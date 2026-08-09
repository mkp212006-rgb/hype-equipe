import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { hashSecret, signToken, verifySecret, verifyToken } from "./crypto.js";
import { rateLimit } from "./rate-limit.js";
import { HttpError, booleanValue, httpUrl, positiveInteger, quantity, text, uuid } from "./validators.js";

function bearerToken(req) {
  const authorization = req.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new HttpError(401, "Sessão não informada.");
  return authorization.slice(7).trim();
}

function makeSession(config, payload) {
  return signToken(payload, config.jwtSecret, { ttlSeconds: config.tokenTtlSeconds });
}

function errorPayload(error, production) {
  const body = { error: error.message || "O servidor não conseguiu concluir a solicitação." };
  if (!production && error.details) body.details = error.details;
  return body;
}

export async function createApp({ config, db, smm }) {
  const app = express();
  const dummyPasswordHash = await hashSecret("hype-equipe-dummy-password");
  const production = config.nodeEnv === "production";

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((req, res, next) => {
    req.requestId = req.get("x-request-id") || randomUUID();
    res.setHeader("x-request-id", req.requestId);
    next();
  });
  app.use(helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", "https:"],
        imgSrc: ["'self'", "data:"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  }));
  app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Accept", "Authorization", "Content-Type", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset"],
    maxAge: 86_400,
  }));
  app.use(express.json({ limit: "32kb", strict: true }));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/admin/") || req.path.startsWith("/auth/")) {
      res.setHeader("Cache-Control", "no-store");
    }
    next();
  });

  const loginLimiter = rateLimit({ name: "login", windowMs: 15 * 60_000, maximum: 12 });
  const orderLimiter = rateLimit({ name: "orders", windowMs: 60_000, maximum: 30 });

  async function authenticate(req, _res, next) {
    try {
      const payload = verifyToken(bearerToken(req), config.jwtSecret);
      if (payload.role === "member") {
        const team = await db.getTeamAuth();
        if (Number(payload.version) !== team.tokenVersion) throw new HttpError(401, "A sessão da equipe expirou.");
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
    return function roleGuard(req, _res, next) {
      if (req.auth?.role !== role) return next(new HttpError(403, "Você não tem permissão para esta ação."));
      next();
    };
  }

  app.get("/health", async (_req, res) => {
    await db.healthcheck();
    res.json({
      status: "ok",
      service: "hype-equipe",
      providerConfigured: smm.isConfigured(),
      timestamp: new Date().toISOString(),
    });
  });

  app.post("/auth/login", loginLimiter, async (req, res) => {
    const name = text(req.body?.name, "Nome", { minimum: 2, maximum: 80 });
    const accessCode = text(req.body?.accessCode, "Código da equipe", { minimum: 6, maximum: 256 });
    const team = await db.getTeamAuth();
    if (!team.codeHash) throw new HttpError(503, "O administrador ainda precisa definir o código da equipe.");
    if (!(await verifySecret(accessCode, team.codeHash))) throw new HttpError(401, "Código da equipe incorreto.");
    const token = makeSession(config, { sub: `member:${name}`, role: "member", member: name, version: team.tokenVersion });
    res.json({ token, member: name, role: "member" });
  });

  app.post("/admin/login", loginLimiter, async (req, res) => {
    const username = text(req.body?.username, "Usuário", { minimum: 1, maximum: 80 }).toLowerCase();
    const password = text(req.body?.password, "Senha", { minimum: 1, maximum: 256 });
    const admin = await db.getAdmin(username);
    const valid = await verifySecret(password, admin?.password_hash || dummyPasswordHash);
    if (!admin || !valid) throw new HttpError(401, "Usuário ou senha incorretos.");
    await db.recordAdminLogin(admin.username);
    const token = makeSession(config, {
      sub: admin.username,
      role: "admin",
      member: "Administrador",
      version: Number(admin.token_version),
    });
    res.json({
      token,
      member: "Administrador",
      role: "admin",
      mustChangePassword: Boolean(admin.must_change_password),
    });
  });

  app.get("/api/info", authenticate, async (req, res) => {
    const response = { member: req.auth.member, role: req.auth.role };
    if (req.auth.role === "admin") {
      const admin = await db.getAdmin(req.auth.sub);
      response.mustChangePassword = Boolean(admin?.must_change_password);
    }
    res.json(response);
  });

  app.get("/api/services", authenticate, requireRole("member"), async (_req, res) => {
    res.json(await db.listServices(true));
  });

  app.get("/api/orders", authenticate, requireRole("member"), async (_req, res) => {
    res.json(await db.listOrders());
  });

  app.get("/api/balance", authenticate, requireRole("member"), async (_req, res) => {
    const balance = await smm.balance();
    res.json({ balance: balance.balance, currency: balance.currency });
  });

  app.post("/api/orders", orderLimiter, authenticate, requireRole("member"), async (req, res) => {
    const serviceId = positiveInteger(req.body?.serviceId, "Serviço");
    const service = await db.getService(serviceId);
    if (!service || !service.enabled) throw new HttpError(404, "Esse produto não está disponível.");
    const orderQuantity = quantity(req.body?.quantity, service.min, service.max);
    const link = httpUrl(req.body?.link);
    const idempotencyKey = text(req.body?.idempotencyKey, "Chave do pedido", { minimum: 12, maximum: 128 });
    const estimatedCharge = Number(((service.rate * orderQuantity) / 1000).toFixed(6));
    const pending = await db.createPendingOrder({
      id: randomUUID(),
      idempotencyKey,
      serviceId,
      serviceName: service.name,
      link,
      quantity: orderQuantity,
      estimatedCharge,
      currency: "USD",
      refillAvailable: service.refill,
      cancelAvailable: service.cancel,
      createdBy: req.auth.member,
    });
    if (!pending.created) return res.json(pending.order);

    try {
      const provider = await smm.addOrder({ serviceId, link, quantity: orderQuantity });
      const order = await db.updateOrder(pending.order.id, {
        providerOrderId: provider.providerOrderId,
        status: "Pending",
        providerPayload: provider.raw,
      });
      await db.addOrderEvent(order.id, "created", req.auth.member, { providerOrderId: provider.providerOrderId });
      res.status(201).json(order);
    } catch (error) {
      await db.updateOrder(pending.order.id, {
        status: "Error",
        providerPayload: { error: error.message, code: error.code || "PROVIDER_ERROR" },
      });
      await db.addOrderEvent(pending.order.id, "provider-error", req.auth.member, {
        error: error.message,
        code: error.code || "PROVIDER_ERROR",
      });
      throw error;
    }
  });

  app.post("/api/orders/:id/refresh", authenticate, requireRole("member"), async (req, res) => {
    const id = uuid(req.params.id, "Pedido");
    const order = await db.getOrder(id);
    if (!order) throw new HttpError(404, "Pedido não encontrado.");
    if (!order.providerOrderId) throw new HttpError(409, "Esse pedido não recebeu um número da SMMHype.");
    const provider = await smm.status(order.providerOrderId);
    const updated = await db.updateOrder(id, {
      status: provider.status,
      estimatedCharge: provider.charge,
      currency: provider.currency,
      startCount: provider.startCount,
      remains: provider.remains,
      providerPayload: provider.raw,
    });
    await db.addOrderEvent(id, "refresh", req.auth.member, { status: provider.status });
    res.json(updated);
  });

  app.post("/api/orders/:id/refill", authenticate, requireRole("member"), async (req, res) => {
    const id = uuid(req.params.id, "Pedido");
    const order = await db.getOrder(id);
    if (!order) throw new HttpError(404, "Pedido não encontrado.");
    if (!order.refillAvailable) throw new HttpError(409, "Esse serviço não oferece reposição.");
    if (!order.providerOrderId) throw new HttpError(409, "Esse pedido não recebeu um número da SMMHype.");
    const provider = await smm.refill(order.providerOrderId);
    await db.addOrderEvent(id, "refill", req.auth.member, { refillId: provider.refillId });
    res.json(await db.getOrder(id));
  });

  app.post("/api/orders/:id/cancel", authenticate, requireRole("member"), async (req, res) => {
    const id = uuid(req.params.id, "Pedido");
    const order = await db.getOrder(id);
    if (!order) throw new HttpError(404, "Pedido não encontrado.");
    if (!order.cancelAvailable) throw new HttpError(409, "Esse serviço não oferece cancelamento.");
    if (!order.providerOrderId) throw new HttpError(409, "Esse pedido não recebeu um número da SMMHype.");
    const provider = await smm.cancel(order.providerOrderId);
    const updated = await db.updateOrder(id, {
      status: "Cancel requested",
      cancelAvailable: false,
      providerPayload: provider.raw,
    });
    await db.addOrderEvent(id, "cancel", req.auth.member);
    res.json(updated);
  });

  app.get("/admin/services", authenticate, requireRole("admin"), async (_req, res) => {
    res.json(await db.listServices(false));
  });

  app.get("/admin/summary", authenticate, requireRole("admin"), async (req, res) => {
    const [orders, services, admin, balanceResult] = await Promise.all([
      db.countOrders(),
      db.listServices(false),
      db.getAdmin(req.auth.sub),
      smm.isConfigured()
        ? smm.balance().catch((error) => ({ balance: null, currency: "USD", error: error.message }))
        : Promise.resolve({ balance: null, currency: "USD", error: "SMM_API_KEY não configurada." }),
    ]);
    res.json({
      balance: balanceResult.balance,
      currency: balanceResult.currency,
      providerError: balanceResult.error || null,
      enabledServices: services.filter((service) => service.enabled).length,
      orders,
      mustChangePassword: Boolean(admin?.must_change_password),
    });
  });

  app.post("/admin/services", authenticate, requireRole("admin"), async (req, res) => {
    const serviceId = positiveInteger(req.body?.serviceId, "Serviço");
    const service = await smm.getService(serviceId, { fresh: true });
    res.status(201).json(await db.upsertService(service));
  });

  app.patch("/admin/services/:serviceId", authenticate, requireRole("admin"), async (req, res) => {
    const serviceId = positiveInteger(req.params.serviceId, "Serviço");
    const enabled = booleanValue(req.body?.enabled, "Disponibilidade");
    const service = await db.setServiceEnabled(serviceId, enabled);
    if (!service) throw new HttpError(404, "Serviço não encontrado.");
    res.json(service);
  });

  app.post("/admin/services/:serviceId/sync", authenticate, requireRole("admin"), async (req, res) => {
    const serviceId = positiveInteger(req.params.serviceId, "Serviço");
    if (!(await db.getService(serviceId))) throw new HttpError(404, "Serviço não encontrado.");
    const providerService = await smm.getService(serviceId, { fresh: true });
    res.json(await db.upsertService(providerService));
  });

  app.delete("/admin/services/:serviceId", authenticate, requireRole("admin"), async (req, res) => {
    const serviceId = positiveInteger(req.params.serviceId, "Serviço");
    if (!(await db.deleteService(serviceId))) throw new HttpError(404, "Serviço não encontrado.");
    res.status(204).end();
  });

  app.post("/admin/team-code", authenticate, requireRole("admin"), async (req, res) => {
    const newCode = text(req.body?.newCode, "Novo código", { minimum: 6, maximum: 256 });
    const codeHash = await hashSecret(newCode);
    const tokenVersion = await db.setTeamCode(codeHash);
    res.json({ ok: true, tokenVersion });
  });

  app.post("/admin/password", loginLimiter, authenticate, requireRole("admin"), async (req, res) => {
    const currentPassword = text(req.body?.currentPassword, "Senha atual", { minimum: 1, maximum: 256 });
    const newPassword = text(req.body?.newPassword, "Nova senha", { minimum: 12, maximum: 256 });
    const admin = await db.getAdmin(req.auth.sub);
    if (!admin || !(await verifySecret(currentPassword, admin.password_hash))) {
      throw new HttpError(401, "A senha atual está incorreta.");
    }
    if (currentPassword === newPassword) throw new HttpError(400, "Escolha uma senha diferente da atual.");
    const updated = await db.changeAdminPassword(admin.username, await hashSecret(newPassword));
    const token = makeSession(config, {
      sub: updated.username,
      role: "admin",
      member: "Administrador",
      version: Number(updated.token_version),
    });
    res.json({ token, member: "Administrador", role: "admin", mustChangePassword: false });
  });

  app.use(express.static(config.publicDirectory, {
    index: "index.html",
    etag: true,
    maxAge: production ? "1h" : 0,
    setHeaders(res, filePath) {
      if (filePath.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
    },
  }));

  app.use((req, _res, next) => {
    next(new HttpError(404, `Rota ${req.method} ${req.path} não encontrada.`));
  });

  app.use((error, req, res, _next) => {
    const status = Number(error.status) >= 400 && Number(error.status) < 600 ? Number(error.status) : 500;
    if (status >= 500) {
      console.error("Request failed", {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status,
        message: error.message,
      });
    }
    if (res.headersSent) return;
    res.status(status).json(errorPayload(error, production));
  });

  return app;
}
