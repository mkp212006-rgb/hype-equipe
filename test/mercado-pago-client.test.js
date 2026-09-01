import assert from "node:assert/strict";
import test from "node:test";
import { MercadoPagoClient, MercadoPagoError } from "../src/mercado-pago-client.js";

function jsonResponse(body, status = 201) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("creates a direct PIX payment and exposes its QR data", async () => {
  let captured = null;
  const client = new MercadoPagoClient({
    accessToken: "APP_USR-test-token",
    publicBaseUrl: "https://store.example.com",
    fetchFn: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return jsonResponse({
        id: 123456789,
        status: "pending",
        point_of_interaction: {
          transaction_data: {
            qr_code: "000201br.gov.bcb.pix-test",
            qr_code_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
            ticket_url: "https://www.mercadopago.com.br/payments/123456789/ticket",
          },
        },
      });
    },
  });

  const payment = await client.createPixPayment({
    depositId: "44444444-4444-4444-8444-444444444444",
    creditAmount: 50,
    feeAmount: 2.5,
    totalAmount: 52.5,
    idempotencyKey: "55555555-5555-4555-8555-555555555555",
    payerEmail: "CLIENTE@EXAMPLE.COM",
  });

  assert.equal(captured.url, "https://api.mercadopago.com/v1/payments");
  assert.equal(captured.options.headers["X-Idempotency-Key"], "55555555-5555-4555-8555-555555555555");
  assert.equal(captured.body.payment_method_id, "pix");
  assert.equal(captured.body.transaction_amount, 52.5);
  assert.equal(captured.body.payer.email, "cliente@example.com");
  assert.equal(captured.body.external_reference, "44444444-4444-4444-8444-444444444444");
  assert.equal(captured.body.notification_url, "https://store.example.com/webhooks/mercado-pago");
  assert.equal(payment.paymentId, "123456789");
  assert.equal(payment.qrCode, "000201br.gov.bcb.pix-test");
  assert.match(payment.qrCodeBase64, /^iVBOR/);
});

test("rejects a PIX response without QR data", async () => {
  const client = new MercadoPagoClient({
    accessToken: "APP_USR-test-token",
    publicBaseUrl: "https://store.example.com",
    fetchFn: async () => jsonResponse({ id: 123, status: "pending" }),
  });

  await assert.rejects(() => client.createPixPayment({
    depositId: "66666666-6666-4666-8666-666666666666",
    creditAmount: 10,
    feeAmount: 0.5,
    totalAmount: 10.5,
    idempotencyKey: "77777777-7777-4777-8777-777777777777",
    payerEmail: "cliente@example.com",
  }), (error) => {
    assert.equal(error instanceof MercadoPagoError, true);
    assert.equal(error.code, "MP_PIX_DATA_MISSING");
    return true;
  });
});
