import { randomUUID } from "node:crypto";
import pg from "pg";
import { hashSecret } from "./crypto.js";

const { Pool } = pg;

function serviceFromRow(row) {
  if (!row) return null;
  const price = row.price_per_thousand_brl == null ? null : Number(row.price_per_thousand_brl);
  return {
    service: Number(row.service_id),
    name: row.name,
    category: row.category,
    type: row.type,
    rate: Number(row.rate),
    providerRate: Number(row.rate),
    pricePerThousandBRL: price,
    rateBRL: price,
    currency: "BRL",
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
  const chargeBRL = row.charge_brl == null
    ? (String(row.currency || "").toUpperCase() === "BRL" && row.estimated_charge != null ? Number(row.estimated_charge) : null)
    : Number(row.charge_brl);
  return {
    id: row.id,
    providerOrderId: row.provider_order_id,
    serviceId: row.service_id == null ? null : Number(row.service_id),
    serviceName: row.service_name,
    link: row.link,
    quantity: Number(row.quantity),
    estimatedCharge: chargeBRL ?? (row.estimated_charge == null ? null : Number(row.estimated_charge)),
    estimatedChargeBRL: chargeBRL,
    chargeBRL,
    amountBRL: chargeBRL,
    currency: chargeBRL != null ? "BRL" : (row.currency || "BRL"),
    status: row.status,
    startCount: row.start_count,
    remains: row.remains,
    refillAvailable: Boolean(row.refill_available),
    cancelAvailable: Boolean(row.cancel_available),
    createdBy: row.created_by,
    walletDebited: Boolean(row.wallet_debited),
    walletRefunded: Boolean(row.wallet_refunded),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function transactionFromRow(row) {
  return {
    id: row.id,
    type: row.type,
    amount: Number(row.amount),
    currency: "BRL",
    description: row.description,
    reference: row.reference,
    createdAt: row.created_at,
  };
}

function depositFromRow(row) {
  if (!row) return null;
  const rawPayment = row.raw_payment && typeof row.raw_payment === "object" ? row.raw_payment : {};
  const transactionData = rawPayment?.point_of_interaction?.transaction_data || {};
  return {
    id: row.id,
    amount: Number(row.credit_amount),
    creditAmount: Number(row.credit_amount),
    feeAmount: Number(row.fee_amount),
    totalAmount: Number(row.total_amount),
    currency: "BRL",
    status: row.status,
    preferenceId: row.mp_preference_id,
    paymentId: row.mp_payment_id,
    checkoutUrl: row.checkout_url,
    ticketUrl: transactionData.ticket_url || row.checkout_url || null,
    qrCode: transactionData.qr_code || null,
    qrCodeBase64: transactionData.qr_code_base64 || null,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
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

        CREATE TABLE IF NOT EXISTS users (
          username TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT,
          password_hash TEXT NOT NULL,
          token_version INTEGER NOT NULL DEFAULT 1,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          last_login_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
        CREATE UNIQUE INDEX IF NOT EXISTS users_email_ci_idx
          ON users ((LOWER(email)))
          WHERE email IS NOT NULL AND email <> '';

        CREATE TABLE IF NOT EXISTS wallets (
          username TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
          balance NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS wallet_transactions (
          id UUID PRIMARY KEY,
          username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
          type TEXT NOT NULL,
          amount NUMERIC(18,2) NOT NULL,
          description TEXT NOT NULL,
          reference TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS wallet_deposits (
          id UUID PRIMARY KEY,
          username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
          idempotency_key TEXT NOT NULL,
          credit_amount NUMERIC(18,2) NOT NULL CHECK (credit_amount > 0),
          fee_amount NUMERIC(18,2) NOT NULL CHECK (fee_amount >= 0),
          total_amount NUMERIC(18,2) NOT NULL CHECK (total_amount > 0),
          status TEXT NOT NULL DEFAULT 'pending',
          mp_preference_id TEXT,
          mp_payment_id TEXT UNIQUE,
          checkout_url TEXT,
          raw_payment JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          approved_at TIMESTAMPTZ,
          UNIQUE (username, idempotency_key)
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

        ALTER TABLE services ADD COLUMN IF NOT EXISTS price_per_thousand_brl NUMERIC(18,2);

        CREATE TABLE IF NOT EXISTS orders (
          id UUID PRIMARY KEY,
          idempotency_key TEXT UNIQUE NOT NULL,
          provider_order_id TEXT,
          service_id INTEGER REFERENCES services(service_id) ON DELETE SET NULL,
          service_name TEXT NOT NULL,
          link TEXT NOT NULL,
          quantity INTEGER NOT NULL CHECK (quantity > 0),
          estimated_charge NUMERIC(18, 6),
          currency TEXT NOT NULL DEFAULT 'BRL',
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

        ALTER TABLE orders ADD COLUMN IF NOT EXISTS charge_brl NUMERIC(18,2);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS wallet_debited BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS wallet_refunded BOOLEAN NOT NULL DEFAULT FALSE;

        CREATE TABLE IF NOT EXISTS order_events (
          id BIGSERIAL PRIMARY KEY,
          order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          action TEXT NOT NULL,
          actor TEXT NOT NULL,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);
        CREATE INDEX IF NOT EXISTS orders_created_by_idx ON orders (created_by, created_at DESC);
        CREATE INDEX IF NOT EXISTS orders_provider_order_id_idx ON orders (provider_order_id);
        CREATE INDEX IF NOT EXISTS order_events_order_id_idx ON order_events (order_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS wallet_transactions_username_idx ON wallet_transactions (username, created_at DESC);
        CREATE INDEX IF NOT EXISTS wallet_deposits_username_idx ON wallet_deposits (username, created_at DESC);
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

  async function createUser({ name, username, email = null, passwordHash }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO users (username, name, email, password_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING username, name, email, token_version, active, created_at`,
        [username, name, email, passwordHash],
      );
      await client.query("INSERT INTO wallets (username, balance) VALUES ($1, 0)", [username]);
      await client.query("COMMIT");
      return result.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function getUser(username) {
    const result = await pool.query(
      `SELECT username, name, email, password_hash, token_version, active, last_login_at, created_at
       FROM users WHERE username = $1`,
      [String(username).toLowerCase()],
    );
    return result.rows[0] || null;
  }

  async function getUserByIdentifier(identifier) {
    const normalized = String(identifier || "").trim().toLowerCase();
    const result = await pool.query(
      `SELECT username, name, email, password_hash, token_version, active, last_login_at, created_at
       FROM users
       WHERE username = $1 OR LOWER(email) = $1
       ORDER BY CASE WHEN username = $1 THEN 0 ELSE 1 END
       LIMIT 1`,
      [normalized],
    );
    return result.rows[0] || null;
  }

  async function recordUserLogin(username) {
    await pool.query("UPDATE users SET last_login_at = NOW() WHERE username = $1", [username]);
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
      `SELECT * FROM services ${enabledOnly ? "WHERE enabled = TRUE AND price_per_thousand_brl IS NOT NULL AND price_per_thousand_brl > 0" : ""}
       ORDER BY category ASC, name ASC, service_id ASC`,
    );
    return result.rows.map(serviceFromRow);
  }

  async function getService(serviceId) {
    const result = await pool.query("SELECT * FROM services WHERE service_id = $1", [serviceId]);
    return serviceFromRow(result.rows[0]);
  }

  async function upsertService(service, pricePerThousandBRL = null) {
    const result = await pool.query(
      `INSERT INTO services (
         service_id, name, category, type, rate, min_quantity, max_quantity,
         refill_supported, cancel_supported, raw_data, price_per_thousand_brl
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
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
         price_per_thousand_brl = COALESCE(EXCLUDED.price_per_thousand_brl, services.price_per_thousand_brl),
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
        pricePerThousandBRL,
      ],
    );
    return serviceFromRow(result.rows[0]);
  }

  async function updateServiceSettings(serviceId, { enabled, pricePerThousandBRL }) {
    const result = await pool.query(
      `UPDATE services SET
         enabled = COALESCE($2, enabled),
         price_per_thousand_brl = COALESCE($3, price_per_thousand_brl),
         updated_at = NOW()
       WHERE service_id = $1
       RETURNING *`,
      [serviceId, enabled ?? null, pricePerThousandBRL ?? null],
    );
    return serviceFromRow(result.rows[0]);
  }

  async function setServiceEnabled(serviceId, enabled) {
    return updateServiceSettings(serviceId, { enabled });
  }

  async function deleteService(serviceId) {
    const result = await pool.query("DELETE FROM services WHERE service_id = $1 RETURNING service_id", [serviceId]);
    return Boolean(result.rowCount);
  }

  async function getWallet(username) {
    const result = await pool.query("SELECT balance, updated_at FROM wallets WHERE username = $1", [username]);
    return result.rows[0]
      ? { balance: Number(result.rows[0].balance), currency: "BRL", updatedAt: result.rows[0].updated_at }
      : null;
  }

  async function listWalletTransactions(username, limit = 100) {
    const result = await pool.query(
      "SELECT * FROM wallet_transactions WHERE username = $1 ORDER BY created_at DESC LIMIT $2",
      [username, limit],
    );
    return result.rows.map(transactionFromRow);
  }

  async function createWalletDeposit({ id, username, idempotencyKey, creditAmount, feeAmount, totalAmount }) {
    const result = await pool.query(
      `INSERT INTO wallet_deposits (id, username, idempotency_key, credit_amount, fee_amount, total_amount)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (username, idempotency_key) DO NOTHING
       RETURNING *`,
      [id, username, idempotencyKey, creditAmount, feeAmount, totalAmount],
    );
    if (result.rowCount) return { created: true, deposit: depositFromRow(result.rows[0]) };
    const existing = await pool.query(
      "SELECT * FROM wallet_deposits WHERE username = $1 AND idempotency_key = $2",
      [username, idempotencyKey],
    );
    return { created: false, deposit: depositFromRow(existing.rows[0]) };
  }

  async function updateWalletDepositPreference(id, { preferenceId, paymentId, checkoutUrl, status, rawPayment }) {
    const result = await pool.query(
      `UPDATE wallet_deposits
       SET mp_preference_id = COALESCE($2, mp_preference_id),
           mp_payment_id = COALESCE($3, mp_payment_id),
           checkout_url = COALESCE($4, checkout_url),
           status = COALESCE($5, status),
           raw_payment = COALESCE($6::jsonb, raw_payment)
       WHERE id = $1
       RETURNING *`,
      [
        id,
        preferenceId ?? null,
        paymentId ?? null,
        checkoutUrl ?? null,
        status ?? null,
        rawPayment == null ? null : JSON.stringify(rawPayment),
      ],
    );
    return depositFromRow(result.rows[0]);
  }

  async function getWalletDeposit(id) {
    const result = await pool.query("SELECT * FROM wallet_deposits WHERE id = $1", [id]);
    return depositFromRow(result.rows[0]);
  }

  async function approveWalletDeposit({ depositId, paymentId, rawPayment }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const depositResult = await client.query("SELECT * FROM wallet_deposits WHERE id = $1 FOR UPDATE", [depositId]);
      const deposit = depositResult.rows[0];
      if (!deposit) {
        await client.query("ROLLBACK");
        return { credited: false, reason: "deposit-not-found" };
      }
      if (deposit.status === "approved") {
        await client.query("COMMIT");
        return { credited: false, reason: "already-approved", deposit: depositFromRow(deposit) };
      }
      const usedPayment = await client.query(
        "SELECT id FROM wallet_deposits WHERE mp_payment_id = $1 AND id <> $2",
        [String(paymentId), depositId],
      );
      if (usedPayment.rowCount) throw new Error("O pagamento já foi usado em outro depósito.");

      const wallet = await client.query("SELECT balance FROM wallets WHERE username = $1 FOR UPDATE", [deposit.username]);
      if (!wallet.rowCount) throw new Error("Carteira não encontrada.");
      const newBalance = Number((Number(wallet.rows[0].balance) + Number(deposit.credit_amount)).toFixed(2));
      await client.query(
        "UPDATE wallets SET balance = $2, updated_at = NOW() WHERE username = $1",
        [deposit.username, newBalance],
      );
      await client.query(
        `UPDATE wallet_deposits
         SET status = 'approved', mp_payment_id = $2, raw_payment = $3::jsonb, approved_at = NOW()
         WHERE id = $1`,
        [depositId, String(paymentId), JSON.stringify(rawPayment || {})],
      );
      await client.query(
        `INSERT INTO wallet_transactions (id, username, type, amount, description, reference)
         VALUES ($4, $1, 'deposit', $2, 'Depósito aprovado via Mercado Pago', $3)`,
        [deposit.username, Number(deposit.credit_amount), String(paymentId), randomUUID()],
      );
      await client.query("COMMIT");
      return { credited: true, balance: newBalance, username: deposit.username };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function markWalletDepositStatus(depositId, status, rawPayment = {}) {
    await pool.query(
      `UPDATE wallet_deposits
       SET status = $2, raw_payment = $3::jsonb
       WHERE id = $1 AND status <> 'approved'`,
      [depositId, status, JSON.stringify(rawPayment || {})],
    );
  }

  async function listOrders(username, limit = 200) {
    const result = await pool.query(
      "SELECT * FROM orders WHERE created_by = $1 ORDER BY created_at DESC LIMIT $2",
      [username, limit],
    );
    return result.rows.map(orderFromRow);
  }

  async function getOrder(id, username = null) {
    const result = username
      ? await pool.query("SELECT * FROM orders WHERE id = $1 AND created_by = $2", [id, username])
      : await pool.query("SELECT * FROM orders WHERE id = $1", [id]);
    return orderFromRow(result.rows[0]);
  }

  async function createWalletOrder(order) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query("SELECT * FROM orders WHERE idempotency_key = $1", [order.idempotencyKey]);
      if (existing.rowCount) {
        const existingOrder = orderFromRow(existing.rows[0]);
        if (existingOrder.createdBy !== order.createdBy) {
          throw new Error("Chave de idempotência já utilizada.");
        }
        await client.query("COMMIT");
        return { created: false, order: existingOrder };
      }

      const wallet = await client.query("SELECT balance FROM wallets WHERE username = $1 FOR UPDATE", [order.createdBy]);
      if (!wallet.rowCount) throw Object.assign(new Error("Carteira não encontrada."), { code: "WALLET_NOT_FOUND" });
      const currentBalance = Number(wallet.rows[0].balance);
      if (currentBalance + 0.00001 < order.chargeBRL) {
        throw Object.assign(new Error("Saldo insuficiente na carteira."), { code: "INSUFFICIENT_BALANCE" });
      }
      const newBalance = Number((currentBalance - order.chargeBRL).toFixed(2));
      await client.query(
        "UPDATE wallets SET balance = $2, updated_at = NOW() WHERE username = $1",
        [order.createdBy, newBalance],
      );
      const result = await client.query(
        `INSERT INTO orders (
           id, idempotency_key, service_id, service_name, link, quantity,
           estimated_charge, charge_brl, currency, status, refill_available,
           cancel_available, created_by, wallet_debited
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,'BRL','Submitting',$8,$9,$10,TRUE)
         RETURNING *`,
        [
          order.id,
          order.idempotencyKey,
          order.serviceId,
          order.serviceName,
          order.link,
          order.quantity,
          order.chargeBRL,
          order.refillAvailable,
          order.cancelAvailable,
          order.createdBy,
        ],
      );
      await client.query(
        `INSERT INTO wallet_transactions (id, username, type, amount, description, reference)
         VALUES ($5, $1, 'order', $2, $3, $4)`,
        [order.createdBy, -order.chargeBRL, `Pedido ${order.serviceName}`, order.id, randomUUID()],
      );
      await client.query("COMMIT");
      return { created: true, order: orderFromRow(result.rows[0]), balance: newBalance };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function refundWalletOrder(id, reason = "Falha ao enviar pedido") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const orderResult = await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [id]);
      const row = orderResult.rows[0];
      if (!row || !row.wallet_debited || row.wallet_refunded || row.charge_brl == null) {
        await client.query("COMMIT");
        return orderFromRow(row);
      }
      const charge = Number(row.charge_brl);
      await client.query("SELECT balance FROM wallets WHERE username = $1 FOR UPDATE", [row.created_by]);
      await client.query(
        "UPDATE wallets SET balance = balance + $2, updated_at = NOW() WHERE username = $1",
        [row.created_by, charge],
      );
      const updated = await client.query(
        `UPDATE orders SET wallet_refunded = TRUE, status = 'Error', updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id],
      );
      await client.query(
        `INSERT INTO wallet_transactions (id, username, type, amount, description, reference)
         VALUES ($5, $1, 'refund', $2, $3, $4)`,
        [row.created_by, charge, reason, id, randomUUID()],
      );
      await client.query("COMMIT");
      return orderFromRow(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function updateOrder(id, update) {
    const result = await pool.query(
      `UPDATE orders SET
         provider_order_id = COALESCE($2, provider_order_id),
         status = COALESCE($3, status),
         start_count = COALESCE($4, start_count),
         remains = COALESCE($5, remains),
         refill_available = COALESCE($6, refill_available),
         cancel_available = COALESCE($7, cancel_available),
         provider_payload = COALESCE($8::jsonb, provider_payload),
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        update.providerOrderId ?? null,
        update.status ?? null,
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

  async function countUsers() {
    const result = await pool.query("SELECT COUNT(*)::INTEGER AS count FROM users WHERE active = TRUE");
    return Number(result.rows[0].count);
  }

  async function close() {
    await pool.end();
  }

  return {
    migrate,
    healthcheck,
    getSetting,
    createUser,
    getUser,
    getUserByIdentifier,
    recordUserLogin,
    getAdmin,
    recordAdminLogin,
    changeAdminPassword,
    listServices,
    getService,
    upsertService,
    updateServiceSettings,
    setServiceEnabled,
    deleteService,
    getWallet,
    listWalletTransactions,
    createWalletDeposit,
    updateWalletDepositPreference,
    getWalletDeposit,
    approveWalletDeposit,
    markWalletDepositStatus,
    listOrders,
    getOrder,
    createWalletOrder,
    refundWalletOrder,
    updateOrder,
    addOrderEvent,
    countOrders,
    countUsers,
    close,
  };
}
