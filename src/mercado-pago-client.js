import { createHmac, timingSafeEqual } from "node:crypto";

export class MercadoPagoError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.status = options.status || 502;
    this.code = options.code || "MERCADO_PAGO_ERROR";
    this.payload = options.payload;
  }
}

function money(value) {
  return Number(Number(value).toFixed(2));
}

export class MercadoPagoClient {
  constructor(options = {}) {
    this.accessToken = String(options.accessToken || "").trim();
    this.webhookSecret = String(options.webhookSecret || "").trim();
    this.publicBaseUrl = String(options.publicBaseUrl || "").replace(/\/+$/, "");
    this.timeoutMs = Number(options.timeoutMs || 20_000);
    this.fetch = options.fetchFn || globalThis.fetch;
    this.apiUrl = "https://api.mercadopago.com";
  }

  isConfigured() {
    return Boolean(this.accessToken && this.publicBaseUrl);
  }

  isWebhookConfigured() {
    return Boolean(this.webhookSecret);
  }

  async request(path, options = {}) {
    if (!this.accessToken) {
      throw new MercadoPagoError("Configure MP_ACCESS_TOKEN no Railway antes de aceitar depósitos.", {
        status: 503,
        code: "MP_NOT_CONFIGURED",
      });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(`${this.apiUrl}${path}`, {
        method: options.method || "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.accessToken}`,
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.idempotencyKey ? { "X-Idempotency-Key": String(options.idempotencyKey) } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      let payload = {};
      try { payload = text ? JSON.parse(text) : {}; } catch { /* handled below */ }
      if (!response.ok) {
        throw new MercadoPagoError(
          payload?.message || payload?.error || `Mercado Pago respondeu com HTTP ${response.status}.`,
          { status: 502, code: "MP_API_ERROR", payload },
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof MercadoPagoError) throw error;
      if (error?.name === "AbortError") {
        throw new MercadoPagoError("O Mercado Pago demorou demais para responder.", { code: "MP_TIMEOUT" });
      }
      throw new MercadoPagoError("Não foi possível conectar ao Mercado Pago.", { code: "MP_NETWORK_ERROR" });
    } finally {
      clearTimeout(timer);
    }
  }

  async createPixPayment({ depositId, creditAmount, feeAmount, totalAmount, idempotencyKey, payerEmail }) {
    if (!this.publicBaseUrl) {
      throw new MercadoPagoError("Configure PUBLIC_BASE_URL no Railway.", { status: 503, code: "MP_PUBLIC_URL_MISSING" });
    }
    const email = String(payerEmail || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new MercadoPagoError("A conta precisa ter um e-mail válido para gerar o PIX.", {
        status: 400,
        code: "MP_PAYER_EMAIL_MISSING",
      });
    }
    const payload = await this.request("/v1/payments", {
      method: "POST",
      idempotencyKey,
      body: {
        transaction_amount: money(totalAmount),
        description: `Carteira Tw Store: R$ ${money(creditAmount).toFixed(2)} + taxa de R$ ${money(feeAmount).toFixed(2)}`,
        payment_method_id: "pix",
        external_reference: depositId,
        notification_url: `${this.publicBaseUrl}/webhooks/mercado-pago`,
        payer: { email },
        metadata: {
          deposit_id: depositId,
          credit_amount: money(creditAmount),
          fee_amount: money(feeAmount),
        },
      },
    });
    const transactionData = payload?.point_of_interaction?.transaction_data || {};
    if (!payload?.id || !transactionData.qr_code || !transactionData.qr_code_base64) {
      throw new MercadoPagoError("O Mercado Pago não retornou os dados do QR Code PIX.", {
        code: "MP_PIX_DATA_MISSING",
        payload,
      });
    }
    return {
      paymentId: String(payload.id),
      status: String(payload.status || "pending"),
      qrCode: String(transactionData.qr_code),
      qrCodeBase64: String(transactionData.qr_code_base64),
      ticketUrl: transactionData.ticket_url ? String(transactionData.ticket_url) : null,
      raw: payload,
    };
  }

  async getPayment(paymentId) {
    return this.request(`/v1/payments/${encodeURIComponent(String(paymentId))}`);
  }

  validateWebhook({ xSignature, xRequestId, dataId }) {
    if (!this.webhookSecret) {
      throw new MercadoPagoError("Configure MP_WEBHOOK_SECRET no Railway.", {
        status: 503,
        code: "MP_WEBHOOK_SECRET_MISSING",
      });
    }
    const signature = String(xSignature || "");
    const requestId = String(xRequestId || "");
    const id = String(dataId || "").toLowerCase();
    if (!signature || !requestId || !id) return false;
    const parts = Object.fromEntries(signature.split(",").map((part) => {
      const index = part.indexOf("=");
      return index > 0 ? [part.slice(0, index).trim(), part.slice(index + 1).trim()] : ["", ""];
    }));
    if (!parts.ts || !parts.v1) return false;
    const manifest = `id:${id};request-id:${requestId};ts:${parts.ts};`;
    const expected = createHmac("sha256", this.webhookSecret).update(manifest).digest();
    let received;
    try { received = Buffer.from(parts.v1, "hex"); } catch { return false; }
    return received.length === expected.length && timingSafeEqual(received, expected);
  }
}
