import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import pg from "pg";
import { verifyToken } from "./crypto.js";
import { HttpError } from "./validators.js";

const { Pool } = pg;
const MAX_IMAGE_LENGTH = 520_000;

function bearerToken(req) {
  const authorization = req.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new HttpError(401, "Sessão não informada.");
  return authorization.slice(7).trim();
}

function cleanText(value, label, { min = 0, max = 500 } = {}) {
  const result = String(value == null ? "" : value).trim();
  if (result.length < min || result.length > max) {
    throw new HttpError(400, `${label} deve ter entre ${min} e ${max} caracteres.`);
  }
  return result;
}

function money(value, label = "Preço") {
  const parsed = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1_000_000) {
    throw new HttpError(400, `${label} inválido.`);
  }
  return Number(parsed.toFixed(2));
}

function nonNegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1_000_000) {
    throw new HttpError(400, `${label} inválida.`);
  }
  return parsed;
}

function optionalImageData(value) {
  if (value == null) return undefined;
  const image = String(value).trim();
  if (!image) return "";
  if (image.length > MAX_IMAGE_LENGTH || !/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(image)) {
    throw new HttpError(400, "A foto deve ser JPG, PNG ou WebP e ter no máximo 390 KB.");
  }
  return image;
}

function imageUrl(kind, id, row) {
  if (!row) return "";
  const version = encodeURIComponent(new Date(row.updated_at || row.created_at || 0).getTime() || 0);
  return `/api/storefront/images/${kind}/${encodeURIComponent(id)}?v=${version}`;
}

function decodedImage(data) {
  const match = /^data:image\/(jpeg|png|webp);base64,([a-z0-9+/=\s]+)$/i.exec(String(data || ""));
  if (!match) return null;
  return { type: `image/${match[1].toLowerCase()}`, bytes: Buffer.from(match[2].replace(/\s/g, ""), "base64") };
}

function optionalUrl(value) {
  const raw = cleanText(value, "Link de compra", { max: 1_000 });
  if (!raw) return "";
  let parsed;
  try { parsed = new URL(raw); } catch { throw new HttpError(400, "Link de compra inválido."); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new HttpError(400, "O link deve começar com http:// ou https://.");
  return parsed.toString();
}

export function normalizeDeliveryEmail(value) {
  const email = String(value == null ? "" : value).trim().toLowerCase();
  if (email.length < 6 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new HttpError(400, "Informe um e-mail válido para receber a assinatura.");
  }
  return email;
}

function uuidValue(value, label) {
  const result = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(result)) {
    throw new HttpError(400, `${label} inválido.`);
  }
  return result;
}

function subscriptionCartProductIds(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new HttpError(400, "O carrinho deve ter entre 1 e 20 assinaturas.");
  }
  const unique = [];
  const seen = new Set();
  for (const item of value) {
    const id = uuidValue(item, "Produto do carrinho");
    if (!seen.has(id)) {
      seen.add(id);
      unique.push(id);
    }
  }
  if (!unique.length) throw new HttpError(400, "O carrinho está vazio.");
  return unique;
}

function encryptionKey(secret) {
  return createHash("sha256").update(String(secret)).digest();
}

export function encryptDeliveryData(value, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptDeliveryData(value, secret) {
  const parts = String(value || "").split(":");
  if (parts.length !== 4 || parts[0] !== "v1") return "";
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(parts[1], "base64"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

function categoryFromRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.store_description || "",
    imageUrl: row.store_image_data ? imageUrl("category", row.id, row) : "",
    sortOrder: Number(row.sort_order || 0),
    enabled: row.store_enabled !== false,
    productCount: Number(row.product_count || 0),
  };
}

function smmFromRow(row) {
  const price = row.price_per_thousand_brl == null ? null : Number(row.price_per_thousand_brl);
  return {
    id: `smm:${row.service_id}`,
    sourceId: Number(row.service_id),
    kind: "smm",
    name: String(row.custom_name || row.name || `Serviço ${row.service_id}`),
    description: row.description || "",
    categoryId: row.category_id == null ? null : Number(row.category_id),
    categoryName: row.category_name || "Sem categoria",
    imageUrl: row.store_image_data ? imageUrl("smm", row.service_id, row) : "",
    badge: row.store_badge || "",
    priceBRL: price,
    priceLabel: "por 1.000",
    min: Number(row.min_quantity),
    max: Number(row.max_quantity),
    featured: Boolean(row.store_featured),
    sortOrder: Number(row.store_sort_order || 0),
    enabled: Boolean(row.enabled),
  };
}

function vpnFromRow(row) {
  return {
    id: `vpn:${row.id}`,
    sourceId: Number(row.id),
    kind: "vpn",
    name: row.name,
    description: row.description || "",
    categoryId: row.category_id == null ? null : Number(row.category_id),
    categoryName: row.category_name || "Sem categoria",
    imageUrl: row.store_image_data ? imageUrl("vpn", row.id, row) : "",
    badge: row.store_badge || "",
    priceBRL: Number(row.price_brl),
    priceLabel: `${Number(row.duration_days)} dias`,
    durationDays: Number(row.duration_days),
    connectionLimit: Number(row.connection_limit),
    accessType: row.access_type,
    featured: Boolean(row.store_featured),
    sortOrder: Number(row.store_sort_order || 0),
    enabled: Boolean(row.enabled),
  };
}

function subscriptionFromRow(row) {
  return {
    id: `subscription:${row.id}`,
    sourceId: row.id,
    kind: "subscription",
    name: row.name,
    description: row.description || "",
    categoryId: row.category_id == null ? null : Number(row.category_id),
    categoryName: row.category_name || "Sem categoria",
    imageUrl: row.image_data ? imageUrl("subscription", row.id, row) : "",
    badge: row.badge || "",
    priceBRL: Number(row.price_brl),
    priceLabel: row.billing_label || "",
    billingLabel: row.billing_label || "",
    actionLabel: row.action_label || "Ver oferta",
    actionUrl: row.action_url || "",
    featured: Boolean(row.featured),
    sortOrder: Number(row.sort_order || 0),
    enabled: Boolean(row.enabled),
  };
}

function subscriptionOrderFromRow(row, config, { admin = false } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    priceBRL: Number(row.price_brl),
    currency: "BRL",
    deliveryEmail: row.delivery_email,
    status: row.status,
    deliveryData: row.status === "fulfilled" || admin ? decryptDeliveryData(row.delivery_data_enc, config.jwtSecret) : "",
    adminNote: admin ? row.admin_note || "" : "",
    createdBy: admin ? row.username : undefined,
    walletDebited: Boolean(row.wallet_debited),
    walletRefunded: Boolean(row.wallet_refunded),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fulfilledAt: row.fulfilled_at,
  };
}

export async function createStorefrontFeatures({ config, db }) {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on("error", (error) => console.error("PostgreSQL storefront pool error", { message: error.message }));

  await pool.query(`
    ALTER TABLE service_categories ADD COLUMN IF NOT EXISTS store_description TEXT NOT NULL DEFAULT '';
    ALTER TABLE service_categories ADD COLUMN IF NOT EXISTS store_image_data TEXT NOT NULL DEFAULT '';
    ALTER TABLE service_categories ADD COLUMN IF NOT EXISTS store_enabled BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE services ADD COLUMN IF NOT EXISTS store_image_data TEXT NOT NULL DEFAULT '';
    ALTER TABLE services ADD COLUMN IF NOT EXISTS store_badge TEXT NOT NULL DEFAULT '';
    ALTER TABLE services ADD COLUMN IF NOT EXISTS store_featured BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE services ADD COLUMN IF NOT EXISTS store_sort_order INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE vpn_products ADD COLUMN IF NOT EXISTS store_image_data TEXT NOT NULL DEFAULT '';
    ALTER TABLE vpn_products ADD COLUMN IF NOT EXISTS store_badge TEXT NOT NULL DEFAULT '';
    ALTER TABLE vpn_products ADD COLUMN IF NOT EXISTS store_featured BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE vpn_products ADD COLUMN IF NOT EXISTS store_sort_order INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE IF NOT EXISTS catalog_products (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category_id BIGINT REFERENCES service_categories(id) ON DELETE SET NULL,
      image_data TEXT NOT NULL DEFAULT '',
      badge TEXT NOT NULL DEFAULT '',
      price_brl NUMERIC(18,2) NOT NULL CHECK (price_brl > 0),
      billing_label TEXT NOT NULL DEFAULT '',
      action_label TEXT NOT NULL DEFAULT 'Ver oferta',
      action_url TEXT NOT NULL DEFAULT '',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      featured BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS catalog_products_category_idx ON catalog_products(category_id, sort_order, name);

    CREATE TABLE IF NOT EXISTS subscription_orders (
      id UUID PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      product_id UUID REFERENCES catalog_products(id) ON DELETE SET NULL,
      username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
      product_name TEXT NOT NULL,
      price_brl NUMERIC(18,2) NOT NULL CHECK (price_brl > 0),
      delivery_email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','fulfilled','refunded')),
      delivery_data_enc TEXT NOT NULL DEFAULT '',
      admin_note TEXT NOT NULL DEFAULT '',
      wallet_debited BOOLEAN NOT NULL DEFAULT TRUE,
      wallet_refunded BOOLEAN NOT NULL DEFAULT FALSE,
      fulfilled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS subscription_orders_username_idx ON subscription_orders(username, created_at DESC);
    CREATE INDEX IF NOT EXISTS subscription_orders_status_idx ON subscription_orders(status, created_at DESC);
  `);

  const router = express.Router();
  router.use(helmet({ crossOriginResourcePolicy: false }));
  router.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Accept", "Authorization", "Content-Type", "X-Request-Id"],
    maxAge: 86_400,
  }));
  router.use(express.json({ limit: "768kb", strict: true }));

  router.get("/api/storefront/images/:kind/:id", async (req, res, next) => {
    try {
      const sources = {
        category: { table: "service_categories", id: "id", image: "store_image_data" },
        smm: { table: "services", id: "service_id", image: "store_image_data" },
        vpn: { table: "vpn_products", id: "id", image: "store_image_data" },
        subscription: { table: "catalog_products", id: "id", image: "image_data" },
      };
      const source = sources[req.params.kind];
      if (!source) throw new HttpError(404, "Foto não encontrada.");
      const rawId = String(req.params.id || "");
      if (req.params.kind === "subscription") {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawId)) throw new HttpError(404, "Foto não encontrada.");
      } else if (!/^\d+$/.test(rawId) || Number(rawId) <= 0) {
        throw new HttpError(404, "Foto não encontrada.");
      }
      const result = await pool.query(`SELECT ${source.image} AS image_data, updated_at FROM ${source.table} WHERE ${source.id}=$1`, [rawId]);
      const image = decodedImage(result.rows[0]?.image_data);
      if (!image) throw new HttpError(404, "Foto não encontrada.");
      res.setHeader("Cache-Control", req.query.v ? "public, max-age=31536000, immutable" : "public, max-age=3600");
      if (result.rows[0]?.updated_at) res.setHeader("Last-Modified", new Date(result.rows[0].updated_at).toUTCString());
      res.type(image.type).send(image.bytes);
    } catch (error) { next(error); }
  });

  async function authenticate(req, _res, next) {
    try {
      const payload = verifyToken(bearerToken(req), config.jwtSecret);
      if (payload.role === "member") {
        const user = await db.getUser(payload.sub);
        if (!user || !user.active || Number(payload.version) !== Number(user.token_version)) throw new HttpError(401, "A sessão do usuário expirou.");
      } else if (payload.role === "admin") {
        const admin = await db.getAdmin(payload.sub);
        if (!admin || Number(payload.version) !== Number(admin.token_version)) throw new HttpError(401, "A sessão administrativa expirou.");
      } else {
        throw new HttpError(401, "Sessão inválida.");
      }
      req.storeAuth = payload;
      next();
    } catch (error) {
      next(error instanceof HttpError ? error : new HttpError(401, error.message || "Sessão inválida."));
    }
  }

  function requireRole(role) {
    return (req, _res, next) => req.storeAuth?.role === role
      ? next()
      : next(new HttpError(403, "Você não tem permissão para esta ação."));
  }

  async function categoryId(value) {
    if (value == null || value === "") return null;
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Categoria inválida.");
    const found = await pool.query("SELECT id FROM service_categories WHERE id=$1", [id]);
    if (!found.rowCount) throw new HttpError(404, "Categoria não encontrada.");
    return id;
  }

  async function loadStorefront(includeDisabled) {
    const visibility = includeDisabled ? "" : "WHERE store_enabled=TRUE";
    const [categories, smm, vpn, subscriptions] = await Promise.all([
      pool.query(`SELECT c.*, 0::INTEGER AS product_count FROM service_categories c ${visibility} ORDER BY c.sort_order, c.name`),
      pool.query(`SELECT s.*, c.name AS category_name FROM services s LEFT JOIN service_categories c ON c.id=s.category_id ${includeDisabled ? "" : "WHERE s.enabled=TRUE AND s.price_per_thousand_brl>0 AND (c.store_enabled IS NULL OR c.store_enabled=TRUE)"} ORDER BY s.store_featured DESC, s.store_sort_order, COALESCE(s.custom_name,s.name)`),
      pool.query(`SELECT p.*, c.name AS category_name FROM vpn_products p LEFT JOIN service_categories c ON c.id=p.category_id ${includeDisabled ? "" : "WHERE p.enabled=TRUE AND (c.store_enabled IS NULL OR c.store_enabled=TRUE)"} ORDER BY p.store_featured DESC, p.store_sort_order, p.name`),
      pool.query(`SELECT p.*, c.name AS category_name FROM catalog_products p LEFT JOIN service_categories c ON c.id=p.category_id ${includeDisabled ? "" : "WHERE p.enabled=TRUE AND (c.store_enabled IS NULL OR c.store_enabled=TRUE)"} ORDER BY p.featured DESC, p.sort_order, p.name`),
    ]);
    const products = [...smm.rows.map(smmFromRow), ...vpn.rows.map(vpnFromRow), ...subscriptions.rows.map(subscriptionFromRow)];
    const counts = new Map();
    for (const product of products) counts.set(product.categoryId, (counts.get(product.categoryId) || 0) + 1);
    return {
      categories: categories.rows.map((row) => categoryFromRow({ ...row, product_count: counts.get(Number(row.id)) || 0 })),
      products,
    };
  }

  router.get("/api/storefront", authenticate, requireRole("member"), async (_req, res) => {
    res.json(await loadStorefront(false));
  });

  router.get("/admin/storefront", authenticate, requireRole("admin"), async (_req, res) => {
    res.json(await loadStorefront(true));
  });

  router.get("/api/subscription-orders", authenticate, requireRole("member"), async (req, res) => {
    const result = await pool.query(
      "SELECT * FROM subscription_orders WHERE username=$1 ORDER BY created_at DESC LIMIT 100",
      [req.storeAuth.sub],
    );
    res.json(result.rows.map((row) => subscriptionOrderFromRow(row, config)));
  });

  router.post("/api/subscription-orders", authenticate, requireRole("member"), async (req, res) => {
    const productId = uuidValue(req.body?.productId, "Produto");
    const deliveryEmail = normalizeDeliveryEmail(req.body?.deliveryEmail);
    const idempotencyKey = cleanText(req.body?.idempotencyKey, "Chave do pedido", { min: 12, max: 128 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        "SELECT * FROM subscription_orders WHERE idempotency_key=$1 FOR UPDATE",
        [idempotencyKey],
      );
      if (existing.rowCount) {
        if (existing.rows[0].username !== req.storeAuth.sub) throw new HttpError(409, "Chave de pedido já utilizada.");
        await client.query("COMMIT");
        return res.json(subscriptionOrderFromRow(existing.rows[0], config));
      }

      const productResult = await client.query(
        "SELECT * FROM catalog_products WHERE id=$1 AND enabled=TRUE FOR SHARE",
        [productId],
      );
      if (!productResult.rowCount) throw new HttpError(404, "Essa assinatura não está disponível.");
      const product = productResult.rows[0];
      const priceBRL = Number(product.price_brl);
      const wallet = await client.query("SELECT balance FROM wallets WHERE username=$1 FOR UPDATE", [req.storeAuth.sub]);
      if (!wallet.rowCount) throw new HttpError(404, "Carteira não encontrada.");
      const balance = Number(wallet.rows[0].balance);
      if (balance + 0.00001 < priceBRL) throw new HttpError(402, "Saldo insuficiente na carteira.");
      const newBalance = Number((balance - priceBRL).toFixed(2));
      const orderId = randomUUID();

      await client.query(
        "UPDATE wallets SET balance=$2, updated_at=NOW() WHERE username=$1",
        [req.storeAuth.sub, newBalance],
      );
      const order = await client.query(
        `INSERT INTO subscription_orders (
          id,idempotency_key,product_id,username,product_name,price_brl,delivery_email,status,wallet_debited
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',TRUE) RETURNING *`,
        [orderId, idempotencyKey, productId, req.storeAuth.sub, product.name, priceBRL, deliveryEmail],
      );
      await client.query(
        `INSERT INTO wallet_transactions (id,username,type,amount,description,reference)
         VALUES ($1,$2,'subscription_order',$3,$4,$5)`,
        [randomUUID(), req.storeAuth.sub, -priceBRL, `Assinatura: ${product.name}`, orderId],
      );
      await client.query("COMMIT");
      return res.status(201).json({
        ...subscriptionOrderFromRow(order.rows[0], config),
        balance: newBalance,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  router.post("/api/subscription-orders/cart", authenticate, requireRole("member"), async (req, res) => {
    const productIds = subscriptionCartProductIds(req.body?.productIds);
    const deliveryEmail = normalizeDeliveryEmail(req.body?.deliveryEmail);
    const idempotencyKey = cleanText(req.body?.idempotencyKey, "Chave do carrinho", { min: 12, max: 96 });
    const orderKeys = productIds.map((_, index) => `${idempotencyKey}:${index + 1}`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        "SELECT * FROM subscription_orders WHERE idempotency_key = ANY($1::text[]) FOR UPDATE",
        [orderKeys],
      );
      if (existing.rowCount) {
        if (existing.rowCount !== orderKeys.length) throw new HttpError(409, "Este carrinho já foi processado parcialmente. Atualize seus pedidos.");
        const byKey = new Map(existing.rows.map((row) => [row.idempotency_key, row]));
        const matchesRequest = orderKeys.every((key, index) => {
          const row = byKey.get(key);
          return row && row.username === req.storeAuth.sub && String(row.product_id || "") === productIds[index];
        });
        if (!matchesRequest) throw new HttpError(409, "Chave do carrinho já utilizada.");
        const wallet = await client.query("SELECT balance FROM wallets WHERE username=$1", [req.storeAuth.sub]);
        await client.query("COMMIT");
        return res.json({
          orders: orderKeys.map((key) => subscriptionOrderFromRow(byKey.get(key), config)),
          balance: wallet.rowCount ? Number(wallet.rows[0].balance) : null,
          repeated: true,
        });
      }

      const productResult = await client.query(
        "SELECT * FROM catalog_products WHERE id = ANY($1::uuid[]) AND enabled=TRUE FOR SHARE",
        [productIds],
      );
      const productsById = new Map(productResult.rows.map((row) => [String(row.id), row]));
      const products = productIds.map((id) => productsById.get(id));
      if (products.some((product) => !product)) {
        throw new HttpError(404, "Uma das assinaturas do carrinho não está mais disponível.");
      }

      const totalBRL = Number(products.reduce((total, product) => total + Number(product.price_brl), 0).toFixed(2));
      const wallet = await client.query("SELECT balance FROM wallets WHERE username=$1 FOR UPDATE", [req.storeAuth.sub]);
      if (!wallet.rowCount) throw new HttpError(404, "Carteira não encontrada.");
      const balance = Number(wallet.rows[0].balance);
      if (balance + 0.00001 < totalBRL) throw new HttpError(402, "Saldo insuficiente para finalizar o carrinho.");
      const newBalance = Number((balance - totalBRL).toFixed(2));
      await client.query("UPDATE wallets SET balance=$2, updated_at=NOW() WHERE username=$1", [req.storeAuth.sub, newBalance]);

      const created = [];
      for (let index = 0; index < products.length; index += 1) {
        const product = products[index];
        const orderId = randomUUID();
        const priceBRL = Number(product.price_brl);
        const order = await client.query(
          `INSERT INTO subscription_orders (
            id,idempotency_key,product_id,username,product_name,price_brl,delivery_email,status,wallet_debited
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',TRUE) RETURNING *`,
          [orderId, orderKeys[index], product.id, req.storeAuth.sub, product.name, priceBRL, deliveryEmail],
        );
        await client.query(
          `INSERT INTO wallet_transactions (id,username,type,amount,description,reference)
           VALUES ($1,$2,'subscription_order',$3,$4,$5)`,
          [randomUUID(), req.storeAuth.sub, -priceBRL, `Assinatura: ${product.name}`, orderId],
        );
        created.push(subscriptionOrderFromRow(order.rows[0], config));
      }

      await client.query("COMMIT");
      return res.status(201).json({ orders: created, balance: newBalance, totalBRL });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  router.get("/admin/subscription-orders", authenticate, requireRole("admin"), async (_req, res) => {
    const result = await pool.query("SELECT * FROM subscription_orders ORDER BY created_at DESC LIMIT 250");
    res.json(result.rows.map((row) => subscriptionOrderFromRow(row, config, { admin: true })));
  });

  router.patch("/admin/subscription-orders/:id/fulfill", authenticate, requireRole("admin"), async (req, res) => {
    const id = uuidValue(req.params.id, "Pedido");
    const deliveryData = cleanText(req.body?.deliveryData, "Dados da assinatura", { min: 2, max: 4_000 });
    const adminNote = cleanText(req.body?.adminNote, "Observação", { max: 1_000 });
    const result = await pool.query(
      `UPDATE subscription_orders SET
        status='fulfilled', delivery_data_enc=$2, admin_note=$3, fulfilled_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND status<>'refunded' RETURNING *`,
      [id, encryptDeliveryData(deliveryData, config.jwtSecret), adminNote],
    );
    if (!result.rowCount) {
      const current = await pool.query("SELECT status FROM subscription_orders WHERE id=$1", [id]);
      if (!current.rowCount) throw new HttpError(404, "Pedido de assinatura não encontrado.");
      throw new HttpError(409, "Esse pedido já foi estornado.");
    }
    res.json(subscriptionOrderFromRow(result.rows[0], config, { admin: true }));
  });

  router.patch("/admin/subscription-orders/:id/refund", authenticate, requireRole("admin"), async (req, res) => {
    const id = uuidValue(req.params.id, "Pedido");
    const adminNote = cleanText(req.body?.adminNote || "Pedido cancelado pelo administrador.", "Motivo", { min: 2, max: 1_000 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const orderResult = await client.query("SELECT * FROM subscription_orders WHERE id=$1 FOR UPDATE", [id]);
      const order = orderResult.rows[0];
      if (!order) throw new HttpError(404, "Pedido de assinatura não encontrado.");
      if (order.status === "fulfilled") throw new HttpError(409, "Esse pedido já foi entregue.");
      if (order.status === "refunded") {
        await client.query("COMMIT");
        return res.json(subscriptionOrderFromRow(order, config, { admin: true }));
      }
      await client.query("SELECT balance FROM wallets WHERE username=$1 FOR UPDATE", [order.username]);
      await client.query(
        "UPDATE wallets SET balance=balance+$2, updated_at=NOW() WHERE username=$1",
        [order.username, Number(order.price_brl)],
      );
      const updated = await client.query(
        `UPDATE subscription_orders SET status='refunded', wallet_refunded=TRUE,
         admin_note=$2, updated_at=NOW() WHERE id=$1 RETURNING *`,
        [id, adminNote],
      );
      await client.query(
        `INSERT INTO wallet_transactions (id,username,type,amount,description,reference)
         VALUES ($1,$2,'refund',$3,$4,$5)`,
        [randomUUID(), order.username, Number(order.price_brl), `Estorno da assinatura: ${order.product_name}`, id],
      );
      await client.query("COMMIT");
      return res.json(subscriptionOrderFromRow(updated.rows[0], config, { admin: true }));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  router.patch("/admin/categories/:id/presentation", authenticate, requireRole("admin"), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Categoria inválida.");
    const current = await pool.query("SELECT * FROM service_categories WHERE id=$1", [id]);
    if (!current.rowCount) throw new HttpError(404, "Categoria não encontrada.");
    const row = current.rows[0];
    const name = Object.hasOwn(req.body || {}, "name") ? cleanText(req.body.name, "Nome", { min: 2, max: 50 }) : row.name;
    const description = Object.hasOwn(req.body || {}, "description") ? cleanText(req.body.description, "Descrição", { max: 240 }) : row.store_description;
    const imageData = optionalImageData(req.body?.imageData);
    const sortOrder = Object.hasOwn(req.body || {}, "sortOrder") ? nonNegativeInteger(req.body.sortOrder, "Ordem") : Number(row.sort_order);
    const enabled = Object.hasOwn(req.body || {}, "enabled") ? Boolean(req.body.enabled) : Boolean(row.store_enabled);
    try {
      const result = await pool.query(`UPDATE service_categories SET name=$2, store_description=$3, store_image_data=$4, sort_order=$5, store_enabled=$6, updated_at=NOW() WHERE id=$1 RETURNING *, 0::INTEGER AS product_count`, [id, name, description, imageData === undefined ? row.store_image_data : imageData, sortOrder, enabled]);
      res.json(categoryFromRow(result.rows[0]));
    } catch (error) {
      if (error?.code === "23505") throw new HttpError(409, "Já existe uma categoria com esse nome.");
      throw error;
    }
  });

  async function updateMedia(table, idColumn, id, body) {
    const current = await pool.query(`SELECT * FROM ${table} WHERE ${idColumn}=$1`, [id]);
    if (!current.rowCount) throw new HttpError(404, "Produto não encontrado.");
    const row = current.rows[0];
    const imageData = optionalImageData(body?.imageData);
    const badge = Object.hasOwn(body || {}, "badge") ? cleanText(body.badge, "Selo", { max: 40 }) : row.store_badge;
    const featured = Object.hasOwn(body || {}, "featured") ? Boolean(body.featured) : Boolean(row.store_featured);
    const sortOrder = Object.hasOwn(body || {}, "sortOrder") ? nonNegativeInteger(body.sortOrder, "Ordem") : Number(row.store_sort_order);
    await pool.query(`UPDATE ${table} SET store_image_data=$2, store_badge=$3, store_featured=$4, store_sort_order=$5, updated_at=NOW() WHERE ${idColumn}=$1`, [id, imageData === undefined ? row.store_image_data : imageData, badge, featured, sortOrder]);
  }

  router.patch("/admin/services/:id/presentation", authenticate, requireRole("admin"), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Serviço inválido.");
    await updateMedia("services", "service_id", id, req.body);
    res.json({ ok: true });
  });

  router.patch("/admin/vpn/products/:id/presentation", authenticate, requireRole("admin"), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Produto VPN inválido.");
    await updateMedia("vpn_products", "id", id, req.body);
    res.json({ ok: true });
  });

  router.post("/admin/catalog-products", authenticate, requireRole("admin"), async (req, res) => {
    const product = {
      id: randomUUID(),
      name: cleanText(req.body?.name, "Nome", { min: 2, max: 90 }),
      description: cleanText(req.body?.description, "Descrição", { max: 5_000 }),
      categoryId: await categoryId(req.body?.categoryId),
      imageData: optionalImageData(req.body?.imageData) || "",
      badge: cleanText(req.body?.badge, "Selo", { max: 40 }),
      priceBRL: money(req.body?.priceBRL),
      billingLabel: cleanText(req.body?.billingLabel, "Periodicidade", { max: 40 }),
      actionLabel: cleanText(req.body?.actionLabel || "Ver oferta", "Texto do botão", { min: 2, max: 40 }),
      actionUrl: optionalUrl(req.body?.actionUrl),
      enabled: req.body?.enabled !== false,
      featured: Boolean(req.body?.featured),
      sortOrder: nonNegativeInteger(req.body?.sortOrder || 0, "Ordem"),
    };
    const result = await pool.query(`INSERT INTO catalog_products (id,name,description,category_id,image_data,badge,price_brl,billing_label,action_label,action_url,enabled,featured,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *, (SELECT name FROM service_categories WHERE id=$4) AS category_name`, Object.values(product));
    res.status(201).json(subscriptionFromRow(result.rows[0]));
  });

  router.patch("/admin/catalog-products/:id", authenticate, requireRole("admin"), async (req, res) => {
    const current = await pool.query("SELECT * FROM catalog_products WHERE id=$1", [req.params.id]);
    if (!current.rowCount) throw new HttpError(404, "Assinatura não encontrada.");
    const row = current.rows[0];
    const imageData = optionalImageData(req.body?.imageData);
    const values = [
      req.params.id,
      Object.hasOwn(req.body || {}, "name") ? cleanText(req.body.name, "Nome", { min: 2, max: 90 }) : row.name,
      Object.hasOwn(req.body || {}, "description") ? cleanText(req.body.description, "Descrição", { max: 5_000 }) : row.description,
      Object.hasOwn(req.body || {}, "categoryId") ? await categoryId(req.body.categoryId) : row.category_id,
      imageData === undefined ? row.image_data : imageData,
      Object.hasOwn(req.body || {}, "badge") ? cleanText(req.body.badge, "Selo", { max: 40 }) : row.badge,
      Object.hasOwn(req.body || {}, "priceBRL") ? money(req.body.priceBRL) : Number(row.price_brl),
      Object.hasOwn(req.body || {}, "billingLabel") ? cleanText(req.body.billingLabel, "Periodicidade", { max: 40 }) : row.billing_label,
      Object.hasOwn(req.body || {}, "actionLabel") ? cleanText(req.body.actionLabel, "Texto do botão", { min: 2, max: 40 }) : row.action_label,
      Object.hasOwn(req.body || {}, "actionUrl") ? optionalUrl(req.body.actionUrl) : row.action_url,
      Object.hasOwn(req.body || {}, "enabled") ? Boolean(req.body.enabled) : Boolean(row.enabled),
      Object.hasOwn(req.body || {}, "featured") ? Boolean(req.body.featured) : Boolean(row.featured),
      Object.hasOwn(req.body || {}, "sortOrder") ? nonNegativeInteger(req.body.sortOrder, "Ordem") : Number(row.sort_order),
    ];
    const result = await pool.query(`UPDATE catalog_products SET name=$2,description=$3,category_id=$4,image_data=$5,badge=$6,price_brl=$7,billing_label=$8,action_label=$9,action_url=$10,enabled=$11,featured=$12,sort_order=$13,updated_at=NOW() WHERE id=$1 RETURNING *, (SELECT name FROM service_categories WHERE id=$4) AS category_name`, values);
    res.json(subscriptionFromRow(result.rows[0]));
  });

  router.delete("/admin/catalog-products/:id", authenticate, requireRole("admin"), async (req, res) => {
    const result = await pool.query("DELETE FROM catalog_products WHERE id=$1 RETURNING id", [req.params.id]);
    if (!result.rowCount) throw new HttpError(404, "Assinatura não encontrada.");
    res.json({ ok: true, id: result.rows[0].id });
  });

  router.use((error, _req, res, _next) => {
    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) console.error("Storefront request failed", { message: error.message });
    res.status(status).json({ error: error.message || "Não foi possível atualizar a vitrine." });
  });

  return { router, close: () => pool.end() };
}
