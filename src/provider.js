const API_URL = process.env.SMMHYPE_API_URL || '';
const API_KEY = process.env.SMMHYPE_API_KEY || '';

function requireProviderConfig() {
  if (!API_URL || !API_KEY) {
    const error = new Error('SMMHype não configurada no servidor. Defina SMMHYPE_API_URL e SMMHYPE_API_KEY.');
    error.status = 503;
    throw error;
  }
}

async function providerRequest(params) {
  requireProviderConfig();
  const body = new URLSearchParams({ key: API_KEY, ...params });
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text || `HTTP ${response.status}` }; }
  if (!response.ok || data?.error) {
    const error = new Error(data?.error || `Erro da SMMHype (${response.status}).`);
    error.status = 502;
    error.provider = data;
    throw error;
  }
  return data;
}

async function listServices() {
  const data = await providerRequest({ action: 'services' });
  return Array.isArray(data) ? data : [];
}

async function getService(serviceId) {
  const services = await listServices();
  const found = services.find((item) => Number(item.service) === Number(serviceId));
  if (!found) {
    const error = new Error(`Serviço #${serviceId} não encontrado na SMMHype.`);
    error.status = 404;
    throw error;
  }
  return found;
}

async function balance() {
  return providerRequest({ action: 'balance' });
}

async function addOrder({ serviceId, link, quantity }) {
  return providerRequest({ action: 'add', service: String(serviceId), link, quantity: String(quantity) });
}

async function status(orderId) {
  return providerRequest({ action: 'status', order: String(orderId) });
}

async function refill(orderId) {
  return providerRequest({ action: 'refill', order: String(orderId) });
}

async function cancel(orderId) {
  return providerRequest({ action: 'cancel', orders: String(orderId) });
}

module.exports = { getService, balance, addOrder, status, refill, cancel };
