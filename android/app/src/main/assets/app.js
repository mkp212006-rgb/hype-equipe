(function () {
  "use strict";

  const SESSION_KEY = "hype-equipe.session.v3";
  const API_URL_KEY = "hype-equipe.api-url.v3";
  const EMBEDDED_API_URL = "__HYPE_API_URL__";
  const SAME_ORIGIN_API_URL = ["http:", "https:"].includes(window.location.protocol) ? window.location.origin : "";
  const DEFAULT_API_URL = EMBEDDED_API_URL.startsWith("https://") ? EMBEDDED_API_URL : SAME_ORIGIN_API_URL;
  const app = document.getElementById("app");
  const toastRegion = document.getElementById("toast-region");

  const state = {
    screen: "loading",
    apiUrl: localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL,
    session: loadJson(SESSION_KEY),
    services: [],
    orders: [],
    balance: null,
    adminSummary: null,
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

  function saveSession(session, apiUrl) {
    state.session = session;
    state.apiUrl = normalizeApiUrl(apiUrl || state.apiUrl);
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    localStorage.setItem(API_URL_KEY, state.apiUrl);
  }

  function clearSession() {
    state.session = null;
    state.services = [];
    state.orders = [];
    state.balance = null;
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
    const title = adminMode ? "Acesso administrativo" : "Acesso da equipe";
    const subtitle = adminMode
      ? "Entre para cadastrar os IDs dos serviços e administrar o catálogo compartilhado."
      : "Entre com seu nome e o código interno para solicitar produtos e acompanhar pedidos reais.";
    const fields = adminMode
      ? `
        <label class="field"><span class="field-label">Usuário administrativo</span><input class="field-control" name="username" autocomplete="username" placeholder="admin" required /></label>
        <label class="field"><span class="field-label">Senha administrativa</span><input class="field-control" name="password" type="password" autocomplete="current-password" placeholder="Sua senha" required /></label>`
      : `
        <label class="field"><span class="field-label">Seu nome</span><input class="field-control" name="name" autocomplete="name" placeholder="Ex.: Ítalo" required /></label>
        <label class="field"><span class="field-label">Código da equipe</span><input class="field-control" name="accessCode" type="password" autocomplete="current-password" placeholder="Código compartilhado" required /></label>`;

    const fixedServer = Boolean(DEFAULT_API_URL);
    app.innerHTML = shell(`
      ${brand()}
      <section class="auth-hero">
        <div class="eyebrow">Operação conectada</div>
        <h1>${title}</h1>
        <p class="subtitle">${subtitle}</p>
      </section>
      <form class="card form-stack" data-form="${adminMode ? "admin-login" : "member-login"}">
        ${fields}
        <label class="field">
          <span class="field-label">Endereço do servidor</span>
          <input class="field-control" name="apiUrl" type="url" inputmode="url" value="${escapeHtml(state.apiUrl)}" placeholder="https://api.seudominio.com" ${fixedServer ? "readonly" : ""} required />
          <span class="helper">${fixedServer ? "Servidor oficial configurado no aplicativo." : "Informe o domínio HTTPS gerado pelo Railway."} A chave da SMMHype fica protegida no servidor.</span>
        </label>
        <button class="button button-primary" type="submit">${icon(adminMode ? "shield" : "user")} ${adminMode ? "Entrar como administrador" : "Entrar na equipe"}</button>
      </form>
      <div class="auth-switch"><button type="button" data-action="${adminMode ? "member-login-screen" : "admin-login-screen"}">${adminMode ? "Voltar ao acesso da equipe" : "Acesso administrativo"}</button></div>
    `, false);
  }

  function money(value, currency) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    try {
      return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "USD" }).format(number);
    } catch {
      return `${currency || "USD"} ${number.toFixed(2)}`;
    }
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
      submitting: "Enviando",
      "refill requested": "Reposição solicitada",
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
          <div class="detail"><div class="detail-label">Custo estimado</div><div class="detail-value">${money(order.estimatedCharge, order.currency)}</div></div>
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
        <div class="balance-row"><div><div class="balance-label">SALDO DISPONÍVEL</div><div class="balance-value">${state.balance ? money(state.balance.balance, state.balance.currency) : "—"}</div></div><span class="live-pill"><i class="live-dot"></i> REAL</span></div>
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
          <div class="cost-preview"><strong data-cost-preview>—</strong><span>Estimativa com base na tarifa atual da SMMHype. O valor final aparece no status do pedido.</span></div>
          <div class="notice">${icon("shield")} <span>Este pedido é real e pode descontar o saldo da conta. Confira o link e a quantidade antes de enviar.</span></div>
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

  function renderSettings() {
    app.innerHTML = shell(`
      ${topbar("Configurações")}
      <section class="page-heading"><h1>Ajustes</h1><p class="subtitle">Dados da sessão e conexão segura do aplicativo.</p></section>
      <section class="card settings-list">
        <div class="setting-item"><div class="setting-icon">${icon("user")}</div><div><h3>Membro conectado</h3><p>${escapeHtml(state.session.member)} • acesso da equipe</p></div></div>
        <div class="setting-item"><div class="setting-icon">${icon("server")}</div><div><h3>Servidor da operação</h3><p>${escapeHtml(state.apiUrl)}</p></div></div>
        <div class="setting-item"><div class="setting-icon">${icon("shield")}</div><div><h3>Chave protegida</h3><p>A chave da SMMHype fica somente no backend e não está salva neste APK.</p></div></div>
      </section>
      <button type="button" class="button button-secondary mt-16" data-action="reload-data">${icon("refresh")} Atualizar dados</button>
      <button type="button" class="button button-danger mt-12" data-action="logout">${icon("logout")} Sair da conta da equipe</button>
    `, true);
  }

  function renderAdmin() {
    const summary = state.adminSummary || {};
    const services = state.services;
    app.innerHTML = `<div class="app-shell no-nav"><main class="page">
      ${topbar("Administração")}
      <section class="page-heading"><h1>Painel administrativo</h1><p class="subtitle">Cadastre apenas o ID do serviço. Os demais dados são buscados diretamente na SMMHype.</p></section>
      <div class="admin-banner">${icon("shield")} <span>Modo administrador • catálogo compartilhado com todos os celulares</span></div>
      ${summary.mustChangePassword ? `<div class="notice mb-14">${icon("lock")} <span>Por segurança, altere a senha administrativa inicial antes de liberar o acesso da equipe.</span></div>` : ""}
      ${summary.providerError ? `<div class="notice mb-14">${icon("server")} <span>Integração SMMHype: ${escapeHtml(summary.providerError)}</span></div>` : ""}
      <section class="card balance-card">
        <div class="balance-row"><div><div class="balance-label">SALDO SMMHYPE</div><div class="balance-value">${summary.balance != null ? money(summary.balance, summary.currency) : "—"}</div></div><span class="live-pill"><i class="live-dot"></i> API</span></div>
      </section>
      <div class="metrics"><div class="metric"><div class="metric-value">${summary.enabledServices == null ? "—" : summary.enabledServices}</div><div class="metric-label">Produtos ativos</div></div><div class="metric"><div class="metric-value">${summary.orders == null ? "—" : summary.orders}</div><div class="metric-label">Pedidos enviados</div></div></div>

      <section class="card mb-14">
        <div class="section-heading"><h2>Adicionar produto</h2></div>
        <form class="form-stack" data-form="add-service">
          <label class="field"><span class="field-label">ID do serviço na SMMHype</span><input class="field-control" name="serviceId" type="number" inputmode="numeric" min="1" placeholder="Ex.: 1234" required /><span class="helper">O backend valida o ID e importa nome, categoria, tarifa, mínimo e máximo automaticamente.</span></label>
          <button class="button button-primary" type="submit">${icon("plus")} Validar e adicionar</button>
        </form>
      </section>

      <div class="section-heading"><h2>Produtos cadastrados</h2><button type="button" data-action="admin-reload">Atualizar</button></div>
      ${services.length ? `<div class="service-list">${services.map(serviceCard).join("")}</div>` : `<div class="card empty-state"><div class="empty-icon">${icon("box")}</div><h3>Catálogo vazio</h3><p>Digite acima o primeiro ID de serviço disponibilizado pela sua conta SMMHype.</p></div>`}

      <section class="card mt-20">
        <div class="section-heading"><h2>Senha administrativa</h2></div>
        <form class="form-stack" data-form="admin-password">
          <label class="field"><span class="field-label">Senha atual</span><input class="field-control" name="currentPassword" type="password" autocomplete="current-password" required /></label>
          <label class="field"><span class="field-label">Nova senha</span><input class="field-control" name="newPassword" type="password" minlength="12" autocomplete="new-password" placeholder="Mínimo de 12 caracteres" required /></label>
          <label class="field"><span class="field-label">Confirmar nova senha</span><input class="field-control" name="confirmPassword" type="password" minlength="12" autocomplete="new-password" required /></label>
          <button class="button button-secondary" type="submit">${icon("lock")} Alterar senha</button>
        </form>
      </section>

      <section class="card mt-20">
        <div class="section-heading"><h2>Código da equipe</h2></div>
        <form class="form-stack" data-form="team-code">
          <label class="field"><span class="field-label">Novo código compartilhado</span><input class="field-control" name="newCode" type="password" minlength="6" autocomplete="new-password" placeholder="Mínimo de 6 caracteres" required /><span class="helper">Todos os membros conectados precisarão entrar novamente.</span></label>
          <button class="button button-secondary" type="submit">${icon("key")} Alterar código</button>
        </form>
      </section>
      <button type="button" class="button button-danger mt-16" data-action="logout">${icon("logout")} Sair da administração</button>
    </main></div>`;
  }

  function serviceCard(service) {
    return `
      <article class="card service-card">
        <div class="service-head"><span class="id-pill">ID ${service.service}</span><button type="button" class="toggle-button ${service.enabled ? "enabled" : ""}" data-action="toggle-service" data-id="${service.service}" data-enabled="${service.enabled ? "true" : "false"}">${service.enabled ? "ATIVO" : "PAUSADO"}</button></div>
        <div class="service-title mt-12">${escapeHtml(service.name)}</div>
        <div class="service-meta">${escapeHtml(service.category)} • ${escapeHtml(service.type)}<br>Tarifa ${money(service.rate, "USD")} / 1.000 • mínimo ${escapeHtml(service.min)} • máximo ${escapeHtml(service.max)}</div>
        <div class="order-actions"><button type="button" class="button button-secondary button-small" data-action="sync-service" data-id="${service.service}">${icon("refresh")} Sincronizar</button><button type="button" class="button button-danger button-small" data-action="remove-service" data-id="${service.service}">${icon("trash")} Remover</button></div>
      </article>`;
  }

  function render() {
    if (state.screen === "loading") return renderLoading();
    if (state.screen === "login") return renderLogin(false);
    if (state.screen === "admin-login") return renderLogin(true);
    if (state.screen === "admin") return renderAdmin();
    if (state.screen === "new-order") return renderNewOrder();
    if (state.screen === "orders") return renderOrders();
    if (state.screen === "settings") return renderSettings();
    return renderHome();
  }

  async function bootstrap() {
    if (!state.session || !state.apiUrl) {
      clearSession();
      state.screen = "login";
      return render();
    }
    renderLoading();
    try {
      const info = await client().request("/api/info");
      state.session.member = info.member;
      state.session.role = info.role;
      state.session.mustChangePassword = Boolean(info.mustChangePassword);
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
    const results = await Promise.all([
      client().request("/api/services"),
      client().request("/api/orders"),
      client().request("/api/balance"),
    ]);
    state.services = results[0];
    state.orders = results[1];
    state.balance = results[2];
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
      if (type === "member-login") {
        const apiUrl = normalizeApiUrl(values.apiUrl);
        state.apiUrl = apiUrl;
        const response = await client(true).request("/auth/login", {
          method: "POST",
          body: { name: values.name, accessCode: values.accessCode },
        });
        saveSession(response, apiUrl);
        await loadMemberData();
        state.screen = "home";
        render();
        toast("Acesso realizado. O aplicativo está conectado à operação real.");
        return;
      }

      if (type === "admin-login") {
        const apiUrl = normalizeApiUrl(values.apiUrl);
        state.apiUrl = apiUrl;
        const response = await client(true).request("/admin/login", {
          method: "POST",
          body: { username: values.username, password: values.password },
        });
        saveSession(response, apiUrl);
        await loadAdminData();
        state.screen = "admin";
        render();
        toast("Painel administrativo conectado.");
        return;
      }

      if (type === "admin-password") {
        if (values.newPassword !== values.confirmPassword) throw new Error("A confirmação da nova senha não confere.");
        if (!window.confirm("Alterar a senha administrativa agora?")) return;
        const response = await client().request("/admin/password", {
          method: "POST",
          body: { currentPassword: values.currentPassword, newPassword: values.newPassword },
        });
        saveSession(response, state.apiUrl);
        await loadAdminData();
        render();
        toast("Senha administrativa alterada com segurança.");
        return;
      }

      if (type === "new-order") {
        const service = state.services.find(function (item) { return item.service === Number(values.serviceId); });
        if (!service) throw new Error("Escolha um produto válido.");
        const quantity = Number(values.quantity);
        const estimated = ((Number(service.rate) * quantity) / 1000).toFixed(4);
        const confirmed = window.confirm(`Confirmar pedido real?\n\n${service.name}\nQuantidade: ${quantity}\nEstimativa: ${money(estimated, "USD")}\n\nEsta ação pode descontar o saldo da SMMHype.`);
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
            idempotencyKey,
          },
        });
        state.orders.unshift(order);
        state.screen = "orders";
        render();
        toast(`Pedido #${order.providerOrderId} enviado com sucesso.`);
        return;
      }

      if (type === "add-service") {
        const service = await client().request("/admin/services", {
          method: "POST",
          body: { serviceId: Number(values.serviceId) },
        });
        await loadAdminData();
        render();
        toast(`Serviço #${service.service} adicionado ao catálogo.`);
        return;
      }

      if (type === "team-code") {
        if (!window.confirm("Alterar o código e desconectar todos os membros atuais?")) return;
        await client().request("/admin/team-code", {
          method: "POST",
          body: { newCode: values.newCode },
        });
        form.reset();
        toast("Código alterado. Os membros precisarão entrar novamente.");
      }
    } catch (error) {
      toast(error.message, "error");
      if (error.status === 401 && type !== "member-login" && type !== "admin-login") {
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
      ? money((Number(service.rate) * quantity) / 1000, "USD")
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
  });

  app.addEventListener("change", function (event) {
    if (event.target.matches("[data-order-service]")) updateOrderPreview();
  });

  bootstrap();
})();
