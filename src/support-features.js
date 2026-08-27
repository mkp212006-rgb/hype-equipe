import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import pg from "pg";
import { hashSecret, signToken, verifySecret, verifyToken } from "./crypto.js";
import { rateLimit } from "./rate-limit.js";
import { HttpError, text, uuid } from "./validators.js";

const { Pool } = pg;

function bearerToken(req) {
  const authorization = req.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new HttpError(401, "Sessão não informada.");
  return authorization.slice(7).trim();
}

function cleanLoginIdentifier(value) {
  const identifier = String(value || "").trim().toLowerCase();
  const isEmail = identifier.includes("@");
  const valid = isEmail
    ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)
    : /^[a-z0-9._-]+$/.test(identifier);
  const minimum = isEmail ? 5 : 1;
  if (identifier.length < minimum || identifier.length > 254 || !valid) {
    throw new HttpError(400, "Informe um e-mail ou usuário válido.");
  }
  return identifier;
}

function makeSession(config, payload) {
  return signToken(payload, config.jwtSecret, { ttlSeconds: config.tokenTtlSeconds });
}

function ticketFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    subject: row.subject,
    status: row.status,
    lastMessage: row.last_message || "",
    lastMessageAt: row.last_message_at || row.updated_at,
    messageCount: Number(row.message_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function messageFromRow(row) {
  return {
    id: row.id,
    senderRole: row.sender_role,
    senderUsername: row.sender_username,
    message: row.message,
    createdAt: row.created_at,
  };
}

export async function createSupportFeatures({ config, db }) {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on("error", (error) => {
    console.error("PostgreSQL support pool error", { message: error.message });
  });

  async function migrate() {
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(21032062)");
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_profiles (
          username TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
          profile_photo_data_url TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS support_tickets (
          id UUID PRIMARY KEY,
          username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
          subject TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS support_messages (
          id UUID PRIMARY KEY,
          ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
          sender_role TEXT NOT NULL CHECK (sender_role IN ('member', 'admin')),
          sender_username TEXT NOT NULL,
          message TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS support_tickets_username_idx
          ON support_tickets (username, updated_at DESC);
        CREATE INDEX IF NOT EXISTS support_tickets_status_idx
          ON support_tickets (status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS support_messages_ticket_idx
          ON support_messages (ticket_id, created_at ASC);
      `);
    } finally {
      try {
        await client.query("SELECT pg_advisory_unlock(21032062)");
      } finally {
        client.release();
      }
    }
  }

  await migrate();

  const dummyPasswordHash = await hashSecret("tw-store-support-dummy-password");
  const router = express.Router();
  const loginLimiter = rateLimit({ name: "unified-login", windowMs: 15 * 60_000, maximum: 20 });
  const ticketLimiter = rateLimit({ name: "support-ticket", windowMs: 60_000, maximum: 20 });

  router.use(helmet({ crossOriginResourcePolicy: false }));
  router.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Accept", "Authorization", "Content-Type", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset"],
    maxAge: 86_400,
  }));
  router.use(express.json({ limit: "128kb", strict: true }));

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

  async function getTicket(ticketId) {
    const result = await pool.query(
      `SELECT t.*,
              (SELECT m.message FROM support_messages m WHERE m.ticket_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
              (SELECT m.created_at FROM support_messages m WHERE m.ticket_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_at,
              (SELECT COUNT(*)::INTEGER FROM support_messages m WHERE m.ticket_id = t.id) AS message_count
       FROM support_tickets t
       WHERE t.id = $1`,
      [ticketId],
    );
    return result.rows[0] || null;
  }

  async function ticketDetails(ticketId) {
    const ticketRow = await getTicket(ticketId);
    if (!ticketRow) return null;
    const messages = await pool.query(
      "SELECT * FROM support_messages WHERE ticket_id = $1 ORDER BY created_at ASC",
      [ticketId],
    );
    return { ...ticketFromRow(ticketRow), messages: messages.rows.map(messageFromRow) };
  }

  // Login único: o mesmo formulário identifica automaticamente cliente ou administrador.
  router.post("/auth/login", loginLimiter, async (req, res) => {
    const identifier = cleanLoginIdentifier(req.body?.identifier ?? req.body?.username);
    const password = text(req.body?.password, "Senha", { minimum: 1, maximum: 256 });

    const [admin, user] = await Promise.all([
      db.getAdmin(identifier.includes("@") ? "" : identifier),
      db.getUserByIdentifier(identifier),
    ]);
    const adminValid = await verifySecret(password, admin?.password_hash || dummyPasswordHash);

    if (admin && adminValid) {
      await db.recordAdminLogin(admin.username);
      const token = makeSession(config, {
        sub: admin.username,
        role: "admin",
        member: "Administrador",
        username: admin.username,
        version: Number(admin.token_version),
      });
      return res.json({
        token,
        member: "Administrador",
        username: admin.username,
        role: "admin",
        mustChangePassword: Boolean(admin.must_change_password),
      });
    }

    const userValid = await verifySecret(password, user?.password_hash || dummyPasswordHash);
    if (!user || !user.active || !userValid) throw new HttpError(401, "E-mail, usuário ou senha incorretos.");

    await db.recordUserLogin(user.username);
    const token = makeSession(config, {
      sub: user.username,
      role: "member",
      member: user.name,
      username: user.username,
      version: Number(user.token_version),
    });
    res.json({ token, member: user.name, username: user.username, email: user.email || null, role: "member" });
  });

  router.get("/api/account", authenticate, requireRole("member"), async (req, res) => {
    const user = await db.getUser(req.auth.sub);
    if (!user) throw new HttpError(404, "Conta não encontrada.");
    const profile = await pool.query("SELECT profile_photo_data_url FROM user_profiles WHERE username = $1", [req.auth.sub]);
    res.json({
      name: user.name,
      username: user.username,
      email: user.email || null,
      role: "member",
      profilePhoto: profile.rows[0]?.profile_photo_data_url || "",
    });
  });

  router.patch("/api/account/profile-photo", authenticate, requireRole("member"), async (req, res) => {
    const photo = String(req.body?.photoDataUrl || "").trim();
    if (photo) {
      if (!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(photo)) {
        throw new HttpError(400, "Formato da foto de perfil inválido.");
      }
      if (photo.length > 95_000) throw new HttpError(413, "A foto deve ter no máximo aproximadamente 70 KB.");
    }
    await pool.query(
      `INSERT INTO user_profiles (username, profile_photo_data_url)
       VALUES ($1, $2)
       ON CONFLICT (username) DO UPDATE SET
         profile_photo_data_url = EXCLUDED.profile_photo_data_url,
         updated_at = NOW()`,
      [req.auth.sub, photo || null],
    );
    res.json({ ok: true, profilePhoto: photo });
  });

  router.post("/api/account/password", authenticate, requireRole("member"), async (req, res) => {
    const currentPassword = text(req.body?.currentPassword, "Senha atual", { minimum: 1, maximum: 256 });
    const newPassword = text(req.body?.newPassword, "Nova senha", { minimum: 6, maximum: 256 });
    const user = await db.getUser(req.auth.sub);
    if (!user || !(await verifySecret(currentPassword, user.password_hash))) {
      throw new HttpError(401, "A senha atual está incorreta.");
    }
    if (currentPassword === newPassword) throw new HttpError(400, "Escolha uma senha diferente da atual.");
    const passwordHash = await hashSecret(newPassword);
    const updated = await pool.query(
      `UPDATE users
       SET password_hash = $2, token_version = token_version + 1, updated_at = NOW()
       WHERE username = $1
       RETURNING username, name, token_version`,
      [req.auth.sub, passwordHash],
    );
    if (!updated.rowCount) throw new HttpError(404, "Conta não encontrada.");
    const row = updated.rows[0];
    const token = makeSession(config, {
      sub: row.username,
      role: "member",
      member: row.name,
      username: row.username,
      version: Number(row.token_version),
    });
    res.json({ token, member: row.name, username: row.username, role: "member" });
  });

  router.get("/api/tickets", authenticate, requireRole("member"), async (req, res) => {
    const result = await pool.query(
      `SELECT t.*,
              (SELECT m.message FROM support_messages m WHERE m.ticket_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
              (SELECT m.created_at FROM support_messages m WHERE m.ticket_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_at,
              (SELECT COUNT(*)::INTEGER FROM support_messages m WHERE m.ticket_id = t.id) AS message_count
       FROM support_tickets t
       WHERE t.username = $1
       ORDER BY t.updated_at DESC`,
      [req.auth.sub],
    );
    res.json(result.rows.map(ticketFromRow));
  });

  router.post("/api/tickets", ticketLimiter, authenticate, requireRole("member"), async (req, res) => {
    const subject = text(req.body?.subject, "Assunto", { minimum: 3, maximum: 120 }).trim();
    const message = text(req.body?.message, "Mensagem", { minimum: 2, maximum: 4000 }).trim();
    const ticketId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO support_tickets (id, username, subject) VALUES ($1, $2, $3)",
        [ticketId, req.auth.sub, subject],
      );
      await client.query(
        `INSERT INTO support_messages (id, ticket_id, sender_role, sender_username, message)
         VALUES ($1, $2, 'member', $3, $4)`,
        [randomUUID(), ticketId, req.auth.sub, message],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    res.status(201).json(await ticketDetails(ticketId));
  });

  router.get("/api/tickets/:ticketId", authenticate, requireRole("member"), async (req, res) => {
    const ticketId = uuid(req.params.ticketId, "Ticket");
    const details = await ticketDetails(ticketId);
    if (!details || details.username !== req.auth.sub) throw new HttpError(404, "Ticket não encontrado.");
    res.json(details);
  });

  router.post("/api/tickets/:ticketId/messages", ticketLimiter, authenticate, requireRole("member"), async (req, res) => {
    const ticketId = uuid(req.params.ticketId, "Ticket");
    const message = text(req.body?.message, "Mensagem", { minimum: 1, maximum: 4000 }).trim();
    const ticket = await getTicket(ticketId);
    if (!ticket || ticket.username !== req.auth.sub) throw new HttpError(404, "Ticket não encontrado.");
    if (ticket.status === "closed") throw new HttpError(409, "Este ticket está encerrado.");
    await pool.query(
      `INSERT INTO support_messages (id, ticket_id, sender_role, sender_username, message)
       VALUES ($1, $2, 'member', $3, $4)`,
      [randomUUID(), ticketId, req.auth.sub, message],
    );
    await pool.query("UPDATE support_tickets SET status = 'open', updated_at = NOW() WHERE id = $1", [ticketId]);
    res.status(201).json(await ticketDetails(ticketId));
  });

  router.patch("/api/tickets/:ticketId/close", authenticate, requireRole("member"), async (req, res) => {
    const ticketId = uuid(req.params.ticketId, "Ticket");
    const result = await pool.query(
      `UPDATE support_tickets SET status = 'closed', updated_at = NOW()
       WHERE id = $1 AND username = $2 RETURNING id`,
      [ticketId, req.auth.sub],
    );
    if (!result.rowCount) throw new HttpError(404, "Ticket não encontrado.");
    res.json(await ticketDetails(ticketId));
  });

  router.get("/admin/tickets", authenticate, requireRole("admin"), async (_req, res) => {
    const result = await pool.query(
      `SELECT t.*,
              (SELECT m.message FROM support_messages m WHERE m.ticket_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
              (SELECT m.created_at FROM support_messages m WHERE m.ticket_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_at,
              (SELECT COUNT(*)::INTEGER FROM support_messages m WHERE m.ticket_id = t.id) AS message_count
       FROM support_tickets t
       ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'answered' THEN 1 ELSE 2 END, t.updated_at DESC`,
    );
    res.json(result.rows.map(ticketFromRow));
  });

  router.get("/admin/tickets/:ticketId", authenticate, requireRole("admin"), async (req, res) => {
    const ticketId = uuid(req.params.ticketId, "Ticket");
    const details = await ticketDetails(ticketId);
    if (!details) throw new HttpError(404, "Ticket não encontrado.");
    res.json(details);
  });

  router.post("/admin/tickets/:ticketId/messages", ticketLimiter, authenticate, requireRole("admin"), async (req, res) => {
    const ticketId = uuid(req.params.ticketId, "Ticket");
    const message = text(req.body?.message, "Mensagem", { minimum: 1, maximum: 4000 }).trim();
    const ticket = await getTicket(ticketId);
    if (!ticket) throw new HttpError(404, "Ticket não encontrado.");
    if (ticket.status === "closed") throw new HttpError(409, "Reabra o ticket antes de responder.");
    await pool.query(
      `INSERT INTO support_messages (id, ticket_id, sender_role, sender_username, message)
       VALUES ($1, $2, 'admin', $3, $4)`,
      [randomUUID(), ticketId, req.auth.sub, message],
    );
    await pool.query("UPDATE support_tickets SET status = 'answered', updated_at = NOW() WHERE id = $1", [ticketId]);
    res.status(201).json(await ticketDetails(ticketId));
  });

  router.patch("/admin/tickets/:ticketId/status", authenticate, requireRole("admin"), async (req, res) => {
    const ticketId = uuid(req.params.ticketId, "Ticket");
    const status = String(req.body?.status || "").trim().toLowerCase();
    if (!["open", "answered", "closed"].includes(status)) throw new HttpError(400, "Status inválido.");
    const result = await pool.query(
      "UPDATE support_tickets SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING id",
      [ticketId, status],
    );
    if (!result.rowCount) throw new HttpError(404, "Ticket não encontrado.");
    res.json(await ticketDetails(ticketId));
  });

  router.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    const status = Number(error.status) >= 400 && Number(error.status) < 600 ? Number(error.status) : 500;
    if (status >= 500) console.error("Support feature request failed", { message: error.message });
    res.status(status).json({ error: error.message || "O servidor não conseguiu concluir a solicitação." });
  });

  return {
    router,
    close: () => pool.end(),
  };
}
