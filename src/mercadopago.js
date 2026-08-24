const crypto = require('crypto');

const ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN || '';
const WEBHOOK_SECRET = process.env.MERCADO_PAGO_WEBHOOK_SECRET || '';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://tw-store-application.up.railway.app').replace(/\/$/, '');

function requireMP() {
  if (!ACCESS_TOKEN) {
    const error = new Error('Mercado Pago não configurado. Defina MERCADO_PAGO_ACCESS_TOKEN no Railway.');
    error.status = 503;
    throw error;
  }
}

async function mpRequest(path, options = {}) {
  requireMP();
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${ACCESS_TOKEN}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `Erro Mercado Pago (${response.status}).`);
    error.status = 502;
    error.mercadoPago = data;
    throw error;
  }
  return data;
}

async function createDepositPreference({ depositId, chargeBRL }) {
  const data = await mpRequest('/checkout/preferences', {
    method: 'POST',
    body: JSON.stringify({
      items: [{
        id: depositId,
        title: 'Carteira Tw Store',
        description: 'Recarga de saldo da carteira Hype Equipe',
        quantity: 1,
        currency_id: 'BRL',
        unit_price: Number(chargeBRL.toFixed(2)),
      }],
      external_reference: `deposit:${depositId}`,
      notification_url: `${PUBLIC_BASE_URL}/webhooks/mercado-pago?source_news=webhooks`,
      back_urls: {
        success: `${PUBLIC_BASE_URL}/payment/success`,
        pending: `${PUBLIC_BASE_URL}/payment/pending`,
        failure: `${PUBLIC_BASE_URL}/payment/failure`,
      },
      auto_return: 'approved',
      statement_descriptor: 'HYPE EQUIPE',
    }),
  });
  return data;
}

async function getPayment(paymentId) {
  return mpRequest(`/v1/payments/${encodeURIComponent(paymentId)}`, { method: 'GET' });
}

function parseSignature(xSignature = '') {
  const out = {};
  for (const part of String(xSignature).split(',')) {
    const [key, ...rest] = part.split('=');
    if (key && rest.length) out[key.trim()] = rest.join('=').trim();
  }
  return out;
}

function validateWebhookSignature({ xSignature, xRequestId, dataId }) {
  if (!WEBHOOK_SECRET) {
    const error = new Error('MERCADO_PAGO_WEBHOOK_SECRET não configurado.');
    error.status = 503;
    throw error;
  }
  const { ts, v1 } = parseSignature(xSignature);
  if (!ts || !v1) return false;
  const normalizedId = dataId == null ? '' : String(dataId).toLowerCase();
  const fields = [];
  if (normalizedId) fields.push(`id:${normalizedId};`);
  if (xRequestId) fields.push(`request-id:${xRequestId};`);
  if (ts) fields.push(`ts:${ts};`);
  const manifest = fields.join('');
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(manifest).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(v1, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { createDepositPreference, getPayment, validateWebhookSignature };
