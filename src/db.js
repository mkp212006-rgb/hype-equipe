import pg from "pg";
import { hashSecret } from "./crypto.js";

const { Pool } = pg;

function serviceFromRow(row) {
  if (!row) return null;
  return {
    service: Number(row.service_id),
    name: row.name,
    category: row.category,
    type: row.type,
    rate: Number(row.rate),
    min: Number(row.min_quantity),
    max: Number(row.max_quantity),
    refill: Boolean(row.refill_supported),
    cancel: Boolean(row.cancel_supported),
    enabled: Boolean(row.enabled),
    updatedAt: row.updated_at,
  };
}

function orderFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    providerOrderId: row.provider_order_id,
    serviceId: row.service_id == null ? null : Number(row.service_id),
    serviceName: row.service_name,
    link: row.link,
    quantity: Number(row.quantity),
    estimatedCharge: row.estimated_charge == null ? null : Number(row.estimated_charge),
    currency: row.currency || "USD",
    status: row.status,
    startCount: row.start_count,
    remains: row.remains,
    refillAvailable: Boolean(row.refill_available),
    cancelAvailable: Boolean(row.cancel_available),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createDatabase(config) {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on("error", (error) => {
    console.error("PostgreSQL pool error", { message: error.message });
  });

  async function migrate() {
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(21032006)");
      await client.query(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS admin_users (
          username TEXT PRIMARY KEY,
          password_hash TEXT NOT NULL,
          token_version INTEGER NOT NULL DEFAULT 1,
          must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
          last_login_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS services (
          service_id INTEGER PRIMARY KEY CHECK (service_id > 0),
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          type TEXT NOT NULL,
          rate NUMERIC(18, 6) NOT NULL CHECK (rate >= 0),
          min_quantity INTEGER NOT NULL CHECK (min_quantity > 0),
          max_quantity INTEGER NOT NULL CHECK (max_quantity >= min_quantity),
          refill_supported BOOLEAN NOT NULL DEFAULT FALSE,
          cancel_supported BOOLEAN NOT NULL DEFAULT FALSE,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS orders (
          id UUID PRIMARY KEY,
          idempotency_key TEXT UNIQUE NOT NULL,
          provider_order_id TEXT,
          service_id INTEGER REFERENCES services(service_id) ON DELETE SET NULL,
          service_name TEXT NOT NULL,
          link TEXT NOT NULL,
          quantity INTEGER NOT NULL CHECK (quantity > 0),
          estimated_charge NUMERIC(18, 6),
          currency TEXT NOT NULL DEFAULT 'USD',
          status TEXT NOT NULL DEFAULT 'Submitting',
          start_count TEXT,
          remains TEXT,
          refill_available BOOLEAN NOT NULL DEFAULT FALSE,
          cancel_available BOOLEAN NOT NULL DEFAULT FALSE,
          created_by TEXT NOT NULL,
          provider_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS order_events (
          id BIGSERIAL PRIMARY KEY,
          order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          action TEXT NOT NULL,
          actor TEXT NOT NULL,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);
        CREATE INDEX IF NOT EXISTS orders_provider_order_id_idx ON orders (provider_order_id);
        CREATE INDEX IF NOT EXISTS order_events_order_id_idx ON order_events (order_id, created_at DESC);
      `);

      const username = config.adminUsername.toLowerCase();
      const existingAdmin = await client.query("SELECT username FROM admin_users WHERE username = $1", [username]);
      if (!existingAdmin.rowCount) {
        const passwordHash = await hashSecret(config.adminPassword);
        await client.query(
          "INSERT INTO admin_users (username, password_hash, must_change_password) VALUES ($1, $2, TRUE)",
          [username, passwordHash],
        );
      }

      await client.query(
        "INSERT INTO app_settings (key, value) VALUES ('team_token_version', '1') ON CONFLICT (key) DO NOTHING",
      );
      const currentTeamCode = await client.query("SELECT value FROM app_settings WHERE key = 'team_code_hash'");
      if (!currentTeamCode.rowCount && config.initialTeamCode) {
        const codeHash = await hashSecret(config.initialTeamCode);
        await client.query("INSERT INTO app_settings (key, value) VALUES ('team_code_hash', $1)", [codeHash]);
      }
    } finally {
      try {
        await client.query("SELECT pg_advisory_unlock(21032006)");
      } finally {
        client.release();
      }
    }
  }

  async function healthcheck() {
    await pool.query("SELECT 1");
  }

  async function getSetting(key) {
    const result = await pool.query("SELECT value FROM app_settings WHERE key = $1", [key]);
    return result.rows[0]?.value ?? null;
  }

  async function getTeamAuth() {
    const result = await pool.query(
      "SELECT key, value FROM app_settings WHERE key IN ('team_code_hash', 'team_token_version')",
    );
    const values = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
    return {
      codeHash: values.team_code_hash || null,
      tokenVersion: Number(values.team_token_version || 1),
    };
  }

  async function setTeamCode(codeHash) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('team_code_hash', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [codeHash],
      );
      const version = await client.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('team_token_version', '2', NOW())
         ON CONFLICT (key) DO UPDATE
         SET value = ((app_settings.value)::INTEGER + 1)::TEXT, updated_at = NOW()
         RETURNING value`,
      );
      await client.query("COMMIT");
      return Number(version.rows[0].value);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function getAdmin(username) {
    const result = await pool.query(
      `SELECT username, password_hash, token_version, must_change_password, last_login_at
       FROM admin_users WHERE username = $1`,
      [String(username).toLowerCase()],
    );
    return result.rows[0] || null;
  }

  async function recordAdminLogin(username) {
    await pool.query("UPDATE admin_users SET last_login_at = NOW() WHERE username = $1", [username]);
  }

  async function changeAdminPassword(username, passwordHash) {
    const result = await pool.query(
      `UPDATE admin_users
       SET password_hash = $2, token_version = token_version + 1,
           must_change_password = FALSE, updated_at = NOW()
       WHERE username = $1
       RETURNING username, token_version, must_change_password`,
      [username, passwordHash],
    );
    return result.rows[0] || null;
  }

  async function listServices(enabledOnly = false) {
    const result = await pool.query(
      `SELECT * FROM services ${enabledOnly ? "WHERE enabled = TRUE" : ""}
       ORDER BY category ASC, name ASC, service_id ASC`,
    );
    return result.rows.map(serviceFromRow);
  }

  async function getService(serviceId) {
    const result = await pool.query("SELECT * FROM services WHERE service_id = $1", [serviceId]);
    return serviceFromRow(result.rows[0]);
  }

  async function upsertService(service) {
    const result = await pool.query(
      `INSERT INTO services (
         service_id, name, category, type, rate, min_quantity, max_quantity,
         refill_supported, cancel_supported, raw_data
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       ON CONFLICT (service_id) DO UPDATE SET
         name = EXCLUDED.name,
         category = EXCLUDED.category,
         type = EXCLUDED.type,
         rate = EXCLUDED.rate,
         min_quantity = EXCLUDED.min_quantity,
         max_quantity = EXCLUDED.max_quantity,
         refill_supported = EXCLUDED.refill_supported,
         cancel_supported = EXCLUDED.cancel_supported,
         raw_data = EXCLUDED.raw_data,
         updated_at = NOW()
       RETURNING *`,
      [
        service.service,
        service.name,
        service.category,
        service.type,
        service.rate,
        service.min,
        service.max,
        service.refill,
        service.cancel,
        JSON.stringify(service.raw || {}),
      ],
    );
    return serviceFromRow(result.rows[0]);
  }

  async function setServiceEnabled(serviceId, enabled) {
    const result = await pool.query(
      "UPDATE services SET enabled = $2, updated_at = NOW() WHERE service_id = $1 RETURNING *",
      [serviceId, enabled],
    );
    return serviceFromRow(result.rows[0]);
  }

  async function deleteService(serviceId) {
    const result = await pool.query("DELETE FROM services WHERE service_id = $1 RETURNING service_id", [serviceId]);
    return Boolean(result.rowCount);
  }

  async function listOrders(limit = 200) {
    const result = await pool.query("SELECT * FROM orders ORDER BY created_at DESC LIMIT $1", [limit]);
    return result.rows.map(orderFromRow);
  }

  async function getOrder(id) {
    const result = await pool.query("SELECT * FROM orders WHERE id = $1", [id]);
    return orderFromRow(result.rows[0]);
  }

  async function createPendingOrder(order) {
    const result = await pool.query(
      `INSERT INTO orders (
         id, idempotency_key, service_id, service_name, link, quantity,
         estimated_charge, currency, status, refill_available, cancel_available, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Submitting',$9,$10,$11)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [
        order.id,
        order.idempotencyKey,
        order.serviceId,
        order.serviceName,
        order.link,
        order.quantity,
        order.estimatedCharge,
        order.currency,
        order.refillAvailable,
        order.cancelAvailable,
        order.createdBy,
      ],
    );
    if (result.rowCount) return { created: true, order: orderFromRow(result.rows[0]) };
    const existing = await pool.query("SELECT * FROM orders WHERE idempotency_key = $1", [order.idempotencyKey]);
    return { created: false, order: orderFromRow(existing.rows[0]) };
  }

  async function updateOrder(id, update) {
    const result = await pool.query(
      `UPDATE orders SET
         provider_order_id = COALESCE($2, provider_order_id),
         status = COALESCE($3, status),
         estimated_charge = COALESCE($4, estimated_charge),
         currency = COALESCE($5, currency),
         start_count = COALESCE($6, start_count),
         remains = COALESCE($7, remains),
         refill_available = COALESCE($8, refill_available),
         cancel_available = COALESCE($9, cancel_available),
         provider_payload = COALESCE($10::jsonb, provider_payload),
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        update.providerOrderId ?? null,
        update.status ?? null,
        update.estimatedCharge ?? null,
        update.currency ?? null,
        update.startCount ?? null,
        update.remains ?? null,
        update.refillAvailable ?? null,
        update.cancelAvailable ?? null,
        update.providerPayload == null ? null : JSON.stringify(update.providerPayload),
      ],
    );
    return orderFromRow(result.rows[0]);
  }

  async function addOrderEvent(orderId, action, actor, payload = {}) {
    await pool.query(
      "INSERT INTO order_events (order_id, action, actor, payload) VALUES ($1, $2, $3, $4::jsonb)",
      [orderId, action, actor, JSON.stringify(payload)],
    );
  }

  async function countOrders() {
    const result = await pool.query("SELECT COUNT(*)::INTEGER AS count FROM orders");
    return Number(result.rows[0].count);
  }

  async function close() {
    await pool.end();
  }

  return {
    migrate,
    healthcheck,
    getSetting,
    getTeamAuth,
    setTeamCode,
    getAdmin,
    recordAdminLogin,
    changeAdminPassword,
    listServices,
    getService,
    upsertService,
    setServiceEnabled,
    deleteService,
    listOrders,
    getOrder,
    createPendingOrder,
    updateOrder,
    addOrderEvent,
    countOrders,
    close,
  };
}
