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

  function storeIcon(name) {
    const paths = {
      arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
      cart: '<circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M3 4h2l2.4 10.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 8H6"/>',
      check: '<path d="M20 6 9 17l-5-5"/>',
      close: '<path d="m6 6 12 12M18 6 6 18"/>',
      discord: '<path d="M8 8.5a9 9 0 0 1 8 0l1.5 7a10 10 0 0 1-3 1.5l-.7-1.1a7 7 0 0 0 1.2-.6M9 15.3a7 7 0 0 0 6 0M6.5 15.5l1.5-7M9.5 12.5h.01M14.5 12.5h.01"/>',
      headset: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M18 19c0 1.1-.9 2-2 2h-3"/><rect x="3" y="13" width="4" height="6" rx="2"/><rect x="17" y="13" width="4" height="6" rx="2"/>',
      history: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2M4 5v4h4"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.7-3.7"/>',
      shield: '<path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6Z"/><path d="m9 12 2 2 4-5"/>',
      star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
      user: '<circle cx="12" cy="8" r="3"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',
      wallet: '<path d="M4 6h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3h12"/><path d="M16 11h4v4h-4a2 2 0 1 1 0-4Z"/>',
      zap: '<path d="m13 2-9 12h7l-1 8 9-12h-7Z"/>',
    };
    return '<svg class="store-icon" viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || paths.check) + "</svg>";
  }

  function productSearchText(product) {
    return [product.name, product.categoryName, product.description, product.badge, product.kind].join(" ").toLowerCase();
  }

  function productActionAttributes(product) {
    const meta = ' data-store-product-name="' + escapeHtml(product.name) + '" data-store-product-price="' + escapeHtml(product.priceBRL) + '"';
    if (product.kind === "smm") {
      return 'data-store-smm="' + escapeHtml(product.sourceId) + '" data-store-category="' + escapeHtml(product.categoryId == null ? "" : product.categoryId) + '"' + meta;
    }
    if (product.kind === "vpn") {
      return 'data-vpn-action="buy" data-product-id="' + escapeHtml(product.sourceId) + '"' + meta;
    }
    return 'data-store-subscription="' + escapeHtml(product.sourceId) + '"' + meta;
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

  function sectionHeading(title) {
    return '<div class="store-video-section-heading"><i></i><h2>' + escapeHtml(title) + "</h2><i></i></div>";
  }

  function mosaicTile(product, index) {
    if (!product) {
      return '<div class="store-mosaic-card store-mosaic-placeholder"><span>TW</span><small>TW STORE</small></div>';
    }
    return '<button type="button" class="store-mosaic-card" ' + productActionAttributes(product) + ' aria-label="Abrir ' + escapeHtml(product.name) + '">' +
      productImage(product, "store-mosaic-image") + '<span class="store-mosaic-index">' + escapeHtml(index + 1) + "</span></button>";
  }

  function featuredCard(product) {
    return '<button type="button" class="store-feature-card" data-store-search-text="' + escapeHtml(productSearchText(product)) + '" ' + productActionAttributes(product) + ' aria-label="Comprar ' + escapeHtml(product.name) + '">' +
      productImage(product, "store-feature-image") +
      '<span class="store-feature-label">' + storeIcon("star") + " Em Destaque</span>" +
    "</button>";
  }

  function catalogCard(product, extra) {
    const priceSuffix = product.kind === "subscription" ? "+" : "";
    const note = product.kind === "smm" ? "por 1.000" : product.priceLabel || "À vista no Pix";
    return '<button type="button" class="store-video-product-card' + (extra ? " store-product-extra" : "") + '" data-store-search-text="' + escapeHtml(productSearchText(product)) + '" ' + productActionAttributes(product) + ' aria-label="Comprar ' + escapeHtml(product.name) + '">' +
      '<span class="store-video-product-media">' + productImage(product, "store-video-product-image") + '<span class="store-video-zap">' + storeIcon("zap") + "</span></span>" +
      '<span class="store-video-product-copy"><span class="store-video-product-name"><b>♥</b> ' + escapeHtml(product.name) + '</span><strong>' + money(product.priceBRL) + escapeHtml(priceSuffix) + '</strong><small>' + escapeHtml(note) + '</small><i>' + storeIcon("zap") + "</i></span></button>";
  }

  function catalogSection(title, products, id) {
    if (!products.length) return "";
    const extraCount = Math.max(0, products.length - 2);
    const pages = Math.min(5, Math.max(1, Math.ceil(products.length / 2)));
    return '<section class="store-category-section" id="store-category-' + escapeHtml(id) + '">' + sectionHeading(title) +
      '<div class="store-video-product-grid">' + products.map(function (product, index) { return catalogCard(product, index > 1); }).join("") + "</div>" +
      (products.length > 2 ? '<div class="store-video-dots" aria-hidden="true">' + Array.from({ length: pages }, function (_item, index) { return '<i class="' + (index === 0 ? "active" : "") + '"></i>'; }).join("") + "</div>" : "") +
      (extraCount ? '<div class="store-video-more-row"><i></i><button type="button" data-store-category-expand data-store-more-count="' + extraCount + '"><span>Ver mais</span><b>' + extraCount + "+</b></button><i></i></div>" : "") +
    "</section>";
  }

  function searchModal(products) {
    return '<div class="store-dialog-backdrop" data-store-search-modal hidden><section class="store-dialog store-search-dialog" role="dialog" aria-modal="true" aria-label="Buscar produtos"><div class="store-dialog-heading"><div><small>TW STORE</small><h2>Buscar produtos</h2></div><button type="button" data-store-close-dialog aria-label="Fechar">' + storeIcon("close") + '</button></div><label class="store-dialog-search">' + storeIcon("search") + '<input type="search" data-store-search placeholder="Digite o nome do produto" autocomplete="off" maxlength="100"></label><div class="store-search-results" data-store-search-results>' + products.map(function (product) { return catalogCard(product, false); }).join("") + '</div><div class="store-search-empty" data-store-search-empty hidden><h3>Nenhum produto encontrado</h3><p>Tente outro nome ou categoria.</p></div></section></div>';
  }

  function purchaseModal() {
    return '<div class="store-dialog-backdrop" data-store-purchase-modal hidden><section class="store-dialog store-purchase-dialog" role="dialog" aria-modal="true" aria-label="Finalizar assinatura"><div class="store-dialog-heading"><div><small>FINALIZAR COMPRA</small><h2 data-store-purchase-name>Assinatura</h2></div><button type="button" data-store-close-dialog aria-label="Fechar">' + storeIcon("close") + '</button></div><div class="store-purchase-summary"><span>Valor da assinatura</span><strong data-store-purchase-price>—</strong></div><form data-store-subscription-order><input type="hidden" name="productId"><label><span>E-mail que receberá a assinatura</span><input type="email" name="deliveryEmail" inputmode="email" autocomplete="email" maxlength="254" placeholder="seuemail@exemplo.com" required><small>Confira com atenção. Os dados serão preparados pelo administrador e enviados para este e-mail.</small></label><button type="submit" class="store-purchase-submit">' + storeIcon("wallet") + '<span>Finalizar com a carteira</span></button></form></section></div>';
  }

  function ordersModal() {
    return '<div class="store-dialog-backdrop" data-store-orders-modal hidden><section class="store-dialog store-orders-dialog" role="dialog" aria-modal="true" aria-label="Pedidos de assinatura"><div class="store-dialog-heading"><div><small>MINHA CONTA</small><h2>Assinaturas</h2></div><button type="button" data-store-close-dialog aria-label="Fechar">' + storeIcon("close") + '</button></div><div data-store-orders-list><div class="store-dialog-loading"><span class="spinner"></span> Carregando pedidos…</div></div></section></div>';
  }

  function renderMemberStorefront(main, payload) {
    if (!document.body.contains(main)) return;
    const catalog = normalizedCatalog(payload);
    const current = session() || {};
    const balance = main.querySelector(".balance-value")?.textContent || "Minha carteira";
    const featured = catalog.products.filter(function (product) { return product.featured; }).slice(0, 3);
    const spotlight = featured.length ? featured : catalog.products.slice(0, 3);
    const subscriptions = catalog.products.filter(function (product) { return product.kind === "subscription"; });
    const categorySections = catalog.categories.map(function (category) {
      const products = productsForCategory(catalog.products, category).filter(function (product) { return product.kind !== "subscription"; });
      return catalogSection(category.name, products, category.id);
    }).join("");
    const mosaic = catalog.products.filter(function (product) { return product.imageUrl; }).slice(0, 9);
    const fallbackProducts = catalog.products.length ? catalog.products : [null];
    while (mosaic.length < 9) mosaic.push(fallbackProducts[mosaic.length % fallbackProducts.length]);

    main.classList.add("storefront-page");
    main.dataset.storefrontEnhanced = "true";
    main.closest(".app-shell")?.classList.add("storefront-shell");
    document.body.classList.add("storefront-active");
    const featuredSection = spotlight.length
      ? '<section class="store-featured" id="store-catalog-start">' + sectionHeading("Produtos em Destaque") + '<div class="store-feature-grid">' + spotlight.map(featuredCard).join("") + "</div></section>"
      : '<section class="store-empty" id="store-catalog-start"><h2>A vitrine está sendo preparada</h2><p>O administrador ainda não publicou produtos com foto e preço.</p></section>';

    main.innerHTML =
      '<a class="store-promo" href="#store-catalog-start" data-store-scroll="store-catalog-start">CLIQUE AQUI E GARANTA DESCONTOS EXCLUSIVOS! ❤️</a>' +
      '<header class="store-reference-header"><div class="store-header-inner"><button type="button" class="store-brand" data-store-scroll="store-hero-start"><img src="./tw-store-icon.png" alt="Ícone Tw Store"><b>Tw Store</b><span class="store-verified">' + storeIcon("check") + '</span></button><div class="store-header-actions"><button type="button" class="store-icon-button" data-store-open-search aria-label="Buscar">' + storeIcon("search") + '</button><button type="button" class="store-icon-button" data-nav="settings" aria-label="Suporte">' + storeIcon("headset") + '</button><button type="button" class="store-icon-button" data-nav="settings" aria-label="Minha conta">' + storeIcon("user") + '</button><button type="button" class="store-icon-button store-cart-button" data-store-open-orders aria-label="Minhas assinaturas">' + storeIcon("cart") + "</button></div></div></header>" +
      '<section class="store-hero" id="store-hero-start"><div class="store-hero-copy"><div class="store-review-badge">' + storeIcon("star") + '<b>4.9</b><i></i>' + storeIcon("check") + '<span>+50 Mil avaliações</span>' + storeIcon("arrow") + '</div><h1>Bem Vindo(a)<strong>Tw Store!</strong></h1><p>A Tw Store oferece qualidade, segurança e confiança em cada pedido. Sua experiência é nossa prioridade.</p><div class="store-hero-actions"><button type="button" class="store-primary-action" data-nav="settings">' + storeIcon("discord") + ' Comunidade</button><button type="button" class="store-secondary-action" data-nav="settings">' + storeIcon("headset") + ' Suporte</button></div></div><div class="store-mosaic">' + mosaic.map(mosaicTile).join("") + "</div></section>" +
      featuredSection + catalogSection("Assinaturas", subscriptions, "subscriptions") + categorySections +
      '<footer class="store-video-footer"><img src="./tw-store-icon.png" alt="Tw Store"><div><b>Tw Store</b><small>Qualidade, segurança e confiança.</small></div><button type="button" data-nav="wallet">' + storeIcon("wallet") + '<span>' + escapeHtml(balance) + "</span></button></footer>" +
      searchModal(catalog.products) + purchaseModal() + ordersModal();
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
        '<p class="store-admin-delivery-note">A compra será debitada da carteira e enviada para a aba <b>Entregas</b> com o e-mail informado pelo cliente.</p>' +
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
        '<p class="store-admin-delivery-note">Não é necessário cadastrar link. O cliente informa o e-mail e o pedido entra na aba <b>Entregas</b>.</p>' +
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
          badge: data.badge || "", sortOrder: Number(data.sortOrder || 0), actionLabel: "Comprar assinatura",
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

  function randomOrderKey() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return "subscription-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function openDialog(dialog) {
    if (!dialog) return;
    dialog.hidden = false;
    document.body.classList.add("store-dialog-open");
    requestAnimationFrame(function () { dialog.classList.add("open"); });
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    dialog.classList.remove("open");
    setTimeout(function () {
      dialog.hidden = true;
      if (!document.querySelector(".store-dialog-backdrop.open")) document.body.classList.remove("store-dialog-open");
    }, 150);
  }

  function openSubscriptionCheckout(target) {
    const modal = document.querySelector("[data-store-purchase-modal]");
    const form = modal?.querySelector("[data-store-subscription-order]");
    if (!modal || !form) return;
    const previous = target.closest(".store-dialog-backdrop");
    if (previous && previous !== modal) closeDialog(previous);
    form.reset();
    form.elements.productId.value = target.dataset.storeSubscription || "";
    modal.querySelector("[data-store-purchase-name]").textContent = target.dataset.storeProductName || "Assinatura";
    modal.querySelector("[data-store-purchase-price]").textContent = money(target.dataset.storeProductPrice);
    openDialog(modal);
    setTimeout(function () { form.elements.deliveryEmail.focus(); }, 180);
  }

  function subscriptionStatus(order) {
    if (order.status === "fulfilled") return { label: "Enviado", className: "fulfilled" };
    if (order.status === "refunded") return { label: "Estornado", className: "refunded" };
    return { label: "Aguardando envio", className: "pending" };
  }

  function subscriptionOrderCard(order) {
    const status = subscriptionStatus(order);
    const delivered = order.status === "fulfilled" && order.deliveryData
      ? '<div class="store-order-delivery"><span>Dados enviados</span><pre>' + escapeHtml(order.deliveryData) + "</pre></div>"
      : order.status === "pending" ? '<p>O administrador está preparando os dados da sua assinatura.</p>' : '<p>O valor foi devolvido para a sua carteira.</p>';
    return '<article class="store-order-card"><div class="store-order-head"><div><small>' + escapeHtml(new Date(order.createdAt).toLocaleString("pt-BR")) + '</small><h3>' + escapeHtml(order.productName) + '</h3></div><span class="' + status.className + '">' + status.label + '</span></div><dl><div><dt>Valor</dt><dd>' + money(order.priceBRL) + '</dd></div><div><dt>E-mail de entrega</dt><dd>' + escapeHtml(order.deliveryEmail) + "</dd></div></dl>" + delivered + "</article>";
  }

  async function openSubscriptionOrders() {
    const modal = document.querySelector("[data-store-orders-modal]");
    const host = modal?.querySelector("[data-store-orders-list]");
    if (!modal || !host) return;
    host.innerHTML = '<div class="store-dialog-loading"><span class="spinner"></span> Carregando pedidos…</div>';
    openDialog(modal);
    try {
      const orders = await api("/api/subscription-orders");
      host.innerHTML = Array.isArray(orders) && orders.length
        ? '<div class="store-order-list">' + orders.map(subscriptionOrderCard).join("") + "</div>"
        : '<div class="store-dialog-empty">' + storeIcon("history") + '<h3>Nenhuma assinatura comprada</h3><p>Seus pedidos aparecerão aqui.</p></div>';
    } catch (error) {
      host.innerHTML = '<div class="store-dialog-empty"><h3>Não foi possível carregar</h3><p>' + escapeHtml(error.message) + "</p></div>";
    }
  }

  async function handleSubscriptionOrder(form) {
    const button = form.querySelector('button[type="submit"]');
    if (button) { button.disabled = true; button.dataset.label = button.innerHTML; button.textContent = "Finalizando…"; }
    try {
      await api("/api/subscription-orders", {
        method: "POST",
        body: {
          productId: form.elements.productId.value,
          deliveryEmail: form.elements.deliveryEmail.value,
          idempotencyKey: randomOrderKey(),
        },
      });
      closeDialog(form.closest("[data-store-purchase-modal]"));
      toast("Compra finalizada. O administrador recebeu o pedido de assinatura.");
      setTimeout(openSubscriptionOrders, 180);
    } catch (error) {
      toast(error.message, true);
    } finally {
      if (button && document.body.contains(button)) { button.disabled = false; button.innerHTML = button.dataset.label || "Finalizar com a carteira"; }
    }
  }

  document.addEventListener("submit", function (event) {
    const subscriptionOrder = event.target.closest("[data-store-subscription-order]");
    if (subscriptionOrder) {
      event.preventDefault();
      event.stopImmediatePropagation();
      handleSubscriptionOrder(subscriptionOrder);
      return;
    }
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
    const productSearch = event.target.closest("[data-store-search]");
    if (productSearch) {
      const dialog = productSearch.closest(".store-search-dialog");
      if (!dialog) return;
      const query = String(productSearch.value || "").trim().toLowerCase();
      let matches = 0;
      dialog.querySelectorAll("[data-store-search-text]").forEach(function (item) {
        const visible = !query || String(item.dataset.storeSearchText || "").includes(query);
        item.hidden = !visible;
        if (visible) matches += 1;
      });
      const empty = dialog.querySelector("[data-store-search-empty]");
      if (empty) empty.hidden = matches > 0;
      return;
    }
    const search = event.target.closest("[data-store-admin-search]");
    if (!search) return;
    const query = String(search.value || "").trim().toLowerCase();
    search.closest(".store-admin-section")?.querySelectorAll("[data-store-admin-item]").forEach(function (item) {
      item.hidden = Boolean(query) && !String(item.dataset.search || "").includes(query);
    });
  });

  document.addEventListener("click", async function (event) {
    const close = event.target.closest("[data-store-close-dialog]");
    if (close) {
      event.preventDefault();
      closeDialog(close.closest(".store-dialog-backdrop"));
      return;
    }
    if (event.target.classList?.contains("store-dialog-backdrop")) {
      closeDialog(event.target);
      return;
    }
    const openSearch = event.target.closest("[data-store-open-search]");
    if (openSearch) {
      event.preventDefault();
      const modal = document.querySelector("[data-store-search-modal]");
      openDialog(modal);
      setTimeout(function () { modal?.querySelector("[data-store-search]")?.focus(); }, 180);
      return;
    }
    const openOrders = event.target.closest("[data-store-open-orders]");
    if (openOrders) {
      event.preventDefault();
      openSubscriptionOrders();
      return;
    }
    const expand = event.target.closest("[data-store-category-expand]");
    if (expand) {
      event.preventDefault();
      const section = expand.closest(".store-category-section");
      if (!section) return;
      section.classList.toggle("store-category-expanded");
      const expanded = section.classList.contains("store-category-expanded");
      const label = expand.querySelector("span");
      const count = expand.querySelector("b");
      if (label) label.textContent = expanded ? "Mostrar menos" : "Ver mais";
      if (count) count.hidden = expanded;
      return;
    }
    const scroll = event.target.closest("[data-store-scroll]");
    if (scroll) {
      event.preventDefault();
      document.getElementById(scroll.dataset.storeScroll)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const smm = event.target.closest("[data-store-smm]");
    if (smm) {
      event.preventDefault();
      closeDialog(smm.closest(".store-dialog-backdrop"));
      queueServiceSelection(smm.dataset.storeSmm, smm.dataset.storeCategory);
      return;
    }
    const vpn = event.target.closest('[data-vpn-action="buy"]');
    if (vpn) {
      closeDialog(vpn.closest(".store-dialog-backdrop"));
      return;
    }
    const subscription = event.target.closest("[data-store-subscription]");
    if (subscription) {
      event.preventDefault();
      openSubscriptionCheckout(subscription);
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
      const main = app.querySelector(".app-shell > main.page");
      if (!main?.classList.contains("storefront-page")) document.body.classList.remove("storefront-active", "store-dialog-open");
      enhanceMemberHome(main);
      applyQueuedService();
    } else if (current.role === "admin") {
      document.body.classList.remove("storefront-active", "store-dialog-open");
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
