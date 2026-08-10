(function () {
  "use strict";

  const SESSION_KEY = "tw-store.session.v3";
  const API_URL = "https://hype-equipe-production.up.railway.app";
  const app = document.getElementById("app");
  const toastRegion = document.getElementById("toast-region");
  const state = { memberLoading: false, adminLoading: false, products: [], orders: [], providerStatus: null };

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

  function productCategory(product) {
    return String(product && product.categoryName || "Sem categoria");
  }

  function productCard(product) {
    return '<article class="vpn-product-card">' +
      '<div class="vpn-product-top"><div><span class="vpn-badge">' + escapeHtml(productCategory(product)) + '</span><h3>' + escapeHtml(product.name) + '</h3></div><strong>' + money(product.priceBRL) + '</strong></div>' +
      '<p>' + escapeHtml(product.description || "Acesso criado automaticamente após a compra.") + '</p>' +
      '<div class="vpn-product-meta"><span>VPN</span><span>' + escapeHtml(product.durationDays) + ' dias</span><span>' + escapeHtml(product.connectionLimit) + ' conexão' + (Number(product.connectionLimit) === 1 ? "" : "ões") + '</span><span>' + escapeHtml(String(product.accessType || "ssh").toUpperCase()) + '</span></div>' +
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
    section.innerHTML = '<div class="section-heading"><h2>Serviços VPN</h2></div><div class="vpn-loading">Carregando serviços…</div>';
    heading.insertAdjacentElement("afterend", section);
    state.memberLoading = true;
    try {
      state.products = await api("/api/vpn/products");
      if (!document.body.contains(section)) return;
      section.innerHTML = '<div class="vpn-section-title"><div><span class="vpn-badge">MESMAS CATEGORIAS DO CATÁLOGO</span><h2>Serviços VPN</h2><p>Os acessos VPN usam as categorias criadas pelo administrador.</p></div></div>' +
        (state.products.length ? '<div class="vpn-product-grid">' + state.products.map(productCard).join("") + '</div>' : '<div class="vpn-empty">Nenhum serviço VPN disponível no momento.</div>');
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

  function getCategoryOptions(selectedId) {
    const source = document.querySelector('[data-form="add-service"] select[name="categoryId"]');
    if (!source) return '<option value="">Sem categoria</option>';
    return Array.from(source.options).map(function (option) {
      const value = String(option.value || "");
      return '<option value="' + escapeHtml(value) + '" ' + (String(selectedId == null ? "" : selectedId) === value ? "selected" : "") + '>' + escapeHtml(option.textContent || "Sem categoria") + '</option>';
    }).join("");
  }

  function providerStatusText() {
    if (!state.providerStatus) return "A configuração da API VPN é validada no servidor.";
    return state.providerStatus.configured
      ? "API VPN configurada no servidor. A chave não fica salva no aplicativo."
      : "API VPN ainda não configurada no servidor.";
  }

  function vpnAdminProductCard(product) {
    return '<article class="card service-card vpn-catalog-product" data-vpn-product-card="' + escapeHtml(product.id) + '">' +
      '<div class="service-head"><span class="id-pill">VPN #' + escapeHtml(product.id) + '</span><button type="button" class="toggle-button ' + (product.enabled ? "enabled" : "") + '" data-vpn-action="toggle-product" data-product-id="' + escapeHtml(product.id) + '" data-enabled="' + (product.enabled ? "true" : "false") + '">' + (product.enabled ? "ATIVO" : "PAUSADO") + '</button></div>' +
      '<div class="service-title mt-12">' + escapeHtml(product.name) + '</div>' +
      '<div class="service-meta">' + escapeHtml(productCategory(product)) + ' • VPN ' + escapeHtml(String(product.accessType || "ssh").toUpperCase()) + '<br>Preço fixo: ' + money(product.priceBRL) + ' • ' + escapeHtml(product.durationDays) + ' dias • ' + escapeHtml(product.connectionLimit) + ' conexão' + (Number(product.connectionLimit) === 1 ? "" : "ões") + '</div>' +
      '<form class="service-edit-form" data-vpn-form="edit-product" data-product-id="' + escapeHtml(product.id) + '">' +
        '<label class="field"><span class="field-label">Nome personalizado</span><input class="field-control" name="name" maxlength="90" value="' + escapeHtml(product.name) + '" required /></label>' +
        '<label class="field"><span class="field-label">Descrição</span><textarea class="field-control field-textarea" name="description" maxlength="500">' + escapeHtml(product.description || "") + '</textarea></label>' +
        '<label class="field"><span class="field-label">Categoria</span><select class="field-control" name="categoryId">' + getCategoryOptions(product.categoryId) + '</select></label>' +
        '<div class="vpn-form-grid"><label class="field"><span class="field-label">Preço fixo (R$)</span><input class="field-control" name="priceBRL" type="number" min="0.01" step="0.01" value="' + escapeHtml(Number(product.priceBRL).toFixed(2)) + '" required /></label>' +
        '<label class="field"><span class="field-label">Validade</span><input class="field-control" name="durationDays" type="number" min="1" max="365" value="' + escapeHtml(product.durationDays) + '" required /></label>' +
        '<label class="field"><span class="field-label">Conexões</span><input class="field-control" name="connectionLimit" type="number" min="1" max="50" value="' + escapeHtml(product.connectionLimit) + '" required /></label>' +
        '<label class="field"><span class="field-label">Protocolo</span><select class="field-control" name="accessType"><option value="ssh" ' + (product.accessType === "ssh" ? "selected" : "") + '>SSH</option><option value="v2ray" ' + (product.accessType === "v2ray" ? "selected" : "") + '>V2Ray</option><option value="xray" ' + (product.accessType === "xray" ? "selected" : "") + '>XRay</option></select></label></div>' +
        '<div class="vpn-admin-actions"><button type="submit" class="button button-primary button-small">Salvar alterações</button><button type="button" class="button button-danger button-small" data-vpn-action="delete-product" data-product-id="' + escapeHtml(product.id) + '">Remover</button></div>' +
      '</form>' +
    '</article>';
  }

  function updateCategoryCounts() {
    const rows = Array.from(document.querySelectorAll(".category-list .category-row"));
    rows.forEach(function (row) {
      const strong = row.querySelector("strong");
      const countNode = row.querySelector("span");
      if (!strong || !countNode) return;
      if (!row.dataset.vpnBaseCount) {
        const found = String(countNode.textContent || "").match(/\d+/);
        row.dataset.vpnBaseCount = found ? found[0] : "0";
      }
      const base = Number(row.dataset.vpnBaseCount || 0);
      const name = String(strong.textContent || "").trim().toLowerCase();
      const vpnCount = state.products.filter(function (item) { return productCategory(item).trim().toLowerCase() === name; }).length;
      const total = base + vpnCount;
      countNode.textContent = total + " serviço" + (total === 1 ? "" : "s");
    });
  }

  function injectAdminProductList() {
    const current = session();
    if (!current || current.role !== "admin") return;
    document.querySelectorAll("[data-vpn-product-card]").forEach(function (node) { node.remove(); });
    const headings = Array.from(document.querySelectorAll(".section-heading h2"));
    const title = headings.find(function (node) { return /produtos cadastrados/i.test(node.textContent || ""); });
    if (!title) return;
    const heading = title.closest(".section-heading");
    const originalNext = heading && heading.nextElementSibling;
    let list = originalNext && originalNext.classList.contains("service-list") ? originalNext : null;
    if (!list) {
      list = document.createElement("div");
      list.className = "service-list";
      list.setAttribute("data-vpn-created-list", "true");
      heading.insertAdjacentElement("afterend", list);
    }
    if (originalNext && originalNext.classList.contains("empty-state")) {
      originalNext.style.display = state.products.length ? "none" : "";
    }
    state.products.forEach(function (product) {
      const wrap = document.createElement("div");
      wrap.innerHTML = vpnAdminProductCard(product);
      list.appendChild(wrap.firstElementChild);
    });
    updateCategoryCounts();
  }

  async function refreshAdminProducts() {
    const current = session();
    if (!current || current.role !== "admin" || state.adminLoading) return;
    state.adminLoading = true;
    try {
      const results = await Promise.all([api("/admin/vpn/products"), api("/admin/vpn/status")]);
      state.products = Array.isArray(results[0]) ? results[0] : [];
      state.providerStatus = results[1] || null;
      injectAdminProductList();
      const note = document.querySelector("[data-vpn-provider-note]");
      if (note) note.textContent = providerStatusText();
    } catch (error) {
      if (Number(error.status) !== 404) console.warn("VPN admin unavailable", error);
    } finally {
      state.adminLoading = false;
    }
  }

  function setAddFormMode(form) {
    const mode = form.querySelector("[data-vpn-product-kind]")?.value || "smm";
    const serviceIdInput = form.querySelector('input[name="serviceId"]');
    const serviceIdField = serviceIdInput && serviceIdInput.closest(".field");
    const nameInput = form.querySelector('input[name="customName"]');
    const priceInput = form.querySelector('input[name="pricePerThousandBRL"]');
    const priceField = priceInput && priceInput.closest(".field");
    const priceLabel = priceField && priceField.querySelector(".field-label");
    const priceHelper = priceField && priceField.querySelector(".helper");
    const extras = form.querySelector("[data-vpn-extra-fields]");
    const submit = form.querySelector('button[type="submit"]');
    const vpn = mode === "vpn";

    if (serviceIdField) serviceIdField.style.display = vpn ? "none" : "";
    if (serviceIdInput) serviceIdInput.required = !vpn;
    if (nameInput) {
      nameInput.required = vpn;
      if (vpn && !String(nameInput.value || "").trim()) nameInput.value = "VPN 30 dias";
    }
    if (priceLabel) priceLabel.textContent = vpn ? "Preço fixo do acesso" : "Preço cobrado por 1.000";
    if (priceHelper) priceHelper.textContent = vpn ? "Valor total em Real cobrado por cada acesso VPN criado." : "Valor em Real brasileiro que o usuário pagará por cada 1.000 unidades.";
    if (extras) extras.style.display = vpn ? "grid" : "none";
    if (submit) submit.innerHTML = vpn ? "Adicionar produto VPN" : "Validar e adicionar";
  }

  function enhanceAdminAddForm() {
    const current = session();
    if (!current || current.role !== "admin") return;
    const form = document.querySelector('[data-form="add-service"]');
    if (!form || form.dataset.vpnEnhanced === "true") return;
    form.dataset.vpnEnhanced = "true";

    const typeField = document.createElement("label");
    typeField.className = "field vpn-kind-field";
    typeField.innerHTML = '<span class="field-label">Tipo do produto</span><select class="field-control" data-vpn-product-kind><option value="smm">Serviço SMM / redes sociais</option><option value="vpn">Acesso VPN automático</option></select><span class="helper">O VPN usa as mesmas categorias desta tela; não cria uma aba separada.</span>';
    form.prepend(typeField);

    const extras = document.createElement("div");
    extras.className = "vpn-form-grid vpn-add-extra-fields";
    extras.setAttribute("data-vpn-extra-fields", "true");
    extras.innerHTML = '<label class="field"><span class="field-label">Validade</span><input class="field-control" name="vpnDurationDays" type="number" min="1" max="365" value="30" /></label>' +
      '<label class="field"><span class="field-label">Conexões</span><input class="field-control" name="vpnConnectionLimit" type="number" min="1" max="50" value="1" /></label>' +
      '<label class="field"><span class="field-label">Protocolo</span><select class="field-control" name="vpnAccessType"><option value="ssh">SSH</option><option value="v2ray">V2Ray</option><option value="xray">XRay</option></select></label>' +
      '<div class="field vpn-provider-note"><span class="field-label">Automação</span><div class="smm-readonly-field" data-vpn-provider-note>' + escapeHtml(providerStatusText()) + '</div></div>';
    const priceInput = form.querySelector('input[name="pricePerThousandBRL"]');
    const priceField = priceInput && priceInput.closest(".field");
    if (priceField) priceField.insertAdjacentElement("afterend", extras); else form.appendChild(extras);

    form.querySelector("[data-vpn-product-kind]").addEventListener("change", function () { setAddFormMode(form); });
    setAddFormMode(form);
    refreshAdminProducts();
  }

  async function createVpnFromCatalogForm(form) {
    const submit = form.querySelector('button[type="submit"]');
    const original = submit ? submit.innerHTML : "";
    if (submit) { submit.disabled = true; submit.textContent = "Criando VPN…"; }
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      const price = Number(String(values.pricePerThousandBRL || "").replace(",", "."));
      if (!Number.isFinite(price) || price <= 0) throw new Error("Informe o preço fixo do acesso VPN.");
      const body = {
        name: String(values.customName || "").trim() || "VPN 30 dias",
        description: String(values.description || "").trim(),
        categoryId: values.categoryId ? Number(values.categoryId) : null,
        priceBRL: Number(price.toFixed(2)),
        durationDays: Number(values.vpnDurationDays || 30),
        connectionLimit: Number(values.vpnConnectionLimit || 1),
        accessType: values.vpnAccessType || "ssh",
      };
      await api("/admin/vpn/products", { method: "POST", body: body });
      toast("Produto VPN adicionado na categoria selecionada.");
      if (form.querySelector('input[name="customName"]')) form.querySelector('input[name="customName"]').value = "VPN 30 dias";
      if (form.querySelector('textarea[name="description"]')) form.querySelector('textarea[name="description"]').value = "";
      if (form.querySelector('input[name="pricePerThousandBRL"]')) form.querySelector('input[name="pricePerThousandBRL"]').value = "";
      await refreshAdminProducts();
    } catch (error) {
      toast(error.message, true);
    } finally {
      if (submit && document.body.contains(submit)) { submit.disabled = false; submit.innerHTML = original; setAddFormMode(form); }
    }
  }

  async function saveVpnProduct(form) {
    const submit = form.querySelector('button[type="submit"]');
    const original = submit ? submit.innerHTML : "";
    if (submit) { submit.disabled = true; submit.textContent = "Salvando…"; }
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      await api("/admin/vpn/products/" + encodeURIComponent(form.dataset.productId), {
        method: "PATCH",
        body: {
          name: values.name,
          description: values.description || "",
          categoryId: values.categoryId ? Number(values.categoryId) : null,
          priceBRL: Number(String(values.priceBRL || "").replace(",", ".")),
          durationDays: Number(values.durationDays || 30),
          connectionLimit: Number(values.connectionLimit || 1),
          accessType: values.accessType || "ssh",
        },
      });
      toast("Produto VPN atualizado.");
      await refreshAdminProducts();
    } catch (error) {
      toast(error.message, true);
    } finally {
      if (submit && document.body.contains(submit)) { submit.disabled = false; submit.innerHTML = original; }
    }
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

  document.addEventListener("submit", function (event) {
    const memberOrderForm = event.target.closest('[data-form="new-order"]');
    if (memberOrderForm) {
      const serviceSelect = memberOrderForm.querySelector("[data-order-service]");
      const product = serviceSelect ? vpnProductByServiceId(serviceSelect.value) : null;
      if (product) {
        event.preventDefault();
        event.stopImmediatePropagation();
        buyVpnFromCatalog(product, memberOrderForm.querySelector('button[type="submit"]'));
        return;
      }
    }
    const addForm = event.target.closest('[data-form="add-service"]');
    if (addForm && addForm.querySelector("[data-vpn-product-kind]")?.value === "vpn") {
      event.preventDefault();
      event.stopImmediatePropagation();
      createVpnFromCatalogForm(addForm);
      return;
    }
    const vpnForm = event.target.closest('[data-vpn-form="edit-product"]');
    if (vpnForm) {
      event.preventDefault();
      event.stopImmediatePropagation();
      saveVpnProduct(vpnForm);
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
        toast(enabled ? "Produto VPN pausado." : "Produto VPN ativado.");
      } else if (action === "delete-product") {
        if (!window.confirm("Remover este produto VPN? Se já houve vendas, ele será apenas desativado.")) return;
        await api("/admin/vpn/products/" + encodeURIComponent(button.dataset.productId), { method: "DELETE" });
        toast("Produto VPN removido/desativado.");
      }
      await refreshAdminProducts();
    } catch (error) {
      toast(error.message, true);
    }
  }, true);


  const VPN_SERVICE_BASE_ID = 900000000;

  function vpnPseudoServiceId(product) {
    return VPN_SERVICE_BASE_ID + Number(product && product.id || 0);
  }

  function isVpnPseudoServiceId(value) {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= VPN_SERVICE_BASE_ID;
  }

  function vpnProductByServiceId(value) {
    if (!isVpnPseudoServiceId(value)) return null;
    const productId = Number(value) - VPN_SERVICE_BASE_ID;
    return state.products.find(function (item) { return Number(item.id) === productId; }) || null;
  }

  async function ensureMemberVpnProductsLoaded() {
    const current = session();
    if (!current || current.role !== "member") return [];
    if (state.products.length) return state.products;
    if (state.memberLoading) return state.products;
    state.memberLoading = true;
    try {
      const data = await api("/api/vpn/products");
      state.products = Array.isArray(data) ? data : [];
      return state.products;
    } catch (error) {
      if (Number(error.status) !== 404) console.warn("VPN member catalog unavailable", error);
      state.products = [];
      return [];
    } finally {
      state.memberLoading = false;
    }
  }

  function memberVpnMatches(product, category, query) {
    if (productCategory(product) !== category) return false;
    if (!query) return true;
    const haystack = [product.name, product.description, productCategory(product), String(product.accessType || "ssh")]
      .join(" ")
      .toLocaleLowerCase("pt-BR");
    return haystack.includes(query);
  }

  function setFieldVisibility(field, visible) {
    if (!field) return;
    field.style.display = visible ? "" : "none";
  }

  function syncMemberVpnCatalog() {
    const current = session();
    if (!current || current.role !== "member") return;
    const activeNav = document.querySelector('[data-nav="new-order"].active');
    const form = document.querySelector('[data-form="new-order"]');
    if (!activeNav || !form) return;

    ensureMemberVpnProductsLoaded().then(function () {
      const categorySelect = form.querySelector("[data-order-category]");
      const serviceSelect = form.querySelector("[data-order-service]");
      const searchInput = form.querySelector("[data-order-search]");
      if (!categorySelect || !serviceSelect) return;

      const currentCategory = String(categorySelect.value || "");
      const query = String(searchInput && searchInput.value || "").trim().toLocaleLowerCase("pt-BR");
      const selectedValue = String(serviceSelect.value || "");

      Array.from(new Set(state.products.map(function (product) { return productCategory(product); }))).sort(function (a, b) {
        return String(a).localeCompare(String(b), "pt-BR");
      }).forEach(function (categoryName) {
        const exists = Array.from(categorySelect.options).some(function (option) { return String(option.value) === String(categoryName); });
        if (!exists) {
          const option = document.createElement("option");
          option.value = categoryName;
          option.textContent = categoryName;
          categorySelect.appendChild(option);
        }
      });

      const matches = state.products.filter(function (product) {
        return memberVpnMatches(product, currentCategory, query);
      });

      if (matches.length) {
        if (serviceSelect.options.length === 1 && serviceSelect.options[0] && serviceSelect.options[0].value === "") {
          serviceSelect.innerHTML = "";
        }
        const existingValues = new Set(Array.from(serviceSelect.options).map(function (option) { return String(option.value); }));
        matches.forEach(function (product) {
          const value = String(vpnPseudoServiceId(product));
          if (existingValues.has(value)) return;
          const option = document.createElement("option");
          option.value = value;
          option.textContent = "VPN - " + product.name;
          option.dataset.vpnProduct = String(product.id);
          serviceSelect.appendChild(option);
          existingValues.add(value);
        });
        serviceSelect.disabled = false;
        const hasSelected = Array.from(serviceSelect.options).some(function (option) { return String(option.value) === selectedValue; });
        if (selectedValue && hasSelected) serviceSelect.value = selectedValue;
      }

      updateMemberVpnSelection();
    });
  }

  function updateMemberVpnSelection() {
    const current = session();
    if (!current || current.role !== "member") return;
    const form = document.querySelector('[data-form="new-order"]');
    if (!form) return;

    const serviceSelect = form.querySelector("[data-order-service]");
    const product = serviceSelect ? vpnProductByServiceId(serviceSelect.value) : null;
    const linkInput = form.querySelector('input[name="link"]');
    const quantityInput = form.querySelector("[data-order-quantity]");
    const linkField = linkInput && linkInput.closest(".field");
    const quantityField = quantityInput && quantityInput.closest(".field");
    const averageTimeField = document.querySelector("[data-order-average-time]")?.closest(".field");
    const description = document.querySelector("[data-service-description]");
    const averageTime = document.querySelector("[data-order-average-time]");
    const helper = document.querySelector("[data-service-helper]");
    const preview = document.querySelector("[data-cost-preview]");
    const previewCaption = preview && preview.parentElement ? preview.parentElement.querySelector("span:last-child") : null;
    const submit = form.querySelector('button[type="submit"]');

    if (submit && !submit.dataset.vpnOriginalHtml) submit.dataset.vpnOriginalHtml = submit.innerHTML;
    if (linkInput && !linkInput.dataset.vpnOriginalRequired) linkInput.dataset.vpnOriginalRequired = linkInput.required ? "true" : "false";
    if (quantityInput && !quantityInput.dataset.vpnOriginalRequired) quantityInput.dataset.vpnOriginalRequired = quantityInput.required ? "true" : "false";

    if (!product) {
      setFieldVisibility(linkField, true);
      setFieldVisibility(quantityField, true);
      setFieldVisibility(averageTimeField, true);
      if (linkInput) {
        const currentLink = String(linkInput.value || "").trim();
        if (linkInput.dataset.vpnAutoLink === "true" || /^https:\/\/vpn\.local\/\d+\/?$/i.test(currentLink)) {
          linkInput.value = "";
          delete linkInput.dataset.vpnAutoLink;
        }
        linkInput.disabled = false;
        linkInput.required = linkInput.dataset.vpnOriginalRequired === "true";
      }
      if (quantityInput) {
        quantityInput.disabled = false;
        quantityInput.required = quantityInput.dataset.vpnOriginalRequired === "true";
      }
      if (submit && submit.dataset.vpnOriginalHtml) submit.innerHTML = submit.dataset.vpnOriginalHtml;
      if (previewCaption) previewCaption.textContent = "O valor continua sendo calculado automaticamente com a tarifa original do aplicativo.";
      return;
    }

    setFieldVisibility(linkField, false);
    setFieldVisibility(quantityField, false);
    setFieldVisibility(averageTimeField, true);
    if (linkInput) {
      linkInput.value = "https://vpn.local/" + product.id;
      linkInput.dataset.vpnAutoLink = "true";
      linkInput.disabled = true;
      linkInput.required = false;
    }
    if (quantityInput) {
      quantityInput.value = "1";
      quantityInput.min = "1";
      quantityInput.max = "1";
      quantityInput.disabled = true;
      quantityInput.required = false;
    }
    if (helper) helper.textContent = "Plano fixo: " + String(product.durationDays) + " dias • " + String(product.connectionLimit) + " conexão" + (Number(product.connectionLimit) === 1 ? "" : "ões");
    if (description) {
      description.textContent = product.description || "Acesso criado automaticamente após a compra.";
      description.style.display = "block";
    }
    if (averageTime) averageTime.textContent = "Ativação automática";
    if (preview) preview.textContent = money(product.priceBRL);
    if (previewCaption) previewCaption.textContent = "Valor fixo do acesso VPN. A conta é criada automaticamente após a compra.";
    if (submit) submit.innerHTML = "Comprar acesso VPN";
  }

  async function buyVpnFromCatalog(product, button) {
    if (!product) throw new Error("Produto VPN inválido.");
    if (!window.confirm("Confirmar a compra deste acesso VPN? O valor será descontado da sua carteira.")) return;
    const original = button ? button.innerHTML : "";
    if (button) {
      button.disabled = true;
      button.textContent = "Criando acesso…";
    }
    try {
      const order = await api("/api/vpn/orders", {
        method: "POST",
        body: { productId: Number(product.id), idempotencyKey: randomKey() },
      });
      state.orders.unshift(order);
      try { state.wallet = await api("/api/wallet"); } catch { /* ignora */ }
      toast("Acesso VPN criado com sucesso.");
      document.querySelectorAll(".vpn-success-panel").forEach(function (node) { node.remove(); });
      const anchor = document.querySelector('[data-form="new-order"] .smm-order-panel') || document.querySelector('[data-form="new-order"]');
      if (anchor) {
        const result = document.createElement("div");
        result.className = "vpn-success-panel";
        result.innerHTML = '<h3>Acesso criado</h3><p>Salve estas credenciais.</p>' + orderCard(order) + '<button type="button" class="button button-secondary" data-vpn-action="reload-app">Atualizar carteira</button>';
        anchor.insertAdjacentElement("afterend", result);
        result.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } catch (error) {
      toast(error.message, true);
    } finally {
      if (button && document.body.contains(button)) {
        button.disabled = false;
        button.innerHTML = original;
      }
    }
  }

  injectMemberProducts = function () {
    syncMemberVpnCatalog();
  };


  document.addEventListener("change", function (event) {
    if (event.target.matches("[data-order-category], [data-order-service]")) {
      setTimeout(function () { syncMemberVpnCatalog(); }, 0);
    }
  }, true);

  document.addEventListener("input", function (event) {
    if (event.target.matches("[data-order-search]")) {
      setTimeout(function () { syncMemberVpnCatalog(); }, 0);
    }
  }, true);

  const observer = new MutationObserver(function () {
    enhanceAdminAddForm();
    injectMemberProducts();
    updateMemberVpnSelection();
    injectMemberHistory();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  enhanceAdminAddForm();
  injectMemberProducts();
  injectMemberHistory();
})();
