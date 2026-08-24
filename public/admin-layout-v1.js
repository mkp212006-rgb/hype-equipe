(function () {
  "use strict";

  const SESSION_KEY = "tw-store.session.v3";
  const ADMIN_SCREEN_KEY = "tw-store.admin.screen.v1";
  const runtime = window.TW_STORE_CONFIG || {};
  const API_URL = runtime.apiBaseUrl || "https://tw-store-application.up.railway.app";
  const REQUEST_TIMEOUT_MS = Number(runtime.requestTimeoutMs) || 15_000;
  const app = document.getElementById("app");

  let catalogMarkup = "";
  let applying = false;
  let homeRequestId = 0;
  let openTickets = 0;
  let pendingDeliveries = 0;

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
  }

  function isAdmin() {
    const current = session();
    return Boolean(current && current.token && current.role === "admin");
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function money(value) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
  }

  function icon(name) {
    const paths = {
      home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/>',
      catalog: '<path d="m21 8-9-5-9 5 9 5Z"/><path d="m3 8 9 5 9-5v8l-9 5-9-5Z"/><path d="M12 13v8"/>',
      delivery: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/><path d="m15 3-3 4h3l-2 4"/>',
      check: '<path d="M20 6 9 17l-5-5"/>',
      copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
      reports: '<path d="M5 20V10M12 20V4M19 20v-7"/><path d="M3 20h18"/>',
      support: '<path d="M4 13v-2a8 8 0 0 1 16 0v2"/><path d="M4 13h3v6H5a1 1 0 0 1-1-1ZM20 13h-3v6h2a1 1 0 0 0 1-1Z"/><path d="M17 19c0 1-1.5 2-3 2h-2"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
      bag: '<path d="M6 8h12l1 12H5Z"/><path d="M9 9V7a3 3 0 0 1 6 0v2"/>',
      money: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5c-.8-.7-1.8-1-3-1-1.7 0-3 .8-3 2s1 1.8 3 2.2 3 1 3 2.3-1.3 2.2-3.2 2.2c-1.2 0-2.4-.4-3.3-1.2M12 5.5v13"/>',
      arrow: '<path d="m9 18 6-6-6-6"/>',
      refresh: '<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18.5 9A7 7 0 0 0 6 6.5L4 9M5.5 15A7 7 0 0 0 18 17.5l2-2.5"/>',
    };
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || paths.home) + '</svg>';
  }

  function setScreen(value) {
    const screen = ["home", "catalog", "deliveries", "reports", "support", "settings"].includes(value) ? value : "home";
    sessionStorage.setItem(ADMIN_SCREEN_KEY, screen);
    return screen;
  }

  function screen() {
    return setScreen(sessionStorage.getItem(ADMIN_SCREEN_KEY) || "home");
  }

  async function api(path, options) {
    const current = session();
    if (!current || current.role !== "admin" || !current.token) throw new Error("Sessão administrativa inválida.");
    const config = options || {};
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(API_URL + path, {
        method: config.method || "GET",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer " + current.token,
          ...(config.body ? { "Content-Type": "application/json" } : {}),
        },
        body: config.body ? JSON.stringify(config.body) : undefined,
        signal: controller.signal,
        cache: "no-store",
        credentials: "same-origin",
      });
      const raw = await response.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar os dados administrativos.");
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  function adminNav(active) {
    const items = [
      ["home", "Início", "home"],
      ["catalog", "Catálogo", "catalog"],
      ["deliveries", "Entregas", "delivery"],
      ["reports", "Relatórios", "reports"],
      ["support", "Suporte", "support"],
      ["settings", "Ajustes", "settings"],
    ];
    return '<nav class="bottom-nav admin-bottom-nav" data-admin-active="' + escapeHtml(active) + '" data-admin-badges="' + escapeHtml(openTickets + ":" + pendingDeliveries) + '" aria-label="Navegação administrativa">' + items.map(function (item) {
      const count = item[0] === "support" ? openTickets : item[0] === "deliveries" ? pendingDeliveries : 0;
      const badge = count > 0 ? '<b class="admin-nav-badge">' + escapeHtml(count > 99 ? "99+" : count) + '</b>' : '';
      return '<button type="button" class="nav-item ' + (active === item[0] ? "active" : "") + '" data-admin-nav="' + item[0] + '"><span class="admin-nav-icon">' + icon(item[2]) + badge + '</span><span>' + item[1] + '</span></button>';
    }).join("") + '</nav>';
  }

  function appendNav(active) {
    if (!app || !isAdmin()) return;
    const old = app.querySelector(".admin-bottom-nav");
    if (old && old.dataset.adminActive === active && old.dataset.adminBadges === openTickets + ":" + pendingDeliveries) {
      app.classList.add("admin-nav-visible");
      return;
    }
    applying = true;
    try {
      if (old) old.remove();
      app.insertAdjacentHTML("beforeend", adminNav(active));
      app.classList.add("admin-nav-visible");
    } finally {
      applying = false;
    }
  }

  function adminTopbar() {
    const current = session() || {};
    const username = String(current.username || current.member || "Admin");
    const initial = username.trim().charAt(0).toUpperCase() || "A";
    return '<header class="topbar admin-topbar"><div><div class="eyebrow">OLÁ, ' + escapeHtml(username.toUpperCase()) + ' (ADMIN)</div><div class="brand-name">Tw Store</div></div><div class="avatar admin-avatar">' + escapeHtml(initial) + '</div></header>';
  }

  function metricCard(iconName, label, value, note, extraClass) {
    return '<article class="admin-dashboard-metric ' + (extraClass || "") + '"><div class="admin-metric-icon">' + icon(iconName) + '</div><div class="admin-metric-copy"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong><small>' + escapeHtml(note || "Atualizado agora") + '</small></div></article>';
  }

  function renderHomeSkeleton() {
    if (!app) return;
    applying = true;
    app.innerHTML = '<div class="app-shell admin-app-shell"><main class="page admin-dashboard-page">' +
      adminTopbar() +
      '<section class="admin-dashboard-hero"><h1>Painel Admin</h1><p>Acompanhe a operação da loja e gerencie todas as áreas.</p></section>' +
      '<div class="section-heading admin-overview-heading"><h2>Visão geral</h2><button type="button" data-admin-refresh>' + icon("refresh") + ' Atualizar</button></div>' +
      '<div class="admin-dashboard-grid" data-admin-dashboard-metrics>' +
        metricCard("bag", "Total de pedidos", "—", "Carregando…") +
        metricCard("catalog", "Catálogo ativo", "—", "Carregando…") +
        metricCard("support", "Tickets abertos", "—", "Carregando…") +
        metricCard("delivery", "Entregas pendentes", "—", "Carregando…") +
      '</div>' +
      '<button class="admin-quick-card" type="button" data-admin-nav="catalog"><span class="admin-quick-icon">' + icon("catalog") + '</span><span class="admin-quick-copy"><strong>Gerenciar catálogo</strong><small>Adicione, edite ou organize produtos e serviços.</small></span><span class="admin-quick-action">Acessar ' + icon("arrow") + '</span></button>' +
      '<button class="admin-quick-card admin-delivery-quick" type="button" data-admin-nav="deliveries"><span class="admin-quick-icon">' + icon("delivery") + '</span><span class="admin-quick-copy"><strong>Entregas de assinaturas</strong><small>Veja os pedidos e envie os dados ao e-mail informado pelo cliente.</small></span><span class="admin-quick-action">Abrir ' + icon("arrow") + '</span></button>' +
      '<section class="admin-recent-section"><div class="section-heading"><h2>Suporte recente</h2><button type="button" data-admin-nav="support">Ver todos</button></div><div class="admin-recent-list" data-admin-recent><div class="card feature-loading">Carregando atividades…</div></div></section>' +
      '</main></div>';
    appendNav("home");
    window.scrollTo(0, 0);
    applying = false;
  }

  function renderRecentTickets(tickets) {
    const target = app && app.querySelector("[data-admin-recent]");
    if (!target) return;
    const items = Array.isArray(tickets) ? tickets.slice().sort(function (a, b) {
      return new Date(b.lastMessageAt || b.updatedAt || b.createdAt || 0) - new Date(a.lastMessageAt || a.updatedAt || a.createdAt || 0);
    }).slice(0, 3) : [];
    if (!items.length) {
      target.innerHTML = '<div class="card empty-state admin-empty-recent"><div class="empty-icon">' + icon("support") + '</div><h3>Nenhum ticket recente</h3><p>Os atendimentos dos clientes aparecerão aqui.</p></div>';
      return;
    }
    target.innerHTML = items.map(function (ticket) {
      const id = String(ticket.id || "").slice(0, 8);
      const status = String(ticket.status || "open").toLowerCase() === "closed" ? "Encerrado" : "Aberto";
      return '<button type="button" class="card admin-activity-item" data-feature-action="admin-ticket-detail" data-ticket-id="' + escapeHtml(ticket.id) + '"><span class="admin-activity-icon">' + icon("support") + '</span><span class="admin-activity-copy"><strong>' + escapeHtml(ticket.subject || "Ticket #" + id) + '</strong><small>@' + escapeHtml(ticket.username || "cliente") + ' • ' + escapeHtml(status) + '</small></span><span class="admin-activity-arrow">' + icon("arrow") + '</span></button>';
    }).join("");
  }

  async function loadHome() {
    const requestId = ++homeRequestId;
    const results = await Promise.allSettled([
      api("/admin/summary"),
      api("/admin/services"),
      api("/admin/tickets"),
      api("/admin/subscription-orders"),
    ]);
    if (requestId !== homeRequestId || screen() !== "home" || !app) return;
    const summary = results[0].status === "fulfilled" ? results[0].value : {};
    const services = results[1].status === "fulfilled" && Array.isArray(results[1].value) ? results[1].value : [];
    const tickets = results[2].status === "fulfilled" && Array.isArray(results[2].value) ? results[2].value : [];
    const deliveries = results[3].status === "fulfilled" && Array.isArray(results[3].value) ? results[3].value : [];
    openTickets = tickets.filter(function (ticket) { return String(ticket.status || "open").toLowerCase() !== "closed"; }).length;
    pendingDeliveries = deliveries.filter(function (order) { return order.status === "pending"; }).length;

    const metrics = app.querySelector("[data-admin-dashboard-metrics]");
    if (metrics) {
      const enabled = services.filter(function (service) { return service.enabled !== false; }).length;
      metrics.innerHTML =
        metricCard("bag", "Total de pedidos", summary.orders == null ? String(deliveries.length) : String(Number(summary.orders) + deliveries.length), "Inclui assinaturas") +
        metricCard("catalog", "Catálogo ativo", String(enabled), services.length + " produto(s) cadastrado(s)") +
        metricCard("support", "Tickets abertos", String(openTickets), openTickets ? "Precisam de atendimento" : "Tudo respondido") +
        metricCard("delivery", "Entregas pendentes", String(pendingDeliveries), pendingDeliveries ? "Precisam ser enviadas" : "Tudo entregue");
    }
    renderRecentTickets(tickets);
    appendNav("home");
  }

  function renderHome() {
    setScreen("home");
    renderHomeSkeleton();
    loadHome().catch(function () { /* skeleton remains usable */ });
  }

  function stripCatalogClone(main) {
    const clone = main.cloneNode(true);
    clone.querySelectorAll(".balance-card, .metrics, [data-feature-admin-support], [data-report-admin-settings-entry], .button-danger[data-action='logout'], .admin-bottom-nav").forEach(function (node) { node.remove(); });
    const heading = clone.querySelector(".page-heading");
    if (heading) {
      const h1 = heading.querySelector("h1");
      const p = heading.querySelector("p");
      if (h1) h1.textContent = "Catálogo";
      if (p) p.textContent = "Gerencie categorias, produtos, serviços e preços cobrados no aplicativo.";
    }
    const topEyebrow = clone.querySelector(".topbar .eyebrow");
    if (topEyebrow) topEyebrow.textContent = "ADMINISTRAÇÃO • CATÁLOGO";
    return clone.innerHTML;
  }

  function captureCatalog() {
    if (!app || !isAdmin()) return false;
    const main = app.querySelector(".app-shell > main.page");
    const heading = main && Array.from(main.querySelectorAll("h1")).find(function (node) { return /painel administrativo/i.test(node.textContent || ""); });
    if (!main || !heading) return false;
    catalogMarkup = stripCatalogClone(main);
    return true;
  }

  function renderCatalog() {
    setScreen("catalog");
    if (!catalogMarkup) {
      if (!captureCatalog()) {
        setScreen("home");
        renderHome();
        return;
      }
    }
    applying = true;
    app.innerHTML = '<div class="app-shell admin-app-shell"><main class="page admin-catalog-page">' + catalogMarkup + '</main></div>';
    appendNav("catalog");
    window.scrollTo(0, 0);
    applying = false;
  }

  function dateTime(value) {
    const date = new Date(value || 0);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pt-BR");
  }

  function notify(message, error) {
    const region = document.getElementById("toast-region");
    if (!region) return;
    region.innerHTML = '<div class="toast ' + (error ? "error" : "") + '">' + escapeHtml(message) + "</div>";
    setTimeout(function () { if (region) region.innerHTML = ""; }, 4200);
  }

  function deliveryStatus(order) {
    if (order.status === "fulfilled") return { label: "Enviado", className: "fulfilled" };
    if (order.status === "refunded") return { label: "Estornado", className: "refunded" };
    return { label: "Pendente", className: "pending" };
  }

  function deliveryCard(order) {
    const status = deliveryStatus(order);
    const summary = '<div class="admin-delivery-summary"><div><span>Cliente</span><strong>@' + escapeHtml(order.createdBy || "cliente") + '</strong></div><div><span>Valor</span><strong>' + money(order.priceBRL) + '</strong></div><div><span>E-mail</span><strong>' + escapeHtml(order.deliveryEmail) + '</strong></div><div><span>Pedido em</span><strong>' + escapeHtml(dateTime(order.createdAt)) + "</strong></div></div>";
    let action = "";
    if (order.status === "pending") {
      action = '<form class="admin-delivery-form" data-admin-delivery-form data-order-id="' + escapeHtml(order.id) + '" data-delivery-email="' + escapeHtml(order.deliveryEmail) + '" data-product-name="' + escapeHtml(order.productName) + '"><label><span>Dados que serão enviados ao cliente</span><textarea name="deliveryData" maxlength="4000" placeholder="Ex.: Login, senha, link de acesso e instruções" required></textarea></label><label><span>Observação interna (opcional)</span><input name="adminNote" maxlength="1000" placeholder="Informação visível somente no painel"></label><div class="admin-delivery-actions"><button type="button" class="button button-secondary" data-admin-open-email>' + icon("delivery") + '<span>1. Abrir e-mail</span></button><button type="submit" class="button button-primary">' + icon("check") + '<span>2. Confirmar envio</span></button></div><button type="button" class="admin-delivery-refund" data-admin-refund-order="' + escapeHtml(order.id) + '">Cancelar pedido e estornar ' + money(order.priceBRL) + "</button></form>";
    } else if (order.status === "fulfilled") {
      action = '<div class="admin-delivery-sent"><span>Dados registrados como enviados em ' + escapeHtml(dateTime(order.fulfilledAt || order.updatedAt)) + '</span><pre>' + escapeHtml(order.deliveryData || "") + '</pre><button type="button" class="button button-secondary" data-admin-resend-email data-delivery-email="' + escapeHtml(order.deliveryEmail) + '" data-product-name="' + escapeHtml(order.productName) + '">' + icon("delivery") + " Abrir e-mail novamente</button></div>";
    } else {
      action = '<div class="admin-delivery-refunded">O valor foi devolvido à carteira do cliente.' + (order.adminNote ? '<small>' + escapeHtml(order.adminNote) + "</small>" : "") + "</div>";
    }
    return '<article class="admin-delivery-card ' + status.className + '"><div class="admin-delivery-head"><div><small>PEDIDO #' + escapeHtml(String(order.id || "").slice(0, 8).toUpperCase()) + '</small><h2>' + escapeHtml(order.productName) + '</h2></div><span class="' + status.className + '">' + status.label + "</span></div>" + summary + action + "</article>";
  }

  async function loadDeliveries() {
    const host = app && app.querySelector("[data-admin-deliveries-list]");
    if (!host) return;
    try {
      const orders = await api("/admin/subscription-orders");
      pendingDeliveries = Array.isArray(orders) ? orders.filter(function (order) { return order.status === "pending"; }).length : 0;
      host.innerHTML = Array.isArray(orders) && orders.length
        ? orders.map(deliveryCard).join("")
        : '<div class="card empty-state"><div class="empty-icon">' + icon("delivery") + '</div><h3>Nenhum pedido de assinatura</h3><p>As compras feitas pelos clientes aparecerão nesta aba.</p></div>';
      const count = app.querySelector("[data-admin-delivery-count]");
      if (count) count.textContent = pendingDeliveries + " pendente" + (pendingDeliveries === 1 ? "" : "s");
      appendNav("deliveries");
    } catch (error) {
      host.innerHTML = '<div class="card empty-state"><h3>Não foi possível carregar</h3><p>' + escapeHtml(error.message) + "</p></div>";
    }
  }

  function renderDeliveries() {
    setScreen("deliveries");
    applying = true;
    app.innerHTML = '<div class="app-shell admin-app-shell"><main class="page subscription-deliveries-page">' + adminTopbar() + '<section class="admin-dashboard-hero admin-delivery-hero"><span>ASSINATURAS</span><h1>Entregas</h1><p>Abra o e-mail informado pelo cliente, envie os dados da assinatura e confirme a entrega.</p><b data-admin-delivery-count>Carregando…</b></section><div class="admin-delivery-guide"><span><b>1</b> Cliente compra e informa o e-mail</span><span><b>2</b> Você envia os dados</span><span><b>3</b> Confirma a entrega</span></div><div class="admin-deliveries-list" data-admin-deliveries-list><div class="card feature-loading">Carregando pedidos de assinatura…</div></div></main></div>';
    appendNav("deliveries");
    window.scrollTo(0, 0);
    applying = false;
    loadDeliveries();
  }

  function emailLink(email, product, data) {
    const subject = "Sua assinatura " + product + " — Tw Store";
    const body = "Olá!\n\nSeu pedido de " + product + " foi preparado pela Tw Store.\n\nDados da assinatura:\n" + data + "\n\nGuarde estas informações em segurança.\n\nTw Store";
    return "mailto:" + String(email || "") + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  }

  function syntheticClick(attribute) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute(attribute, "true");
    button.style.display = "none";
    document.body.appendChild(button);
    button.click();
    button.remove();
  }

  function openReports() {
    setScreen("reports");
    syntheticClick("data-report-open");
    setTimeout(function () { appendNav("reports"); }, 0);
  }

  function openSupport() {
    setScreen("support");
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.dataset.featureAction = "admin-tickets";
    trigger.style.display = "none";
    document.body.appendChild(trigger);
    trigger.click();
    trigger.remove();
    setTimeout(function () { appendNav("support"); }, 0);
  }

  function openSettings() {
    setScreen("settings");
    syntheticClick("data-report-admin-settings-entry");
    setTimeout(function () { enhanceAdminSettings(); appendNav("settings"); }, 0);
  }

  function enhanceAdminSettings() {
    if (!app || !isAdmin()) return;
    const heading = Array.from(app.querySelectorAll("h1")).find(function (node) { return /^ajustes$/i.test((node.textContent || "").trim()); });
    if (!heading) return;
    const back = app.querySelector("[data-report-admin-back]");
    if (back) back.style.display = "none";
    const menu = app.querySelector(".report-admin-settings-menu");
    if (menu && !menu.querySelector("[data-admin-support-shortcut]")) {
      const support = document.createElement("button");
      support.type = "button";
      support.className = "feature-option";
      support.setAttribute("data-admin-support-shortcut", "true");
      support.innerHTML = '<span class="feature-option-icon">' + icon("support") + '</span><span class="feature-option-copy"><strong>Suporte</strong><small>Abra os tickets enviados pelos clientes</small></span><span class="feature-option-arrow">' + icon("arrow") + '</span>';
      menu.prepend(support);
    }
    const main = heading.closest("main");
    if (main && !main.querySelector("[data-admin-logout-settings]")) {
      const logout = document.createElement("button");
      logout.type = "button";
      logout.className = "button button-danger mt-16";
      logout.setAttribute("data-action", "logout");
      logout.setAttribute("data-admin-logout-settings", "true");
      logout.textContent = "Sair da administração";
      main.appendChild(logout);
    }
  }

  function identifySpecialScreen() {
    if (!app || !isAdmin()) return null;
    if (app.querySelector(".subscription-deliveries-page")) return "deliveries";
    if (app.querySelector(".report-page")) return "reports";
    const h1s = Array.from(app.querySelectorAll("h1")).map(function (node) { return (node.textContent || "").trim().toLowerCase(); });
    if (h1s.some(function (text) { return text === "ajustes"; })) return "settings";
    if (h1s.some(function (text) { return /tickets de suporte|atendimento/.test(text); }) || app.querySelector("[data-feature-form='admin-reply']")) return "support";
    return null;
  }

  function routeAfterBaseRender() {
    if (!isAdmin() || applying || !app) return;
    const special = identifySpecialScreen();
    if (special) {
      if (screen() !== special && ["deliveries", "reports", "support", "settings"].includes(special)) setScreen(special);
      if (special === "settings") enhanceAdminSettings();
      appendNav(special);
      return;
    }

    const main = app.querySelector(".app-shell > main.page");
    const isBaseAdmin = Boolean(main && Array.from(main.querySelectorAll("h1")).some(function (node) { return /painel administrativo/i.test(node.textContent || ""); }));
    if (!isBaseAdmin) return;
    captureCatalog();
    const desired = screen();
    if (desired === "catalog") return renderCatalog();
    if (desired === "deliveries") return renderDeliveries();
    if (desired === "reports") return openReports();
    if (desired === "support") return openSupport();
    if (desired === "settings") return openSettings();
    renderHome();
  }

  document.addEventListener("submit", async function (event) {
    const form = event.target.closest("[data-admin-delivery-form]");
    if (!form || !isAdmin()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (form.dataset.emailOpened !== "true" && !window.confirm("Você já enviou os dados para o e-mail do cliente?")) return;
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      await api("/admin/subscription-orders/" + encodeURIComponent(form.dataset.orderId) + "/fulfill", {
        method: "PATCH",
        body: {
          deliveryData: form.elements.deliveryData.value,
          adminNote: form.elements.adminNote.value || "",
        },
      });
      notify("Entrega confirmada no pedido do cliente.");
      await loadDeliveries();
    } catch (error) {
      notify(error.message, true);
    } finally {
      if (button && document.body.contains(button)) button.disabled = false;
    }
  }, true);

  document.addEventListener("click", async function (event) {
    const nav = event.target.closest("[data-admin-nav]");
    if (nav && isAdmin()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const target = nav.dataset.adminNav;
      if (target === "home") return renderHome();
      if (target === "catalog") return renderCatalog();
      if (target === "deliveries") return renderDeliveries();
      if (target === "reports") return openReports();
      if (target === "support") return openSupport();
      if (target === "settings") return openSettings();
    }

    const openEmail = event.target.closest("[data-admin-open-email]");
    if (openEmail && isAdmin()) {
      event.preventDefault();
      const form = openEmail.closest("[data-admin-delivery-form]");
      const data = String(form?.elements.deliveryData.value || "").trim();
      if (!data) {
        notify("Preencha os dados da assinatura antes de abrir o e-mail.", true);
        form?.elements.deliveryData.focus();
        return;
      }
      form.dataset.emailOpened = "true";
      window.location.href = emailLink(form.dataset.deliveryEmail, form.dataset.productName, data);
      return;
    }

    const resend = event.target.closest("[data-admin-resend-email]");
    if (resend && isAdmin()) {
      event.preventDefault();
      const data = resend.closest(".admin-delivery-card")?.querySelector("pre")?.textContent || "";
      window.location.href = emailLink(resend.dataset.deliveryEmail, resend.dataset.productName, data);
      return;
    }

    const refund = event.target.closest("[data-admin-refund-order]");
    if (refund && isAdmin()) {
      event.preventDefault();
      if (!window.confirm("Cancelar este pedido e devolver o valor para a carteira do cliente?")) return;
      refund.disabled = true;
      try {
        await api("/admin/subscription-orders/" + encodeURIComponent(refund.dataset.adminRefundOrder) + "/refund", {
          method: "PATCH",
          body: { adminNote: "Pedido cancelado e estornado pelo administrador." },
        });
        notify("Pedido cancelado e valor estornado.");
        await loadDeliveries();
      } catch (error) {
        notify(error.message, true);
      } finally {
        if (document.body.contains(refund)) refund.disabled = false;
      }
      return;
    }

    const refresh = event.target.closest("[data-admin-refresh]");
    if (refresh && isAdmin()) {
      event.preventDefault();
      renderHome();
      return;
    }

    const supportShortcut = event.target.closest("[data-admin-support-shortcut]");
    if (supportShortcut && isAdmin()) {
      event.preventDefault();
      openSupport();
      return;
    }

    const ticket = event.target.closest("[data-feature-action='admin-ticket-detail']");
    if (ticket && isAdmin()) setScreen("support");
  }, true);

  function scheduleAdminRoute() {
    if (!isAdmin() || applying) return;
    if (typeof runtime.schedule === "function") return runtime.schedule("admin-layout-v1", routeAfterBaseRender);
    setTimeout(routeAfterBaseRender, 16);
  }

  const observer = new MutationObserver(scheduleAdminRoute);

  if (app) observer.observe(app, { childList: true, subtree: true });
  scheduleAdminRoute();
})();
