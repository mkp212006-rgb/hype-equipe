(function () {
  "use strict";

  const SESSION_KEY = "hype-equipe.session.v2";
  const DEFAULT_API_URL = "https://hype-equipe-production.up.railway.app";
  const app = document.getElementById("app");
  const toastRegion = document.getElementById("toast-region");

  const state = {
    screen: "loading",
    apiUrl: DEFAULT_API_URL,
    session: loadJson(SESSION_KEY),
    services: [],
    orders: [],
    balance: null,
    wallet: null,
    walletSupported: true,
    adminSummary: null,
    registrationUsername: "",
    error: "",
  };

  const icons = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/>',
    plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6M9 12h6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
    shield: '<path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6Z"/><path d="m9 12 2 2 4-5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    wallet: '<path d="M4 6h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3h12"/><path d="M16 11h4v4h-4a2 2 0 1 1 0-4Z"/>',
    refresh: '<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18.5 9A7 7 0 0 0 6 6.5L4 9M5.5 15A7 7 0 0 0 18 17.5l2-2.5"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
    logout: '<path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/>',
    box: '<path d="m21 8-9-5-9 5 9 5Z"/><path d="m3 8 9 5 9-5v8l-9 5-9-5Z"/><path d="M12 13v8"/>',
    server: '<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l2 2M14 9l2 2"/>',
  };

  function icon(name, className) {
    return `<svg class="icon ${className || ""}" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.box}</svg>`;
  }

  function loadJson(key) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeApiUrl(value) {
    const raw = String(value || "").trim().replace(/\/+$/, "");
    if (!raw) throw new Error("Informe o endereço HTTPS do servidor.");
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error("O endereço do servidor é inválido.");
    }
    const local = ["localhost", "127.0.0.1", "10.0.2.2"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
      throw new Error("O servidor deve usar https://.");
    }
    return raw;
  }

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  class ApiClient {
    constructor(baseUrl, token) {
      this.baseUrl = normalizeApiUrl(baseUrl);
      this.token = token;
    }

    async request(path, options) {
      const config = options || {};
      const controller = new AbortController();
      const timer = setTimeout(function () { controller.abort(); }, 25_000);
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method: config.method || "GET",
          headers: {
            Accept: "application/json",
            ...(config.body ? { "Content-Type": "application/json" } : {}),
            ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          },
          body: config.body ? JSON.stringify(config.body) : undefined,
          signal: controller.signal,
        });
        const text = await response.text();
        let payload = {};
        try { payload = text ? JSON.parse(text) : {}; } catch { /* handled below */ }
        if (!response.ok) {
          throw new ApiError(payload.error || "O servidor não conseguiu concluir a solicitação.", response.status);
        }
        return payload;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (error.name === "AbortError") throw new ApiError("O servidor demorou demais para responder.", 0);
        throw new ApiError("Não foi possível acessar o servidor. Confira o endereço e a internet.", 0);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  function client(withoutToken) {
    return new ApiClient(state.apiUrl, withoutToken ? null : state.session && state.session.token);
  }

  function saveSession(session) {
    state.session = session;
    state.apiUrl = DEFAULT_API_URL;
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function clearSession() {
    state.session = null;
    state.services = [];
    state.orders = [];
    state.balance = null;
    state.wallet = null;
    state.walletSupported = true;
    state.adminSummary = null;
    localStorage.removeItem(SESSION_KEY);
  }

  function toast(message, type) {
    toastRegion.innerHTML = `<div class="toast ${type === "error" ? "error" : ""}">${escapeHtml(message)}</div>`;
    setTimeout(function () { toastRegion.innerHTML = ""; }, 3800);
  }

  function brand() {
    return `
      <div class="brand">
        <div class="brand-mark">H</div>
        <div>
          <div class="brand-name">Hype Equipe</div>
          <div class="brand-subtitle">Pedidos em um só lugar</div>
        </div>
      </div>`;
  }

  function topbar(title) {
    const member = state.session ? state.session.member : "";
    const initial = String(member || "H").trim().charAt(0).toUpperCase();
    return `
      <header class="topbar">
        <div>
          <div class="eyebrow">${escapeHtml(title || "Hype Equipe")}</div>
          <div class="brand-name">Hype Equipe</div>
        </div>
        <div class="avatar" title="${escapeHtml(member)}">${escapeHtml(initial)}</div>
      </header>`;
  }

  function nav() {
    const items = [
      ["home", "Início", "home"],
      ["new-order", "Pedido", "plus"],
      ["orders", "Histórico", "receipt"],
      ["wallet", "Carteira", "wallet"],
      ["settings", "Ajustes", "settings"],
    ];
    return `
      <nav class="bottom-nav" aria-label="Navegação principal">
        ${items.map(function (item) {
          return `<button type="button" class="nav-item ${state.screen === item[0] ? "active" : ""}" data-nav="${item[0]}">${icon(item[2])}<span>${item[1]}</span></button>`;
        }).join("")}
      </nav>`;
  }

  function shell(content, withNav) {
    return `<div class="app-shell ${withNav ? "" : "no-nav"}"><main class="page ${withNav ? "" : "auth-page"}">${content}</main>${withNav ? nav() : ""}</div>`;
  }

  function renderLoading() {
    app.innerHTML = `<div class="loading-page"><div><div class="brand-mark">H</div><div class="spinner" style="margin:0 auto 13px"></div><div>Conectando ao servidor seguro…</div></div></div>`;
  }

  function renderLogin(adminMode) {
    if (adminMode) {
      app.innerHTML = shell(`
        ${brand()}
        <section class="auth-hero">
          <div class="eyebrow">Área restrita</div>
          <h1>Acesso administrativo</h1>
          <p class="subtitle">Entre para administrar o catálogo e a operação.</p>
        </section>
        <form class="card form-stack" data-form="admin-login">
          <label class="field"><span class="field-label">Usuário administrativo</span><input class="field-control" name="username" autocomplete="username" placeholder="Usuário" required /></label>
          <label class="field"><span class="field-label">Senha administrativa</span><input class="field-control" name="password" type="password" autocomplete="current-password" placeholder="Sua senha" required /></label>
          <div class="notice">${icon("shield")} <span>Conexão segura configurada automaticamente.</span></div>
          <button class="button button-primary" type="submit">${icon("shield")} Entrar como administrador</button>
        </form>
        <div class="auth-switch"><button type="button" data-action="member-login-screen">Voltar ao login</button></div>
      `, false);
      return;
    }

    app.innerHTML = shell(`
      ${brand()}
      <section class="auth-hero">
        <div class="eyebrow">Sua conta Hype</div>
        <h1>Entrar</h1>
        <p class="subtitle">Use o usuário e a senha que você cadastrou para acessar sua carteira e fazer pedidos.</p>
      </section>
      <form class="card form-stack" data-form="member-login">
        <label class="field"><span class="field-label">Usuário</span><input class="field-control" name="username" autocomplete="username" value="${escapeHtml(state.registrationUsername || "")}" placeholder="Seu usuário" minlength="3" required /></label>
        <label class="field"><span class="field-label">Senha</span><input class="field-control" name="password" type="password" autocomplete="current-password" placeholder="Sua senha" minlength="6" required /></label>
        <div class="notice">${icon("shield")} <span>O servidor é configurado de fábrica e não aparece nesta tela.</span></div>
        <button class="button button-primary" type="submit">${icon("user")} Entrar na minha conta</button>
      </form>
      <div class="auth-switch"><button type="button" data-action="register-screen">Ainda não tenho conta • Criar cadastro</button></div>
      <div class="auth-switch"><button type="button" data-action="admin-login-screen">Acesso administrativo</button></div>
    `, false);
  }

  function renderRegister() {
    app.innerHTML = shell(`
      ${brand()}
      <section class="auth-hero">
        <div class="eyebrow">Novo cadastro</div>
        <h1>Criar conta</h1>
        <p class="subtitle">Cadastre seus dados. Depois do registro, volte ao login e entre com o mesmo usuário e senha.</p>
      </section>
      <form class="card form-stack" data-form="member-register">
        <label class="field"><span class="field-label">Nome</span><input class="field-control" name="name" autocomplete="name" placeholder="Seu nome" minlength="2" required /></label>
        <label class="field"><span class="field-label">Usuário</span><input class="field-control" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Crie um usuário" minlength="3" maxlength="32" required /><span class="helper">Use pelo menos 3 caracteres.</span></label>
        <label class="field"><span class="field-label">Senha</span><input class="field-control" name="password" type="password" autocomplete="new-password" placeholder="Crie uma senha" minlength="6" required /></label>
        <label class="field"><span class="field-label">Confirmar senha</span><input class="field-control" name="confirmPassword" type="password" autocomplete="new-password" placeholder="Digite a senha novamente" minlength="6" required /></label>
        <div class="notice">${icon("wallet")} <span>Sua carteira começa em R$ 0,00. Não existe saldo bônus.</span></div>
        <button class="button button-primary" type="submit">${icon("check")} Criar minha conta</button>
      </form>
      <div class="auth-switch"><button type="button" data-action="member-login-screen">Já tenho cadastro • Fazer login</button></div>
    `, false);
  }

  function money(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    try {
      return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number);
    } catch {
      return `R$ ${number.toFixed(2).replace(".", ",")}`;
    }
  }

  function firstNumber() {
    for (let i = 0; i < arguments.length; i += 1) {
      const number = Number(arguments[i]);
      if (Number.isFinite(number)) return number;
    }
    return NaN;
  }

  function serviceRateBRL(service) {
    return firstNumber(
      service && service.pricePerThousandBRL,
      service && service.adminRateBRL,
      service && service.customerRateBRL,
      service && service.saleRateBRL,
      service && service.priceBRL,
      service && service.rateBRL,
      service && service.brlRate,
      service && service.saleRate,
      service && service.rate
    );
  }

  function providerRateBRL(service) {
    return firstNumber(
      service && service.providerRateBRL,
      service && service.providerPriceBRL,
      service && service.costRateBRL,
      service && service.costBRL,
      service && service.originalRateBRL,
      service && service.rateBRL,
      service && service.brlRate,
      service && service.rate
    );
  }

  function orderChargeBRL(order) {
    return firstNumber(order && order.chargeBRL, order && order.amountBRL, order && order.priceBRL, order && order.estimatedChargeBRL, order && order.estimatedCharge, order && order.charge);
  }

  function dateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
  }

  function translatedStatus(status) {
    const key = String(status || "Pending").toLowerCase();
    const labels = {
      pending: "Pendente",
      processing: "Processando",
      "in progress": "Em andamento",
      completed: "Concluído",
      partial: "Parcial",
      canceled: "Cancelado",
      cancelled: "Cancelado",
      "cancel requested": "Cancelamento solicitado",
      error: "Erro",
    };
    return labels[key] || status || "Pendente";
  }

  function statusClass(status) {
    const key = String(status || "").toLowerCase();
    if (key === "completed") return "status-completed";
    if (key.includes("cancel")) return "status-canceled";
    if (key === "error") return "status-error";
    return "";
  }

  function orderCard(order, compact) {
    const actions = compact ? "" : `
      <div class="order-actions">
        <button type="button" class="button button-secondary button-small" data-action="refresh-order" data-id="${escapeHtml(order.id)}">${icon("refresh")} Atualizar</button>
        ${order.refillAvailable ? `<button type="button" class="button button-secondary button-small" data-action="refill-order" data-id="${escapeHtml(order.id)}">Reposição</button>` : ""}
        ${order.cancelAvailable && !String(order.status).toLowerCase().includes("cancel") ? `<button type="button" class="button button-danger button-small" data-action="cancel-order" data-id="${escapeHtml(order.id)}">Cancelar</button>` : ""}
      </div>`;
    return `
      <article class="card order-card">
        <div class="order-head">
          <div style="min-width:0">
            <div class="order-title">${escapeHtml(order.serviceName)}</div>
            <div class="order-meta">Pedido SMM #${escapeHtml(order.providerOrderId)} • ${dateTime(order.createdAt)}</div>
          </div>
          <span class="status-pill ${statusClass(order.status)}">${escapeHtml(translatedStatus(order.status))}</span>
        </div>
        <div class="order-details">
          <div class="detail"><div class="detail-label">Quantidade</div><div class="detail-value">${escapeHtml(order.quantity)}</div></div>
          <div class="detail"><div class="detail-label">Custo estimado</div><div class="detail-value">${money(orderChargeBRL(order))}</div></div>
          ${compact ? "" : `<div class="detail"><div class="detail-label">Restante</div><div class="detail-value">${escapeHtml(order.remains == null ? "—" : order.remains)}</div></div><div class="detail"><div class="detail-label">Solicitado por</div><div class="detail-value">${escapeHtml(order.createdBy)}</div></div>`}
        </div>
        ${actions}
      </article>`;
  }

  function renderHome() {
    const recent = state.orders.slice(0, 3);
    const active = state.orders.filter(function (order) {
      return ["pending", "processing", "in progress"].includes(String(order.status).toLowerCase());
    }).length;
    app.innerHTML = shell(`
      ${topbar(`Olá, ${state.session.member || "equipe"}`)}
      <section class="page-heading"><h1>Visão geral</h1><p class="subtitle">Acompanhe a operação e envie pedidos diretamente à SMMHype.</p></section>
      <section class="card balance-card">
        <div class="balance-row"><div><div class="balance-label">MINHA CARTEIRA</div><div class="balance-value">${state.wallet ? money(state.wallet.balance) : "—"}</div></div><span class="live-pill"><i class="live-dot"></i> SALDO</span></div>
        <button type="button" class="wallet-inline-button" data-nav="wallet">${icon("plus")} Adicionar saldo</button>
      </section>
      <div class="metrics"><div class="metric"><div class="metric-value">${state.orders.length}</div><div class="metric-label">Pedidos</div></div><div class="metric"><div class="metric-value">${active}</div><div class="metric-label">Em andamento</div></div></div>
      <button type="button" class="primary-action" data-nav="new-order"><span class="action-icon">${icon("plus")}</span><span><strong>Novo pedido</strong><span>Escolha o serviço, confira o custo e confirme.</span></span></button>
      <div class="section-heading"><h2>Pedidos recentes</h2>${recent.length ? '<button type="button" data-nav="orders">Ver todos</button>' : ""}</div>
      ${recent.length ? `<div class="order-list">${recent.map(function (order) { return orderCard(order, true); }).join("")}</div>` : `<div class="card empty-state"><div class="empty-icon">${icon("receipt")}</div><h3>Ainda não há pedidos</h3><p>Depois que o administrador cadastrar um serviço, seu primeiro pedido aparecerá aqui.</p></div>`}
    `, true);
  }

  function renderNewOrder() {
    const options = state.services.map(function (service) {
      return `<option value="${service.service}">#${service.service} — ${escapeHtml(service.name)}</option>`;
    }).join("");
    const first = state.services[0];
    app.innerHTML = shell(`
      ${topbar("Nova solicitação")}
      <section class="page-heading"><h1>Criar pedido</h1><p class="subtitle">Revise o serviço, o destino e a quantidade antes de confirmar.</p></section>
      ${state.services.length ? `
        <form class="card form-stack" data-form="new-order">
          <label class="field"><span class="field-label">Produto disponível</span><select class="field-control" name="serviceId" data-order-service required>${options}</select><span class="helper" data-service-helper>Mínimo ${escapeHtml(first.min)} • Máximo ${escapeHtml(first.max)} • ${escapeHtml(first.category)}</span></label>
          <label class="field"><span class="field-label">Link do perfil ou publicação</span><input class="field-control" name="link" type="url" inputmode="url" placeholder="https://instagram.com/..." required /></label>
          <label class="field"><span class="field-label">Quantidade</span><input class="field-control" name="quantity" type="number" inputmode="numeric" min="${escapeHtml(first.min)}" max="${escapeHtml(first.max)}" placeholder="${escapeHtml(first.min)}" data-order-quantity required /></label>
          <div class="cost-preview"><strong data-cost-preview>—</strong><span>Valor estimado em Real brasileiro. O servidor confere o valor final e o saldo da sua carteira antes de enviar.</span></div>
          <div class="notice">${icon("shield")} <span>O pedido só deve ser liberado pelo servidor quando houver saldo individual suficiente na carteira.</span></div>
          <button class="button button-primary" type="submit">${icon("check")} Revisar e enviar</button>
        </form>` : `
        <div class="card empty-state"><div class="empty-icon">${icon("box")}</div><h3>Nenhum produto disponível</h3><p>Peça ao administrador para entrar no painel e cadastrar o ID de um serviço da SMMHype.</p></div>`}
    `, true);
    updateOrderPreview();
  }

  function renderOrders() {
    app.innerHTML = shell(`
      ${topbar("Histórico")}
      <section class="page-heading"><h1>Pedidos</h1><p class="subtitle">Atualize a situação diretamente no provedor e consulte quem enviou cada solicitação.</p></section>
      ${state.orders.length ? `<div class="order-list">${state.orders.map(function (order) { return orderCard(order, false); }).join("")}</div>` : `<div class="card empty-state"><div class="empty-icon">${icon("receipt")}</div><h3>Nenhum pedido registrado</h3><p>Os pedidos reais enviados pela equipe aparecerão aqui.</p></div>`}
    `, true);
  }

  function renderWallet() {
    const wallet = state.wallet || { balance: 0, currency: "BRL", transactions: [] };
    const transactions = Array.isArray(wallet.transactions) ? wallet.transactions : [];
    const statusNote = state.walletSupported
      ? `<div class="notice wallet-ok">${icon("shield")} <span>O saldo só é liberado depois que o servidor confirma o pagamento no Mercado Pago.</span></div>`
      : `<div class="notice wallet-warning">${icon("shield")} <span>A carteira visual está pronta, mas o servidor ainda precisa habilitar os endpoints financeiros para aceitar depósitos e usar o saldo nos pedidos.</span></div>`;
    app.innerHTML = shell(`
      ${topbar("Minha carteira")}
      <section class="page-heading"><h1>Carteira</h1><p class="subtitle">Use seu saldo para pagar os pedidos da sua conta.</p></section>
      <section class="card balance-card wallet-hero">
        <div class="balance-row"><div><div class="balance-label">SALDO DISPONÍVEL</div><div class="balance-value">${money(wallet.balance)}</div></div><span class="live-pill"><i class="live-dot"></i> INDIVIDUAL</span></div>
      </section>
      <section class="card wallet-deposit-card">
        <div class="section-heading"><h2>Adicionar saldo</h2></div>
        <form class="form-stack" data-form="wallet-deposit">
          <label class="field"><span class="field-label">Valor que deseja receber na carteira</span><input class="field-control" name="amount" type="number" inputmode="decimal" min="1" step="0.01" placeholder="Ex.: 20,00" data-wallet-amount required /><span class="helper">É cobrada uma taxa de 5% sobre cada depósito.</span></label>
          <div class="wallet-fee-preview">
            <div><span>Crédito na carteira</span><strong data-wallet-credit>R$ 0,00</strong></div>
            <div><span>Taxa de 5%</span><strong data-wallet-fee>R$ 0,00</strong></div>
            <div class="wallet-total"><span>Total a pagar</span><strong data-wallet-total>R$ 0,00</strong></div>
          </div>
          ${statusNote}
          <button class="button button-primary" type="submit" ${state.walletSupported ? "" : "disabled"}>${icon("wallet")} Pagar com Mercado Pago</button>
        </form>
      </section>
      <div class="section-heading"><h2>Movimentações</h2><button type="button" data-action="refresh-wallet">Atualizar</button></div>
      ${transactions.length ? `<div class="wallet-transactions">${transactions.map(walletTransactionCard).join("")}</div>` : `<div class="card empty-state"><div class="empty-icon">${icon("wallet")}</div><h3>Nenhuma movimentação</h3><p>Seus depósitos e pagamentos de pedidos aparecerão aqui.</p></div>`}
    `, true);
    updateWalletPreview();
  }

  function walletTransactionCard(item) {
    const type = String(item.type || item.kind || "movimentação");
    const isDebit = type.toLowerCase().includes("debit") || type.toLowerCase().includes("pedido") || Number(item.amount) < 0;
    const amount = Math.abs(Number(item.amount || item.value || 0));
    const labelMap = { deposit: "Depósito", credit: "Crédito", debit: "Pedido", order: "Pedido", refund: "Estorno" };
    const label = labelMap[type.toLowerCase()] || item.description || "Movimentação";
    return `<article class="card wallet-transaction"><div><strong>${escapeHtml(label)}</strong><span>${dateTime(item.createdAt || item.date)}</span></div><b class="${isDebit ? "wallet-debit" : "wallet-credit"}">${isDebit ? "−" : "+"}${money(amount)}</b></article>`;
  }

  function renderSettings() {
    app.innerHTML = shell(`
      ${topbar("Configurações")}
      <section class="page-heading"><h1>Ajustes</h1><p class="subtitle">Dados da sessão e segurança do aplicativo.</p></section>
      <section class="card settings-list">
        <div class="setting-item"><div class="setting-icon">${icon("user")}</div><div><h3>Conta conectada</h3><p>${escapeHtml(state.session.username || state.session.member || "usuário")}</p></div></div>
        <div class="setting-item"><div class="setting-icon">${icon("wallet")}</div><div><h3>Carteira individual</h3><p>Saldo vinculado à sua conta e atualizado somente após confirmação de pagamento.</p></div></div>
        <div class="setting-item"><div class="setting-icon">${icon("shield")}</div><div><h3>Conexão protegida</h3><p>Credenciais privadas e validações financeiras ficam somente no backend.</p></div></div>
      </section>
      <button type="button" class="button button-secondary mt-16" data-action="reload-data">${icon("refresh")} Atualizar dados</button>
      <button type="button" class="button button-danger mt-12" data-action="logout">${icon("logout")} Sair da conta</button>
    `, true);
  }

  function renderAdmin() {
    const summary = state.adminSummary || {};
    const services = state.services;
    app.innerHTML = `<div class="app-shell no-nav"><main class="page">
      ${topbar("Administração")}
      <section class="page-heading"><h1>Painel administrativo</h1><p class="subtitle">Cadastre os serviços e defina quanto o cliente pagará a cada 1.000 unidades.</p></section>
      <div class="admin-banner">${icon("shield")} <span>Modo administrador • catálogo compartilhado com todos os celulares</span></div>
      <section class="card balance-card">
        <div class="balance-row"><div><div class="balance-label">SALDO SMMHYPE</div><div class="balance-value">${summary.balance != null ? money(summary.balanceBRL != null ? summary.balanceBRL : summary.balance) : "—"}</div></div><span class="live-pill"><i class="live-dot"></i> API</span></div>
      </section>
      <div class="metrics"><div class="metric"><div class="metric-value">${summary.enabledServices == null ? "—" : summary.enabledServices}</div><div class="metric-label">Produtos ativos</div></div><div class="metric"><div class="metric-value">${summary.orders == null ? "—" : summary.orders}</div><div class="metric-label">Pedidos enviados</div></div></div>

      <section class="card mb-14">
        <div class="section-heading"><h2>Adicionar produto</h2></div>
        <form class="form-stack" data-form="add-service">
          <label class="field"><span class="field-label">ID do serviço na SMMHype</span><input class="field-control" name="serviceId" type="number" inputmode="numeric" min="1" placeholder="Ex.: 1234" required /><span class="helper">O backend valida o ID e importa nome, categoria, tarifa, mínimo e máximo automaticamente.</span></label>
          <label class="field"><span class="field-label">Preço cobrado por 1.000</span><input class="field-control" name="pricePerThousandBRL" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="Ex.: 15,90" required /><span class="helper">Valor em Real brasileiro que o usuário pagará por cada 1.000 unidades.</span></label>
          <button class="button button-primary" type="submit">${icon("plus")} Validar e adicionar</button>
        </form>
      </section>

      <div class="section-heading"><h2>Produtos cadastrados</h2><button type="button" data-action="admin-reload">Atualizar</button></div>
      ${services.length ? `<div class="service-list">${services.map(serviceCard).join("")}</div>` : `<div class="card empty-state"><div class="empty-icon">${icon("box")}</div><h3>Catálogo vazio</h3><p>Digite acima o primeiro ID de serviço disponibilizado pela sua conta SMMHype.</p></div>`}

      <button type="button" class="button button-danger mt-16" data-action="logout">${icon("logout")} Sair da administração</button>
    </main></div>`;
  }

  function serviceCard(service) {
    const sellingRate = serviceRateBRL(service);
    const providerRate = providerRateBRL(service);
    const sellingValue = Number.isFinite(sellingRate) ? Number(sellingRate).toFixed(2) : "";
    const providerText = Number.isFinite(providerRate) ? money(providerRate) : "—";
    return `
      <article class="card service-card">
        <div class="service-head"><span class="id-pill">ID ${service.service}</span><button type="button" class="toggle-button ${service.enabled ? "enabled" : ""}" data-action="toggle-service" data-id="${service.service}" data-enabled="${service.enabled ? "true" : "false"}">${service.enabled ? "ATIVO" : "PAUSADO"}</button></div>
        <div class="service-title mt-12">${escapeHtml(service.name)}</div>
        <div class="service-meta">${escapeHtml(service.category)} • ${escapeHtml(service.type)}<br>Tarifa do fornecedor: ${providerText} / 1.000 • mínimo ${escapeHtml(service.min)} • máximo ${escapeHtml(service.max)}</div>
        <form class="service-price-form" data-form="service-price" data-service-id="${service.service}">
          <label class="field service-price-field"><span class="field-label">Preço cobrado por 1.000</span><div class="money-input-wrap"><span>R$</span><input class="field-control" name="pricePerThousandBRL" type="number" inputmode="decimal" min="0.01" step="0.01" value="${escapeHtml(sellingValue)}" placeholder="0,00" required /></div><span class="helper">Este é o preço usado no cálculo da carteira e mostrado aos usuários.</span></label>
          <button type="submit" class="button button-primary button-small">${icon("check")} Salvar preço</button>
        </form>
        <div class="order-actions"><button type="button" class="button button-secondary button-small" data-action="sync-service" data-id="${service.service}">${icon("refresh")} Sincronizar</button><button type="button" class="button button-danger button-small" data-action="remove-service" data-id="${service.service}">${icon("trash")} Remover</button></div>
      </article>`;
  }

  function render() {
    if (state.screen === "loading") return renderLoading();
    if (state.screen === "login") return renderLogin(false);
    if (state.screen === "register") return renderRegister();
    if (state.screen === "admin-login") return renderLogin(true);
    if (state.screen === "admin") return renderAdmin();
    if (state.screen === "new-order") return renderNewOrder();
    if (state.screen === "orders") return renderOrders();
    if (state.screen === "wallet") return renderWallet();
    if (state.screen === "settings") return renderSettings();
    return renderHome();
  }

  async function bootstrap() {
    state.apiUrl = DEFAULT_API_URL;
    if (!state.session) {
      clearSession();
      state.screen = "login";
      return render();
    }
    renderLoading();
    try {
      const info = await client().request("/api/info");
      state.session.member = info.member;
      state.session.role = info.role;
      localStorage.setItem(SESSION_KEY, JSON.stringify(state.session));
      if (info.role === "admin") {
        await loadAdminData();
        state.screen = "admin";
      } else {
        await loadMemberData();
        state.screen = "home";
      }
    } catch (error) {
      clearSession();
      state.screen = "login";
      toast(error.message, "error");
    }
    render();
  }

  async function loadMemberData() {
    const core = await Promise.all([
      client().request("/api/services"),
      client().request("/api/orders"),
      client().request("/api/balance"),
    ]);
    state.services = core[0];
    state.orders = core[1];
    state.balance = core[2];
    try {
      state.wallet = await client().request("/api/wallet");
      state.walletSupported = true;
    } catch (error) {
      if (error.status !== 404) throw error;
      state.walletSupported = false;
      state.wallet = { balance: 0, currency: "BRL", transactions: [] };
    }
  }

  async function loadAdminData() {
    const results = await Promise.all([
      client().request("/admin/services"),
      client().request("/admin/summary"),
    ]);
    state.services = results[0];
    state.adminSummary = results[1];
  }

  async function navigate(screen) {
    state.screen = screen;
    render();
    window.scrollTo(0, 0);
  }

  function buttonBusy(button, busy) {
    if (!button) return;
    if (busy) {
      button.dataset.original = button.innerHTML;
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Aguarde…';
    } else {
      button.disabled = false;
      if (button.dataset.original) button.innerHTML = button.dataset.original;
    }
  }

  async function handleForm(form) {
    const type = form.dataset.form;
    const values = Object.fromEntries(new FormData(form).entries());
    const submit = form.querySelector('button[type="submit"]');
    buttonBusy(submit, true);
    try {
      if (type === "member-register") {
        state.apiUrl = DEFAULT_API_URL;
        const username = String(values.username || "").trim();
        const password = String(values.password || "");
        if (username.length < 3) throw new Error("O usuário precisa ter pelo menos 3 caracteres.");
        if (password.length < 6) throw new Error("A senha precisa ter pelo menos 6 caracteres.");
        if (password !== String(values.confirmPassword || "")) throw new Error("As senhas não coincidem.");
        await client(true).request("/auth/register", {
          method: "POST",
          body: { name: String(values.name || "").trim(), username, password },
        });
        state.registrationUsername = username;
        state.screen = "login";
        render();
        toast("Cadastro criado. Agora entre com seu usuário e senha.");
        return;
      }

      if (type === "member-login") {
        state.apiUrl = DEFAULT_API_URL;
        const username = String(values.username || "").trim();
        const response = await client(true).request("/auth/login", {
          method: "POST",
          body: { username, password: values.password },
        });
        const user = response.user || response.account || {};
        const session = {
          ...response,
          token: response.token || response.accessToken,
          member: response.member || user.name || user.username || username,
          username: response.username || user.username || username,
          role: response.role || user.role || "member",
        };
        if (!session.token) throw new Error("O servidor não retornou uma sessão válida.");
        saveSession(session);
        state.registrationUsername = "";
        await loadMemberData();
        state.screen = "home";
        render();
        toast("Login realizado com sucesso.");
        return;
      }

      if (type === "admin-login") {
        state.apiUrl = DEFAULT_API_URL;
        const response = await client(true).request("/admin/login", {
          method: "POST",
          body: { username: values.username, password: values.password },
        });
        saveSession(response);
        await loadAdminData();
        state.screen = "admin";
        render();
        toast("Painel administrativo conectado.");
        return;
      }

      if (type === "new-order") {
        if (!state.walletSupported) throw new Error("A carteira ainda não foi habilitada no servidor. O pedido não será enviado até o saldo individual estar protegido no backend.");
        const service = state.services.find(function (item) { return item.service === Number(values.serviceId); });
        if (!service) throw new Error("Escolha um produto válido.");
        const quantity = Number(values.quantity);
        const estimated = ((serviceRateBRL(service) * quantity) / 1000).toFixed(2);
        const confirmed = window.confirm(`Confirmar pedido real?\n\n${service.name}\nQuantidade: ${quantity}\nValor estimado: ${money(estimated)}\n\nO servidor validará e descontará o valor correspondente da sua carteira.`);
        if (!confirmed) return;
        const idempotencyKey = window.crypto && crypto.randomUUID
          ? crypto.randomUUID()
          : `order-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const order = await client().request("/api/orders", {
          method: "POST",
          body: {
            serviceId: Number(values.serviceId),
            link: values.link,
            quantity,
            paymentMethod: "wallet",
            displayedRateBRL: Number(serviceRateBRL(service).toFixed(2)),
            idempotencyKey,
          },
        });
        state.orders.unshift(order);
        try { state.wallet = await client().request("/api/wallet"); } catch { /* mantém o saldo visível atual */ }
        state.screen = "orders";
        render();
        toast(`Pedido #${order.providerOrderId} enviado com sucesso.`);
        return;
      }

      if (type === "wallet-deposit") {
        if (!state.walletSupported) throw new Error("O servidor ainda não habilitou a carteira.");
        const amount = Number(String(values.amount).replace(",", "."));
        if (!Number.isFinite(amount) || amount < 1) throw new Error("Informe um valor de depósito válido.");
        const idempotencyKey = window.crypto && crypto.randomUUID
          ? crypto.randomUUID()
          : `deposit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const payment = await client().request("/api/wallet/deposits", {
          method: "POST",
          body: { amount: Number(amount.toFixed(2)), feePercent: 5, idempotencyKey },
        });
        const url = payment.checkoutUrl || payment.initPoint || payment.paymentUrl || payment.ticketUrl;
        if (!url) throw new Error("Pagamento criado, mas o servidor não retornou o link do Mercado Pago.");
        toast("Pagamento criado. O saldo será liberado automaticamente após a aprovação.");
        window.location.href = url;
        return;
      }

      if (type === "add-service") {
        const pricePerThousandBRL = Number(String(values.pricePerThousandBRL || "").replace(",", "."));
        if (!Number.isFinite(pricePerThousandBRL) || pricePerThousandBRL <= 0) throw new Error("Informe o preço cobrado por 1.000 em R$.");
        const service = await client().request("/admin/services", {
          method: "POST",
          body: { serviceId: Number(values.serviceId), pricePerThousandBRL: Number(pricePerThousandBRL.toFixed(2)) },
        });
        await loadAdminData();
        render();
        toast(`Serviço #${service.service} adicionado com preço de ${money(pricePerThousandBRL)} por 1.000.`);
        return;
      }

      if (type === "service-price") {
        const serviceId = Number(form.dataset.serviceId);
        const pricePerThousandBRL = Number(String(values.pricePerThousandBRL || "").replace(",", "."));
        if (!Number.isFinite(serviceId) || serviceId <= 0) throw new Error("Serviço inválido.");
        if (!Number.isFinite(pricePerThousandBRL) || pricePerThousandBRL <= 0) throw new Error("Informe um preço válido por 1.000 em R$.");
        await client().request(`/admin/services/${serviceId}`, {
          method: "PATCH",
          body: { pricePerThousandBRL: Number(pricePerThousandBRL.toFixed(2)) },
        });
        await loadAdminData();
        render();
        toast(`Preço atualizado para ${money(pricePerThousandBRL)} por 1.000.`);
        return;
      }

    } catch (error) {
      toast(error.message, "error");
      if (error.status === 401 && type !== "member-login" && type !== "member-register" && type !== "admin-login") {
        clearSession();
        state.screen = "login";
        render();
      }
    } finally {
      buttonBusy(submit, false);
    }
  }

  async function handleAction(button) {
    const action = button.dataset.action;
    const id = button.dataset.id;
    if (action === "admin-login-screen") return navigate("admin-login");
    if (action === "register-screen") return navigate("register");
    if (action === "member-login-screen") return navigate("login");
    if (action === "logout") {
      clearSession();
      state.screen = "login";
      render();
      return;
    }
    if (action === "reload-data") {
      buttonBusy(button, true);
      try { await loadMemberData(); render(); toast("Dados atualizados."); }
      catch (error) { toast(error.message, "error"); }
      finally { buttonBusy(button, false); }
      return;
    }
    if (action === "refresh-wallet") {
      buttonBusy(button, true);
      try {
        state.wallet = await client().request("/api/wallet");
        state.walletSupported = true;
        render();
        toast("Carteira atualizada.");
      } catch (error) { toast(error.message, "error"); }
      finally { buttonBusy(button, false); }
      return;
    }
    if (action === "admin-reload") {
      buttonBusy(button, true);
      try { await loadAdminData(); render(); toast("Painel atualizado."); }
      catch (error) { toast(error.message, "error"); }
      finally { buttonBusy(button, false); }
      return;
    }

    if (["refresh-order", "refill-order", "cancel-order"].includes(action)) {
      const suffix = action === "refresh-order" ? "refresh" : action === "refill-order" ? "refill" : "cancel";
      if (suffix === "cancel" && !window.confirm("Solicitar o cancelamento deste pedido na SMMHype?")) return;
      if (suffix === "refill" && !window.confirm("Solicitar reposição para este pedido?")) return;
      buttonBusy(button, true);
      try {
        const updated = await client().request(`/api/orders/${id}/${suffix}`, { method: "POST" });
        const index = state.orders.findIndex(function (item) { return item.id === id; });
        if (index >= 0) state.orders[index] = updated;
        render();
        toast(suffix === "refresh" ? "Status atualizado." : suffix === "refill" ? "Reposição solicitada." : "Cancelamento solicitado.");
      } catch (error) {
        toast(error.message, "error");
      } finally {
        buttonBusy(button, false);
      }
      return;
    }

    if (["toggle-service", "sync-service", "remove-service"].includes(action)) {
      const serviceId = Number(id);
      if (action === "remove-service" && !window.confirm(`Remover o serviço #${serviceId} do aplicativo?`)) return;
      buttonBusy(button, true);
      try {
        if (action === "toggle-service") {
          await client().request(`/admin/services/${serviceId}`, {
            method: "PATCH",
            body: { enabled: button.dataset.enabled !== "true" },
          });
          toast("Disponibilidade do produto alterada.");
        } else if (action === "sync-service") {
          await client().request(`/admin/services/${serviceId}/sync`, { method: "POST" });
          toast("Dados sincronizados com a SMMHype.");
        } else {
          await client().request(`/admin/services/${serviceId}`, { method: "DELETE" });
          toast("Produto removido do catálogo.");
        }
        await loadAdminData();
        render();
      } catch (error) {
        toast(error.message, "error");
      } finally {
        buttonBusy(button, false);
      }
    }
  }

  function updateWalletPreview() {
    const input = document.querySelector("[data-wallet-amount]");
    const credit = document.querySelector("[data-wallet-credit]");
    const fee = document.querySelector("[data-wallet-fee]");
    const total = document.querySelector("[data-wallet-total]");
    if (!input || !credit || !fee || !total) return;
    const amount = Number(String(input.value || "0").replace(",", "."));
    const safe = Number.isFinite(amount) && amount > 0 ? amount : 0;
    const feeValue = safe * 0.05;
    credit.textContent = money(safe);
    fee.textContent = money(feeValue);
    total.textContent = money(safe + feeValue);
  }

  function updateOrderPreview() {
    const select = document.querySelector("[data-order-service]");
    const quantityInput = document.querySelector("[data-order-quantity]");
    const helper = document.querySelector("[data-service-helper]");
    const preview = document.querySelector("[data-cost-preview]");
    if (!select || !quantityInput || !helper || !preview) return;
    const service = state.services.find(function (item) { return item.service === Number(select.value); });
    if (!service) return;
    quantityInput.min = service.min;
    quantityInput.max = service.max;
    quantityInput.placeholder = service.min;
    helper.textContent = `Mínimo ${service.min} • Máximo ${service.max} • ${service.category}`;
    const quantity = Number(quantityInput.value);
    preview.textContent = Number.isFinite(quantity) && quantity > 0
      ? money((serviceRateBRL(service) * quantity) / 1000)
      : "—";
  }

  app.addEventListener("click", function (event) {
    const navButton = event.target.closest("[data-nav]");
    if (navButton) {
      event.preventDefault();
      navigate(navButton.dataset.nav);
      return;
    }
    const actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      event.preventDefault();
      handleAction(actionButton);
    }
  });

  app.addEventListener("submit", function (event) {
    const form = event.target.closest("[data-form]");
    if (!form) return;
    event.preventDefault();
    handleForm(form);
  });

  app.addEventListener("input", function (event) {
    if (event.target.matches("[data-order-quantity]")) updateOrderPreview();
    if (event.target.matches("[data-wallet-amount]")) updateWalletPreview();
  });

  app.addEventListener("change", function (event) {
    if (event.target.matches("[data-order-service]")) updateOrderPreview();
  });

  window.addEventListener("focus", async function () {
    if (!state.session || state.session.role === "admin" || !state.walletSupported) return;
    try {
      state.wallet = await client().request("/api/wallet");
      if (state.screen === "wallet" || state.screen === "home") render();
    } catch { /* atualização silenciosa */ }
  });

  bootstrap();
})();
