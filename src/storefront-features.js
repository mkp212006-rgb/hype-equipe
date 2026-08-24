import { randomUUID } from "node:crypto";
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
      description: cleanText(req.body?.description, "Descrição", { max: 500 }),
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
      Object.hasOwn(req.body || {}, "description") ? cleanText(req.body.description, "Descrição", { max: 500 }) : row.description,
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
