import { createSign } from "node:crypto";
import express from "express";
import pg from "pg";
import { verifyToken } from "./crypto.js";

const { Pool } = pg;
const OAUTH_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const OAUTH_AUDIENCE = "https://oauth2.googleapis.com/token";
const OAUTH_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const PAYMENT_CHANNEL_ID = "tw_store_payments";

function safeJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function firebaseCredentials(env = process.env) {
  const serviceAccount = safeJson(String(env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim()) || {};
  return {
    projectId: String(env.FIREBASE_PROJECT_ID || serviceAccount.project_id || "").trim(),
    clientEmail: String(env.FIREBASE_CLIENT_EMAIL || serviceAccount.client_email || "").trim(),
    privateKey: String(env.FIREBASE_PRIVATE_KEY || serviceAccount.private_key || "")
      .replace(/\\n/g, "\n")
      .trim(),
  };
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function paymentText(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Pagamento aprovado";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function bearerToken(req) {
  const authorization = String(req.get("authorization") || "");
  if (!authorization.startsWith("Bearer ")) return "";
  return authorization.slice(7).trim();
}

async function fetchWithTimeout(url, options, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function createPaymentPushFeatures({ config, db }) {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on("error", (error) => {
    console.error("PostgreSQL payment push pool error", { message: error.message });
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_push_devices (
      id BIGSERIAL PRIMARY KEY,
      admin_username TEXT NOT NULL,
      fcm_token TEXT NOT NULL UNIQUE,
      platform TEXT NOT NULL DEFAULT 'android',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS admin_push_devices_enabled_idx
      ON admin_push_devices (enabled, updated_at DESC);
  `);

  const credentials = firebaseCredentials();
  const configured = Boolean(credentials.projectId && credentials.clientEmail && credentials.privateKey);
  let cachedAccessToken = "";
  let cachedAccessTokenExpiresAt = 0;
  let accessTokenPromise = null;

  async function firebaseAccessToken() {
    const nowMs = Date.now();
    if (cachedAccessToken && cachedAccessTokenExpiresAt - nowMs > 5 * 60_000) {
      return cachedAccessToken;
    }
    if (accessTokenPromise) return accessTokenPromise;

    accessTokenPromise = (async () => {
      const now = Math.floor(Date.now() / 1000);
      const header = base64urlJson({ alg: "RS256", typ: "JWT" });
      const payload = base64urlJson({
        iss: credentials.clientEmail,
        scope: OAUTH_SCOPE,
        aud: OAUTH_AUDIENCE,
        iat: now,
        exp: now + 3600,
      });
      const unsignedJwt = `${header}.${payload}`;
      const signer = createSign("RSA-SHA256");
      signer.update(unsignedJwt);
      signer.end();
      const signature = signer.sign(credentials.privateKey).toString("base64url");
      const assertion = `${unsignedJwt}.${signature}`;

      const response = await fetchWithTimeout(OAUTH_AUDIENCE, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: OAUTH_GRANT, assertion }).toString(),
      });
      const text = await response.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { /* handled below */ }
      if (!response.ok || !data.access_token) {
        throw new Error(data.error_description || data.error || `OAuth Firebase HTTP ${response.status}`);
      }
      cachedAccessToken = String(data.access_token);
      const expiresIn = Number(data.expires_in || 3600);
      cachedAccessTokenExpiresAt = Date.now() + Math.max(300, expiresIn) * 1000;
      return cachedAccessToken;
    })();

    try {
      return await accessTokenPromise;
    } finally {
      accessTokenPromise = null;
    }
  }

  async function disableToken(token) {
    await pool.query(
      "UPDATE admin_push_devices SET enabled = FALSE, updated_at = NOW() WHERE fcm_token = $1",
      [token],
    );
  }

  async function sendToDevice(token, { amount, paymentId, depositId }) {
    const accessToken = await firebaseAccessToken();
    const response = await fetchWithTimeout(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(credentials.projectId)}/messages:send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            notification: {
              title: "Tw Store • Pagamento recebido",
              body: `💰 ${paymentText(amount)} recebido e aprovado.`,
            },
            data: {
              type: "payment_approved",
              amount: Number.isFinite(Number(amount)) ? Number(amount).toFixed(2) : "",
              paymentId: String(paymentId || ""),
              depositId: String(depositId || ""),
            },
            android: {
              priority: "high",
              notification: {
                channel_id: PAYMENT_CHANNEL_ID,
                sound: "default",
              },
            },
          },
        }),
      },
    );

    const text = await response.text();
    if (!response.ok) {
      if (text.includes("UNREGISTERED") || text.includes("registration-token-not-registered")) {
        await disableToken(token);
      }
      throw new Error(`FCM HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
  }

  async function notifyApprovedPayment({ amount, paymentId, depositId }) {
    if (!configured) return;
    const result = await pool.query(
      `SELECT fcm_token
       FROM admin_push_devices
       WHERE enabled = TRUE
       ORDER BY updated_at DESC
       LIMIT 20`,
    );
    if (!result.rowCount) return;

    const sends = await Promise.allSettled(
      result.rows.map((row) => sendToDevice(row.fcm_token, { amount, paymentId, depositId })),
    );
    const failed = sends.filter((item) => item.status === "rejected");
    if (failed.length) {
      console.error("Falha ao enviar algumas notificações de pagamento", {
        failed: failed.length,
        total: sends.length,
        messages: failed.slice(0, 3).map((item) => item.reason?.message || String(item.reason)),
      });
    }
  }

  const originalApproveWalletDeposit = db.approveWalletDeposit.bind(db);
  db.approveWalletDeposit = async function approveWalletDepositWithPush(args) {
    const result = await originalApproveWalletDeposit(args);
    if (result?.credited) {
      try {
        await notifyApprovedPayment({
          amount: args?.rawPayment?.transaction_amount,
          paymentId: args?.paymentId || args?.rawPayment?.id,
          depositId: args?.depositId,
        });
      } catch (error) {
        // A notificação nunca pode impedir o crédito nem fazer o webhook falhar.
        console.error("Pagamento creditado, mas o push não foi enviado", { message: error.message });
      }
    }
    return result;
  };

  const router = express.Router();
  router.use(express.json({ limit: "16kb", strict: true }));

  router.post("/admin/push/register", async (req, res) => {
    try {
      const token = bearerToken(req);
      if (!token) return res.status(401).json({ error: "Sessão administrativa não informada." });

      let payload;
      try {
        payload = verifyToken(token, config.jwtSecret);
      } catch {
        return res.status(401).json({ error: "Sessão administrativa inválida." });
      }
      if (payload.role !== "admin") return res.status(403).json({ error: "Acesso administrativo necessário." });

      const admin = await db.getAdmin(payload.sub);
      if (!admin || Number(payload.version) !== Number(admin.token_version)) {
        return res.status(401).json({ error: "A sessão administrativa expirou." });
      }

      const fcmToken = String(req.body?.token || "").trim();
      if (fcmToken.length < 20 || fcmToken.length > 4096) {
        return res.status(400).json({ error: "Token de notificação inválido." });
      }

      await pool.query(
        `INSERT INTO admin_push_devices (admin_username, fcm_token, platform, enabled, updated_at)
         VALUES ($1, $2, 'android', TRUE, NOW())
         ON CONFLICT (fcm_token) DO UPDATE SET
           admin_username = EXCLUDED.admin_username,
           platform = EXCLUDED.platform,
           enabled = TRUE,
           updated_at = NOW()`,
        [admin.username, fcmToken],
      );

      res.json({
        ok: true,
        pushConfigured: configured,
        message: configured
          ? "Este celular foi registrado para receber pagamentos."
          : "Celular registrado. Falta configurar o Firebase no Railway.",
      });
    } catch (error) {
      console.error("Push registration failed", { message: error.message });
      if (!res.headersSent) res.status(500).json({ error: "Não foi possível registrar as notificações." });
    }
  });

  async function close() {
    db.approveWalletDeposit = originalApproveWalletDeposit;
    await pool.end();
  }

  if (!configured) {
    console.warn("Notificações de pagamento desativadas: configure FIREBASE_SERVICE_ACCOUNT_JSON no Railway.");
  }

  return { router, close };
}
