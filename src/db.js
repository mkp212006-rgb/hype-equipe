const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não configurada. Adicione um PostgreSQL no Railway e exponha DATABASE_URL.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
});

async function migrate() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS wallets (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      amount_cents BIGINT NOT NULL,
      description TEXT NOT NULL,
      reference TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_created
      ON wallet_transactions(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS service_categories (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_service_categories_name_ci
      ON service_categories ((LOWER(name)));

    CREATE TABLE IF NOT EXISTS services (
      service_id BIGINT PRIMARY KEY,
      name TEXT NOT NULL,
      custom_name TEXT,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      category_id BIGINT REFERENCES service_categories(id) ON DELETE SET NULL,
      type TEXT NOT NULL DEFAULT '',
      provider_rate NUMERIC(18,6) NOT NULL DEFAULT 0,
      min_qty INTEGER NOT NULL DEFAULT 1,
      max_qty INTEGER NOT NULL DEFAULT 1000000,
      price_per_thousand_cents BIGINT NOT NULL CHECK (price_per_thousand_cents > 0),
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      provider_payload JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE services ADD COLUMN IF NOT EXISTS custom_name TEXT;
    ALTER TABLE services ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
    ALTER TABLE services ADD COLUMN IF NOT EXISTS category_id BIGINT;
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'services_category_id_fkey'
      ) THEN
        ALTER TABLE services
          ADD CONSTRAINT services_category_id_fkey
          FOREIGN KEY (category_id) REFERENCES service_categories(id) ON DELETE SET NULL;
      END IF;
    END $$;
    CREATE INDEX IF NOT EXISTS idx_services_category_id ON services(category_id);

    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      service_id BIGINT NOT NULL REFERENCES services(service_id) ON DELETE RESTRICT,
      link TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      charge_cents BIGINT NOT NULL CHECK (charge_cents >= 0),
      provider_order_id TEXT,
      status TEXT NOT NULL DEFAULT 'processing',
      provider_payload JSONB,
      idempotency_key TEXT NOT NULL,
      refunded BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS deposits (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      credit_cents BIGINT NOT NULL CHECK (credit_cents > 0),
      fee_cents BIGINT NOT NULL CHECK (fee_cents >= 0),
      charge_cents BIGINT NOT NULL CHECK (charge_cents > 0),
      status TEXT NOT NULL DEFAULT 'pending',
      idempotency_key TEXT NOT NULL,
      mp_preference_id TEXT,
      mp_payment_id TEXT UNIQUE,
      checkout_url TEXT,
      provider_payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_deposits_user_created ON deposits(user_id, created_at DESC);
  `);
}

async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { pool, migrate, withTx };
