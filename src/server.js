const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool, migrate, withTx } = require('./db');
const provider = require('./provider');
const mercadoPago = require('./mercadopago');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || '';
const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || '').trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const PROVIDER_RATE_TO_BRL = Number(process.env.SMMHYPE_RATE_TO_BRL || 1);

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '256kb' }));

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireJwtSecret() {
  if (!JWT_SECRET || JWT_SECRET.length < 24) {
    throw httpError(503, 'JWT_SECRET não configurado ou muito curto no Railway.');
  }
}

function signToken(payload) {
  requireJwtSecret();
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d', issuer: 'hype-equipe' });
}

function auth(requiredRole) {
  return (req, _res, next) => {
    try {
      requireJwtSecret();
      const header = String(req.headers.authorization || '');
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token) throw httpError(401, 'Sessão não informada.');
      const session = jwt.verify(token, JWT_SECRET, { issuer: 'hype-equipe' });
      if (requiredRole && session.role !== requiredRole) throw httpError(403, 'Acesso não autorizado.');
      req.session = session;
      next();
    } catch (error) {
      if (!error.status) error.status = 401;
      next(error);
    }
  };
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function toCents(value, field = 'valor') {
  const n = Number(value);
  if (!Number.isFinite(n)) throw httpError(400, `${field} inválido.`);
  return Math.round(n * 100);
}

function brl(cents) {
  return Number((Number(cents || 0) / 100).toFixed(2));
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function mapService(row, admin = false) {
  const price = brl(row.price_per_thousand_cents);
  const rawProviderRate = num(row.provider_rate);
  const providerRateBRL = Number((rawProviderRate * (Number.isFinite(PROVIDER_RATE_TO_BRL) ? PROVIDER_RATE_TO_BRL : 1)).toFixed(4));
  const displayName = String(row.custom_name || row.name || `Serviço ${row.service_id}`);
  const displayCategory = String(row.category_name || 'Sem categoria');
  const base = {
    service: Number(row.service_id),
    name: displayName,
    customName: row.custom_name || '',
    originalName: row.name,
    description: row.description || '',
    category: displayCategory,
    categoryId: row.category_id == null ? null : Number(row.category_id),
    categoryName: displayCategory,
    providerCategory: row.category || '',
    type: row.type,
    min: Number(row.min_qty),
    max: Number(row.max_qty),
    enabled: row.enabled,
    pricePerThousandBRL: price,
    rateBRL: price,
    rate: price,
    currency: 'BRL',
  };
  if (admin) {
    base.providerRate = rawProviderRate;
    base.providerRateBRL = providerRateBRL;
    base.providerCurrency = process.env.SMMHYPE_PROVIDER_CURRENCY || 'USD';
    base.updatedAt = row.updated_at;
  }
  return base;
}

function mapOrder(row) {
  return {
    id: row.id,
    service: Number(row.service_id),
    serviceId: Number(row.service_id),
    serviceName: row.service_name || `Serviço #${row.service_id}`,
    link: row.link,
    quantity: Number(row.quantity),
    chargeBRL: brl(row.charge_cents),
    amountBRL: brl(row.charge_cents),
    currency: 'BRL',
    providerOrderId: row.provider_order_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDeposit(row) {
  return {
    id: row.id,
    status: row.status,
    amount: brl(row.credit_cents),
    creditBRL: brl(row.credit_cents),
    feeBRL: brl(row.fee_cents),
    chargedBRL: brl(row.charge_cents),
    feePercent: 5,
    currency: 'BRL',
    checkoutUrl: row.checkout_url,
    initPoint: row.checkout_url,
    mercadoPagoPreferenceId: row.mp_preference_id,
    mercadoPagoPaymentId: row.mp_payment_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureMember(userId) {
  const result = await pool.query('SELECT id, name, username, role FROM users WHERE id=$1', [userId]);
  if (!result.rows[0]) throw httpError(401, 'Usuário não encontrado.');
  return result.rows[0];
}

async function getServiceRow(db, serviceId) {
  const result = await db.query(
    `SELECT s.*, c.name AS category_name, c.sort_order AS category_sort_order
     FROM services s
     LEFT JOIN service_categories c ON c.id=s.category_id
     WHERE s.service_id=$1`,
    [serviceId]
  );
  return result.rows[0] || null;
}

async function checkedCategoryId(db, value) {
  if (value == null || value === '') return null;
  const categoryId = Number(value);
  if (!Number.isInteger(categoryId) || categoryId <= 0) throw httpError(400, 'Categoria inválida.');
  const found = await db.query('SELECT id FROM service_categories WHERE id=$1', [categoryId]);
  if (!found.rows[0]) throw httpError(404, 'Categoria não encontrada.');
  return categoryId;
}

function cleanOptionalText(value, maxLength, field) {
  const text = String(value == null ? '' : value).trim();
  if (text.length > maxLength) throw httpError(400, `${field} deve ter no máximo ${maxLength} caracteres.`);
  return text;
}

app.get('/', (_req, res) => {
  res.type('html').send('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Hype Equipe API</title><body><h1>Hype Equipe API</h1><p>Servidor online.</p></body></html>');
});

app.get('/health', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'hype-equipe', currency: 'BRL' });
  } catch (error) { next(error); }
});

app.get('/payment/:status', (req, res) => {
  const messages = {
    success: 'Pagamento aprovado. Volte ao aplicativo e atualize sua carteira.',
    pending: 'Pagamento pendente. O saldo será creditado automaticamente após a aprovação.',
    failure: 'Pagamento não aprovado. Nenhum saldo foi creditado.',
  };
  res.type('html').send(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hype Equipe</title><body style="font-family:sans-serif;padding:32px;max-width:600px;margin:auto"><h1>Hype Equipe</h1><p>${messages[req.params.status] || 'Status do pagamento recebido.'}</p></body></html>`);
});

app.post('/auth/register', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || '');
    if (name.length < 2) throw httpError(400, 'Informe seu nome.');
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw httpError(400, 'Usuário inválido. Use 3 a 40 caracteres, letras, números, ponto, traço ou sublinhado.');
    if (password.length < 6 || password.length > 128) throw httpError(400, 'A senha deve ter entre 6 e 128 caracteres.');
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await withTx(async (db) => {
      const inserted = await db.query(
        `INSERT INTO users(name, username, password_hash, role)
         VALUES($1,$2,$3,'member') RETURNING id,name,username,role,created_at`,
        [name, username, passwordHash]
      );
      await db.query('INSERT INTO wallets(user_id, balance_cents) VALUES($1,0)', [inserted.rows[0].id]);
      return inserted.rows[0];
    });
    res.status(201).json({ ok: true, user: { name: user.name, username: user.username, role: user.role }, balance: 0, currency: 'BRL' });
  } catch (error) {
    if (error.code === '23505') return next(httpError(409, 'Este nome de usuário já está cadastrado.'));
    next(error);
  }
});

app.post('/auth/login', async (req, res, next) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || '');
    const result = await pool.query('SELECT id,name,username,password_hash,role FROM users WHERE username=$1', [username]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) throw httpError(401, 'Usuário ou senha inválidos.');
    const token = signToken({ sub: user.id, role: 'member', username: user.username });
    res.json({ token, member: user.name, username: user.username, role: 'member', user: { name: user.name, username: user.username, role: 'member' } });
  } catch (error) { next(error); }
});

app.post('/admin/login', async (req, res, next) => {
  try {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) throw httpError(503, 'Credenciais do administrador ainda não foram configuradas no Railway.');
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const userOk = crypto.timingSafeEqual(Buffer.from(username.padEnd(Math.max(username.length, ADMIN_USERNAME.length), '\0')), Buffer.from(ADMIN_USERNAME.padEnd(Math.max(username.length, ADMIN_USERNAME.length), '\0')));
    const passOk = crypto.timingSafeEqual(Buffer.from(password.padEnd(Math.max(password.length, ADMIN_PASSWORD.length), '\0')), Buffer.from(ADMIN_PASSWORD.padEnd(Math.max(password.length, ADMIN_PASSWORD.length), '\0')));
    if (!userOk || !passOk) throw httpError(401, 'Usuário ou senha do administrador inválidos.');
    const token = signToken({ sub: 'admin', role: 'admin', username: ADMIN_USERNAME });
    res.json({ token, member: ADMIN_USERNAME, username: ADMIN_USERNAME, role: 'admin' });
  } catch (error) { next(error); }
});

app.get('/api/info', auth(), async (req, res, next) => {
  try {
    if (req.session.role === 'admin') return res.json({ member: req.session.username, username: req.session.username, role: 'admin' });
    const user = await ensureMember(req.session.sub);
    res.json({ member: user.name, username: user.username, role: 'member' });
  } catch (error) { next(error); }
});

app.get('/api/services', auth('member'), async (_req, res, next) => {
  try {
    const result = await pool.query(`SELECT s.*, c.name AS category_name, c.sort_order AS category_sort_order FROM services s LEFT JOIN service_categories c ON c.id=s.category_id WHERE s.enabled=TRUE ORDER BY c.sort_order NULLS LAST,c.name NULLS LAST,COALESCE(s.custom_name,s.name)`);
    res.json(result.rows.map((row) => mapService(row, false)));
  } catch (error) { next(error); }
});

app.get('/api/wallet', auth('member'), async (req, res, next) => {
  try {
    const wallet = await pool.query('SELECT balance_cents, updated_at FROM wallets WHERE user_id=$1', [req.session.sub]);
    if (!wallet.rows[0]) throw httpError(404, 'Carteira não encontrada.');
    const txs = await pool.query(
      'SELECT id,type,amount_cents,description,reference,created_at FROM wallet_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',
      [req.session.sub]
    );
    res.json({
      balance: brl(wallet.rows[0].balance_cents),
      balanceBRL: brl(wallet.rows[0].balance_cents),
      currency: 'BRL',
      updatedAt: wallet.rows[0].updated_at,
      transactions: txs.rows.map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: brl(tx.amount_cents),
        amountBRL: brl(tx.amount_cents),
        description: tx.description,
        reference: tx.reference,
        createdAt: tx.created_at,
      })),
    });
  } catch (error) { next(error); }
});

app.get('/api/balance', auth('member'), async (req, res, next) => {
  try {
    const result = await pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [req.session.sub]);
    if (!result.rows[0]) throw httpError(404, 'Carteira não encontrada.');
    res.json({ balance: brl(result.rows[0].balance_cents), currency: 'BRL' });
  } catch (error) { next(error); }
});

app.post('/api/wallet/deposits', auth('member'), async (req, res, next) => {
  try {
    const creditCents = toCents(req.body?.amount, 'Valor do depósito');
    if (creditCents < 100) throw httpError(400, 'O depósito mínimo é de R$ 1,00.');
    if (creditCents > 5000000) throw httpError(400, 'O depósito máximo por operação é de R$ 50.000,00.');
    const idempotencyKey = String(req.body?.idempotencyKey || '').trim();
    if (idempotencyKey.length < 8 || idempotencyKey.length > 160) throw httpError(400, 'Chave de idempotência inválida.');
    const feeCents = Math.round(creditCents * 0.05);
    const chargeCents = creditCents + feeCents;

    let deposit;
    const existing = await pool.query('SELECT * FROM deposits WHERE user_id=$1 AND idempotency_key=$2', [req.session.sub, idempotencyKey]);
    if (existing.rows[0]) deposit = existing.rows[0];
    else {
      const inserted = await pool.query(
        `INSERT INTO deposits(user_id,credit_cents,fee_cents,charge_cents,status,idempotency_key)
         VALUES($1,$2,$3,$4,'pending',$5) RETURNING *`,
        [req.session.sub, creditCents, feeCents, chargeCents, idempotencyKey]
      );
      deposit = inserted.rows[0];
    }

    if (!deposit.checkout_url && deposit.status !== 'approved') {
      try {
        const preference = await mercadoPago.createDepositPreference({ depositId: deposit.id, chargeBRL: brl(deposit.charge_cents) });
        const checkoutUrl = preference.init_point || preference.sandbox_init_point;
        const updated = await pool.query(
          `UPDATE deposits SET mp_preference_id=$2,checkout_url=$3,provider_payload=$4,status='pending',updated_at=NOW()
           WHERE id=$1 RETURNING *`,
          [deposit.id, preference.id || null, checkoutUrl || null, preference]
        );
        deposit = updated.rows[0];
      } catch (error) {
        await pool.query(`UPDATE deposits SET status='payment_creation_error',updated_at=NOW() WHERE id=$1`, [deposit.id]);
        throw error;
      }
    }

    res.status(201).json(mapDeposit(deposit));
  } catch (error) { next(error); }
});

app.get('/api/wallet/deposits/:id', auth('member'), async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM deposits WHERE id=$1 AND user_id=$2', [req.params.id, req.session.sub]);
    if (!result.rows[0]) throw httpError(404, 'Depósito não encontrado.');
    res.json(mapDeposit(result.rows[0]));
  } catch (error) { next(error); }
});

app.post('/webhooks/mercadopago', async (req, res, next) => {
  try {
    const dataId = req.query['data.id'];
    const signatureOk = mercadoPago.validateWebhookSignature({
      xSignature: req.headers['x-signature'],
      xRequestId: req.headers['x-request-id'],
      dataId,
    });
    if (!signatureOk) throw httpError(401, 'Assinatura do Mercado Pago inválida.');

    const paymentId = String(dataId || '');
    if (!paymentId) throw httpError(400, 'ID do pagamento ausente.');
    const payment = await mercadoPago.getPayment(paymentId);
    const reference = String(payment.external_reference || '');
    if (!reference.startsWith('deposit:')) return res.sendStatus(200);
    const depositId = reference.slice('deposit:'.length);

    await withTx(async (db) => {
      const depResult = await db.query('SELECT * FROM deposits WHERE id=$1 FOR UPDATE', [depositId]);
      const deposit = depResult.rows[0];
      if (!deposit) return;

      await db.query('UPDATE deposits SET provider_payload=$2,mp_payment_id=COALESCE(mp_payment_id,$3),updated_at=NOW() WHERE id=$1', [deposit.id, payment, String(payment.id)]);
      if (payment.status !== 'approved' || deposit.status === 'approved') return;

      const paidCents = Math.round(Number(payment.transaction_amount || 0) * 100);
      if (String(payment.currency_id || '').toUpperCase() !== 'BRL') throw httpError(400, 'Pagamento não está em BRL.');
      if (paidCents !== Number(deposit.charge_cents)) throw httpError(409, 'Valor aprovado não corresponde ao valor da recarga.');

      await db.query('SELECT user_id FROM wallets WHERE user_id=$1 FOR UPDATE', [deposit.user_id]);
      await db.query('UPDATE wallets SET balance_cents=balance_cents+$2,updated_at=NOW() WHERE user_id=$1', [deposit.user_id, deposit.credit_cents]);
      await db.query(
        `INSERT INTO wallet_transactions(user_id,type,amount_cents,description,reference)
         VALUES($1,'deposit',$2,'Crédito confirmado pelo Mercado Pago',$3)`,
        [deposit.user_id, deposit.credit_cents, `deposit:${deposit.id}:payment:${payment.id}`]
      );
      await db.query(`UPDATE deposits SET status='approved',mp_payment_id=$2,updated_at=NOW() WHERE id=$1`, [deposit.id, String(payment.id)]);
    });

    res.sendStatus(200);
  } catch (error) { next(error); }
});

app.get('/api/orders', auth('member'), async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT o.*,COALESCE(s.custom_name,s.name) AS service_name FROM orders o LEFT JOIN services s ON s.service_id=o.service_id WHERE o.user_id=$1 ORDER BY o.created_at DESC LIMIT 300`, [req.session.sub]);
    res.json(result.rows.map(mapOrder));
  } catch (error) { next(error); }
});

app.post('/api/orders', auth('member'), async (req, res, next) => {
  let order;
  try {
    const serviceId = Number(req.body?.serviceId);
    const quantity = Number(req.body?.quantity);
    const link = String(req.body?.link || '').trim();
    const idempotencyKey = String(req.body?.idempotencyKey || '').trim();
    if (!Number.isInteger(serviceId) || serviceId <= 0) throw httpError(400, 'Serviço inválido.');
    if (!Number.isInteger(quantity) || quantity <= 0) throw httpError(400, 'Quantidade inválida.');
    if (!/^https?:\/\//i.test(link)) throw httpError(400, 'Informe um link válido começando com http:// ou https://.');
    if (idempotencyKey.length < 8 || idempotencyKey.length > 160) throw httpError(400, 'Chave de idempotência inválida.');

    const already = await pool.query('SELECT * FROM orders WHERE user_id=$1 AND idempotency_key=$2', [req.session.sub, idempotencyKey]);
    if (already.rows[0]) return res.json(mapOrder(already.rows[0]));

    order = await withTx(async (db) => {
      const serviceResult = await db.query('SELECT * FROM services WHERE service_id=$1 AND enabled=TRUE', [serviceId]);
      const service = serviceResult.rows[0];
      if (!service) throw httpError(404, 'Serviço indisponível.');
      if (quantity < Number(service.min_qty) || quantity > Number(service.max_qty)) throw httpError(400, `A quantidade deve ficar entre ${service.min_qty} e ${service.max_qty}.`);
      const chargeCents = Math.round((Number(service.price_per_thousand_cents) * quantity) / 1000);
      if (chargeCents <= 0) throw httpError(400, 'O valor calculado do pedido é inválido.');

      const walletResult = await db.query('SELECT balance_cents FROM wallets WHERE user_id=$1 FOR UPDATE', [req.session.sub]);
      if (!walletResult.rows[0]) throw httpError(404, 'Carteira não encontrada.');
      if (Number(walletResult.rows[0].balance_cents) < chargeCents) throw httpError(402, `Saldo insuficiente. Pedido: R$ ${brl(chargeCents).toFixed(2)}.`);

      await db.query('UPDATE wallets SET balance_cents=balance_cents-$2,updated_at=NOW() WHERE user_id=$1', [req.session.sub, chargeCents]);
      const inserted = await db.query(
        `INSERT INTO orders(user_id,service_id,link,quantity,charge_cents,status,idempotency_key)
         VALUES($1,$2,$3,$4,$5,'processing',$6) RETURNING *`,
        [req.session.sub, serviceId, link, quantity, chargeCents, idempotencyKey]
      );
      await db.query(
        `INSERT INTO wallet_transactions(user_id,type,amount_cents,description,reference)
         VALUES($1,'order',-$2,$3,$4)`,
        [req.session.sub, chargeCents, `Pedido do serviço #${serviceId}`, `order:${inserted.rows[0].id}`]
      );
      return inserted.rows[0];
    });

    try {
      const providerOrder = await provider.addOrder({ serviceId, link, quantity });
      const providerOrderId = String(providerOrder.order || providerOrder.id || '');
      if (!providerOrderId) throw httpError(502, 'A SMMHype não retornou o ID do pedido.');
      const updated = await pool.query(
        `UPDATE orders SET provider_order_id=$2,status='Pending',provider_payload=$3,updated_at=NOW() WHERE id=$1 RETURNING *`,
        [order.id, providerOrderId, providerOrder]
      );
      return res.status(201).json(mapOrder(updated.rows[0]));
    } catch (providerError) {
      await withTx(async (db) => {
        const locked = await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [order.id]);
        const current = locked.rows[0];
        if (!current || current.refunded) return;
        await db.query('SELECT user_id FROM wallets WHERE user_id=$1 FOR UPDATE', [current.user_id]);
        await db.query('UPDATE wallets SET balance_cents=balance_cents+$2,updated_at=NOW() WHERE user_id=$1', [current.user_id, current.charge_cents]);
        await db.query(`UPDATE orders SET refunded=TRUE,status='provider_error',provider_payload=$2,updated_at=NOW() WHERE id=$1`, [current.id, providerError.provider || { error: providerError.message }]);
        await db.query(
          `INSERT INTO wallet_transactions(user_id,type,amount_cents,description,reference)
           VALUES($1,'refund',$2,'Estorno automático: pedido não enviado ao provedor',$3)`,
          [current.user_id, current.charge_cents, `order:${current.id}:refund`]
        );
      });
      throw providerError;
    }
  } catch (error) {
    if (error.code === '23505' && req.body?.idempotencyKey) {
      const existing = await pool.query('SELECT * FROM orders WHERE user_id=$1 AND idempotency_key=$2', [req.session.sub, String(req.body.idempotencyKey)]);
      if (existing.rows[0]) return res.json(mapOrder(existing.rows[0]));
    }
    next(error);
  }
});

app.post('/api/orders/:id/refresh', auth('member'), async (req, res, next) => {
  try {
    const found = await pool.query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [req.params.id, req.session.sub]);
    const order = found.rows[0];
    if (!order) throw httpError(404, 'Pedido não encontrado.');
    if (!order.provider_order_id) throw httpError(409, 'Pedido ainda não possui ID do provedor.');
    const data = await provider.status(order.provider_order_id);
    const updated = await pool.query('UPDATE orders SET status=$2,provider_payload=$3,updated_at=NOW() WHERE id=$1 RETURNING *', [order.id, String(data.status || order.status), data]);
    res.json(mapOrder(updated.rows[0]));
  } catch (error) { next(error); }
});

app.post('/api/orders/:id/refill', auth('member'), async (req, res, next) => {
  try {
    const found = await pool.query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [req.params.id, req.session.sub]);
    const order = found.rows[0];
    if (!order) throw httpError(404, 'Pedido não encontrado.');
    if (!order.provider_order_id) throw httpError(409, 'Pedido ainda não possui ID do provedor.');
    await provider.refill(order.provider_order_id);
    res.json(mapOrder(order));
  } catch (error) { next(error); }
});

app.post('/api/orders/:id/cancel', auth('member'), async (req, res, next) => {
  try {
    const found = await pool.query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [req.params.id, req.session.sub]);
    const order = found.rows[0];
    if (!order) throw httpError(404, 'Pedido não encontrado.');
    if (!order.provider_order_id) throw httpError(409, 'Pedido ainda não possui ID do provedor.');
    await provider.cancel(order.provider_order_id);
    res.json(mapOrder(order));
  } catch (error) { next(error); }
});

app.get('/admin/categories', auth('admin'), async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT c.id,c.name,c.sort_order,c.created_at,c.updated_at,COUNT(s.service_id)::int AS service_count
       FROM service_categories c
       LEFT JOIN services s ON s.category_id=c.id
       GROUP BY c.id
       ORDER BY c.sort_order,c.name`
    );
    res.json(result.rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      sortOrder: Number(row.sort_order || 0),
      serviceCount: Number(row.service_count || 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })));
  } catch (error) { next(error); }
});

app.post('/admin/categories', auth('admin'), async (req, res, next) => {
  try {
    const name = cleanOptionalText(req.body?.name, 50, 'Nome da categoria');
    if (name.length < 2) throw httpError(400, 'O nome da categoria deve ter pelo menos 2 caracteres.');
    const maxOrder = await pool.query('SELECT COALESCE(MAX(sort_order),-1)+1 AS next_order FROM service_categories');
    const result = await pool.query(
      'INSERT INTO service_categories(name,sort_order) VALUES($1,$2) RETURNING *',
      [name, Number(maxOrder.rows[0].next_order || 0)]
    );
    const row = result.rows[0];
    res.status(201).json({ id: Number(row.id), name: row.name, sortOrder: Number(row.sort_order), serviceCount: 0 });
  } catch (error) {
    if (error.code === '23505') return next(httpError(409, 'Já existe uma categoria com esse nome.'));
    next(error);
  }
});

app.patch('/admin/categories/:categoryId', auth('admin'), async (req, res, next) => {
  try {
    const categoryId = Number(req.params.categoryId);
    if (!Number.isInteger(categoryId) || categoryId <= 0) throw httpError(400, 'Categoria inválida.');
    const current = await pool.query('SELECT * FROM service_categories WHERE id=$1', [categoryId]);
    if (!current.rows[0]) throw httpError(404, 'Categoria não encontrada.');
    const name = req.body?.name == null ? current.rows[0].name : cleanOptionalText(req.body.name, 50, 'Nome da categoria');
    if (name.length < 2) throw httpError(400, 'O nome da categoria deve ter pelo menos 2 caracteres.');
    const sortOrder = req.body?.sortOrder == null ? Number(current.rows[0].sort_order) : Number(req.body.sortOrder);
    if (!Number.isInteger(sortOrder) || sortOrder < 0) throw httpError(400, 'Ordem da categoria inválida.');
    const result = await pool.query(
      'UPDATE service_categories SET name=$2,sort_order=$3,updated_at=NOW() WHERE id=$1 RETURNING *',
      [categoryId, name, sortOrder]
    );
    const row = result.rows[0];
    res.json({ id: Number(row.id), name: row.name, sortOrder: Number(row.sort_order) });
  } catch (error) {
    if (error.code === '23505') return next(httpError(409, 'Já existe uma categoria com esse nome.'));
    next(error);
  }
});

app.delete('/admin/categories/:categoryId', auth('admin'), async (req, res, next) => {
  try {
    const categoryId = Number(req.params.categoryId);
    if (!Number.isInteger(categoryId) || categoryId <= 0) throw httpError(400, 'Categoria inválida.');
    const result = await pool.query('DELETE FROM service_categories WHERE id=$1 RETURNING id,name', [categoryId]);
    if (!result.rows[0]) throw httpError(404, 'Categoria não encontrada.');
    res.json({ ok: true, id: Number(result.rows[0].id), name: result.rows[0].name });
  } catch (error) { next(error); }
});

app.get('/admin/services', auth('admin'), async (_req, res, next) => {
  try {
    const result = await pool.query(`SELECT s.*, c.name AS category_name, c.sort_order AS category_sort_order FROM services s LEFT JOIN service_categories c ON c.id=s.category_id ORDER BY c.sort_order NULLS LAST,c.name NULLS LAST,COALESCE(s.custom_name,s.name)`);
    res.json(result.rows.map((row) => mapService(row, true)));
  } catch (error) { next(error); }
});

app.post('/admin/services', auth('admin'), async (req, res, next) => {
  try {
    const serviceId = Number(req.body?.serviceId);
    const priceCents = toCents(req.body?.pricePerThousandBRL, 'Preço por 1.000');
    if (!Number.isInteger(serviceId) || serviceId <= 0) throw httpError(400, 'ID do serviço inválido.');
    if (priceCents <= 0) throw httpError(400, 'O preço por 1.000 deve ser maior que zero.');
    const customName = cleanOptionalText(req.body?.customName, 90, 'Nome personalizado') || null;
    const description = cleanOptionalText(req.body?.description, 500, 'Descrição');
    const categoryId = await checkedCategoryId(pool, req.body?.categoryId);
    const remote = await provider.getService(serviceId);
    await pool.query(
      `INSERT INTO services(service_id,name,custom_name,description,category,category_id,type,provider_rate,min_qty,max_qty,price_per_thousand_cents,enabled,provider_payload)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12)
       ON CONFLICT(service_id) DO UPDATE SET
         name=EXCLUDED.name,
         custom_name=COALESCE(EXCLUDED.custom_name,services.custom_name),
         description=CASE WHEN EXCLUDED.description<>'' THEN EXCLUDED.description ELSE services.description END,
         category=EXCLUDED.category,
         category_id=CASE WHEN $13::boolean THEN EXCLUDED.category_id ELSE services.category_id END,
         type=EXCLUDED.type,provider_rate=EXCLUDED.provider_rate,
         min_qty=EXCLUDED.min_qty,max_qty=EXCLUDED.max_qty,price_per_thousand_cents=EXCLUDED.price_per_thousand_cents,
         provider_payload=EXCLUDED.provider_payload,updated_at=NOW()`,
      [
        serviceId,
        String(remote.name || `Serviço ${serviceId}`),
        customName,
        description,
        String(remote.category || ''),
        categoryId,
        String(remote.type || ''),
        num(remote.rate),
        Number(remote.min || 1),
        Number(remote.max || 1000000),
        priceCents,
        remote,
        Object.prototype.hasOwnProperty.call(req.body || {}, 'categoryId'),
      ]
    );
    const row = await getServiceRow(pool, serviceId);
    res.status(201).json(mapService(row, true));
  } catch (error) { next(error); }
});

app.patch('/admin/services/:serviceId', auth('admin'), async (req, res, next) => {
  try {
    const serviceId = Number(req.params.serviceId);
    const current = await pool.query('SELECT * FROM services WHERE service_id=$1', [serviceId]);
    if (!current.rows[0]) throw httpError(404, 'Serviço não cadastrado.');
    let priceCents = current.rows[0].price_per_thousand_cents;
    if (req.body?.pricePerThousandBRL != null) {
      priceCents = toCents(req.body.pricePerThousandBRL, 'Preço por 1.000');
      if (priceCents <= 0) throw httpError(400, 'O preço por 1.000 deve ser maior que zero.');
    }
    const enabled = req.body?.enabled == null ? current.rows[0].enabled : Boolean(req.body.enabled);
    const hasCustomName = Object.prototype.hasOwnProperty.call(req.body || {}, 'customName');
    const customName = hasCustomName ? (cleanOptionalText(req.body.customName, 90, 'Nome personalizado') || null) : current.rows[0].custom_name;
    const hasDescription = Object.prototype.hasOwnProperty.call(req.body || {}, 'description');
    const description = hasDescription ? cleanOptionalText(req.body.description, 500, 'Descrição') : current.rows[0].description;
    const hasCategory = Object.prototype.hasOwnProperty.call(req.body || {}, 'categoryId');
    const categoryId = hasCategory ? await checkedCategoryId(pool, req.body.categoryId) : current.rows[0].category_id;
    await pool.query(
      `UPDATE services
       SET price_per_thousand_cents=$2,enabled=$3,custom_name=$4,description=$5,category_id=$6,updated_at=NOW()
       WHERE service_id=$1`,
      [serviceId, priceCents, enabled, customName, description, categoryId]
    );
    const row = await getServiceRow(pool, serviceId);
    res.json(mapService(row, true));
  } catch (error) { next(error); }
});

app.post('/admin/services/:serviceId/sync', auth('admin'), async (req, res, next) => {
  try {
    const serviceId = Number(req.params.serviceId);
    const current = await pool.query('SELECT * FROM services WHERE service_id=$1', [serviceId]);
    if (!current.rows[0]) throw httpError(404, 'Serviço não cadastrado.');
    const remote = await provider.getService(serviceId);
    await pool.query(
      `UPDATE services SET name=$2,category=$3,type=$4,provider_rate=$5,min_qty=$6,max_qty=$7,provider_payload=$8,updated_at=NOW()
       WHERE service_id=$1`,
      [serviceId, String(remote.name || current.rows[0].name), String(remote.category || ''), String(remote.type || ''), num(remote.rate), Number(remote.min || current.rows[0].min_qty), Number(remote.max || current.rows[0].max_qty), remote]
    );
    const row = await getServiceRow(pool, serviceId);
    res.json(mapService(row, true));
  } catch (error) { next(error); }
});

app.delete('/admin/services/:serviceId', auth('admin'), async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM services WHERE service_id=$1 RETURNING service_id', [Number(req.params.serviceId)]);
    if (!result.rows[0]) throw httpError(404, 'Serviço não cadastrado.');
    res.json({ ok: true, service: Number(result.rows[0].service_id) });
  } catch (error) {
    if (error.code === '23503') return next(httpError(409, 'Este serviço possui pedidos e não pode ser removido. Pause-o em vez de excluir.'));
    next(error);
  }
});

app.get('/admin/summary', auth('admin'), async (_req, res, next) => {
  try {
    const [services, orders, users, deposits] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM services WHERE enabled=TRUE'),
      pool.query('SELECT COUNT(*)::int AS count FROM orders'),
      pool.query('SELECT COUNT(*)::int AS count FROM users'),
      pool.query(`SELECT COALESCE(SUM(credit_cents),0)::bigint AS total FROM deposits WHERE status='approved'`),
    ]);
    let smmBalance = null;
    try { smmBalance = await provider.balance(); } catch { /* painel segue funcionando sem fornecedor */ }
    res.json({
      enabledServices: services.rows[0].count,
      orders: orders.rows[0].count,
      users: users.rows[0].count,
      approvedDepositsBRL: brl(deposits.rows[0].total),
      balance: smmBalance ? num(smmBalance.balance) : null,
      currency: smmBalance?.currency || process.env.SMMHYPE_PROVIDER_CURRENCY || 'USD',
    });
  } catch (error) { next(error); }
});

app.post('/admin/team-code', auth('admin'), (_req, res) => {
  res.status(410).json({ error: 'O código compartilhado foi desativado. Agora cada usuário possui cadastro e senha próprios.' });
});

app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

app.use((error, _req, res, _next) => {
  const status = Number(error.status || 500);
  if (status >= 500) console.error(error);
  res.status(status).json({ error: error.message || 'Erro interno do servidor.' });
});

migrate()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => console.log(`Hype Equipe API ouvindo na porta ${PORT}`));
  })
  .catch((error) => {
    console.error('Falha ao inicializar o banco:', error);
    process.exit(1);
  });
