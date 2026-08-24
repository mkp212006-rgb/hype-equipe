(function () {
  "use strict";

  const SESSION_KEY = "tw-store.session.v3";
  const OPEN_SERVICE_KEY = "tw-store.storefront.service.v1";
  const runtime = window.TW_STORE_CONFIG || {};
  const API_URL = runtime.apiBaseUrl || window.location.origin;
  const REQUEST_TIMEOUT_MS = Number(runtime.requestTimeoutMs) || 15_000;
  const app = document.getElementById("app");
  const toastRegion = document.getElementById("toast-region");
  let memberRequest = null;
  let adminRequest = null;
  let syncQueued = false;

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function money(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "Consulte";
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(number);
  }

  function toast(message, error) {
    if (!toastRegion) return;
    toastRegion.innerHTML = '<div class="toast ' + (error ? "error" : "") + '">' + escapeHtml(message) + "</div>";
    setTimeout(function () { if (toastRegion) toastRegion.innerHTML = ""; }, 3800);
  }

  async function api(path, options) {
    const current = session();
    if (!current || !current.token) throw new Error("Sessão inválida.");
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
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      const raw = await response.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
      if (!response.ok) throw Object.assign(new Error(data.error || "Não foi possível concluir a operação."), { status: response.status });
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("O servidor demorou demais para responder.");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function storefrontData(admin, fresh) {
    if (admin) {
      if (!fresh && adminRequest) return adminRequest;
      adminRequest = api("/admin/storefront").catch(function (error) { adminRequest = null; throw error; });
      return adminRequest;
    }
    if (!fresh && memberRequest) return memberRequest;
    memberRequest = api("/api/storefront").catch(function (error) { memberRequest = null; throw error; });
    return memberRequest;
  }

  function productImage(product, className) {
    const source = product.imageUrl || product.imageData || "";
    if (source) {
      return '<img class="' + escapeHtml(className || "") + '" src="' + escapeHtml(source) + '" alt="' + escapeHtml(product.name) + '" loading="lazy" />';
    }
    const initial = String(product.name || "T").trim().charAt(0).toUpperCase() || "T";
    return '<span class="store-image-fallback ' + escapeHtml(className || "") + '" aria-hidden="true"><b>' + escapeHtml(initial) + "</b><small>TW STORE</small></span>";
  }

  function productButton(product) {
    if (product.kind === "smm") {
      return '<button type="button" class="store-product-button" data-store-smm="' + escapeHtml(product.sourceId) + '" data-store-category="' + escapeHtml(product.categoryName) + '">Comprar agora <span>→</span></button>';
    }
    if (product.kind === "vpn") {
      return '<button type="button" class="store-product-button" data-vpn-action="buy" data-product-id="' + escapeHtml(product.sourceId) + '">Comprar acesso <span>→</span></button>';
    }
    return '<button type="button" class="store-product-button" data-store-subscription="' + escapeHtml(product.sourceId) + '" data-store-url="' + escapeHtml(product.actionUrl || "") + '">' + escapeHtml(product.actionLabel || "Ver oferta") + ' <span>→</span></button>';
  }

  function productCard(product) {
    const priceLabel = product.priceLabel ? '<small>' + escapeHtml(product.priceLabel) + "</small>" : "";
    return '<article class="store-product-card" data-store-product-kind="' + escapeHtml(product.kind) + '">' +
      '<div class="store-product-media">' + productImage(product, "store-product-image") +
        (product.badge ? '<span class="store-product-badge">' + escapeHtml(product.badge) + "</span>" : "") +
        (product.featured ? '<span class="store-featured-badge">DESTAQUE</span>' : "") +
      "</div>" +
      '<div class="store-product-copy"><span class="store-product-category">' + escapeHtml(product.categoryName || "Outros") + "</span>" +
        '<h3>' + escapeHtml(product.name) + "</h3>" +
        '<p>' + escapeHtml(product.description || "Produto selecionado pela Tw Store.") + "</p>" +
        '<div class="store-product-price"><strong>' + money(product.priceBRL) + "</strong>" + priceLabel + "</div>" +
        productButton(product) +
      "</div></article>";
  }

  function normalizedCatalog(payload) {
    const products = Array.isArray(payload.products) ? payload.products.filter(function (item) { return item.enabled !== false; }) : [];
    const categories = Array.isArray(payload.categories) ? payload.categories.filter(function (item) { return item.enabled !== false; }) : [];
    const known = new Set(categories.map(function (category) { return Number(category.id); }));
    const uncategorized = products.some(function (product) { return product.categoryId == null || !known.has(Number(product.categoryId)); });
    if (uncategorized) categories.push({ id: "other", name: "Sem categoria", description: "Mais opções para você.", sortOrder: 999999, enabled: true });
    categories.sort(function (a, b) { return Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.name).localeCompare(String(b.name), "pt-BR"); });
    products.sort(function (a, b) { return Number(b.featured) - Number(a.featured) || Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.name).localeCompare(String(b.name), "pt-BR"); });
    return { products: products, categories: categories };
  }

  function productsForCategory(products, category) {
    if (category.id === "other") return products.filter(function (product) { return product.categoryId == null; });
    return products.filter(function (product) { return Number(product.categoryId) === Number(category.id); });
  }

  function heroGallery(products) {
    const chosen = products.filter(function (product) { return product.imageUrl || product.imageData; }).slice(0, 3);
    const source = chosen.length ? chosen : products.slice(0, 3);
    if (!source.length) return '<div class="store-hero-empty"><b>TW</b><span>Sua vitrine começa aqui</span></div>';
    return '<div class="store-hero-gallery">' + source.map(function (product, index) {
      return '<div class="store-hero-tile store-hero-tile-' + index + '">' + productImage(product, "store-hero-image") + '<span>' + escapeHtml(product.name) + "</span></div>";
    }).join("") + "</div>";
  }

  function renderMemberStorefront(main, payload) {
    if (!document.body.contains(main)) return;
    const catalog = normalizedCatalog(payload);
    const topbar = main.querySelector(".topbar");
    const balance = main.querySelector(".balance-value")?.textContent || "Minha carteira";
    const featured = catalog.products.filter(function (product) { return product.featured; }).slice(0, 4);
    const spotlight = featured.length ? featured : catalog.products.slice(0, 4);
    const sections = catalog.categories.map(function (category) {
      const products = productsForCategory(catalog.products, category);
      if (!products.length) return "";
      const hasVpn = products.some(function (product) { return product.kind === "vpn"; });
      return '<section class="store-category-section" id="store-category-' + escapeHtml(category.id) + '" ' + (hasVpn ? 'data-vpn-member-products="true"' : "") + '>' +
        '<div class="store-section-heading"><div><span>CATÁLOGO</span><h2>' + escapeHtml(category.name) + '</h2><p>' + escapeHtml(category.description || "Escolha a melhor opção para você.") + '</p></div><button type="button" data-store-scroll="store-category-' + escapeHtml(category.id) + '">Ver produtos</button></div>' +
        '<div class="store-product-grid">' + products.map(productCard).join("") + "</div>" +
      "</section>";
    }).join("");

    main.classList.add("storefront-page");
    main.dataset.storefrontEnhanced = "true";
    main.innerHTML = (topbar ? topbar.outerHTML : "") +
      '<div class="store-promo">Ofertas e novidades organizadas para você <span>•</span> Compra segura na Tw Store</div>' +
      '<section class="store-hero"><div class="store-hero-copy"><span class="store-kicker">BEM-VINDO(A) À TW STORE</span><h1>Tudo o que você precisa, em um só lugar.</h1><p>Explore produtos, serviços e assinaturas separados por catálogo, com preços claros e suporte quando precisar.</p><div class="store-hero-actions"><button type="button" class="store-primary-action" data-store-scroll="store-catalog-start">Explorar catálogo</button><button type="button" class="store-secondary-action" data-nav="wallet">' + escapeHtml(balance) + "</button></div></div>" + heroGallery(catalog.products) + "</section>" +
      '<section class="store-trust-strip"><div><b>100% seguro</b><span>Conta e carteira protegidas</span></div><div><b>Processamento rápido</b><span>Pedidos sem etapas desnecessárias</span></div><div><b>Suporte humano</b><span>Ajuda dentro do aplicativo</span></div></section>' +
      (catalog.categories.length ? '<nav class="store-category-nav" aria-label="Catálogos">' + catalog.categories.map(function (category) { const count = productsForCategory(catalog.products, category).length; return count ? '<button type="button" data-store-scroll="store-category-' + escapeHtml(category.id) + '">' + escapeHtml(category.name) + '<small>' + count + "</small></button>" : ""; }).join("") + "</nav>" : "") +
      (spotlight.length ? '<section class="store-featured" id="store-catalog-start"><div class="store-section-heading"><div><span>ESCOLHAS DA LOJA</span><h2>Produtos em destaque</h2><p>As principais opções selecionadas pelo administrador.</p></div></div><div class="store-product-grid">' + spotlight.map(productCard).join("") + "</div></section>" : '<section class="store-empty" id="store-catalog-start"><h2>A vitrine está sendo preparada</h2><p>O administrador ainda não publicou produtos com foto e preço.</p></section>') +
      sections +
      '<section class="store-how"><div class="store-section-heading"><div><span>COMO FUNCIONA</span><h2>Simples do início ao fim</h2></div></div><div class="store-steps"><article><b>01</b><h3>Escolha</h3><p>Navegue pelos catálogos e encontre o produto ideal.</p></article><article><b>02</b><h3>Confira</h3><p>Veja a descrição, o preço e as condições antes de comprar.</p></article><article><b>03</b><h3>Compre</h3><p>Finalize pela carteira ou pelo link definido para a oferta.</p></article><article><b>04</b><h3>Acompanhe</h3><p>Consulte seus pedidos e fale com o suporte quando precisar.</p></article></div></section>';
  }

  async function enhanceMemberHome(main) {
    if (!main || main.dataset.storefrontEnhanced || main.dataset.storefrontLoading) return;
    const heading = main.querySelector(".page-heading h1");
    if (!heading || !/^visão geral$/i.test(heading.textContent.trim())) return;
    main.dataset.storefrontLoading = "true";
    try { renderMemberStorefront(main, await storefrontData(false, false)); }
    catch (error) { delete main.dataset.storefrontLoading; console.warn("Storefront unavailable", error); }
  }

  function categoryOptions(categories, selected) {
    return '<option value="">Sem categoria</option>' + categories.map(function (category) {
      return '<option value="' + escapeHtml(category.id) + '" ' + (String(selected || "") === String(category.id) ? "selected" : "") + '>' + escapeHtml(category.name) + "</option>";
    }).join("");
  }

  function imageAdminField(product) {
    return '<div class="store-admin-image-field"><div class="store-admin-preview">' + productImage(product, "store-admin-preview-image") + '</div><label class="store-upload-button">Escolher foto<input type="file" name="image" accept="image/jpeg,image/png,image/webp" hidden /></label>' + (product.imageUrl || product.imageData ? '<button type="button" class="store-remove-image" data-store-remove-image>Remover foto</button>' : "") + "</div>";
  }

  function categoryManager(category) {
    return '<details class="store-admin-details"><summary><span>' + (category.imageUrl ? productImage({ name: category.name, imageUrl: category.imageUrl }, "store-category-thumb") : '<span class="store-category-thumb store-category-thumb-empty">' + escapeHtml(category.name.charAt(0)) + "</span>") + '</span><b>' + escapeHtml(category.name) + '</b><small>Ordem ' + escapeHtml(category.sortOrder) + ' • ' + escapeHtml(category.productCount) + " produto(s)</small></summary>" +
      '<form class="store-admin-form" data-store-form="category" data-id="' + escapeHtml(category.id) + '">' +
        imageAdminField({ name: category.name, imageUrl: category.imageUrl }) +
        '<label>Nome<input name="name" maxlength="50" value="' + escapeHtml(category.name) + '" required /></label>' +
        '<label>Descrição da seção<textarea name="description" maxlength="240">' + escapeHtml(category.description || "") + "</textarea></label>" +
        '<div class="store-admin-form-grid"><label>Ordem na vitrine<input name="sortOrder" type="number" min="0" value="' + escapeHtml(category.sortOrder) + '" required /></label><label class="store-check"><input name="enabled" type="checkbox" ' + (category.enabled ? "checked" : "") + '/><span>Mostrar esta categoria</span></label></div>' +
        '<button class="store-save-button" type="submit">Salvar categoria</button>' +
      "</form></details>";
  }

  function mediaManager(product) {
    const endpointKind = product.kind === "vpn" ? "vpn" : "smm";
    return '<details class="store-admin-details store-media-item" data-store-admin-item data-search="' + escapeHtml([product.name, product.categoryName, product.kind].join(" ").toLowerCase()) + '"><summary><span>' + productImage(product, "store-category-thumb") + '</span><b>' + escapeHtml(product.name) + '</b><small>' + escapeHtml(product.categoryName) + " • " + escapeHtml(product.kind.toUpperCase()) + "</small></summary>" +
      '<form class="store-admin-form" data-store-form="media" data-kind="' + endpointKind + '" data-id="' + escapeHtml(product.sourceId) + '">' +
        imageAdminField(product) +
        '<div class="store-admin-form-grid"><label>Selo curto<input name="badge" maxlength="40" value="' + escapeHtml(product.badge || "") + '" placeholder="Ex.: Mais vendido" /></label><label>Ordem<input name="sortOrder" type="number" min="0" value="' + escapeHtml(product.sortOrder || 0) + '" required /></label></div>' +
        '<label class="store-check"><input name="featured" type="checkbox" ' + (product.featured ? "checked" : "") + '/><span>Exibir em Produtos em destaque</span></label>' +
        '<button class="store-save-button" type="submit">Salvar foto e destaque</button>' +
      "</form></details>";
  }

  function subscriptionEditor(product, categories) {
    return '<details class="store-admin-details store-media-item" data-store-admin-item data-search="' + escapeHtml([product.name, product.categoryName, "assinatura"].join(" ").toLowerCase()) + '"><summary><span>' + productImage(product, "store-category-thumb") + '</span><b>' + escapeHtml(product.name) + '</b><small>' + escapeHtml(product.categoryName) + " • " + money(product.priceBRL) + "</small></summary>" +
      '<form class="store-admin-form" data-store-form="subscription-edit" data-id="' + escapeHtml(product.sourceId) + '">' + imageAdminField(product) +
        '<label>Nome<input name="name" maxlength="90" value="' + escapeHtml(product.name) + '" required /></label><label>Descrição<textarea name="description" maxlength="500">' + escapeHtml(product.description || "") + "</textarea></label>" +
        '<label>Categoria<select name="categoryId">' + categoryOptions(categories, product.categoryId) + "</select></label>" +
        '<div class="store-admin-form-grid"><label>Preço (R$)<input name="priceBRL" type="number" min="0.01" step="0.01" value="' + escapeHtml(Number(product.priceBRL).toFixed(2)) + '" required /></label><label>Periodicidade<input name="billingLabel" maxlength="40" value="' + escapeHtml(product.billingLabel || "") + '" placeholder="Ex.: por mês" /></label><label>Selo<input name="badge" maxlength="40" value="' + escapeHtml(product.badge || "") + '" /></label><label>Ordem<input name="sortOrder" type="number" min="0" value="' + escapeHtml(product.sortOrder || 0) + '" /></label></div>' +
        '<div class="store-admin-form-grid"><label>Texto do botão<input name="actionLabel" maxlength="40" value="' + escapeHtml(product.actionLabel || "Ver oferta") + '" required /></label><label>Link de compra<input name="actionUrl" type="url" maxlength="1000" value="' + escapeHtml(product.actionUrl || "") + '" placeholder="https://..." /></label></div>' +
        '<div class="store-admin-checks"><label class="store-check"><input name="enabled" type="checkbox" ' + (product.enabled ? "checked" : "") + '/><span>Produto ativo</span></label><label class="store-check"><input name="featured" type="checkbox" ' + (product.featured ? "checked" : "") + '/><span>Produto em destaque</span></label></div>' +
        '<div class="store-admin-actions"><button class="store-save-button" type="submit">Salvar assinatura</button><button type="button" class="store-delete-button" data-store-delete-subscription="' + escapeHtml(product.sourceId) + '">Excluir</button></div>' +
      "</form></details>";
  }

  function adminPanelMarkup(payload) {
    const categories = Array.isArray(payload.categories) ? payload.categories : [];
    const products = Array.isArray(payload.products) ? payload.products : [];
    const subscriptions = products.filter(function (product) { return product.kind === "subscription"; });
    const mediaProducts = products.filter(function (product) { return product.kind !== "subscription"; });
    return '<section class="store-admin-shell"><div class="store-admin-hero"><div><span>NOVA VITRINE</span><h2>Layout da loja</h2><p>Fotos, destaques, ordem dos catálogos e produtos de assinatura são controlados aqui.</p></div><div class="store-admin-metrics"><b>' + products.length + '<small>produtos</small></b><b>' + categories.length + '<small>catálogos</small></b><b>' + products.filter(function (p) { return p.featured; }).length + '<small>destaques</small></b></div></div>' +
      '<details class="card store-admin-section" open><summary><h3>Organizar catálogos</h3><span>Nome, foto, descrição e ordem</span></summary><form class="store-category-create" data-store-form="category-create"><input name="name" maxlength="50" placeholder="Ex.: Assinaturas" required /><button type="submit">Criar catálogo</button></form><div class="store-admin-list">' + (categories.length ? categories.map(categoryManager).join("") : '<p class="store-admin-empty">Crie o primeiro catálogo acima para começar.</p>') + "</div></details>" +
      '<details class="card store-admin-section"><summary><h3>Novo produto de assinatura</h3><span>Cadastro manual com foto e valor fixo</span></summary><form class="store-admin-form store-subscription-create" data-store-form="subscription-create">' +
        imageAdminField({ name: "Assinatura", imageData: "" }) +
        '<label>Nome do produto<input name="name" maxlength="90" placeholder="Ex.: Assinatura Premium" required /></label><label>Descrição<textarea name="description" maxlength="500" placeholder="Explique o que está incluído"></textarea></label><label>Categoria<select name="categoryId">' + categoryOptions(categories, "") + "</select></label>" +
        '<div class="store-admin-form-grid"><label>Preço (R$)<input name="priceBRL" type="number" min="0.01" step="0.01" placeholder="29,90" required /></label><label>Periodicidade<input name="billingLabel" maxlength="40" placeholder="Ex.: por mês" /></label><label>Selo<input name="badge" maxlength="40" placeholder="Ex.: Mais vendido" /></label><label>Ordem<input name="sortOrder" type="number" min="0" value="0" /></label></div>' +
        '<div class="store-admin-form-grid"><label>Texto do botão<input name="actionLabel" maxlength="40" value="Ver oferta" required /></label><label>Link de compra ou WhatsApp<input name="actionUrl" type="url" maxlength="1000" placeholder="https://..." /></label></div>' +
        '<label class="store-check"><input name="featured" type="checkbox" /><span>Colocar em Produtos em destaque</span></label><button class="store-save-button" type="submit">Adicionar assinatura</button></form></details>' +
      '<details class="card store-admin-section"><summary><h3>Fotos dos produtos</h3><span>SMM e VPN</span></summary><label class="store-admin-search">Buscar produto<input type="search" data-store-admin-search placeholder="Nome ou categoria" /></label><div class="store-admin-list">' + (mediaProducts.length ? mediaProducts.map(mediaManager).join("") : '<p class="store-admin-empty">Nenhum produto SMM ou VPN cadastrado.</p>') + "</div></details>" +
      '<details class="card store-admin-section" ' + (subscriptions.length ? "" : "") + '><summary><h3>Assinaturas cadastradas</h3><span>' + subscriptions.length + ' produto(s)</span></summary><div class="store-admin-list">' + (subscriptions.length ? subscriptions.map(function (product) { return subscriptionEditor(product, categories); }).join("") : '<p class="store-admin-empty">Nenhuma assinatura cadastrada ainda.</p>') + "</div></details></section>";
  }

  async function enhanceAdminCatalog(main) {
    if (!main || main.dataset.storeAdminEnhanced || main.dataset.storeAdminLoading) return;
    main.dataset.storeAdminLoading = "true";
    main.classList.add("store-admin-page");
    try {
      const payload = await storefrontData(true, true);
      if (!document.body.contains(main)) return;
      const host = document.createElement("div");
      host.setAttribute("data-store-admin-host", "true");
      host.innerHTML = adminPanelMarkup(payload);
      const heading = main.querySelector(".page-heading");
      if (heading) heading.insertAdjacentElement("afterend", host); else main.prepend(host);
      main.dataset.storeAdminEnhanced = "true";
      delete main.dataset.storeAdminLoading;
    } catch (error) {
      delete main.dataset.storeAdminLoading;
      console.warn("Store admin unavailable", error);
    }
  }

  function values(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function imageFromForm(form) {
    const input = form.querySelector('input[type="file"][name="image"]');
    if (form.dataset.removeImage === "true") return Promise.resolve("");
    if (form._storeImageData) return Promise.resolve(form._storeImageData);
    if (!input || !input.files || !input.files[0]) return Promise.resolve(undefined);
    return compressImage(input.files[0]);
  }

  function compressImage(file) {
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type || "")) return Promise.reject(new Error("Escolha uma foto JPG, PNG ou WebP."));
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onerror = function () { reject(new Error("Não foi possível ler a foto.")); };
      reader.onload = function () {
        const image = new Image();
        image.onerror = function () { reject(new Error("A foto selecionada é inválida.")); };
        image.onload = function () {
          const max = 720;
          const scale = Math.min(1, max / Math.max(image.width, image.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const context = canvas.getContext("2d");
          context.fillStyle = "#12090b";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          let quality = 0.84;
          let result = canvas.toDataURL("image/jpeg", quality);
          while (result.length > 470000 && quality > 0.38) {
            quality -= 0.08;
            result = canvas.toDataURL("image/jpeg", quality);
          }
          if (result.length > 500000) return reject(new Error("A foto ficou muito grande. Escolha uma imagem menor."));
          resolve(result);
        };
        image.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  function setBusy(form, busy) {
    const button = form.querySelector('button[type="submit"]');
    if (!button) return;
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.disabled = busy;
    button.textContent = busy ? "Salvando…" : button.dataset.label;
  }

  async function refreshAdminHost(main) {
    adminRequest = null;
    const payload = await storefrontData(true, true);
    const host = main.querySelector("[data-store-admin-host]");
    if (host) host.innerHTML = adminPanelMarkup(payload);
  }

  async function handleStoreForm(form) {
    setBusy(form, true);
    try {
      const data = values(form);
      const imageData = await imageFromForm(form);
      const type = form.dataset.storeForm;
      let path;
      let method = "PATCH";
      let body = {};
      if (type === "category-create") {
        path = "/admin/categories";
        method = "POST";
        body = { name: data.name };
      } else if (type === "category") {
        path = "/admin/categories/" + encodeURIComponent(form.dataset.id) + "/presentation";
        body = { name: data.name, description: data.description || "", sortOrder: Number(data.sortOrder || 0), enabled: Boolean(data.enabled) };
      } else if (type === "media") {
        path = form.dataset.kind === "vpn"
          ? "/admin/vpn/products/" + encodeURIComponent(form.dataset.id) + "/presentation"
          : "/admin/services/" + encodeURIComponent(form.dataset.id) + "/presentation";
        body = { badge: data.badge || "", sortOrder: Number(data.sortOrder || 0), featured: Boolean(data.featured) };
      } else if (type === "subscription-create" || type === "subscription-edit") {
        method = type === "subscription-create" ? "POST" : "PATCH";
        path = type === "subscription-create" ? "/admin/catalog-products" : "/admin/catalog-products/" + encodeURIComponent(form.dataset.id);
        body = {
          name: data.name, description: data.description || "", categoryId: data.categoryId ? Number(data.categoryId) : null,
          priceBRL: Number(String(data.priceBRL || "").replace(",", ".")), billingLabel: data.billingLabel || "",
          badge: data.badge || "", sortOrder: Number(data.sortOrder || 0), actionLabel: data.actionLabel || "Ver oferta",
          actionUrl: data.actionUrl || "", featured: Boolean(data.featured), enabled: type === "subscription-create" ? true : Boolean(data.enabled),
        };
      }
      if (imageData !== undefined) body.imageData = imageData;
      await api(path, { method: method, body: body });
      memberRequest = null;
      const main = form.closest("main");
      if (["category", "category-create"].includes(type) && main?.querySelector('[data-action="admin-reload"]')) {
        adminRequest = null;
        main.querySelector('[data-action="admin-reload"]').click();
      } else {
        await refreshAdminHost(main);
      }
      toast(type === "subscription-create" ? "Assinatura adicionada à vitrine." : type === "category-create" ? "Catálogo criado com sucesso." : "Vitrine atualizada com sucesso.");
    } catch (error) {
      toast(error.message, true);
    } finally {
      if (document.body.contains(form)) setBusy(form, false);
    }
  }

  function queueServiceSelection(id, category) {
    sessionStorage.setItem(OPEN_SERVICE_KEY, JSON.stringify({ id: String(id), category: String(category || "") }));
    const nav = document.querySelector('[data-nav="new-order"]');
    if (nav) nav.click();
    setTimeout(applyQueuedService, 30);
  }

  function applyQueuedService() {
    let target;
    try { target = JSON.parse(sessionStorage.getItem(OPEN_SERVICE_KEY) || "null"); } catch { target = null; }
    if (!target) return;
    const form = document.querySelector('[data-form="new-order"]');
    const category = form && form.querySelector("[data-order-category]");
    const service = form && form.querySelector("[data-order-service]");
    if (!form || !category || !service) return;
    if (target.category && String(category.value) !== target.category) {
      category.value = target.category;
      category.dispatchEvent(new Event("change", { bubbles: true }));
    }
    setTimeout(function () {
      const option = Array.from(service.options).find(function (item) { return String(item.value) === String(target.id); });
      if (!option) return;
      service.value = String(target.id);
      service.dispatchEvent(new Event("change", { bubbles: true }));
      sessionStorage.removeItem(OPEN_SERVICE_KEY);
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 40);
  }

  document.addEventListener("submit", function (event) {
    const form = event.target.closest("[data-store-form]");
    if (!form) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    handleStoreForm(form);
  }, true);

  document.addEventListener("change", function (event) {
    const input = event.target.closest('[data-store-form] input[type="file"][name="image"]');
    if (!input || !input.files || !input.files[0]) return;
    const form = input.closest("[data-store-form]");
    delete form.dataset.removeImage;
    const preview = form.querySelector(".store-admin-preview");
    compressImage(input.files[0]).then(function (imageData) {
      form._storeImageData = imageData;
      if (preview) preview.innerHTML = '<img class="store-admin-preview-image" src="' + escapeHtml(imageData) + '" alt="Prévia da foto" />';
    }).catch(function (error) { toast(error.message, true); input.value = ""; });
  });

  document.addEventListener("input", function (event) {
    const search = event.target.closest("[data-store-admin-search]");
    if (!search) return;
    const query = String(search.value || "").trim().toLowerCase();
    search.closest(".store-admin-section")?.querySelectorAll("[data-store-admin-item]").forEach(function (item) {
      item.hidden = Boolean(query) && !String(item.dataset.search || "").includes(query);
    });
  });

  document.addEventListener("click", async function (event) {
    const scroll = event.target.closest("[data-store-scroll]");
    if (scroll) {
      event.preventDefault();
      document.getElementById(scroll.dataset.storeScroll)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const smm = event.target.closest("[data-store-smm]");
    if (smm) {
      event.preventDefault();
      queueServiceSelection(smm.dataset.storeSmm, smm.dataset.storeCategory);
      return;
    }
    const subscription = event.target.closest("[data-store-subscription]");
    if (subscription) {
      event.preventDefault();
      const url = String(subscription.dataset.storeUrl || "");
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      else toast("O administrador ainda não informou o link desta oferta.", true);
      return;
    }
    const remove = event.target.closest("[data-store-remove-image]");
    if (remove) {
      event.preventDefault();
      const form = remove.closest("[data-store-form]");
      if (!form) return;
      form.dataset.removeImage = "true";
      delete form._storeImageData;
      const preview = form.querySelector(".store-admin-preview");
      if (preview) preview.innerHTML = '<span class="store-image-fallback store-admin-preview-image"><b>T</b><small>SEM FOTO</small></span>';
      remove.remove();
      return;
    }
    const removeSubscription = event.target.closest("[data-store-delete-subscription]");
    if (removeSubscription) {
      event.preventDefault();
      if (!window.confirm("Excluir este produto de assinatura da vitrine?")) return;
      try {
        await api("/admin/catalog-products/" + encodeURIComponent(removeSubscription.dataset.storeDeleteSubscription), { method: "DELETE" });
        memberRequest = null; adminRequest = null;
        await refreshAdminHost(removeSubscription.closest("main"));
        toast("Assinatura removida da vitrine.");
      } catch (error) { toast(error.message, true); }
    }
  }, true);

  function sync() {
    syncQueued = false;
    const current = session();
    if (!current || !current.token || !app) return;
    if (current.role === "member") {
      enhanceMemberHome(app.querySelector(".app-shell > main.page"));
      applyQueuedService();
    } else if (current.role === "admin") {
      enhanceAdminCatalog(app.querySelector(".admin-catalog-page"));
    }
  }

  function scheduleSync() {
    if (syncQueued) return;
    syncQueued = true;
    if (typeof runtime.schedule === "function") return runtime.schedule("storefront-v2", sync);
    setTimeout(sync, 16);
  }

  const observer = new MutationObserver(scheduleSync);
  if (app) observer.observe(app, { childList: true, subtree: true });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) scheduleSync(); });
  scheduleSync();
})();
