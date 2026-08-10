import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import pg from "pg";
import { verifyToken } from "./crypto.js";
import { HttpError } from "./validators.js";

const { Pool } = pg;

function bearerToken(req) {
  const authorization = req.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new HttpError(401, "Sessão não informada.");
  return authorization.slice(7).trim();
}

function cleanText(value, label, { min = 0, max = 200 } = {}) {
  const result = String(value == null ? "" : value).trim();
  if (result.length < min || result.length > max) {
    throw new HttpError(400, `${label} deve ter entre ${min} e ${max} caracteres.`);
  }
  return result;
}

function positiveInteger(value, label, { min = 1, max = 1000000 } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new HttpError(400, `${label} inválido.`);
  }
  return parsed;
}

function money(value, label) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1_000_000) {
    throw new HttpError(400, `${label} inválido.`);
  }
  return Number(parsed.toFixed(2));
}

function userType(value) {
  const type = String(value || "ssh").trim().toLowerCase();
  if (!["ssh", "v2ray", "xray"].includes(type)) {
    throw new HttpError(400, "Tipo de acesso inválido. Use ssh, v2ray ou xray.");
  }
  return type;
}

function safeProviderPayload(value) {
  if (!value || typeof value !== "object") return {};
  const clone = JSON.parse(JSON.stringify(value));
  if (clone?.data?.senha) clone.data.senha = "[redacted]";
  if (clone?.senha) clone.senha = "[redacted]";
  return clone;
}

function encryptionKey(secret) {
  return createHash("sha256").update(String(secret)).digest();
}

function encryptSecret(value, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptSecret(value, secret) {
  if (!value) return "";
  const parts = String(value).split(":");
  if (parts.length !== 4 || parts[0] !== "v1") return "";
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(parts[1], "base64"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

function productFromRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description || "",
    priceBRL: Number(row.price_brl),
    durationDays: Number(row.duration_days),
    connectionLimit: Number(row.connection_limit),
    accessType: row.access_type,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function orderFromRow(row, config, { includePassword = true } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    productId: Number(row.product_id),
    productName: row.product_name,
    priceBRL: Number(row.price_brl),
    currency: "BRL",
    durationDays: Number(row.duration_days),
    connectionLimit: Number(row.connection_limit),
    accessType: row.access_type,
    login: row.provider_login || "",
    password: includePassword ? decryptSecret(row.provider_password_enc, config.jwtSecret) : "",
    uuid: row.provider_uuid || "",
    expiresAt: row.expires_at,
    providerExpiresText: row.provider_expires_text || "",
    status: row.status,
    error: row.error_message || "",
    createdBy: row.username,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function generateProviderLogin(username) {
  const stem = String(username || "user").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "user";
  return `tw${stem}${randomBytes(3).toString("hex")}`.slice(0, 24);
}

function generateProviderPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(14);
  let result = "";
  for (const byte of bytes) result += alphabet[byte % alphabet.length];
  return result;
}

function fallbackExpiry(days) {
  return new Date(Date.now() + Number(days) * 86_400_000);
}

class JardelVpnClient {
  constructor(config) {
    this.apiUrl = String(config.jardelApiUrl || "").replace(/\/+$/, "");
    this.apiAccount = String(config.jardelApiAccount || "").trim();
    this.createPath = String(config.jardelApiCreatePath || "/api/usuario/criar.php");
    this.timeoutMs = Number(config.jardelApiTimeoutMs || 20_000);
  }

  isConfigured() {
    return Boolean(this.apiUrl && this.apiAccount && this.createPath);
  }

  async createUser({ login, password, days, limit, name, type }) {
    if (!this.isConfigured()) throw new HttpError(503, "A API VPN ainda não foi configurada no servidor.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const uuid = type === "v2ray" || type === "xray" ? randomUUID() : undefined;
      const payload = {
        login,
        senha: password,
        dias: days,
        limite: limit,
        nome: name,
        tipo: type,
        ...(uuid ? { uuid } : {}),
      };
      const response = await fetch(`${this.apiUrl}${this.createPath.startsWith("/") ? "" : "/"}${this.createPath}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiAccount}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const raw = await response.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw.slice(0, 500) }; }
      if (!response.ok || data?.success === false) {
        const message = data?.error || data?.message || `A API VPN respondeu HTTP ${response.status}.`;
        throw Object.assign(new Error(message), { status: response.status, providerPayload: safeProviderPayload(data) });
      }
      return {
        login: data?.data?.login || login,
        password: data?.data?.senha || password,
        uuid: data?.data?.uuid || uuid || "",
        expiresText: data?.data?.expira || data?.data?.nova_expira || "",
        raw: safeProviderPayload(data),
      };
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("A API VPN demorou demais para responder.");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function createVpnFeatures({ config, db }) {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on("error", (error) => console.error("PostgreSQL VPN pool error", { message: error.message }));

  await pool.query(`
    CREATE TABLE IF NOT EXISTS vpn_products (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_brl NUMERIC(18,2) NOT NULL CHECK (price_brl > 0),
      duration_days INTEGER NOT NULL DEFAULT 30 CHECK (duration_days BETWEEN 1 AND 365),
      connection_limit INTEGER NOT NULL DEFAULT 1 CHECK (connection_limit BETWEEN 1 AND 50),
      access_type TEXT NOT NULL DEFAULT 'ssh' CHECK (access_type IN ('ssh','v2ray','xray')),
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS vpn_orders (
      id UUID PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      product_id BIGINT NOT NULL REFERENCES vpn_products(id),
      username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
      product_name TEXT NOT NULL,
      price_brl NUMERIC(18,2) NOT NULL CHECK (price_brl > 0),
      duration_days INTEGER NOT NULL,
      connection_limit INTEGER NOT NULL,
      access_type TEXT NOT NULL,
      provider_login TEXT,
      provider_password_enc TEXT,
      provider_uuid TEXT,
      provider_expires_text TEXT,
      expires_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'submitting',
      error_message TEXT,
      provider_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS vpn_orders_username_idx ON vpn_orders(username, created_at DESC);
    CREATE INDEX IF NOT EXISTS vpn_orders_product_idx ON vpn_orders(product_id, created_at DESC);
  `);

  const provider = new JardelVpnClient(config);
  const router = express.Router();
  router.use(helmet({ crossOriginResourcePolicy: false }));
  router.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Accept", "Authorization", "Content-Type", "X-Request-Id"],
    maxAge: 86_400,
  }));
  router.use(express.json({ limit: "64kb", strict: true }));

  async function authenticate(req, _res, next) {
    try {
      const payload = verifyToken(bearerToken(req), config.jwtSecret);
      if (payload.role === "member") {
        const user = await db.getUser(payload.sub);
        if (!user || !user.active || Number(payload.version) !== Number(user.token_version)) {
          throw new HttpError(401, "A sessão do usuário expirou.");
        }
      } else if (payload.role === "admin") {
        const admin = await db.getAdmin(payload.sub);
        if (!admin || Number(payload.version) !== Number(admin.token_version)) {
          throw new HttpError(401, "A sessão administrativa expirou.");
        }
      } else {
        throw new HttpError(401, "Sessão inválida.");
      }
      req.auth = payload;
      next();
    } catch (error) {
      next(error instanceof HttpError ? error : new HttpError(401, error.message || "Sessão inválida."));
    }
  }

  function requireRole(role) {
    return (req, _res, next) => {
      if (req.auth?.role !== role) return next(new HttpError(403, "Você não tem permissão para esta ação."));
      next();
    };
  }

  router.get("/api/vpn/products", authenticate, requireRole("member"), async (_req, res) => {
    const result = await pool.query("SELECT * FROM vpn_products WHERE enabled = TRUE ORDER BY id ASC");
    res.json(result.rows.map(productFromRow));
  });

  router.get("/api/vpn/orders", authenticate, requireRole("member"), async (req, res) => {
    const result = await pool.query("SELECT * FROM vpn_orders WHERE username = $1 ORDER BY created_at DESC LIMIT 100", [req.auth.sub]);
    res.json(result.rows.map((row) => orderFromRow(row, config)));
  });

  router.post("/api/vpn/orders", authenticate, requireRole("member"), async (req, res) => {
    const productId = positiveInteger(req.body?.productId, "Produto", { max: Number.MAX_SAFE_INTEGER });
    const idempotencyKey = cleanText(req.body?.idempotencyKey, "Chave do pedido", { min: 12, max: 128 });
    const client = await pool.connect();
    let orderId;
    let product;
    let memberName = req.auth.member || req.auth.sub;
    try {
      await client.query("BEGIN");
      const existing = await client.query("SELECT * FROM vpn_orders WHERE idempotency_key = $1 FOR UPDATE", [idempotencyKey]);
      if (existing.rowCount) {
        if (existing.rows[0].username !== req.auth.sub) throw new HttpError(409, "Chave de pedido já utilizada.");
        await client.query("COMMIT");
        return res.json(orderFromRow(existing.rows[0], config));
      }
      const productResult = await client.query("SELECT * FROM vpn_products WHERE id = $1 AND enabled = TRUE FOR SHARE", [productId]);
      if (!productResult.rowCount) throw new HttpError(404, "Esse acesso VPN não está disponível.");
      product = productFromRow(productResult.rows[0]);
      const userResult = await client.query("SELECT name FROM users WHERE username = $1", [req.auth.sub]);
      if (userResult.rows[0]?.name) memberName = userResult.rows[0].name;
      const wallet = await client.query("SELECT balance FROM wallets WHERE username = $1 FOR UPDATE", [req.auth.sub]);
      if (!wallet.rowCount) throw new HttpError(404, "Carteira não encontrada.");
      const currentBalance = Number(wallet.rows[0].balance);
      if (currentBalance + 0.00001 < product.priceBRL) throw new HttpError(402, "Saldo insuficiente na carteira.");
      const newBalance = Number((currentBalance - product.priceBRL).toFixed(2));
      await client.query("UPDATE wallets SET balance = $2, updated_at = NOW() WHERE username = $1", [req.auth.sub, newBalance]);
      orderId = randomUUID();
      await client.query(
        `INSERT INTO vpn_orders (
          id, idempotency_key, product_id, username, product_name, price_brl,
          duration_days, connection_limit, access_type, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'submitting')`,
        [orderId, idempotencyKey, product.id, req.auth.sub, product.name, product.priceBRL, product.durationDays, product.connectionLimit, product.accessType],
      );
      await client.query(
        `INSERT INTO wallet_transactions (id, username, type, amount, description, reference)
         VALUES ($1,$2,'vpn_order',$3,$4,$5)`,
        [randomUUID(), req.auth.sub, -product.priceBRL, `Acesso VPN: ${product.name}`, orderId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const login = generateProviderLogin(req.auth.sub);
    const password = generateProviderPassword();
    try {
      const created = await provider.createUser({
        login,
        password,
        days: product.durationDays,
        limit: product.connectionLimit,
        name: memberName,
        type: product.accessType,
      });
      const expiry = fallbackExpiry(product.durationDays);
      const result = await pool.query(
        `UPDATE vpn_orders SET
          provider_login = $2,
          provider_password_enc = $3,
          provider_uuid = $4,
          provider_expires_text = $5,
          expires_at = $6,
          provider_payload = $7::jsonb,
          status = 'active',
          error_message = NULL,
          updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [orderId, created.login, encryptSecret(created.password, config.jwtSecret), created.uuid || null, created.expiresText || "", expiry, JSON.stringify(created.raw || {})],
      );
      return res.status(201).json(orderFromRow(result.rows[0], config));
    } catch (error) {
      const refund = await pool.connect();
      try {
        await refund.query("BEGIN");
        const locked = await refund.query("SELECT * FROM vpn_orders WHERE id = $1 FOR UPDATE", [orderId]);
        if (locked.rowCount && locked.rows[0].status === "submitting") {
          await refund.query("SELECT balance FROM wallets WHERE username = $1 FOR UPDATE", [req.auth.sub]);
          await refund.query("UPDATE wallets SET balance = balance + $2, updated_at = NOW() WHERE username = $1", [req.auth.sub, product.priceBRL]);
          await refund.query(
            `UPDATE vpn_orders SET status = 'refunded', error_message = $2, provider_payload = $3::jsonb, updated_at = NOW() WHERE id = $1`,
            [orderId, String(error.message || "Falha na API VPN").slice(0, 500), JSON.stringify(error.providerPayload || {})],
          );
          await refund.query(
            `INSERT INTO wallet_transactions (id, username, type, amount, description, reference)
             VALUES ($1,$2,'refund',$3,$4,$5)`,
            [randomUUID(), req.auth.sub, product.priceBRL, `Estorno automático do acesso VPN: ${product.name}`, orderId],
          );
        }
        await refund.query("COMMIT");
      } catch (refundError) {
        await refund.query("ROLLBACK");
        console.error("VPN refund failed", { orderId, message: refundError.message });
      } finally {
        refund.release();
      }
      throw new HttpError(502, `Não foi possível criar o acesso VPN. O valor foi estornado. ${error.message || ""}`.trim());
    }
  });

  router.get("/admin/vpn/status", authenticate, requireRole("admin"), async (_req, res) => {
    const [products, orders] = await Promise.all([
      pool.query("SELECT COUNT(*)::INTEGER AS total, COUNT(*) FILTER (WHERE enabled = TRUE)::INTEGER AS enabled FROM vpn_products"),
      pool.query("SELECT COUNT(*)::INTEGER AS total, COUNT(*) FILTER (WHERE status = 'active')::INTEGER AS active FROM vpn_orders"),
    ]);
    res.json({
      configured: provider.isConfigured(),
      products: Number(products.rows[0].total),
      enabledProducts: Number(products.rows[0].enabled),
      orders: Number(orders.rows[0].total),
      activeOrders: Number(orders.rows[0].active),
    });
  });

  router.get("/admin/vpn/products", authenticate, requireRole("admin"), async (_req, res) => {
    const result = await pool.query("SELECT * FROM vpn_products ORDER BY id ASC");
    res.json(result.rows.map(productFromRow));
  });

  router.post("/admin/vpn/products", authenticate, requireRole("admin"), async (req, res) => {
    const name = cleanText(req.body?.name, "Nome", { min: 2, max: 90 });
    const description = cleanText(req.body?.description, "Descrição", { max: 500 });
    const priceBRL = money(req.body?.priceBRL, "Preço");
    const durationDays = positiveInteger(req.body?.durationDays ?? 30, "Duração", { min: 1, max: 365 });
    const connectionLimit = positiveInteger(req.body?.connectionLimit ?? 1, "Limite de conexões", { min: 1, max: 50 });
    const accessType = userType(req.body?.accessType);
    const enabled = req.body?.enabled == null ? true : Boolean(req.body.enabled);
    const result = await pool.query(
      `INSERT INTO vpn_products (name, description, price_brl, duration_days, connection_limit, access_type, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, description, priceBRL, durationDays, connectionLimit, accessType, enabled],
    );
    res.status(201).json(productFromRow(result.rows[0]));
  });

  router.patch("/admin/vpn/products/:id", authenticate, requireRole("admin"), async (req, res) => {
    const id = positiveInteger(req.params.id, "Produto", { max: Number.MAX_SAFE_INTEGER });
    const current = await pool.query("SELECT * FROM vpn_products WHERE id = $1", [id]);
    if (!current.rowCount) throw new HttpError(404, "Produto VPN não encontrado.");
    const row = current.rows[0];
    const name = req.body?.name == null ? row.name : cleanText(req.body.name, "Nome", { min: 2, max: 90 });
    const description = req.body?.description == null ? row.description : cleanText(req.body.description, "Descrição", { max: 500 });
    const priceBRL = req.body?.priceBRL == null ? Number(row.price_brl) : money(req.body.priceBRL, "Preço");
    const durationDays = req.body?.durationDays == null ? Number(row.duration_days) : positiveInteger(req.body.durationDays, "Duração", { min: 1, max: 365 });
    const connectionLimit = req.body?.connectionLimit == null ? Number(row.connection_limit) : positiveInteger(req.body.connectionLimit, "Limite de conexões", { min: 1, max: 50 });
    const accessType = req.body?.accessType == null ? row.access_type : userType(req.body.accessType);
    const enabled = req.body?.enabled == null ? Boolean(row.enabled) : Boolean(req.body.enabled);
    const result = await pool.query(
      `UPDATE vpn_products SET name=$2, description=$3, price_brl=$4, duration_days=$5,
       connection_limit=$6, access_type=$7, enabled=$8, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [id, name, description, priceBRL, durationDays, connectionLimit, accessType, enabled],
    );
    res.json(productFromRow(result.rows[0]));
  });

  router.delete("/admin/vpn/products/:id", authenticate, requireRole("admin"), async (req, res) => {
    const id = positiveInteger(req.params.id, "Produto", { max: Number.MAX_SAFE_INTEGER });
    const used = await pool.query("SELECT 1 FROM vpn_orders WHERE product_id = $1 LIMIT 1", [id]);
    if (used.rowCount) {
      const result = await pool.query("UPDATE vpn_products SET enabled = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *", [id]);
      if (!result.rowCount) throw new HttpError(404, "Produto VPN não encontrado.");
      return res.json({ ok: true, disabled: true, product: productFromRow(result.rows[0]) });
    }
    const result = await pool.query("DELETE FROM vpn_products WHERE id = $1 RETURNING id", [id]);
    if (!result.rowCount) throw new HttpError(404, "Produto VPN não encontrado.");
    res.json({ ok: true, deleted: true, id });
  });

  router.get("/admin/vpn/orders", authenticate, requireRole("admin"), async (_req, res) => {
    const result = await pool.query("SELECT * FROM vpn_orders ORDER BY created_at DESC LIMIT 200");
    res.json(result.rows.map((row) => orderFromRow(row, config, { includePassword: false })));
  });

  router.use((error, _req, res, _next) => {
    const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 500;
    if (status >= 500) console.error("VPN feature error", { message: error?.message });
    if (!res.headersSent) res.status(status).json({ error: error?.message || "Não foi possível concluir a solicitação VPN." });
  });

  return {
    router,
    isConfigured: () => provider.isConfigured(),
    close: () => pool.end(),
  };
}
