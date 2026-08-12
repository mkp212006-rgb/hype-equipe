import cors from "cors";
import express from "express";
import helmet from "helmet";
import pg from "pg";
import { verifyToken } from "./crypto.js";
import { HttpError } from "./validators.js";

const { Pool } = pg;
const REPORT_TIME_ZONE = "America/Sao_Paulo";

function bearerToken(req) {
  const authorization = req.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new HttpError(401, "Sessão não informada.");
  return authorization.slice(7).trim();
}

function brl(value) {
  const number = Number(value || 0);
  return Number((Number.isFinite(number) ? Math.max(0, number) : 0).toFixed(2));
}

function periodFromRows(boundary, summary, topUsers = []) {
  return {
    startAt: boundary.start_at,
    endAt: boundary.end_at,
    spentBRL: brl(summary.spent_brl),
    smmBRL: brl(summary.smm_brl),
    vpnBRL: brl(summary.vpn_brl),
    purchases: Number(summary.purchases || 0),
    topUsers: topUsers.map((row, index) => ({
      position: index + 1,
      username: row.username,
      name: row.name || row.username,
      spentBRL: brl(row.spent_brl),
      purchases: Number(row.purchases || 0),
    })),
  };
}

export async function createReportFeatures({ config, db }) {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on("error", (error) => {
    console.error("PostgreSQL report pool error", { message: error.message });
  });

  const router = express.Router();
  router.use(helmet({ crossOriginResourcePolicy: false }));
  router.use(cors({
    origin: "*",
    methods: ["GET", "OPTIONS"],
    allowedHeaders: ["Accept", "Authorization", "Content-Type", "X-Request-Id"],
    maxAge: 86_400,
  }));

  async function authenticate(req, role) {
    let payload;
    try {
      payload = verifyToken(bearerToken(req), config.jwtSecret);
    } catch (error) {
      throw new HttpError(401, error.message || "Sessão inválida.");
    }

    if (payload.role !== role) throw new HttpError(403, "Você não tem permissão para visualizar este relatório.");

    if (role === "admin") {
      const admin = await db.getAdmin(payload.sub);
      if (!admin || Number(payload.version) !== Number(admin.token_version)) {
        throw new HttpError(401, "A sessão administrativa expirou.");
      }
    } else {
      const user = await db.getUser(payload.sub);
      if (!user || !user.active || Number(payload.version) !== Number(user.token_version)) {
        throw new HttpError(401, "A sessão do usuário expirou.");
      }
    }

    return payload;
  }

  function requireRole(role) {
    return async (req, _res, next) => {
      try {
        req.auth = await authenticate(req, role);
        next();
      } catch (error) {
        next(error instanceof HttpError ? error : new HttpError(401, error.message || "Sessão inválida."));
      }
    };
  }

  async function boundaries() {
    const result = await pool.query(`
      SELECT
        NOW() AS end_at,
        (date_trunc('week', NOW() AT TIME ZONE $1) AT TIME ZONE $1) AS week_start,
        (date_trunc('month', NOW() AT TIME ZONE $1) AT TIME ZONE $1) AS month_start
    `, [REPORT_TIME_ZONE]);
    return result.rows[0];
  }

  async function hasVpnOrders() {
    const result = await pool.query("SELECT to_regclass('public.vpn_orders') IS NOT NULL AS exists");
    return Boolean(result.rows[0]?.exists);
  }

  function usageCte(includeVpn) {
    return `
      WITH usage AS (
        SELECT
          o.created_by AS username,
          COALESCE(o.charge_brl, 0)::NUMERIC AS amount,
          o.created_at,
          'smm'::TEXT AS source
        FROM orders o
        WHERE o.wallet_debited = TRUE
          AND o.wallet_refunded = FALSE
          AND COALESCE(o.charge_brl, 0) > 0
        ${includeVpn ? `
        UNION ALL
        SELECT
          v.username,
          v.price_brl::NUMERIC AS amount,
          v.created_at,
          'vpn'::TEXT AS source
        FROM vpn_orders v
        WHERE v.status IN ('submitting', 'active')
          AND v.price_brl > 0
        ` : ""}
      )`;
  }

  async function summarize(startAt, endAt, includeVpn, username = null, includeRanking = false) {
    const cte = usageCte(includeVpn);
    const params = username ? [startAt, endAt, String(username).toLowerCase()] : [startAt, endAt];
    const userFilter = username ? " AND LOWER(username) = $3" : "";

    const summaryPromise = pool.query(`${cte}
      SELECT
        COALESCE(SUM(amount), 0) AS spent_brl,
        COALESCE(SUM(amount) FILTER (WHERE source = 'smm'), 0) AS smm_brl,
        COALESCE(SUM(amount) FILTER (WHERE source = 'vpn'), 0) AS vpn_brl,
        COUNT(*)::INTEGER AS purchases
      FROM usage
      WHERE created_at >= $1 AND created_at <= $2${userFilter}
    `, params);

    const rankingPromise = includeRanking
      ? pool.query(`${cte}
          SELECT
            x.username,
            u.name,
            SUM(x.amount) AS spent_brl,
            COUNT(*)::INTEGER AS purchases
          FROM usage x
          LEFT JOIN users u ON u.username = x.username
          WHERE x.created_at >= $1 AND x.created_at <= $2
          GROUP BY x.username, u.name
          HAVING SUM(x.amount) > 0
          ORDER BY SUM(x.amount) DESC, COUNT(*) DESC, x.username ASC
          LIMIT 3
        `, [startAt, endAt])
      : Promise.resolve({ rows: [] });

    const [summaryResult, rankingResult] = await Promise.all([summaryPromise, rankingPromise]);
    return { summary: summaryResult.rows[0], topUsers: rankingResult.rows };
  }

  async function buildReport({ username = null, includeRanking = false }) {
    const bounds = await boundaries();
    const includeVpn = await hasVpnOrders();
    const [week, month] = await Promise.all([
      summarize(bounds.week_start, bounds.end_at, includeVpn, username, includeRanking),
      summarize(bounds.month_start, bounds.end_at, includeVpn, username, includeRanking),
    ]);
    return {
      currency: "BRL",
      timeZone: REPORT_TIME_ZONE,
      generatedAt: bounds.end_at,
      scope: username ? "member" : "admin",
      username: username || null,
      week: periodFromRows({ start_at: bounds.week_start, end_at: bounds.end_at }, week.summary, week.topUsers),
      month: periodFromRows({ start_at: bounds.month_start, end_at: bounds.end_at }, month.summary, month.topUsers),
    };
  }

  router.get("/api/reports/spending", requireRole("member"), async (req, res, next) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(await buildReport({ username: req.auth.sub, includeRanking: false }));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/reports/spending", requireRole("admin"), async (_req, res, next) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(await buildReport({ includeRanking: true }));
    } catch (error) {
      next(error);
    }
  });

  router.use((error, _req, res, _next) => {
    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) console.error("Report request failed", { message: error.message });
    res.status(status).json({ error: error.message || "Não foi possível gerar o relatório." });
  });

  return {
    router,
    close: () => pool.end(),
  };
}
