export class SmmApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.status = options.status || 502;
    this.code = options.code || "SMM_API_ERROR";
    this.providerPayload = options.providerPayload;
  }
}

function providerBoolean(value) {
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "sim", "enabled", "available"].includes(String(value || "").toLowerCase());
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeService(raw) {
  const service = Number(raw?.service);
  const min = Number(raw?.min);
  const max = Number(raw?.max);
  const rate = finiteNumber(raw?.rate, Number.NaN);
  if (!Number.isSafeInteger(service) || service <= 0 || !Number.isFinite(rate)) {
    throw new SmmApiError("A SMMHype retornou um serviço inválido.", { providerPayload: raw });
  }
  return {
    service,
    name: String(raw.name || `Serviço #${service}`),
    category: String(raw.category || "Sem categoria"),
    type: String(raw.type || "Default"),
    rate,
    min: Number.isSafeInteger(min) && min > 0 ? min : 1,
    max: Number.isSafeInteger(max) && max >= min ? max : Math.max(1, Number.isSafeInteger(min) ? min : 1),
    refill: providerBoolean(raw.refill),
    cancel: providerBoolean(raw.cancel),
    raw,
  };
}

export class SmmClient {
  constructor(options) {
    this.apiUrl = options.apiUrl;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs || 20_000;
    this.fetch = options.fetchFn || globalThis.fetch;
    this.servicesCache = null;
    this.servicesCacheAt = 0;
  }

  isConfigured() {
    return Boolean(this.apiUrl && this.apiKey);
  }

  async request(parameters) {
    if (!this.isConfigured()) {
      throw new SmmApiError("Configure SMM_API_KEY no Railway antes de usar a integração.", {
        status: 503,
        code: "SMM_NOT_CONFIGURED",
      });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const body = new URLSearchParams({ key: this.apiKey, ...parameters });
      const response = await this.fetch(this.apiUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Hype-Equipe/2.1",
        },
        body,
        signal: controller.signal,
      });
      const responseText = await response.text();
      let payload;
      try {
        payload = responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new SmmApiError("A SMMHype retornou uma resposta que não é JSON.", {
          providerPayload: { status: response.status },
        });
      }
      if (!response.ok) {
        throw new SmmApiError(payload.error || `A SMMHype respondeu com HTTP ${response.status}.`, {
          providerPayload: payload,
        });
      }
      if (payload && typeof payload === "object" && !Array.isArray(payload) && payload.error) {
        throw new SmmApiError(String(payload.error), { providerPayload: payload });
      }
      return payload;
    } catch (error) {
      if (error instanceof SmmApiError) throw error;
      if (error?.name === "AbortError") {
        throw new SmmApiError("A SMMHype demorou demais para responder.", { code: "SMM_TIMEOUT" });
      }
      throw new SmmApiError("Não foi possível conectar à SMMHype.", {
        code: "SMM_NETWORK_ERROR",
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async services(options = {}) {
    const now = Date.now();
    if (!options.fresh && this.servicesCache && now - this.servicesCacheAt < 60_000) {
      return this.servicesCache;
    }
    const payload = await this.request({ action: "services" });
    if (!Array.isArray(payload)) {
      throw new SmmApiError("A lista de serviços da SMMHype veio em formato inesperado.", {
        providerPayload: payload,
      });
    }
    const services = payload.map(normalizeService);
    this.servicesCache = services;
    this.servicesCacheAt = now;
    return services;
  }

  async getService(serviceId, options = {}) {
    const services = await this.services(options);
    const service = services.find((item) => item.service === Number(serviceId));
    if (!service) {
      throw new SmmApiError(`O serviço #${serviceId} não foi encontrado na SMMHype.`, {
        status: 404,
        code: "SERVICE_NOT_FOUND",
      });
    }
    return service;
  }

  async balance() {
    const payload = await this.request({ action: "balance" });
    return {
      balance: finiteNumber(payload.balance),
      currency: String(payload.currency || "USD"),
      raw: payload,
    };
  }

  async addOrder({ serviceId, link, quantity }) {
    const payload = await this.request({
      action: "add",
      service: String(serviceId),
      link,
      quantity: String(quantity),
    });
    if (payload.order == null || String(payload.order).trim() === "") {
      throw new SmmApiError("A SMMHype não devolveu o número do pedido.", { providerPayload: payload });
    }
    return { providerOrderId: String(payload.order), raw: payload };
  }

  async status(providerOrderId) {
    const payload = await this.request({ action: "status", order: String(providerOrderId) });
    return {
      charge: payload.charge == null ? null : finiteNumber(payload.charge),
      startCount: payload.start_count == null ? null : String(payload.start_count),
      status: String(payload.status || "Pending"),
      remains: payload.remains == null ? null : String(payload.remains),
      currency: String(payload.currency || "USD"),
      raw: payload,
    };
  }

  async refill(providerOrderId) {
    const payload = await this.request({ action: "refill", order: String(providerOrderId) });
    return { refillId: payload.refill == null ? null : String(payload.refill), raw: payload };
  }

  async cancel(providerOrderId) {
    const payload = await this.request({ action: "cancel", orders: String(providerOrderId) });
    const result = Array.isArray(payload)
      ? payload.find((item) => String(item.order) === String(providerOrderId)) || payload[0]
      : payload;
    if (result && result.cancel === false) {
      throw new SmmApiError(result.error || "A SMMHype recusou o cancelamento.", { providerPayload: payload });
    }
    return { raw: payload };
  }
}
