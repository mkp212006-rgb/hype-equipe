--- a/src/server.js
+++ b/src/server.js
@@ -1,15 +1,69 @@
 import "dotenv/config";
 import http from "node:http";
+import cors from "cors";
+import express from "express";
+import helmet from "helmet";
+import pg from "pg";
 import { createApp } from "./app.js";
 import { loadConfig } from "./config.js";
+import { verifyToken } from "./crypto.js";
 import { createDatabase } from "./db.js";
 import { MercadoPagoClient } from "./mercado-pago-client.js";
 import { SmmClient } from "./smm-client.js";
 
+const { Pool } = pg;
 const config = loadConfig();
 const db = createDatabase(config);
 await db.migrate();
 
+const catalogPool = new Pool({
+  connectionString: config.databaseUrl,
+  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
+  max: 5,
+  idleTimeoutMillis: 30_000,
+  connectionTimeoutMillis: 10_000,
+});
+
+catalogPool.on("error", (error) => {
+  console.error("PostgreSQL catalog pool error", { message: error.message });
+});
+
+async function migrateCatalogCustomization() {
+  await catalogPool.query(`
+    CREATE TABLE IF NOT EXISTS service_categories (
+      id BIGSERIAL PRIMARY KEY,
+      name TEXT NOT NULL,
+      sort_order INTEGER NOT NULL DEFAULT 0,
+      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
+      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
+    );
+
+    CREATE UNIQUE INDEX IF NOT EXISTS service_categories_name_ci_idx
+      ON service_categories ((LOWER(name)));
+
+    ALTER TABLE services ADD COLUMN IF NOT EXISTS custom_name TEXT;
+    ALTER TABLE services ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
+    ALTER TABLE services ADD COLUMN IF NOT EXISTS category_id BIGINT;
+
+    DO $$
+    BEGIN
+      IF NOT EXISTS (
+        SELECT 1 FROM pg_constraint
+        WHERE conname = 'services_category_id_fkey'
+          AND conrelid = 'services'::regclass
+      ) THEN
+        ALTER TABLE services
+          ADD CONSTRAINT services_category_id_fkey
+          FOREIGN KEY (category_id) REFERENCES service_categories(id) ON DELETE SET NULL;
+      END IF;
+    END $$;
+
+    CREATE INDEX IF NOT EXISTS services_category_id_idx ON services(category_id);
+  `);
+}
+
+await migrateCatalogCustomization();
+
 const smm = new SmmClient({
   apiUrl: config.smmApiUrl,
   apiKey: config.smmApiKey,
@@ -23,7 +77,413 @@
   timeoutMs: config.mercadoPagoTimeoutMs,
 });
 
-const app = await createApp({ config, db, smm, mercadoPago });
+function catalogError(status, message) {
+  return Object.assign(new Error(message), { status });
+}
+
+function bearerToken(req) {
+  const authorization = req.get("authorization") || "";
+  if (!authorization.startsWith("Bearer ")) throw catalogError(401, "Sessão não informada.");
+  return authorization.slice(7).trim();
+}
+
+async function catalogSession(req, role) {
+  let payload;
+  try {
+    payload = verifyToken(bearerToken(req), config.jwtSecret);
+  } catch (error) {
+    throw catalogError(401, error.message || "Sessão inválida.");
+  }
+
+  if (payload.role !== role) throw catalogError(403, "Você não tem permissão para esta ação.");
+
+  if (role === "member") {
+    const user = await db.getUser(payload.sub);
+    if (!user || !user.active || Number(payload.version) !== Number(user.token_version)) {
+      throw catalogError(401, "A sessão do usuário expirou.");
+    }
+  } else {
+    const admin = await db.getAdmin(payload.sub);
+    if (!admin || Number(payload.version) !== Number(admin.token_version)) {
+      throw catalogError(401, "A sessão administrativa expirou.");
+    }
+  }
+
+  return payload;
+}
+
+function guarded(role, handler) {
+  return async (req, res) => {
+    try {
+      req.catalogAuth = await catalogSession(req, role);
+      await handler(req, res);
+    } catch (error) {
+      const status = Number(error.status) >= 400 && Number(error.status) < 600 ? Number(error.status) : 500;
+      if (status >= 500) console.error("Catalog request failed", { method: req.method, path: req.path, message: error.message });
+      if (!res.headersSent) res.status(status).json({ error: error.message || "O servidor não conseguiu concluir a solicitação." });
+    }
+  };
+}
+
+function positiveServiceId(value) {
+  const serviceId = Number(value);
+  if (!Number.isInteger(serviceId) || serviceId <= 0) throw catalogError(400, "Serviço inválido.");
+  return serviceId;
+}
+
+function priceValue(value) {
+  const price = Number(String(value ?? "").replace(",", "."));
+  if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) {
+    throw catalogError(400, "Preço por 1.000 inválido.");
+  }
+  return Number(price.toFixed(2));
+}
+
+function cleanOptionalText(value, maxLength, field) {
+  const result = String(value == null ? "" : value).trim();
+  if (result.length > maxLength) throw catalogError(400, `${field} deve ter no máximo ${maxLength} caracteres.`);
+  return result;
+}
+
+async function checkedCategoryId(value) {
+  if (value == null || value === "") return null;
+  const categoryId = Number(value);
+  if (!Number.isInteger(categoryId) || categoryId <= 0) throw catalogError(400, "Categoria inválida.");
+  const found = await catalogPool.query("SELECT id FROM service_categories WHERE id = $1", [categoryId]);
+  if (!found.rowCount) throw catalogError(404, "Categoria não encontrada.");
+  return categoryId;
+}
+
+function mapCatalogService(row) {
+  if (!row) return null;
+  const price = row.price_per_thousand_brl == null ? null : Number(row.price_per_thousand_brl);
+  const displayName = String(row.custom_name || row.name || `Serviço ${row.service_id}`);
+  const displayCategory = String(row.category_name || "Sem categoria");
+  return {
+    service: Number(row.service_id),
+    name: displayName,
+    customName: row.custom_name || "",
+    originalName: row.name,
+    description: row.description || "",
+    category: displayCategory,
+    categoryId: row.category_id == null ? null : Number(row.category_id),
+    categoryName: displayCategory,
+    providerCategory: row.category || "",
+    type: row.type,
+    rate: Number(row.rate),
+    providerRate: Number(row.rate),
+    pricePerThousandBRL: price,
+    rateBRL: price,
+    currency: "BRL",
+    min: Number(row.min_quantity),
+    max: Number(row.max_quantity),
+    refill: Boolean(row.refill_supported),
+    cancel: Boolean(row.cancel_supported),
+    enabled: Boolean(row.enabled),
+    updatedAt: row.updated_at,
+  };
+}
+
+function mapCatalogOrder(row) {
+  const chargeBRL = row.charge_brl == null
+    ? (String(row.currency || "").toUpperCase() === "BRL" && row.estimated_charge != null ? Number(row.estimated_charge) : null)
+    : Number(row.charge_brl);
+  return {
+    id: row.id,
+    providerOrderId: row.provider_order_id,
+    serviceId: row.service_id == null ? null : Number(row.service_id),
+    serviceName: row.service_name,
+    link: row.link,
+    quantity: Number(row.quantity),
+    estimatedCharge: chargeBRL ?? (row.estimated_charge == null ? null : Number(row.estimated_charge)),
+    estimatedChargeBRL: chargeBRL,
+    chargeBRL,
+    amountBRL: chargeBRL,
+    currency: chargeBRL != null ? "BRL" : (row.currency || "BRL"),
+    status: row.status,
+    startCount: row.start_count,
+    remains: row.remains,
+    refillAvailable: Boolean(row.refill_available),
+    cancelAvailable: Boolean(row.cancel_available),
+    createdBy: row.created_by,
+    walletDebited: Boolean(row.wallet_debited),
+    walletRefunded: Boolean(row.wallet_refunded),
+    createdAt: row.created_at,
+    updatedAt: row.updated_at,
+  };
+}
+
+async function getCatalogService(serviceId) {
+  const result = await catalogPool.query(
+    `SELECT s.*, c.name AS category_name, c.sort_order AS category_sort_order
+     FROM services s
+     LEFT JOIN service_categories c ON c.id = s.category_id
+     WHERE s.service_id = $1`,
+    [serviceId],
+  );
+  return result.rows[0] || null;
+}
+
+const catalogRouter = express.Router();
+catalogRouter.use(helmet({ crossOriginResourcePolicy: false }));
+catalogRouter.use(cors({
+  origin: "*",
+  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
+  allowedHeaders: ["Accept", "Authorization", "Content-Type", "X-Request-Id"],
+  maxAge: 86_400,
+}));
+catalogRouter.use(express.json({ limit: "64kb", strict: true }));
+
+catalogRouter.get("/api/services", guarded("member", async (_req, res) => {
+  const result = await catalogPool.query(
+    `SELECT s.*, c.name AS category_name, c.sort_order AS category_sort_order
+     FROM services s
+     LEFT JOIN service_categories c ON c.id = s.category_id
+     WHERE s.enabled = TRUE
+       AND s.price_per_thousand_brl IS NOT NULL
+       AND s.price_per_thousand_brl > 0
+     ORDER BY c.sort_order NULLS LAST, c.name NULLS LAST, COALESCE(s.custom_name, s.name), s.service_id`,
+  );
+  res.json(result.rows.map(mapCatalogService));
+}));
+
+catalogRouter.get("/api/orders", guarded("member", async (req, res) => {
+  const result = await catalogPool.query(
+    `SELECT o.*, COALESCE(s.custom_name, s.name, o.service_name) AS service_name
+     FROM orders o
+     LEFT JOIN services s ON s.service_id = o.service_id
+     WHERE o.created_by = $1
+     ORDER BY o.created_at DESC
+     LIMIT 200`,
+    [req.catalogAuth.sub],
+  );
+  res.json(result.rows.map(mapCatalogOrder));
+}));
+
+catalogRouter.get("/admin/categories", guarded("admin", async (_req, res) => {
+  const result = await catalogPool.query(
+    `SELECT c.id, c.name, c.sort_order, c.created_at, c.updated_at,
+            COUNT(s.service_id)::INTEGER AS service_count
+     FROM service_categories c
+     LEFT JOIN services s ON s.category_id = c.id
+     GROUP BY c.id
+     ORDER BY c.sort_order, c.name`,
+  );
+  res.json(result.rows.map((row) => ({
+    id: Number(row.id),
+    name: row.name,
+    sortOrder: Number(row.sort_order || 0),
+    serviceCount: Number(row.service_count || 0),
+    createdAt: row.created_at,
+    updatedAt: row.updated_at,
+  })));
+}));
+
+catalogRouter.post("/admin/categories", guarded("admin", async (req, res) => {
+  const name = cleanOptionalText(req.body?.name, 50, "Nome da categoria");
+  if (name.length < 2) throw catalogError(400, "O nome da categoria deve ter pelo menos 2 caracteres.");
+  const maxOrder = await catalogPool.query("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM service_categories");
+  try {
+    const result = await catalogPool.query(
+      "INSERT INTO service_categories (name, sort_order) VALUES ($1, $2) RETURNING *",
+      [name, Number(maxOrder.rows[0].next_order || 0)],
+    );
+    const row = result.rows[0];
+    res.status(201).json({ id: Number(row.id), name: row.name, sortOrder: Number(row.sort_order), serviceCount: 0 });
+  } catch (error) {
+    if (error?.code === "23505") throw catalogError(409, "Já existe uma categoria com esse nome.");
+    throw error;
+  }
+}));
+
+catalogRouter.patch("/admin/categories/:categoryId", guarded("admin", async (req, res) => {
+  const categoryId = Number(req.params.categoryId);
+  if (!Number.isInteger(categoryId) || categoryId <= 0) throw catalogError(400, "Categoria inválida.");
+  const current = await catalogPool.query("SELECT * FROM service_categories WHERE id = $1", [categoryId]);
+  if (!current.rowCount) throw catalogError(404, "Categoria não encontrada.");
+  const name = req.body?.name == null
+    ? current.rows[0].name
+    : cleanOptionalText(req.body.name, 50, "Nome da categoria");
+  if (name.length < 2) throw catalogError(400, "O nome da categoria deve ter pelo menos 2 caracteres.");
+  const sortOrder = req.body?.sortOrder == null ? Number(current.rows[0].sort_order) : Number(req.body.sortOrder);
+  if (!Number.isInteger(sortOrder) || sortOrder < 0) throw catalogError(400, "Ordem da categoria inválida.");
+  try {
+    const result = await catalogPool.query(
+      `UPDATE service_categories
+       SET name = $2, sort_order = $3, updated_at = NOW()
+       WHERE id = $1
+       RETURNING *`,
+      [categoryId, name, sortOrder],
+    );
+    const row = result.rows[0];
+    res.json({ id: Number(row.id), name: row.name, sortOrder: Number(row.sort_order) });
+  } catch (error) {
+    if (error?.code === "23505") throw catalogError(409, "Já existe uma categoria com esse nome.");
+    throw error;
+  }
+}));
+
+catalogRouter.delete("/admin/categories/:categoryId", guarded("admin", async (req, res) => {
+  const categoryId = Number(req.params.categoryId);
+  if (!Number.isInteger(categoryId) || categoryId <= 0) throw catalogError(400, "Categoria inválida.");
+  const result = await catalogPool.query(
+    "DELETE FROM service_categories WHERE id = $1 RETURNING id, name",
+    [categoryId],
+  );
+  if (!result.rowCount) throw catalogError(404, "Categoria não encontrada.");
+  res.json({ ok: true, id: Number(result.rows[0].id), name: result.rows[0].name });
+}));
+
+catalogRouter.get("/admin/services", guarded("admin", async (_req, res) => {
+  const result = await catalogPool.query(
+    `SELECT s.*, c.name AS category_name, c.sort_order AS category_sort_order
+     FROM services s
+     LEFT JOIN service_categories c ON c.id = s.category_id
+     ORDER BY c.sort_order NULLS LAST, c.name NULLS LAST, COALESCE(s.custom_name, s.name), s.service_id`,
+  );
+  res.json(result.rows.map(mapCatalogService));
+}));
+
+catalogRouter.post("/admin/services", guarded("admin", async (req, res) => {
+  const serviceId = positiveServiceId(req.body?.serviceId);
+  const pricePerThousandBRL = priceValue(req.body?.pricePerThousandBRL);
+  const hasCustomName = Object.prototype.hasOwnProperty.call(req.body || {}, "customName");
+  const hasDescription = Object.prototype.hasOwnProperty.call(req.body || {}, "description");
+  const hasCategory = Object.prototype.hasOwnProperty.call(req.body || {}, "categoryId");
+  const customName = hasCustomName ? (cleanOptionalText(req.body.customName, 90, "Nome personalizado") || null) : null;
+  const description = hasDescription ? cleanOptionalText(req.body.description, 500, "Descrição") : "";
+  const categoryId = hasCategory ? await checkedCategoryId(req.body.categoryId) : null;
+  const remote = await smm.getService(serviceId, { fresh: true });
+
+  await catalogPool.query(
+    `INSERT INTO services (
+       service_id, name, custom_name, description, category, category_id, type, rate,
+       min_quantity, max_quantity, refill_supported, cancel_supported, raw_data,
+       price_per_thousand_brl, enabled
+     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,TRUE)
+     ON CONFLICT (service_id) DO UPDATE SET
+       name = EXCLUDED.name,
+       custom_name = CASE WHEN $15::BOOLEAN THEN EXCLUDED.custom_name ELSE services.custom_name END,
+       description = CASE WHEN $16::BOOLEAN THEN EXCLUDED.description ELSE services.description END,
+       category = EXCLUDED.category,
+       category_id = CASE WHEN $17::BOOLEAN THEN EXCLUDED.category_id ELSE services.category_id END,
+       type = EXCLUDED.type,
+       rate = EXCLUDED.rate,
+       min_quantity = EXCLUDED.min_quantity,
+       max_quantity = EXCLUDED.max_quantity,
+       refill_supported = EXCLUDED.refill_supported,
+       cancel_supported = EXCLUDED.cancel_supported,
+       raw_data = EXCLUDED.raw_data,
+       price_per_thousand_brl = EXCLUDED.price_per_thousand_brl,
+       updated_at = NOW()`,
+    [
+      serviceId,
+      remote.name || `Serviço ${serviceId}`,
+      customName,
+      description,
+      remote.category || "",
+      categoryId,
+      remote.type || "",
+      Number(remote.rate || 0),
+      Number(remote.min || 1),
+      Number(remote.max || 1_000_000),
+      Boolean(remote.refill),
+      Boolean(remote.cancel),
+      JSON.stringify(remote.raw || remote || {}),
+      pricePerThousandBRL,
+      hasCustomName,
+      hasDescription,
+      hasCategory,
+    ],
+  );
+
+  res.status(201).json(mapCatalogService(await getCatalogService(serviceId)));
+}));
+
+catalogRouter.patch("/admin/services/:serviceId", guarded("admin", async (req, res) => {
+  const serviceId = positiveServiceId(req.params.serviceId);
+  const currentResult = await catalogPool.query("SELECT * FROM services WHERE service_id = $1", [serviceId]);
+  const current = currentResult.rows[0];
+  if (!current) throw catalogError(404, "Serviço não encontrado.");
+
+  const hasEnabled = Object.prototype.hasOwnProperty.call(req.body || {}, "enabled");
+  const hasPrice = Object.prototype.hasOwnProperty.call(req.body || {}, "pricePerThousandBRL");
+  const hasCustomName = Object.prototype.hasOwnProperty.call(req.body || {}, "customName");
+  const hasDescription = Object.prototype.hasOwnProperty.call(req.body || {}, "description");
+  const hasCategory = Object.prototype.hasOwnProperty.call(req.body || {}, "categoryId");
+
+  if (!hasEnabled && !hasPrice && !hasCustomName && !hasDescription && !hasCategory) {
+    throw catalogError(400, "Informe ao menos um campo para atualizar o serviço.");
+  }
+
+  const enabled = hasEnabled ? Boolean(req.body.enabled) : Boolean(current.enabled);
+  const pricePerThousandBRL = hasPrice ? priceValue(req.body.pricePerThousandBRL) : Number(current.price_per_thousand_brl);
+  const customName = hasCustomName
+    ? (cleanOptionalText(req.body.customName, 90, "Nome personalizado") || null)
+    : current.custom_name;
+  const description = hasDescription
+    ? cleanOptionalText(req.body.description, 500, "Descrição")
+    : current.description;
+  const categoryId = hasCategory ? await checkedCategoryId(req.body.categoryId) : current.category_id;
+
+  await catalogPool.query(
+    `UPDATE services
+     SET enabled = $2,
+         price_per_thousand_brl = $3,
+         custom_name = $4,
+         description = $5,
+         category_id = $6,
+         updated_at = NOW()
+     WHERE service_id = $1`,
+    [serviceId, enabled, pricePerThousandBRL, customName, description, categoryId],
+  );
+
+  res.json(mapCatalogService(await getCatalogService(serviceId)));
+}));
+
+catalogRouter.post("/admin/services/:serviceId/sync", guarded("admin", async (req, res) => {
+  const serviceId = positiveServiceId(req.params.serviceId);
+  const current = await catalogPool.query("SELECT * FROM services WHERE service_id = $1", [serviceId]);
+  if (!current.rowCount) throw catalogError(404, "Serviço não encontrado.");
+  const remote = await smm.getService(serviceId, { fresh: true });
+
+  await catalogPool.query(
+    `UPDATE services SET
+       name = $2,
+       category = $3,
+       type = $4,
+       rate = $5,
+       min_quantity = $6,
+       max_quantity = $7,
+       refill_supported = $8,
+       cancel_supported = $9,
+       raw_data = $10::jsonb,
+       updated_at = NOW()
+     WHERE service_id = $1`,
+    [
+      serviceId,
+      remote.name || current.rows[0].name,
+      remote.category || "",
+      remote.type || "",
+      Number(remote.rate || 0),
+      Number(remote.min || current.rows[0].min_quantity),
+      Number(remote.max || current.rows[0].max_quantity),
+      Boolean(remote.refill),
+      Boolean(remote.cancel),
+      JSON.stringify(remote.raw || remote || {}),
+    ],
+  );
+
+  res.json(mapCatalogService(await getCatalogService(serviceId)));
+}));
+
+const legacyApp = await createApp({ config, db, smm, mercadoPago });
+const app = express();
+app.disable("x-powered-by");
+app.set("trust proxy", 1);
+app.use(catalogRouter);
+app.use(legacyApp);
+
 const server = http.createServer(app);
 
 server.listen(config.port, "0.0.0.0", () => {
@@ -38,7 +498,7 @@
   const force = setTimeout(() => process.exit(1), 10_000).unref();
   server.close(async () => {
     clearTimeout(force);
-    await db.close();
+    await Promise.allSettled([db.close(), catalogPool.end()]);
     process.exit(0);
   });
 }
