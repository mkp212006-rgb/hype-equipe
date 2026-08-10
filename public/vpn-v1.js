(function () {
  "use strict";

  const SESSION_KEY = "tw-store.session.v3";
  const API_URL = "https://hype-equipe-production.up.railway.app";
  const app = document.getElementById("app");
  const toastRegion = document.getElementById("toast-region");
  const state = { adminLoading: false, memberLoading: false, products: [], orders: [] };

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
    const number = Number(value || 0);
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number.isFinite(number) ? number : 0);
  }

  function dateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
  }

  function toast(message, error) {
    if (!toastRegion) return;
    toastRegion.innerHTML = '<div class="toast ' + (error ? "error" : "") + '">' + escapeHtml(message) + "</div>";
    setTimeout(function () { toastRegion.innerHTML = ""; }, 4200);
  }

  async function api(path, options) {
    const current = session();
    if (!current || !current.token) throw new Error("Sua sessão expirou. Entre novamente.");
    const opts = options || {};
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 30000);
    try {
      const response = await fetch(API_URL + path, {
        method: opts.method || "GET",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer " + current.token,
          ...(opts.body ? { "Content-Type": "application/json" } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
      const raw = await response.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
      if (!response.ok) {
        const error = new Error(data.error || "Não foi possível concluir a solicitação.");
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("O servidor demorou demais para responder.");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function randomKey() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return "vpn-" + Date.now() + "-" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }

  function productCard(product) {
    return '<article class="vpn-product-card">' +
      '<div class="vpn-product-top"><div><span class="vpn-badge">VPN</span><h3>' + escapeHtml(product.name) + '</h3></div><strong>' + money(product.priceBRL) + '</strong></div>' +
      '<p>' + escapeHtml(product.description || "Acesso criado automaticamente após a compra.") + '</p>' +
      '<div class="vpn-product-meta"><span>' + escapeHtml(product.durationDays) + ' dias</span><span>' + escapeHtml(product.connectionLimit) + ' conexão' + (Number(product.connectionLimit) === 1 ? "" : "ões") + '</span><span>' + escapeHtml(String(product.accessType || "ssh").toUpperCase()) + '</span></div>' +
      '<button type="button" class="button button-primary vpn-buy-button" data-vpn-action="buy" data-product-id="' + escapeHtml(product.id) + '">Comprar acesso</button>' +
    '</article>';
  }

  function orderCard(order) {
    const active = order.status === "active";
    const refunded = order.status === "refunded";
    return '<article class="card vpn-access-card">' +
      '<div class="vpn-access-head"><div><span class="vpn-status ' + escapeHtml(order.status) + '">' + (active ? "ATIVO" : refunded ? "ESTORNADO" : escapeHtml(String(order.status || "PROCESSANDO").toUpperCase())) + '</span><h3>' + escapeHtml(order.productName || "Acesso VPN") + '</h3></div><strong>' + money(order.priceBRL) + '</strong></div>' +
      (active ? '<div class="vpn-credentials">' +
        '<div><span>Usuário</span><code>' + escapeHtml(order.login) + '</code><button type="button" data-vpn-copy="' + escapeHtml(order.login) + '">Copiar</button></div>' +
        '<div><span>Senha</span><code>' + escapeHtml(order.password) + '</code><button type="button" data-vpn-copy="' + escapeHtml(order.password) + '">Copiar</button></div>' +
        (order.uuid ? '<div><span>UUID</span><code>' + escapeHtml(order.uuid) + '</code><button type="button" data-vpn-copy="' + escapeHtml(order.uuid) + '">Copiar</button></div>' : '') +
      '</div>' : '') +
      '<div class="vpn-access-meta"><span>Tipo: ' + escapeHtml(String(order.accessType || "ssh").toUpperCase()) + '</span><span>Validade: ' + escapeHtml(order.providerExpiresText || dateTime(order.expiresAt)) + '</span><span>Comprado: ' + escapeHtml(dateTime(order.createdAt)) + '</span></div>' +
      (order.error ? '<p class="vpn-error-text">' + escapeHtml(order.error) + '</p>' : '') +
    '</article>';
  }

  async function injectMemberProducts() {
    const current = session();
    if (!current || current.role !== "member" || state.memberLoading) return;
    const activeNav = document.querySelector('[data-nav="new-order"].active');
    if (!activeNav || document.querySelector("[data-vpn-member-products]")) return;
    const heading = document.querySelector(".page-heading");
    if (!heading) return;
    const section = document.createElement("section");
    section.className = "card vpn-member-section";
    section.setAttribute("data-vpn-member-products", "true");
    section.innerHTML = '<div class="section-heading"><h2>Acessos VPN</h2></div><div class="vpn-loading">Carregando acessos…</div>';
    heading.insertAdjacentElement("afterend", section);
    state.memberLoading = true;
    try {
      state.products = await api("/api/vpn/products");
      if (!document.body.contains(section)) return;
      section.innerHTML = '<div class="vpn-section-title"><div><span class="vpn-badge">NOVA CATEGORIA</span><h2>Acessos VPN</h2><p>Compre um acesso e receba usuário e senha automaticamente.</p></div></div>' +
        (state.products.length ? '<div class="vpn-product-grid">' + state.products.map(productCard).join("") + '</div>' : '<div class="vpn-empty">Nenhum acesso VPN disponível no momento.</div>');
    } catch (error) {
      if (document.body.contains(section) && Number(error.status) !== 404) section.innerHTML = '<div class="vpn-empty">VPN indisponível: ' + escapeHtml(error.message) + '</div>';
      else if (document.body.contains(section)) section.remove();
    } finally {
      state.memberLoading = false;
    }
  }

  async function injectMemberHistory() {
    const current = session();
    if (!current || current.role !== "member") return;
    const activeNav = document.querySelector('[data-nav="orders"].active');
    if (!activeNav || document.querySelector("[data-vpn-member-history]")) return;
    const heading = document.querySelector(".page-heading");
    if (!heading) return;
    const section = document.createElement("section");
    section.className = "vpn-history-section";
    section.setAttribute("data-vpn-member-history", "true");
    section.innerHTML = '<div class="section-heading"><h2>Meus acessos VPN</h2></div><div class="card vpn-loading">Carregando acessos…</div>';
    heading.insertAdjacentElement("afterend", section);
    try {
      state.orders = await api("/api/vpn/orders");
      if (!document.body.contains(section)) return;
      section.innerHTML = '<div class="section-heading"><h2>Meus acessos VPN</h2><button type="button" data-vpn-action="refresh-history">Atualizar</button></div>' +
        (state.orders.length ? '<div class="vpn-access-list">' + state.orders.map(orderCard).join("") + '</div>' : '<div class="card vpn-empty">Você ainda não comprou um acesso VPN.</div>');
    } catch (error) {
      if (Number(error.status) === 404) section.remove();
      else section.innerHTML = '<div class="card vpn-empty">Não foi possível carregar os acessos VPN.</div>';
    }
  }

  function adminProductCard(product) {
    return '<article class="vpn-admin-product">' +
      '<div class="vpn-admin-product-head"><div><span class="vpn-badge">ID ' + escapeHtml(product.id) + '</span><strong>' + escapeHtml(product.name) + '</strong></div><button type="button" class="toggle-button ' + (product.enabled ? "enabled" : "") + '" data-vpn-action="toggle-product" data-product-id="' + escapeHtml(product.id) + '" data-enabled="' + (product.enabled ? "true" : "false") + '">' + (product.enabled ? "ATIVO" : "PAUSADO") + '</button></div>' +
      '<form class="form-stack vpn-admin-edit" data-vpn-form="edit-product" data-product-id="' + escapeHtml(product.id) + '">' +
        '<label class="field"><span class="field-label">Nome</span><input class="field-control" name="name" maxlength="90" value="' + escapeHtml(product.name) + '" required /></label>' +
        '<label class="field"><span class="field-label">Descrição</span><textarea class="field-control field-textarea" name="description" maxlength="500">' + escapeHtml(product.description || "") + '</textarea></label>' +
        '<div class="vpn-form-grid"><label class="field"><span class="field-label">Preço (R$)</span><input class="field-control" name="priceBRL" type="number" min="0.01" step="0.01" value="' + escapeHtml(Number(product.priceBRL).toFixed(2)) + '" required /></label>' +
        '<label class="field"><span class="field-label">Dias</span><input class="field-control" name="durationDays" type="number" min="1" max="365" value="' + escapeHtml(product.durationDays) + '" required /></label>' +
        '<label class="field"><span class="field-label">Conexões</span><input class="field-control" name="connectionLimit" type="number" min="1" max="50" value="' + escapeHtml(product.connectionLimit) + '" required /></label>' +
        '<label class="field"><span class="field-label">Tipo</span><select class="field-control" name="accessType"><option value="ssh" ' + (product.accessType === "ssh" ? "selected" : "") + '>SSH</option><option value="v2ray" ' + (product.accessType === "v2ray" ? "selected" : "") + '>V2Ray</option><option value="xray" ' + (product.accessType === "xray" ? "selected" : "") + '>XRay</option></select></label></div>' +
        '<div class="vpn-admin-actions"><button class="button button-primary button-small" type="submit">Salvar</button><button class="button button-danger button-small" type="button" data-vpn-action="delete-product" data-product-id="' + escapeHtml(product.id) + '">Remover</button></div>' +
      '</form>' +
    '</article>';
  }

  async function loadAdminSection(section) {
    if (state.adminLoading) return;
    state.adminLoading = true;
    try {
      const results = await Promise.all([api("/admin/vpn/status"), api("/admin/vpn/products")]);
      const status = results[0];
      const products = results[1];
      if (!document.body.contains(section)) return;
      section.innerHTML = '<div class="vpn-admin-heading"><div><span class="vpn-badge">SERVIÇO AUTOMÁTICO</span><h2>Categoria VPN</h2><p>Crie acessos com validade automática. A chave da API fica somente no servidor.</p></div><span class="vpn-provider-state ' + (status.configured ? "ok" : "off") + '">' + (status.configured ? "API CONFIGURADA" : "CONFIGURE A API") + '</span></div>' +
        '<div class="vpn-admin-metrics"><span><strong>' + escapeHtml(status.enabledProducts) + '</strong> ativos</span><span><strong>' + escapeHtml(status.activeOrders) + '</strong> acessos criados</span></div>' +
        '<details class="vpn-create-details" open><summary>Adicionar serviço VPN</summary><form class="form-stack" data-vpn-form="create-product">' +
          '<label class="field"><span class="field-label">Nome do serviço</span><input class="field-control" name="name" maxlength="90" value="VPN 30 dias" required /></label>' +
          '<label class="field"><span class="field-label">Descrição</span><textarea class="field-control field-textarea" name="description" maxlength="500" placeholder="Ex.: Acesso VPN individual por 30 dias"></textarea></label>' +
          '<div class="vpn-form-grid"><label class="field"><span class="field-label">Preço (R$)</span><input class="field-control" name="priceBRL" type="number" min="0.01" step="0.01" placeholder="Ex.: 25,00" required /></label>' +
          '<label class="field"><span class="field-label">Validade</span><input class="field-control" name="durationDays" type="number" min="1" max="365" value="30" required /></label>' +
          '<label class="field"><span class="field-label">Conexões</span><input class="field-control" name="connectionLimit" type="number" min="1" max="50" value="1" required /></label>' +
          '<label class="field"><span class="field-label">Tipo</span><select class="field-control" name="accessType"><option value="ssh">SSH</option><option value="v2ray">V2Ray</option><option value="xray">XRay</option></select></label></div>' +
          '<button class="button button-primary" type="submit">Adicionar serviço VPN</button></form></details>' +
        '<div class="vpn-admin-list">' + (products.length ? products.map(adminProductCard).join("") : '<div class="vpn-empty">Nenhum serviço VPN cadastrado.</div>') + '</div>';
    } catch (error) {
      if (Number(error.status) === 404) {
        section.remove();
      } else if (document.body.contains(section)) {
        section.innerHTML = '<div class="vpn-empty">Não foi possível carregar a categoria VPN: ' + escapeHtml(error.message) + '</div>';
      }
    } finally {
      state.adminLoading = false;
    }
  }

  function injectAdmin() {
    const current = session();
    if (!current || current.role !== "admin") return;
    if (document.querySelector("[data-vpn-admin]")) return;
    const heading = Array.from(document.querySelectorAll("h1")).find(function (node) { return /painel administrativo/i.test(node.textContent || ""); });
    const metrics = document.querySelector(".metrics");
    if (!heading || !metrics) return;
    const section = document.createElement("section");
    section.className = "card vpn-admin-section";
    section.setAttribute("data-vpn-admin", "true");
    section.innerHTML = '<div class="vpn-loading">Carregando categoria VPN…</div>';
    metrics.insertAdjacentElement("afterend", section);
    loadAdminSection(section);
  }

  async function buyProduct(productId, button) {
    if (!window.confirm("Confirmar a compra deste acesso VPN? O valor será descontado da sua carteira.")) return;
    const original = button.innerHTML;
    button.disabled = true;
    button.textContent = "Criando acesso…";
    try {
      const order = await api("/api/vpn/orders", { method: "POST", body: { productId: Number(productId), idempotencyKey: randomKey() } });
      toast("Acesso VPN criado com sucesso.");
      const section = document.querySelector("[data-vpn-member-products]");
      if (section) {
        const result = document.createElement("div");
        result.className = "vpn-success-panel";
        result.innerHTML = '<h3>Acesso criado</h3><p>Salve estas credenciais.</p>' + orderCard(order) + '<button type="button" class="button button-secondary" data-vpn-action="reload-app">Atualizar carteira</button>';
        section.insertAdjacentElement("afterend", result);
        result.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } catch (error) {
      toast(error.message, true);
    } finally {
      if (document.body.contains(button)) { button.disabled = false; button.innerHTML = original; }
    }
  }

  document.addEventListener("submit", async function (event) {
    const form = event.target.closest("[data-vpn-form]");
    if (!form) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const submit = form.querySelector('button[type="submit"]');
    const original = submit ? submit.innerHTML : "";
    if (submit) { submit.disabled = true; submit.textContent = "Salvando…"; }
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      const body = {
        name: values.name,
        description: values.description || "",
        priceBRL: Number(String(values.priceBRL || "").replace(",", ".")),
        durationDays: Number(values.durationDays || 30),
        connectionLimit: Number(values.connectionLimit || 1),
        accessType: values.accessType || "ssh",
      };
      if (form.dataset.vpnForm === "create-product") {
        await api("/admin/vpn/products", { method: "POST", body: body });
        toast("Serviço VPN adicionado.");
        form.reset();
      } else if (form.dataset.vpnForm === "edit-product") {
        await api("/admin/vpn/products/" + encodeURIComponent(form.dataset.productId), { method: "PATCH", body: body });
        toast("Serviço VPN atualizado.");
      }
      const section = document.querySelector("[data-vpn-admin]");
      if (section) { state.adminLoading = false; await loadAdminSection(section); }
    } catch (error) {
      toast(error.message, true);
    } finally {
      if (submit && document.body.contains(submit)) { submit.disabled = false; submit.innerHTML = original; }
    }
  }, true);

  document.addEventListener("click", async function (event) {
    const copyButton = event.target.closest("[data-vpn-copy]");
    if (copyButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      try {
        await navigator.clipboard.writeText(copyButton.dataset.vpnCopy || "");
        toast("Copiado.");
      } catch { toast("Não foi possível copiar automaticamente.", true); }
      return;
    }

    const button = event.target.closest("[data-vpn-action]");
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const action = button.dataset.vpnAction;
    try {
      if (action === "buy") return buyProduct(button.dataset.productId, button);
      if (action === "reload-app") { window.location.reload(); return; }
      if (action === "refresh-history") {
        const section = document.querySelector("[data-vpn-member-history]");
        if (section) section.remove();
        return injectMemberHistory();
      }
      if (action === "toggle-product") {
        const enabled = button.dataset.enabled === "true";
        await api("/admin/vpn/products/" + encodeURIComponent(button.dataset.productId), { method: "PATCH", body: { enabled: !enabled } });
        toast(enabled ? "Serviço VPN pausado." : "Serviço VPN ativado.");
      } else if (action === "delete-product") {
        if (!window.confirm("Remover este serviço VPN? Se já houve vendas, ele será apenas desativado.")) return;
        await api("/admin/vpn/products/" + encodeURIComponent(button.dataset.productId), { method: "DELETE" });
        toast("Serviço VPN removido/desativado.");
      }
      const section = document.querySelector("[data-vpn-admin]");
      if (section) { state.adminLoading = false; await loadAdminSection(section); }
    } catch (error) {
      toast(error.message, true);
    }
  }, true);

  const observer = new MutationObserver(function () {
    injectAdmin();
    injectMemberProducts();
    injectMemberHistory();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  injectAdmin();
  injectMemberProducts();
  injectMemberHistory();
})();
