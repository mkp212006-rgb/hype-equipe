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

function usernameValue(value) {
  const username = text(value, "Usuário", { minimum: 3, maximum: 40 }).trim().toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw new HttpError(400, "O usuário pode conter apenas letras, números, ponto, hífen e sublinhado.");
  }
  return username;
}

function emailValue(value) {
  const email = text(value, "E-mail", { minimum: 5, maximum: 254 }).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "Informe um e-mail válido.");
  }
  return email;
}

function loginIdentifierValue(value) {
  const identifier = text(value, "E-mail ou usuário", { minimum: 3, maximum: 254 }).trim().toLowerCase();
  return identifier.includes("@") ? emailValue(identifier) : usernameValue(identifier);
}

function moneyValue(value, label, { minimum = 0.01, maximum = 1_000_000 } = {}) {
  const number = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new HttpError(400, `${label} inválido.`);
  }
  return Number(number.toFixed(2));
}

function optionalBoolean(value, label) {
  if (value == null) return undefined;
  return booleanValue(value, label);
}

function safePaymentStatus(value) {
  const raw = String(value || "pending").toLowerCase();
  return raw.replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "pending";
}

export async function createApp({ config, db, smm, mercadoPago }) {
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
  app.use(express.json({ limit: "64kb", strict: true }));
  app.use((req, res, next) => {
    if (
      req.path.startsWith("/api/") ||
      req.path.startsWith("/admin/") ||
      req.path.startsWith("/auth/") ||
      req.path.startsWith("/webhooks/")
    ) {
      res.setHeader("Cache-Control", "no-store");
    }
    next();
  });

  const loginLimiter = rateLimit({ name: "login", windowMs: 15 * 60_000, maximum: 20 });
  const registerLimiter = rateLimit({ name: "register", windowMs: 60 * 60_000, maximum: 12 });
  const orderLimiter = rateLimit({ name: "orders", windowMs: 60_000, maximum: 30 });
  const depositLimiter = rateLimit({ name: "deposits", windowMs: 60_000, maximum: 10 });

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
      mercadoPagoConfigured: mercadoPago.isConfigured(),
      mercadoPagoWebhookConfigured: mercadoPago.isWebhookConfigured(),
      currency: "BRL",
      timestamp: new Date().toISOString(),
    });
  });

  app.post("/auth/register", registerLimiter, async (req, res) => {
    const name = text(req.body?.name, "Nome", { minimum: 2, maximum: 80 }).trim();
    const username = usernameValue(req.body?.username);
    const email = req.body?.email == null || String(req.body.email).trim() === ""
      ? null
      : emailValue(req.body.email);
    const password = text(req.body?.password, "Senha", { minimum: 6, maximum: 256 });
    try {
      const user = await db.createUser({ name, username, email, passwordHash: await hashSecret(password) });
      res.status(201).json({
        ok: true,
        user: { name: user.name, username: user.username, email: user.email || null, role: "member" },
        balance: 0,
        currency: "BRL",
      });
    } catch (error) {
      if (error?.code === "23505") {
        const message = error.constraint === "users_email_ci_idx"
          ? "Esse e-mail já está cadastrado."
          : "Esse nome de usuário já está cadastrado.";
        throw new HttpError(409, message);
      }
      throw error;
    }
  });

  app.post("/auth/login", loginLimiter, async (req, res) => {
    const identifier = loginIdentifierValue(req.body?.identifier ?? req.body?.username);
    const password = text(req.body?.password, "Senha", { minimum: 1, maximum: 256 });
    const user = await db.getUserByIdentifier(identifier);
    const valid = await verifySecret(password, user?.password_hash || dummyPasswordHash);
    if (!user || !user.active || !valid) throw new HttpError(401, "E-mail, usuário ou senha incorretos.");
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
    const response = { member: req.auth.member, username: req.auth.username || req.auth.sub, role: req.auth.role };
    if (req.auth.role === "admin") {
      const admin = await db.getAdmin(req.auth.sub);
      response.mustChangePassword = Boolean(admin?.must_change_password);
    }
    res.json(response);
  });

  app.get("/api/services", authenticate, requireRole("member"), async (_req, res) => {
    res.json(await db.listServices(true));
  });

  app.get("/api/orders", authenticate, requireRole("member"), async (req, res) => {
    res.json(await db.listOrders(req.auth.sub));
  });

  app.get("/api/balance", authenticate, requireRole("member"), async (req, res) => {
    const wallet = await db.getWallet(req.auth.sub);
    if (!wallet) throw new HttpError(404, "Carteira não encontrada.");
    res.json({ balance: wallet.balance, currency: "BRL" });
  });

  app.get("/api/wallet", authenticate, requireRole("member"), async (req, res) => {
    const [wallet, transactions] = await Promise.all([
      db.getWallet(req.auth.sub),
      db.listWalletTransactions(req.auth.sub),
    ]);
    if (!wallet) throw new HttpError(404, "Carteira não encontrada.");
    res.json({ balance: wallet.balance, currency: "BRL", transactions });
  });

  app.post("/api/wallet/deposits", depositLimiter, authenticate, requireRole("member"), async (req, res) => {
    if (!mercadoPago.isConfigured()) {
      throw new HttpError(503, "Mercado Pago ainda não foi configurado no servidor.");
    }
    const creditAmount = moneyValue(req.body?.amount, "Valor do depósito", { minimum: 5, maximum: 100_000 });
    const idempotencyKey = text(req.body?.idempotencyKey, "Chave do depósito", { minimum: 12, maximum: 128 });
    const feeAmount = Number((creditAmount * 0.05).toFixed(2));
    const totalAmount = Number((creditAmount + feeAmount).toFixed(2));
    const pending = await db.createWalletDeposit({
      id: randomUUID(),
      username: req.auth.sub,
      idempotencyKey,
      creditAmount,
      feeAmount,
      totalAmount,
    });

    if (!pending.created && pending.deposit?.checkoutUrl) {
      return res.json(pending.deposit);
    }

    try {
      const preference = await mercadoPago.createDepositPreference({
        depositId: pending.deposit.id,
        creditAmount,
        feeAmount,
        totalAmount,
        idempotencyKey: pending.deposit.id,
      });
      const deposit = await db.updateWalletDepositPreference(pending.deposit.id, {
        preferenceId: preference.preferenceId,
        checkoutUrl: preference.checkoutUrl,
        status: "pending",
      });
      res.status(pending.created ? 201 : 200).json({
        ...deposit,
        initPoint: deposit.checkoutUrl,
        paymentUrl: deposit.checkoutUrl,
      });
    } catch (error) {
      await db.markWalletDepositStatus(pending.deposit.id, "error", { error: error.message });
      throw error;
    }
  });

  app.post("/webhooks/mercado-pago", async (req, res) => {
    const dataId = req.query["data.id"] || req.query.data_id || req.body?.data?.id;
    const type = String(req.query.type || req.body?.type || "").toLowerCase();
    if (type && type !== "payment") return res.status(200).json({ ok: true, ignored: true });

    const valid = mercadoPago.validateWebhook({
      xSignature: req.get("x-signature"),
      xRequestId: req.get("x-request-id"),
      dataId,
    });
    if (!valid) throw new HttpError(401, "Assinatura do Mercado Pago inválida.");

    const payment = await mercadoPago.getPayment(dataId);
    const depositId = String(payment?.external_reference || payment?.metadata?.deposit_id || "");
    if (!depositId) return res.status(200).json({ ok: true, ignored: true });
    const deposit = await db.getWalletDeposit(depositId);
    if (!deposit) return res.status(200).json({ ok: true, ignored: true });

    const status = safePaymentStatus(payment.status);
    const amount = Number(payment.transaction_amount);
    const currency = String(payment.currency_id || "").toUpperCase();
    const amountMatches = Number.isFinite(amount) && Math.abs(amount - deposit.totalAmount) < 0.01;
    const currencyMatches = currency === "BRL";

    if (status === "approved" && amountMatches && currencyMatches) {
      const result = await db.approveWalletDeposit({
        depositId,
        paymentId: String(payment.id),
        rawPayment: payment,
      });
      return res.status(200).json({ ok: true, credited: result.credited });
    }

    const storedStatus = status === "approved" ? "verification_failed" : status;
    await db.markWalletDepositStatus(depositId, storedStatus, payment);
    res.status(200).json({ ok: true, credited: false, status: storedStatus });
  });

  app.post("/api/orders", orderLimiter, authenticate, requireRole("member"), async (req, res) => {
    const serviceId = positiveInteger(req.body?.serviceId, "Serviço");
    const service = await db.getService(serviceId);
    if (!service || !service.enabled) throw new HttpError(404, "Esse produto não está disponível.");
    if (!Number.isFinite(service.pricePerThousandBRL) || service.pricePerThousandBRL <= 0) {
      throw new HttpError(409, "O administrador ainda não definiu o preço desse serviço em BRL.");
    }
    if (req.body?.paymentMethod && req.body.paymentMethod !== "wallet") {
      throw new HttpError(400, "Os pedidos deste aplicativo devem usar a carteira.");
    }
    const orderQuantity = quantity(req.body?.quantity, service.min, service.max);
    const link = httpUrl(req.body?.link);
    const idempotencyKey = text(req.body?.idempotencyKey, "Chave do pedido", { minimum: 12, maximum: 128 });
    const chargeBRL = Math.max(0.01, Number(((service.pricePerThousandBRL * orderQuantity) / 1000).toFixed(2)));

    let pending;
    try {
      pending = await db.createWalletOrder({
        id: randomUUID(),
        idempotencyKey,
        serviceId,
        serviceName: service.name,
        link,
        quantity: orderQuantity,
        chargeBRL,
        refillAvailable: service.refill,
        cancelAvailable: service.cancel,
        createdBy: req.auth.sub,
      });
    } catch (error) {
      if (error?.code === "INSUFFICIENT_BALANCE") throw new HttpError(402, "Saldo insuficiente na carteira.");
      if (error?.code === "WALLET_NOT_FOUND") throw new HttpError(404, "Carteira não encontrada.");
      throw error;
    }
    if (!pending.created) return res.json(pending.order);

    try {
      const provider = await smm.addOrder({ serviceId, link, quantity: orderQuantity });
      const order = await db.updateOrder(pending.order.id, {
        providerOrderId: provider.providerOrderId,
        status: "Pending",
        providerPayload: provider.raw,
      });
      await db.addOrderEvent(order.id, "created", req.auth.sub, {
        providerOrderId: provider.providerOrderId,
        chargeBRL,
      });
      res.status(201).json(order);
    } catch (error) {
      await db.refundWalletOrder(pending.order.id, "Estorno automático: pedido não enviado ao fornecedor");
      await db.updateOrder(pending.order.id, {
        status: "Error",
        providerPayload: { error: error.message, code: error.code || "PROVIDER_ERROR" },
      });
      await db.addOrderEvent(pending.order.id, "provider-error-refunded", req.auth.sub, {
        error: error.message,
        code: error.code || "PROVIDER_ERROR",
        refundBRL: chargeBRL,
      });
      throw error;
    }
  });

  app.post("/api/orders/:id/refresh", authenticate, requireRole("member"), async (req, res) => {
    const id = uuid(req.params.id, "Pedido");
    const order = await db.getOrder(id, req.auth.sub);
    if (!order) throw new HttpError(404, "Pedido não encontrado.");
    if (!order.providerOrderId) throw new HttpError(409, "Esse pedido não recebeu um número da SMMHype.");
    const provider = await smm.status(order.providerOrderId);
    const updated = await db.updateOrder(id, {
      status: provider.status,
      startCount: provider.startCount,
      remains: provider.remains,
      providerPayload: provider.raw,
    });
    await db.addOrderEvent(id, "refresh", req.auth.sub, { status: provider.status });
    res.json(updated);
  });

  app.post("/api/orders/:id/refill", authenticate, requireRole("member"), async (req, res) => {
    const id = uuid(req.params.id, "Pedido");
    const order = await db.getOrder(id, req.auth.sub);
    if (!order) throw new HttpError(404, "Pedido não encontrado.");
    if (!order.refillAvailable) throw new HttpError(409, "Esse serviço não oferece reposição.");
    if (!order.providerOrderId) throw new HttpError(409, "Esse pedido não recebeu um número da SMMHype.");
    const provider = await smm.refill(order.providerOrderId);
    await db.addOrderEvent(id, "refill", req.auth.sub, { refillId: provider.refillId });
    res.json(await db.getOrder(id, req.auth.sub));
  });

  app.post("/api/orders/:id/cancel", authenticate, requireRole("member"), async (req, res) => {
    const id = uuid(req.params.id, "Pedido");
    const order = await db.getOrder(id, req.auth.sub);
    if (!order) throw new HttpError(404, "Pedido não encontrado.");
    if (!order.cancelAvailable) throw new HttpError(409, "Esse serviço não oferece cancelamento.");
    if (!order.providerOrderId) throw new HttpError(409, "Esse pedido não recebeu um número da SMMHype.");
    const provider = await smm.cancel(order.providerOrderId);
    const updated = await db.updateOrder(id, {
      status: "Cancel requested",
      cancelAvailable: false,
      providerPayload: provider.raw,
    });
    await db.addOrderEvent(id, "cancel", req.auth.sub);
    res.json(updated);
  });

  app.get("/admin/services", authenticate, requireRole("admin"), async (_req, res) => {
    res.json(await db.listServices(false));
  });

  app.get("/admin/summary", authenticate, requireRole("admin"), async (req, res) => {
    const [orders, users, services, admin, balanceResult] = await Promise.all([
      db.countOrders(),
      db.countUsers(),
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
      pricedServices: services.filter((service) => Number(service.pricePerThousandBRL) > 0).length,
      orders,
      users,
      mercadoPagoConfigured: mercadoPago.isConfigured(),
      mercadoPagoWebhookConfigured: mercadoPago.isWebhookConfigured(),
      mustChangePassword: Boolean(admin?.must_change_password),
    });
  });

  app.post("/admin/services", authenticate, requireRole("admin"), async (req, res) => {
    const serviceId = positiveInteger(req.body?.serviceId, "Serviço");
    const pricePerThousandBRL = moneyValue(req.body?.pricePerThousandBRL, "Preço por 1.000", { minimum: 0.01 });
    const service = await smm.getService(serviceId, { fresh: true });
    res.status(201).json(await db.upsertService(service, pricePerThousandBRL));
  });

  app.patch("/admin/services/:serviceId", authenticate, requireRole("admin"), async (req, res) => {
    const serviceId = positiveInteger(req.params.serviceId, "Serviço");
    const enabled = optionalBoolean(req.body?.enabled, "Disponibilidade");
    const pricePerThousandBRL = req.body?.pricePerThousandBRL == null
      ? undefined
      : moneyValue(req.body.pricePerThousandBRL, "Preço por 1.000", { minimum: 0.01 });
    if (enabled === undefined && pricePerThousandBRL === undefined) {
      throw new HttpError(400, "Informe enabled ou pricePerThousandBRL para atualizar o serviço.");
    }
    const service = await db.updateServiceSettings(serviceId, { enabled, pricePerThousandBRL });
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
    maxAge: 0,
    setHeaders(res, filePath) {
      if (/\.(?:html|js|css|webmanifest)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-cache, must-revalidate");
      } else if (production) {
        res.setHeader("Cache-Control", "public, max-age=86400");
      }
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
