(function () {
  "use strict";

  const SESSION_KEY = "tw-store.session.v3";
  const runtime = window.TW_STORE_CONFIG || {};
  const API_URL = runtime.apiBaseUrl || "https://tw-store-application.up.railway.app";
  const REQUEST_TIMEOUT_MS = Number(runtime.requestTimeoutMs) || 15_000;
  const WHATSAPP_URL = "https://wa.me/5512983087742";
  const app = document.getElementById("app");
  let reportOpen = false;
  let adminSettingsOpen = false;
  let loading = false;

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
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

  function shortDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  }

  function reportSvg() {
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V10M12 20V4M19 20v-7"/><path d="M3 20h18"/></svg>';
  }

  function whatsappSvg() {
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 11.6a8.5 8.5 0 0 1-12.5 7.5L3 20.5l1.4-4.8A8.5 8.5 0 1 1 20.5 11.6Z"/><path d="M8.2 7.8c.3-.6.7-.6 1-.2l1 1.8c.2.4.1.7-.2 1l-.6.7c.7 1.4 1.8 2.5 3.3 3.2l.7-.8c.3-.3.6-.4 1-.2l1.8.9c.5.2.6.6.4 1.1-.4 1.1-1.4 1.7-2.5 1.6-3.8-.4-7-3.3-7.7-7-.2-.8.1-1.5.8-2.1Z"/></svg>';
  }

  function chevronSvg() {
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
  }

  async function api(path) {
    const current = session();
    if (!current?.token || !["member", "admin"].includes(current.role)) throw new Error("Entre na sua conta para visualizar os relatórios.");
    const controller = new AbortController();
    const timeout = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(API_URL + path, {
        headers: { Accept: "application/json", Authorization: "Bearer " + current.token },
        signal: controller.signal,
        cache: "no-store",
        credentials: "same-origin",
      });
      const raw = await response.text();
      let payload = {};
      try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar o relatório.");
      return payload;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("O servidor demorou demais para responder.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function trophy(position) {
    return position === 1 ? "🥇" : position === 2 ? "🥈" : "🥉";
  }

  function ranking(period) {
    const users = Array.isArray(period?.topUsers) ? period.topUsers : [];
    if (!users.length) return '<div class="report-empty">Nenhum gasto registrado neste período.</div>';
    return '<div class="report-ranking">' + users.map(function (user) {
      return '<article class="report-rank-item report-rank-' + escapeHtml(user.position) + '">' +
        '<div class="report-medal">' + trophy(Number(user.position)) + '</div>' +
        '<div class="report-user"><strong>' + escapeHtml(user.name || user.username) + '</strong><span>@' + escapeHtml(user.username) + ' • ' + escapeHtml(user.purchases) + ' compra(s)</span></div>' +
        '<strong class="report-rank-money">' + escapeHtml(money(user.spentBRL)) + '</strong>' +
      '</article>';
    }).join("") + '</div>';
  }

  function periodCard(title, period, subtitle, isAdmin) {
    return '<section class="card report-period-card">' +
      '<div class="report-period-heading"><div><span class="report-kicker">' + escapeHtml(subtitle) + '</span><h2>' + escapeHtml(title) + '</h2></div><span class="report-date">' + escapeHtml(shortDate(period.startAt)) + ' – ' + escapeHtml(shortDate(period.endAt)) + '</span></div>' +
      '<div class="report-main-value"><span>Total utilizado</span><strong>' + escapeHtml(money(period.spentBRL)) + '</strong><small>' + escapeHtml(period.purchases) + ' compra(s) contabilizada(s)</small></div>' +
      '<div class="report-breakdown"><div><span>Serviços SMM</span><strong>' + escapeHtml(money(period.smmBRL)) + '</strong></div><div><span>Acessos VPN</span><strong>' + escapeHtml(money(period.vpnBRL)) + '</strong></div></div>' +
      (isAdmin ? '<div class="report-top-title"><strong>Top 3 usuários</strong><span>Quem mais utilizou saldo</span></div>' + ranking(period) : '') +
    '</section>';
  }

  function loadingView() {
    if (!app) return;
    app.innerHTML = '<main class="page report-page"><div class="report-toolbar"><button type="button" class="report-back" data-report-back>← Voltar</button><span>Relatórios</span></div><section class="card report-loading"><div class="spinner"></div><p>Calculando gastos da semana e do mês…</p></section></main>';
  }

  function errorView(message) {
    if (!app) return;
    app.innerHTML = '<main class="page report-page"><div class="report-toolbar"><button type="button" class="report-back" data-report-back>← Voltar</button><span>Relatórios</span></div><section class="card report-error"><h2>Não foi possível gerar o relatório</h2><p>' + escapeHtml(message) + '</p><button class="button button-primary" type="button" data-report-refresh>Tentar novamente</button></section></main>';
  }

  function renderReport(data) {
    if (!app) return;
    const current = session();
    const isAdmin = current?.role === "admin";
    app.innerHTML = '<main class="page report-page">' +
      '<div class="report-toolbar"><button type="button" class="report-back" data-report-back>← Voltar</button><span>Relatórios financeiros</span><button type="button" class="report-refresh" data-report-refresh>Atualizar</button></div>' +
      '<section class="report-hero"><span class="report-eyebrow">' + (isAdmin ? 'PAINEL ADMINISTRATIVO' : 'MINHA CONTA') + '</span><h1>' + (isAdmin ? 'Uso de saldo' : 'Meus gastos') + '</h1><p>' + (isAdmin ? 'Acompanhe quanto foi realmente utilizado no aplicativo. Pedidos estornados não entram no cálculo.' : 'Veja quanto você utilizou nesta semana e neste mês. Somente os gastos da sua própria conta aparecem aqui.') + '</p></section>' +
      '<div class="report-periods">' + periodCard("Esta semana", data.week || {}, "SEMANAL", isAdmin) + periodCard("Este mês", data.month || {}, "MENSAL", isAdmin) + '</div>' +
      '<p class="report-generated">Atualizado em ' + escapeHtml(new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(data.generatedAt))) + ' • horário de Brasília</p>' +
    '</main>';
  }

  async function openReport() {
    if (loading) return;
    const current = session();
    if (!current) return;
    reportOpen = true;
    loading = true;
    loadingView();
    try {
      const endpoint = current.role === "admin" ? "/admin/reports/spending" : "/api/reports/spending";
      renderReport(await api(endpoint));
    } catch (error) {
      errorView(error.message);
    } finally {
      loading = false;
    }
  }

  function adminTopbar() {
    const current = session() || {};
    const initial = String(current.username || "A").trim().charAt(0).toUpperCase();
    return '<header class="topbar"><div><div class="eyebrow">Configurações</div><div class="brand-name">Tw Store</div></div><div class="avatar">' + escapeHtml(initial) + '</div></header>';
  }

  function renderAdminSettings() {
    if (!app) return;
    adminSettingsOpen = true;
    reportOpen = false;
    app.innerHTML = '<div class="app-shell no-nav"><main class="page feature-page">' +
      adminTopbar() +
      '<section class="feature-back-heading"><button type="button" class="feature-back-button" data-report-admin-back>←</button><div><h1>Ajustes</h1><p>Configurações e relatórios administrativos.</p></div></section>' +
      '<section class="feature-menu report-admin-settings-menu">' +
        '<button class="feature-option feature-option-whatsapp" type="button" data-report-whatsapp><span class="feature-option-icon">' + whatsappSvg() + '</span><span class="feature-option-copy"><strong>WhatsApp</strong><small>Fale diretamente com o responsável pelo aplicativo</small></span><span class="feature-option-arrow">' + chevronSvg() + '</span></button>' +
        '<button class="feature-option report-settings-option" type="button" data-report-open><span class="feature-option-icon">' + reportSvg() + '</span><span class="feature-option-copy"><strong>Relatório Semanal / Mensal</strong><small>Total utilizado, SMM, VPN e Top 3 usuários</small></span><span class="feature-option-arrow">' + chevronSvg() + '</span></button>' +
      '</section>' +
    '</main></div>';
    window.scrollTo(0, 0);
  }

  function injectMemberEntry() {
    if (reportOpen || adminSettingsOpen || !app) return;
    const current = session();
    if (!current || current.role !== "member") return;
    if (document.querySelector("[data-report-entry]")) return;
    const whatsapp = document.querySelector('.feature-option-whatsapp[data-feature-action="whatsapp"]');
    if (!whatsapp) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "feature-option report-settings-option";
    button.setAttribute("data-report-entry", "true");
    button.setAttribute("data-report-open", "true");
    button.innerHTML = '<span class="feature-option-icon">' + reportSvg() + '</span><span class="feature-option-copy"><strong>Relatório Semanal / Mensal</strong><small>Veja quanto você utilizou nesta semana e neste mês</small></span><span class="feature-option-arrow">' + chevronSvg() + '</span>';
    whatsapp.insertAdjacentElement("afterend", button);
  }

  function injectAdminSettingsEntry() {
    if (reportOpen || adminSettingsOpen || !app) return;
    const current = session();
    if (!current || current.role !== "admin") return;
    if (document.querySelector("[data-report-admin-settings-entry]")) return;
    const logout = document.querySelector('.button-danger[data-action="logout"]');
    if (!logout) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-secondary mt-16 report-admin-settings-entry";
    button.setAttribute("data-report-admin-settings-entry", "true");
    button.textContent = "⚙ Ajustes";
    logout.insertAdjacentElement("beforebegin", button);
  }

  document.addEventListener("click", function (event) {
    const open = event.target.closest("[data-report-open]");
    if (open) { event.preventDefault(); event.stopImmediatePropagation(); openReport(); return; }

    const refresh = event.target.closest("[data-report-refresh]");
    if (refresh) { event.preventDefault(); openReport(); return; }

    const adminSettings = event.target.closest("[data-report-admin-settings-entry]");
    if (adminSettings) { event.preventDefault(); renderAdminSettings(); return; }

    const adminBack = event.target.closest("[data-report-admin-back]");
    if (adminBack) { event.preventDefault(); adminSettingsOpen = false; window.location.reload(); return; }

    const whatsapp = event.target.closest("[data-report-whatsapp]");
    if (whatsapp) { event.preventDefault(); window.location.href = WHATSAPP_URL; return; }

    const back = event.target.closest("[data-report-back]");
    if (back) {
      event.preventDefault();
      reportOpen = false;
      const current = session();
      if (current?.role === "admin") return renderAdminSettings();
      sessionStorage.setItem("tw-store.return-to-settings", "1");
      window.location.reload();
    }
  }, true);

  function restoreMemberSettings() {
    const current = session();
    if (!current || current.role !== "member") return;
    if (sessionStorage.getItem("tw-store.return-to-settings") !== "1") return;
    const settingsButton = document.querySelector('[data-nav="settings"]');
    if (!settingsButton) return;
    sessionStorage.removeItem("tw-store.return-to-settings");
    settingsButton.click();
  }

  function syncReportEntries() {
    injectMemberEntry();
    injectAdminSettingsEntry();
    restoreMemberSettings();
  }

  function scheduleReportEntries() {
    if (typeof runtime.schedule === "function") return runtime.schedule("reports-v1", syncReportEntries);
    setTimeout(syncReportEntries, 16);
  }

  const observer = new MutationObserver(scheduleReportEntries);
  if (app) observer.observe(app, { childList: true, subtree: true });
  syncReportEntries();
})();
