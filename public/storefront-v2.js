(function () {
  "use strict";

  const SESSION_KEY = "tw-store.session.v3";
  const WHATSAPP_URL = "https://wa.me/5512983087742";
  const DISCORD_URL = "https://discord.gg/86dEVzSTZE";
  const runtime = window.TW_STORE_CONFIG || {};
  const API_URL = runtime.apiBaseUrl || window.location.origin;
  const REQUEST_TIMEOUT_MS = Number(runtime.requestTimeoutMs) || 15_000;
  const app = document.getElementById("app");
  const toastRegion = document.getElementById("toast-region");
  let memberRequest = null;
  let adminRequest = null;
  let syncQueued = false;
  let memberProducts = [];

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
  }

  function saveSession(value) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(value));
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

  function initials(value) {
    return String(value || "T").trim().charAt(0).toUpperCase() || "T";
  }

  function dateTime(value) {
    const date = new Date(value || 0);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pt-BR");
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
      back: '<path d="m15 18-6-6 6-6"/>',
      box: '<path d="m21 8-9-5-9 5 9 5Z"/><path d="m3 8 9 5 9-5v8l-9 5-9-5Z"/><path d="M12 13v8"/>',
      camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4Z"/><circle cx="12" cy="13" r="3"/>',
      cart: '<circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M3 4h2l2.4 10.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 8H6"/>',
      check: '<path d="M20 6 9 17l-5-5"/>',
      close: '<path d="m6 6 12 12M18 6 6 18"/>',
      discord: '<path fill="currentColor" stroke="none" d="M20.317 4.37a19.8 19.8 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.445.865-.608 1.25a18.3 18.3 0 0 0-5.487 0 12.6 12.6 0 0 0-.618-1.25.077.077 0 0 0-.078-.037A19.7 19.7 0 0 0 3.677 4.37a.07.07 0 0 0-.032.028C.533 9.046-.319 13.58.099 18.058a.082.082 0 0 0 .031.056c2.053 1.508 4.041 2.423 5.993 3.03a.078.078 0 0 0 .084-.028c.462-.63.873-1.295 1.226-1.994a.076.076 0 0 0-.042-.106 12.9 12.9 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .079.009c.12.099.246.198.373.292a.077.077 0 0 1-.007.128 12.3 12.3 0 0 1-1.873.892.076.076 0 0 0-.041.107c.36.698.772 1.363 1.225 1.993a.076.076 0 0 0 .084.029c1.961-.607 3.95-1.522 6.002-3.03a.077.077 0 0 0 .031-.055c.5-5.177-.838-9.674-3.548-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.331c-1.183 0-2.157-1.086-2.157-2.419s.956-2.419 2.157-2.419c1.21 0 2.176 1.095 2.157 2.419 0 1.333-.956 2.419-2.157 2.419Zm7.975 0c-1.183 0-2.157-1.086-2.157-2.419s.955-2.419 2.157-2.419c1.21 0 2.176 1.095 2.157 2.419 0 1.333-.946 2.419-2.157 2.419Z"/>',
      headset: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M18 19c0 1.1-.9 2-2 2h-3"/><rect x="3" y="13" width="4" height="6" rx="2"/><rect x="17" y="13" width="4" height="6" rx="2"/>',
      history: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2M4 5v4h4"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
      link: '<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1"/>',
      lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
      logout: '<path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/>',
      more: '<path d="M4 6h16M4 12h16M4 18h16"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.7-3.7"/>',
      send: '<path d="m3 11 18-8-8 18-2-8Z"/><path d="m11 13 4-4"/>',
      shield: '<path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6Z"/><path d="m9 12 2 2 4-5"/>',
      star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
      ticket: '<path d="M4 5h16v5a2 2 0 0 0 0 4v5H4v-5a2 2 0 0 0 0-4Z"/><path d="M9 8h6M9 12h4"/>',
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
    const pages = Math.max(1, Math.ceil(products.length / 2));
    const carouselPages = Array.from({ length: pages }, function (_item, pageIndex) {
      const firstProductIndex = pageIndex * 2;
      return '<div class="store-video-product-page" data-store-carousel-page="' + pageIndex + '" role="group" aria-label="Página ' + (pageIndex + 1) + ' de ' + pages + '">' +
        products.slice(firstProductIndex, firstProductIndex + 2).map(function (product, productIndex) {
          return catalogCard(product, firstProductIndex + productIndex > 1);
        }).join("") +
      "</div>";
    }).join("");
    return '<section class="store-category-section" id="store-category-' + escapeHtml(id) + '">' + sectionHeading(title) +
      '<div class="store-video-product-grid" data-store-carousel data-store-carousel-pages="' + pages + '" data-store-carousel-page-active="0" role="region" aria-label="Produtos de ' + escapeHtml(title) + '" tabindex="0">' + carouselPages + "</div>" +
      (products.length > 2 ? '<div class="store-video-dots" data-store-carousel-dots aria-label="Paginação de ' + escapeHtml(title) + '">' + Array.from({ length: pages }, function (_item, index) { return '<button type="button" class="' + (index === 0 ? "active" : "") + '" data-store-carousel-dot="' + index + '" aria-label="Ir para a página ' + (index + 1) + '" aria-current="' + (index === 0 ? "true" : "false") + '"></button>'; }).join("") + "</div>" : "") +
      (extraCount ? '<div class="store-video-more-row"><i></i><button type="button" data-store-category-expand data-store-more-count="' + extraCount + '"><span>Ver mais</span><b>' + extraCount + "+</b></button><i></i></div>" : "") +
    "</section>";
  }

  function updateStoreCarousel(track) {
    if (!track) return;
    const pageCount = Math.max(1, Number(track.dataset.storeCarouselPages || 1));
    const pageWidth = Math.max(1, Number(track.clientWidth || 1));
    const activePage = Math.max(0, Math.min(pageCount - 1, Math.round(Number(track.scrollLeft || 0) / pageWidth)));
    track.dataset.storeCarouselPageActive = String(activePage);
    const section = track.closest(".store-category-section");
    section?.querySelectorAll("[data-store-carousel-dot]").forEach(function (dot, index) {
      const active = index === activePage;
      dot.classList.toggle("active", active);
      dot.setAttribute("aria-current", active ? "true" : "false");
    });
  }

  function scrollStoreCarousel(track, page, behavior) {
    if (!track) return;
    const pageCount = Math.max(1, Number(track.dataset.storeCarouselPages || 1));
    const targetPage = Math.max(0, Math.min(pageCount - 1, Number(page || 0)));
    const left = targetPage * Math.max(1, Number(track.clientWidth || 1));
    if (typeof track.scrollTo === "function") track.scrollTo({ left: left, behavior: behavior || "smooth" });
    else track.scrollLeft = left;
  }

  function searchModal(products) {
    return '<div class="store-dialog-backdrop" data-store-search-modal hidden><section class="store-dialog store-search-dialog" role="dialog" aria-modal="true" aria-label="Buscar produtos"><div class="store-dialog-heading"><div><small>TW STORE</small><h2>Buscar produtos</h2></div><button type="button" data-store-close-dialog aria-label="Fechar">' + storeIcon("close") + '</button></div><label class="store-dialog-search">' + storeIcon("search") + '<input type="search" data-store-search placeholder="Digite o nome do produto" autocomplete="off" maxlength="100"></label><div class="store-search-results" data-store-search-results>' + products.map(function (product) { return catalogCard(product, false); }).join("") + '</div><div class="store-search-empty" data-store-search-empty hidden><h3>Nenhum produto encontrado</h3><p>Tente outro nome ou categoria.</p></div></section></div>';
  }

  function purchaseModal() {
    return '<div class="store-dialog-backdrop" data-store-purchase-modal hidden><section class="store-dialog store-purchase-dialog" role="dialog" aria-modal="true" aria-label="Finalizar assinatura"><div class="store-dialog-heading"><div><small>FINALIZAR COMPRA</small><h2 data-store-purchase-name>Assinatura</h2></div><button type="button" data-store-close-dialog aria-label="Fechar">' + storeIcon("close") + '</button></div><div class="store-purchase-summary"><span>Valor da assinatura</span><strong data-store-purchase-price>—</strong></div><form data-store-subscription-order><input type="hidden" name="productId"><label><span>E-mail que receberá a assinatura</span><input type="email" name="deliveryEmail" inputmode="email" autocomplete="email" maxlength="254" placeholder="seuemail@exemplo.com" required><small>Confira com atenção. Os dados serão preparados pelo administrador e enviados para este e-mail.</small></label><button type="submit" class="store-purchase-submit">' + storeIcon("wallet") + '<span>Finalizar com a carteira</span></button></form></section></div>';
  }

  function walletModal() {
    return '<div class="store-dialog-backdrop" data-store-wallet-modal hidden><section class="store-dialog store-purchase-dialog store-wallet-dialog" role="dialog" aria-modal="true" aria-label="Adicionar saldo à carteira"><div data-store-wallet-content><div class="store-dialog-loading"><span class="spinner"></span> Carregando carteira…</div></div></section></div>';
  }

  function ordersModal() {
    return '<div class="store-dialog-backdrop" data-store-orders-modal hidden><section class="store-dialog store-orders-dialog" role="dialog" aria-modal="true" aria-label="Meus pedidos"><div class="store-dialog-heading"><div><small>MINHA CONTA</small><h2>Meus pedidos</h2></div><button type="button" data-store-close-dialog aria-label="Fechar">' + storeIcon("close") + '</button></div><div data-store-orders-list><div class="store-dialog-loading"><span class="spinner"></span> Carregando pedidos…</div></div></section></div>';
  }

  function moreMenu(current) {
    return '<div class="store-more-wrap"><button type="button" class="store-icon-button store-menu-button" data-store-toggle-more aria-label="Abrir menu" aria-expanded="false">' + storeIcon("more") + '</button><div class="store-more-menu" data-store-more-menu role="menu" hidden><div class="store-more-account"><span>' + escapeHtml(initials(current.member || current.username)) + '</span><div><b>' + escapeHtml(current.member || "Cliente") + '</b><small>@' + escapeHtml(current.username || "cliente") + '</small></div></div><button type="button" data-store-open-profile role="menuitem">' + storeIcon("user") + '<span><b>Perfil</b><small>Conta, foto e senha</small></span></button><button type="button" data-store-open-orders role="menuitem">' + storeIcon("cart") + '<span><b>Meus pedidos</b><small>Todas as compras e dados recebidos</small></span></button><button type="button" data-store-open-tickets role="menuitem">' + storeIcon("ticket") + '<span><b>Meus tickets</b><small>Acompanhar atendimentos</small></span></button><button type="button" data-store-whatsapp role="menuitem">' + storeIcon("headset") + '<span><b>Suporte</b><small>Abrir conversa no WhatsApp</small></span></button><button type="button" class="store-more-logout" data-store-logout role="menuitem">' + storeIcon("logout") + '<span><b>Sair</b><small>Desconectar da conta</small></span></button></div></div>';
  }

  function profileModal() {
    return '<div class="store-dialog-backdrop" data-store-profile-modal hidden><section class="store-dialog store-profile-dialog" role="dialog" aria-modal="true" aria-label="Perfil"><div data-store-profile-content><div class="store-dialog-loading"><span class="spinner"></span> Carregando perfil…</div></div></section></div>';
  }

  function supportModal() {
    return '<div class="store-dialog-backdrop" data-store-support-modal hidden><section class="store-dialog store-support-dialog" role="dialog" aria-modal="true" aria-label="Suporte"><div data-store-support-content></div></section></div>';
  }

  function smmOrderModal() {
    return '<div class="store-dialog-backdrop" data-store-smm-modal hidden><section class="store-dialog store-smm-detail-dialog" role="dialog" aria-modal="true" aria-label="Fazer pedido SMM"><div data-store-smm-content></div></section></div>';
  }

  function renderMemberStorefront(main, payload) {
    if (!document.body.contains(main)) return;
    const catalog = normalizedCatalog(payload);
    const current = session() || {};
    memberProducts = catalog.products;
    const balance = main.querySelector(".balance-value")?.textContent || "Minha carteira";
    const featured = catalog.products.filter(function (product) { return product.featured; }).slice(0, 3);
    const spotlight = featured.length ? featured : catalog.products.slice(0, 3);
    const subscriptions = catalog.products.filter(function (product) { return product.kind === "subscription"; });
    const categorySections = catalog.categories.map(function (category) {
      const products = productsForCategory(catalog.products, category).filter(function (product) { return product.kind !== "subscription"; });
      return catalogSection(category.name, products, category.id);
    }).join("");
    main.classList.add("storefront-page");
    main.dataset.storefrontEnhanced = "true";
    main.closest(".app-shell")?.classList.add("storefront-shell");
    document.body.classList.add("storefront-active");
    const featuredSection = spotlight.length
      ? '<section class="store-featured" id="store-catalog-start">' + sectionHeading("Produtos em Destaque") + '<div class="store-feature-grid">' + spotlight.map(featuredCard).join("") + "</div></section>"
      : '<section class="store-empty" id="store-catalog-start"><h2>A vitrine está sendo preparada</h2><p>O administrador ainda não publicou produtos com foto e preço.</p></section>';

    main.innerHTML =
      '<a class="store-promo" href="#store-catalog-start" data-store-scroll="store-catalog-start">CLIQUE AQUI E GARANTA DESCONTOS EXCLUSIVOS! ❤️</a>' +
      '<header class="store-reference-header"><div class="store-header-inner"><div class="store-header-left">' + moreMenu(current) + '<button type="button" class="store-brand" data-store-scroll="store-hero-start"><img src="./tw-store-icon.png" alt="Ícone Tw Store"><b>Tw Store</b><span class="store-verified">' + storeIcon("check") + '</span></button></div><div class="store-header-actions"><button type="button" class="store-icon-button" data-store-open-search aria-label="Buscar">' + storeIcon("search") + '</button><button type="button" class="store-icon-button" data-store-whatsapp aria-label="Abrir suporte no WhatsApp">' + storeIcon("headset") + '</button><button type="button" class="store-header-wallet" data-store-open-wallet aria-label="Abrir carteira e adicionar saldo. Saldo atual: ' + escapeHtml(balance) + '">' + storeIcon("wallet") + '<span>' + escapeHtml(balance) + '</span></button><button type="button" class="store-icon-button" data-store-open-profile aria-label="Abrir perfil">' + storeIcon("user") + "</button></div></div></header>" +
      '<section class="store-hero" id="store-hero-start"><div class="store-hero-copy"><div class="store-review-badge">' + storeIcon("star") + '<b>4.9</b><i></i>' + storeIcon("check") + '<span>+50 Mil avaliações</span>' + storeIcon("arrow") + '</div><h1>Bem Vindo(a)<strong>Tw Store!</strong></h1><p>A Tw Store oferece qualidade, segurança e confiança em cada pedido. Sua experiência é nossa prioridade.</p><div class="store-hero-actions"><button type="button" class="store-primary-action" data-store-community>' + storeIcon("discord") + ' Comunidade</button><button type="button" class="store-secondary-action" data-store-whatsapp>' + storeIcon("headset") + ' Suporte</button></div></div></section>' +
      featuredSection + catalogSection("Assinaturas", subscriptions, "subscriptions") + categorySections +
      '<footer class="store-video-footer"><img src="./tw-store-icon.png" alt="Tw Store"><div><b>Tw Store</b><small>Qualidade, segurança e confiança.</small></div><button type="button" data-store-open-wallet aria-label="Abrir carteira e adicionar saldo">' + storeIcon("wallet") + '<span>' + escapeHtml(balance) + "</span></button></footer>" +
      searchModal(catalog.products) + purchaseModal() + walletModal() + ordersModal() + profileModal() + supportModal() + smmOrderModal();
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

  function closeMoreMenu() {
    const menu = document.querySelector("[data-store-more-menu]");
    const trigger = document.querySelector("[data-store-toggle-more]");
    if (menu) menu.hidden = true;
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  }

  function toggleMoreMenu(trigger) {
    const menu = trigger?.closest(".store-more-wrap")?.querySelector("[data-store-more-menu]");
    if (!menu) return;
    const opening = menu.hidden;
    closeMoreMenu();
    menu.hidden = !opening;
    trigger.setAttribute("aria-expanded", opening ? "true" : "false");
  }

  function dialogHeading(kicker, title, backMode) {
    return '<div class="store-dialog-heading store-account-heading"><div class="store-dialog-title-row">' + (backMode ? '<button type="button" class="store-dialog-back" data-store-support-mode="' + escapeHtml(backMode) + '" aria-label="Voltar">' + storeIcon("back") + '</button>' : "") + '<div><small>' + escapeHtml(kicker) + '</small><h2>' + escapeHtml(title) + '</h2></div></div><button type="button" data-store-close-dialog aria-label="Fechar">' + storeIcon("close") + '</button></div>';
  }

  function profileAvatar(profile) {
    return profile.profilePhoto
      ? '<img src="' + escapeHtml(profile.profilePhoto) + '" alt="Foto de perfil">'
      : '<span>' + escapeHtml(initials(profile.name || profile.username)) + '</span>';
  }

  async function openProfile() {
    closeMoreMenu();
    const modal = document.querySelector("[data-store-profile-modal]");
    const host = modal?.querySelector("[data-store-profile-content]");
    if (!modal || !host) return;
    host.innerHTML = dialogHeading("MINHA CONTA", "Perfil") + '<div class="store-dialog-loading"><span class="spinner"></span> Carregando perfil…</div>';
    openDialog(modal);
    const results = await Promise.allSettled([api("/api/account"), api("/api/wallet")]);
    if (!document.body.contains(host)) return;
    if (results[0].status !== "fulfilled") {
      host.innerHTML = dialogHeading("MINHA CONTA", "Perfil") + '<div class="store-dialog-empty">' + storeIcon("user") + '<h3>Não foi possível carregar</h3><p>' + escapeHtml(results[0].reason.message) + '</p></div>';
      return;
    }
    const profile = results[0].value;
    const wallet = results[1].status === "fulfilled" ? results[1].value : null;
    host.innerHTML = dialogHeading("MINHA CONTA", "Perfil") +
      '<section class="store-profile-card"><div class="store-profile-avatar" data-store-profile-avatar>' + profileAvatar(profile) + '</div><div class="store-profile-identity"><h3>' + escapeHtml(profile.name) + '</h3><span>@' + escapeHtml(profile.username) + '</span><small>Cliente Tw Store</small></div><button type="button" class="store-profile-photo-button" data-store-choose-profile-photo>' + storeIcon("camera") + '<span>Alterar foto</span></button><input type="file" accept="image/jpeg,image/png,image/webp" data-store-profile-photo-input hidden></section>' +
      '<section class="store-profile-wallet"><div>' + storeIcon("wallet") + '<span><small>SALDO DA CARTEIRA</small><strong>' + (wallet ? money(wallet.balance) : "Indisponível") + '</strong></span></div><small>Usado nas assinaturas e pedidos SMM.</small></section>' +
      '<details class="store-profile-password"><summary>' + storeIcon("lock") + '<span><b>Alterar senha</b><small>Proteja o acesso à sua conta</small></span>' + storeIcon("arrow") + '</summary><form data-store-profile-password><label><span>Senha atual</span><input name="currentPassword" type="password" autocomplete="current-password" maxlength="256" required></label><label><span>Nova senha</span><input name="newPassword" type="password" minlength="6" maxlength="256" autocomplete="new-password" required></label><label><span>Confirmar nova senha</span><input name="confirmPassword" type="password" minlength="6" maxlength="256" autocomplete="new-password" required></label><button type="submit" class="store-purchase-submit">' + storeIcon("check") + '<span>Salvar nova senha</span></button></form></details>' +
      '<button type="button" class="store-profile-logout" data-store-logout>' + storeIcon("logout") + '<span>Sair da conta</span></button>';
  }

  function ticketStatus(value) {
    const status = String(value || "open");
    if (status === "answered") return { label: "Respondido", className: "answered" };
    if (status === "closed") return { label: "Encerrado", className: "closed" };
    return { label: "Aguardando suporte", className: "open" };
  }

  function supportNewMarkup() {
    return dialogHeading("ATENDIMENTO", "Criar ticket") + '<div class="store-support-tabs"><button type="button" class="active" data-store-support-mode="new">Novo ticket</button><button type="button" data-store-support-mode="tickets">Meus tickets</button></div><form class="store-support-form" data-store-new-ticket><label><span>Assunto</span><input name="subject" minlength="3" maxlength="120" placeholder="Ex.: Dúvida sobre meu pedido" required></label><label><span>Mensagem</span><textarea name="message" minlength="2" maxlength="4000" placeholder="Explique o que aconteceu com detalhes…" required></textarea></label><div class="store-support-notice">' + storeIcon("headset") + '<p><b>Atendimento dentro da Tw Store</b><small>Você poderá acompanhar a resposta em Meus tickets.</small></p></div><button type="submit" class="store-purchase-submit">' + storeIcon("send") + '<span>Enviar ticket</span></button></form>';
  }

  function ticketListCard(ticket) {
    const status = ticketStatus(ticket.status);
    return '<button type="button" class="store-ticket-card" data-store-ticket-view="' + escapeHtml(ticket.id) + '"><div><span class="store-ticket-status ' + status.className + '">' + status.label + '</span><h3>' + escapeHtml(ticket.subject) + '</h3><p>' + escapeHtml(ticket.lastMessage || "Sem mensagens") + '</p></div><footer><small>#' + escapeHtml(String(ticket.id || "").slice(0, 8).toUpperCase()) + '</small><time>' + escapeHtml(dateTime(ticket.lastMessageAt || ticket.updatedAt)) + '</time>' + storeIcon("arrow") + '</footer></button>';
  }

  async function renderTicketList() {
    const host = document.querySelector("[data-store-support-content]");
    if (!host) return;
    host.innerHTML = dialogHeading("ATENDIMENTO", "Meus tickets") + '<div class="store-support-tabs"><button type="button" data-store-support-mode="new">Novo ticket</button><button type="button" class="active" data-store-support-mode="tickets">Meus tickets</button></div><div class="store-dialog-loading"><span class="spinner"></span> Carregando tickets…</div>';
    try {
      const tickets = await api("/api/tickets");
      if (!document.body.contains(host)) return;
      host.innerHTML = dialogHeading("ATENDIMENTO", "Meus tickets") + '<div class="store-support-tabs"><button type="button" data-store-support-mode="new">Novo ticket</button><button type="button" class="active" data-store-support-mode="tickets">Meus tickets</button></div>' + (Array.isArray(tickets) && tickets.length ? '<div class="store-ticket-list">' + tickets.map(ticketListCard).join("") + '</div>' : '<div class="store-dialog-empty">' + storeIcon("ticket") + '<h3>Nenhum ticket ainda</h3><p>Quando precisar, crie um atendimento sem sair da vitrine.</p><button type="button" class="store-inline-action" data-store-support-mode="new">Criar primeiro ticket</button></div>');
    } catch (error) {
      host.innerHTML = dialogHeading("ATENDIMENTO", "Meus tickets") + '<div class="store-dialog-empty"><h3>Não foi possível carregar</h3><p>' + escapeHtml(error.message) + '</p></div>';
    }
  }

  async function renderTicketDetail(ticketId) {
    const host = document.querySelector("[data-store-support-content]");
    if (!host) return;
    host.innerHTML = dialogHeading("TICKET", "Carregando…", "tickets") + '<div class="store-dialog-loading"><span class="spinner"></span> Abrindo conversa…</div>';
    try {
      const ticket = await api("/api/tickets/" + encodeURIComponent(ticketId));
      if (!document.body.contains(host)) return;
      const status = ticketStatus(ticket.status);
      const messages = Array.isArray(ticket.messages) ? ticket.messages : [];
      host.innerHTML = dialogHeading("TICKET #" + String(ticket.id || "").slice(0, 8).toUpperCase(), ticket.subject, "tickets") + '<div class="store-ticket-detail-status"><span class="store-ticket-status ' + status.className + '">' + status.label + '</span><small>Atualizado em ' + escapeHtml(dateTime(ticket.updatedAt)) + '</small></div><section class="store-ticket-thread">' + messages.map(function (message) { const mine = message.senderRole === "member"; return '<article class="' + (mine ? "mine" : "support") + '"><b>' + (mine ? "Você" : "Suporte Tw Store") + '</b><p>' + escapeHtml(message.message) + '</p><time>' + escapeHtml(dateTime(message.createdAt)) + '</time></article>'; }).join("") + '</section>' + (ticket.status !== "closed" ? '<form class="store-ticket-reply" data-store-ticket-reply data-ticket-id="' + escapeHtml(ticket.id) + '"><textarea name="message" maxlength="4000" placeholder="Digite sua resposta…" required></textarea><button type="submit" aria-label="Enviar resposta">' + storeIcon("send") + '</button></form><button type="button" class="store-ticket-close" data-store-ticket-close="' + escapeHtml(ticket.id) + '">Encerrar ticket</button>' : '<div class="store-ticket-closed-note">Este atendimento está encerrado.</div>');
    } catch (error) {
      host.innerHTML = dialogHeading("TICKET", "Atendimento", "tickets") + '<div class="store-dialog-empty"><h3>Não foi possível abrir</h3><p>' + escapeHtml(error.message) + '</p></div>';
    }
  }

  function openSupport(mode) {
    closeMoreMenu();
    const modal = document.querySelector("[data-store-support-modal]");
    const host = modal?.querySelector("[data-store-support-content]");
    if (!modal || !host) return;
    openDialog(modal);
    if (mode === "tickets") renderTicketList();
    else host.innerHTML = supportNewMarkup();
  }

  function multiline(value) {
    return escapeHtml(String(value || "")).replace(/\r?\n/g, "<br>");
  }

  function updateSmmCharge(input) {
    const form = input?.closest("[data-store-smm-order]");
    if (!form) return;
    const quantity = Number(input.value);
    const rate = Number(form.dataset.rate);
    const charge = Number.isFinite(quantity) && Number.isFinite(rate) ? Math.max(.01, (rate * quantity) / 1000) : NaN;
    const preview = form.querySelector("[data-store-smm-charge]");
    if (preview) preview.textContent = Number.isFinite(charge) ? money(charge) : "—";
  }

  function openSmmProduct(target) {
    const product = memberProducts.find(function (item) { return item.kind === "smm" && String(item.sourceId) === String(target.dataset.storeSmm); });
    const modal = document.querySelector("[data-store-smm-modal]");
    const host = modal?.querySelector("[data-store-smm-content]");
    if (!product || !modal || !host) return toast("Este serviço não está mais disponível.", true);
    const previous = target.closest(".store-dialog-backdrop");
    if (previous && previous !== modal) closeDialog(previous);
    const description = product.description || "O administrador ainda não adicionou uma descrição para este serviço.";
    host.innerHTML = dialogHeading("SERVIÇO SMM", product.name) + '<div class="store-smm-product-hero">' + productImage(product, "store-smm-detail-image") + (product.badge ? '<span>' + escapeHtml(product.badge) + '</span>' : "") + '</div><section class="store-smm-product-summary"><div><small>' + escapeHtml(product.categoryName || "Serviço SMM") + '</small><h3>' + escapeHtml(product.name) + '</h3><div class="store-smm-badges"><span>' + storeIcon("box") + ' Mín. ' + escapeHtml(product.min) + '</span><span>' + storeIcon("zap") + ' Pedido automático</span></div></div><strong>' + money(product.priceBRL) + '<small>por 1.000</small></strong></section><form class="store-smm-order-form" data-store-smm-order data-rate="' + escapeHtml(product.priceBRL) + '"><input type="hidden" name="serviceId" value="' + escapeHtml(product.sourceId) + '"><label><span>Link do perfil ou publicação</span><div class="store-smm-field-icon">' + storeIcon("link") + '<input name="link" type="url" inputmode="url" maxlength="2000" placeholder="https://instagram.com/..." required></div></label><label><span>Quantidade</span><input name="quantity" type="number" inputmode="numeric" min="' + escapeHtml(product.min) + '" max="' + escapeHtml(product.max) + '" value="' + escapeHtml(product.min) + '" required data-store-smm-quantity><small>Mínimo: ' + escapeHtml(product.min) + ' • Máximo: ' + escapeHtml(product.max) + '</small></label><div class="store-smm-charge"><span>Total pela quantidade informada</span><strong data-store-smm-charge>' + money((Number(product.priceBRL) * Number(product.min)) / 1000) + '</strong></div><button type="submit" class="store-purchase-submit">' + storeIcon("cart") + '<span>Fazer pedido</span></button></form><section class="store-smm-description"><h3>Descrição</h3><div><span>' + storeIcon("info") + '</span><p>' + multiline(description) + '</p></div></section><section class="store-smm-information"><h3>Informações do serviço</h3><article>' + storeIcon("box") + '<div><b>Quantidade permitida</b><small>De ' + escapeHtml(product.min) + ' até ' + escapeHtml(product.max) + ' unidades.</small></div></article><article>' + storeIcon("wallet") + '<div><b>Pagamento pela carteira</b><small>O valor é calculado e debitado ao confirmar.</small></div></article><article>' + storeIcon("shield") + '<div><b>Dados protegidos</b><small>O link é usado somente para executar este pedido.</small></div></article></section>';
    openDialog(modal);
    setTimeout(function () { host.querySelector('input[name="link"]')?.focus(); }, 180);
  }

  async function handleSmmOrder(form) {
    const product = memberProducts.find(function (item) { return item.kind === "smm" && String(item.sourceId) === String(form.elements.serviceId.value); });
    if (!product) return toast("Este serviço não está mais disponível.", true);
    const quantity = Number(form.elements.quantity.value);
    const button = form.querySelector('button[type="submit"]');
    if (button) { button.disabled = true; button.dataset.label = button.innerHTML; button.textContent = "Enviando pedido…"; }
    try {
      const order = await api("/api/orders", { method: "POST", body: { serviceId: Number(product.sourceId), link: form.elements.link.value, quantity: quantity, paymentMethod: "wallet", displayedRateBRL: Number(product.priceBRL), idempotencyKey: randomOrderKey() } });
      const host = form.closest("[data-store-smm-content]");
      if (host) host.innerHTML = dialogHeading("PEDIDO CONFIRMADO", "Tudo certo!") + '<div class="store-smm-success">' + storeIcon("check") + '<h3>Pedido enviado com sucesso</h3><p>O serviço <b>' + escapeHtml(product.name) + '</b> já foi encaminhado para processamento.</p><div><span>Pedido</span><strong>#' + escapeHtml(String(order.providerOrderId || order.id || "").slice(0, 12)) + '</strong></div><button type="button" class="store-purchase-submit" data-store-open-orders>Ver em Meus pedidos</button></div>';
      try {
        const wallet = await api("/api/wallet");
        const footerBalance = document.querySelector(".store-video-footer [data-store-open-profile] span");
        if (footerBalance) footerBalance.textContent = money(wallet.balance);
      } catch { /* o pedido já foi confirmado; saldo será atualizado na próxima carga */ }
      toast("Pedido criado. Consulte o andamento em Meus pedidos.");
    } catch (error) {
      toast(error.message, true);
    } finally {
      if (button && document.body.contains(button)) { button.disabled = false; button.innerHTML = button.dataset.label || "Fazer pedido"; }
    }
  }

  function compressProfilePhoto(file) {
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type || "")) return Promise.reject(new Error("Escolha uma foto JPG, PNG ou WebP."));
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onerror = function () { reject(new Error("Não foi possível ler a foto.")); };
      reader.onload = function () {
        const image = new Image();
        image.onerror = function () { reject(new Error("A foto selecionada é inválida.")); };
        image.onload = function () {
          const size = 256;
          const canvas = document.createElement("canvas");
          canvas.width = size; canvas.height = size;
          const context = canvas.getContext("2d");
          const scale = Math.max(size / image.width, size / image.height);
          const width = image.width * scale; const height = image.height * scale;
          context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
          let quality = .78;
          let result = canvas.toDataURL("image/jpeg", quality);
          while (result.length > 90_000 && quality > .34) { quality -= .08; result = canvas.toDataURL("image/jpeg", quality); }
          if (result.length > 95_000) return reject(new Error("A foto ficou muito grande. Escolha outra imagem."));
          resolve(result);
        };
        image.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
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

  function walletTransactionMarkup(item) {
    const type = String(item.type || item.kind || "movimentação").toLowerCase();
    const amount = Number(item.amount || item.value || 0);
    const isDebit = amount < 0 || type.includes("debit") || type.includes("order") || type.includes("pedido") || type.includes("subscription");
    const labels = { deposit: "Depósito aprovado", credit: "Crédito", debit: "Pedido", order: "Pedido", refund: "Estorno", subscription_order: "Assinatura" };
    const label = item.description || labels[type] || "Movimentação da carteira";
    return '<article class="store-wallet-transaction"><span class="store-wallet-transaction-icon ' + (isDebit ? "debit" : "credit") + '">' + storeIcon(isDebit ? "cart" : "wallet") + '</span><div><b>' + escapeHtml(label) + '</b><small>' + escapeHtml(dateTime(item.createdAt || item.date)) + '</small></div><strong class="' + (isDebit ? "debit" : "credit") + '">' + (isDebit ? "−" : "+") + money(Math.abs(amount)) + "</strong></article>";
  }

  function walletContentMarkup(wallet) {
    const transactions = Array.isArray(wallet?.transactions) ? wallet.transactions : [];
    const history = transactions.length
      ? '<div class="store-wallet-transactions">' + transactions.map(walletTransactionMarkup).join("") + "</div>"
      : '<div class="store-wallet-empty">' + storeIcon("history") + '<div><b>Nenhuma movimentação</b><small>Seus depósitos e pagamentos aparecerão aqui.</small></div></div>';
    return dialogHeading("MINHA CARTEIRA", "Adicionar saldo") +
      '<section class="store-wallet-balance-card"><span class="store-wallet-balance-icon">' + storeIcon("wallet") + '</span><div><small>SALDO DISPONÍVEL</small><strong>' + money(wallet?.balance || 0) + '</strong></div><span class="store-wallet-status"><i></i> INDIVIDUAL</span></section>' +
      '<form class="store-wallet-form" data-store-wallet-deposit>' +
        '<div class="store-wallet-form-heading"><div><small>NOVO DEPÓSITO</small><h3>Quanto deseja adicionar?</h3></div><span>Taxa de 5%</span></div>' +
        '<div class="store-wallet-quick-values" aria-label="Valores sugeridos"><button type="button" data-store-wallet-value="10" aria-pressed="false">R$ 10</button><button type="button" data-store-wallet-value="20" aria-pressed="false">R$ 20</button><button type="button" data-store-wallet-value="50" aria-pressed="false">R$ 50</button><button type="button" data-store-wallet-value="100" aria-pressed="false">R$ 100</button></div>' +
        '<label class="store-wallet-amount-field"><span>Valor que entrará na carteira</span><div class="store-wallet-amount-control"><b>R$</b><input name="amount" type="number" inputmode="decimal" min="5" max="100000" step="0.01" placeholder="0,00" data-store-wallet-amount required></div><small>O valor mínimo para adicionar é R$ 5,00.</small></label>' +
        '<div class="store-wallet-fee-summary" aria-live="polite"><div><span>Crédito na carteira</span><strong data-store-wallet-credit>R$ 0,00</strong></div><div><span>Taxa de pagamento (5%)</span><strong data-store-wallet-fee>R$ 0,00</strong></div><div><span>Total a pagar</span><strong data-store-wallet-total>R$ 0,00</strong></div></div>' +
        '<div class="store-wallet-payment-note">' + storeIcon("shield") + '<p><b>Pagamento protegido</b><small>O saldo é liberado automaticamente após a confirmação do Mercado Pago.</small></p></div>' +
        '<button type="submit" class="store-purchase-submit">' + storeIcon("wallet") + '<span>Continuar para o Mercado Pago</span></button>' +
      '</form>' +
      '<section class="store-wallet-history"><div class="store-wallet-history-heading"><div><small>HISTÓRICO</small><h3>Últimas movimentações</h3></div><button type="button" data-store-wallet-refresh aria-label="Atualizar carteira">Atualizar</button></div>' + history + "</section>";
  }

  function walletErrorMarkup(message) {
    return dialogHeading("MINHA CARTEIRA", "Adicionar saldo") + '<div class="store-dialog-empty store-wallet-error">' + storeIcon("wallet") + '<h3>Não foi possível carregar</h3><p>' + escapeHtml(message) + '</p><button type="button" class="store-purchase-submit" data-store-wallet-retry>Carregar novamente</button></div>';
  }

  function updateStorefrontWalletBalance(value) {
    const formatted = money(value);
    document.querySelectorAll("[data-store-open-wallet]").forEach(function (button) {
      const label = button.querySelector("span");
      if (label) label.textContent = formatted;
      button.setAttribute("aria-label", "Abrir carteira e adicionar saldo. Saldo atual: " + formatted);
    });
  }

  function updateWalletDepositPreview(input) {
    const form = input?.closest("[data-store-wallet-deposit]");
    if (!form) return;
    const amount = Number(String(input.value || "0").replace(",", "."));
    const credit = Number.isFinite(amount) && amount > 0 ? amount : 0;
    const fee = credit * .05;
    const creditNode = form.querySelector("[data-store-wallet-credit]");
    const feeNode = form.querySelector("[data-store-wallet-fee]");
    const totalNode = form.querySelector("[data-store-wallet-total]");
    if (creditNode) creditNode.textContent = money(credit);
    if (feeNode) feeNode.textContent = money(fee);
    if (totalNode) totalNode.textContent = money(credit + fee);
    form.querySelectorAll("[data-store-wallet-value]").forEach(function (button) {
      button.setAttribute("aria-pressed", Math.abs(Number(button.dataset.storeWalletValue) - credit) < .005 ? "true" : "false");
    });
  }

  async function loadWalletDialog(modal) {
    const host = modal?.querySelector("[data-store-wallet-content]");
    if (!host) return;
    host.innerHTML = dialogHeading("MINHA CARTEIRA", "Adicionar saldo") + '<div class="store-dialog-loading"><span class="spinner"></span> Carregando carteira…</div>';
    try {
      const wallet = await api("/api/wallet");
      if (!document.body.contains(host)) return;
      host.innerHTML = walletContentMarkup(wallet);
      updateStorefrontWalletBalance(wallet.balance);
      updateWalletDepositPreview(host.querySelector("[data-store-wallet-amount]"));
    } catch (error) {
      if (document.body.contains(host)) host.innerHTML = walletErrorMarkup(error.message);
    }
  }

  async function openWallet() {
    closeMoreMenu();
    const modal = document.querySelector("[data-store-wallet-modal]");
    if (!modal) return;
    openDialog(modal);
    await loadWalletDialog(modal);
    setTimeout(function () { modal.querySelector("[data-store-wallet-amount]")?.focus(); }, 180);
  }

  function randomWalletDepositKey() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return "deposit-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  async function handleWalletDeposit(form) {
    const amount = Number(String(form.elements.amount.value || "").replace(",", "."));
    if (!Number.isFinite(amount) || amount < 5 || amount > 100000) {
      toast("Informe um valor entre R$ 5,00 e R$ 100.000,00.", true);
      form.elements.amount.focus();
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    if (button) { button.disabled = true; button.dataset.label = button.innerHTML; button.textContent = "Criando pagamento…"; }
    try {
      const payment = await api("/api/wallet/deposits", {
        method: "POST",
        body: { amount: Number(amount.toFixed(2)), feePercent: 5, idempotencyKey: randomWalletDepositKey() },
      });
      const url = payment.checkoutUrl || payment.initPoint || payment.paymentUrl || payment.ticketUrl;
      if (!url) throw new Error("Pagamento criado, mas o servidor não retornou o link do Mercado Pago.");
      toast("Pagamento criado. O saldo será liberado após a aprovação.");
      window.location.href = url;
    } catch (error) {
      toast(error.message, true);
    } finally {
      if (button && document.body.contains(button)) { button.disabled = false; button.innerHTML = button.dataset.label || "Continuar para o Mercado Pago"; }
    }
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
    return '<article class="store-order-card" data-store-order-type="subscription"><div class="store-order-head"><div><small class="store-order-kind">ASSINATURA</small><small>' + escapeHtml(dateTime(order.createdAt)) + '</small><h3>' + escapeHtml(order.productName) + '</h3></div><span class="' + status.className + '">' + status.label + '</span></div><dl><div><dt>Valor</dt><dd>' + money(order.priceBRL) + '</dd></div><div><dt>E-mail de entrega</dt><dd>' + escapeHtml(order.deliveryEmail) + "</dd></div></dl>" + delivered + "</article>";
  }

  function smmOrderStatus(order) {
    const key = String(order.status || "pending").toLowerCase();
    if (key === "completed") return { label: "Concluído", className: "fulfilled" };
    if (["canceled", "cancelled", "error"].includes(key)) return { label: key === "error" ? "Não processado" : "Cancelado", className: "refunded" };
    if (key === "partial") return { label: "Parcial", className: "pending" };
    if (key === "cancel requested") return { label: "Cancelamento solicitado", className: "pending" };
    if (["processing", "in progress"].includes(key)) return { label: "Em andamento", className: "pending" };
    return { label: "Pendente", className: "pending" };
  }

  function orderAmount(order) {
    const values = [order.chargeBRL, order.amountBRL, order.priceBRL, order.estimatedChargeBRL, order.estimatedCharge];
    for (const value of values) {
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
    return NaN;
  }

  function smmOrderCard(order) {
    const status = smmOrderStatus(order);
    const reference = order.providerOrderId || String(order.id || "").slice(0, 8).toUpperCase() || "—";
    const destination = order.link
      ? '<div class="store-order-reference"><span>Link enviado</span><a href="' + escapeHtml(order.link) + '" target="_blank" rel="noopener noreferrer">Abrir destino</a></div>'
      : "";
    const note = String(order.status || "").toLowerCase() === "error"
      ? '<p>O pedido não foi processado e o valor foi devolvido para a carteira.</p>'
      : "";
    return '<article class="store-order-card" data-store-order-type="smm"><div class="store-order-head"><div><small class="store-order-kind">SERVIÇO SMM</small><small>' + escapeHtml(dateTime(order.createdAt)) + '</small><h3>' + escapeHtml(order.serviceName || "Serviço digital") + '</h3></div><span class="' + status.className + '">' + status.label + '</span></div><dl><div><dt>Pedido</dt><dd>#' + escapeHtml(reference) + '</dd></div><div><dt>Quantidade</dt><dd>' + escapeHtml(order.quantity == null ? "—" : order.quantity) + '</dd></div><div><dt>Valor</dt><dd>' + money(orderAmount(order)) + '</dd></div><div><dt>Restante</dt><dd>' + escapeHtml(order.remains == null ? "—" : order.remains) + "</dd></div></dl>" + destination + note + "</article>";
  }

  function vpnOrderStatus(order) {
    const key = String(order.status || "submitting").toLowerCase();
    if (key === "active") return { label: "Ativo", className: "fulfilled" };
    if (["refunded", "error"].includes(key)) return { label: key === "refunded" ? "Estornado" : "Erro", className: "refunded" };
    return { label: "Processando", className: "pending" };
  }

  function vpnOrderCard(order) {
    const status = vpnOrderStatus(order);
    const credentials = [];
    if (order.login) credentials.push("Usuário: " + order.login);
    if (order.password) credentials.push("Senha: " + order.password);
    if (order.uuid) credentials.push("UUID: " + order.uuid);
    const access = credentials.length
      ? '<div class="store-order-delivery"><span>Dados do acesso</span><pre>' + escapeHtml(credentials.join("\n")) + "</pre></div>"
      : order.error ? '<p>' + escapeHtml(order.error) + '</p>' : '<p>O acesso está sendo preparado e aparecerá aqui quando estiver disponível.</p>';
    const validity = order.providerExpiresText || (order.expiresAt ? dateTime(order.expiresAt) : "—");
    return '<article class="store-order-card" data-store-order-type="vpn"><div class="store-order-head"><div><small class="store-order-kind">ACESSO VPN</small><small>' + escapeHtml(dateTime(order.createdAt)) + '</small><h3>' + escapeHtml(order.productName || "Acesso VPN") + '</h3></div><span class="' + status.className + '">' + status.label + '</span></div><dl><div><dt>Valor</dt><dd>' + money(order.priceBRL) + '</dd></div><div><dt>Protocolo</dt><dd>' + escapeHtml(String(order.accessType || "ssh").toUpperCase()) + '</dd></div><div><dt>Plano</dt><dd>' + escapeHtml(order.durationDays || "—") + ' dias</dd></div><div><dt>Validade</dt><dd>' + escapeHtml(validity) + "</dd></div></dl>" + access + "</article>";
  }

  function memberOrderCard(order) {
    if (order.storeOrderType === "smm") return smmOrderCard(order);
    if (order.storeOrderType === "vpn") return vpnOrderCard(order);
    return subscriptionOrderCard(order);
  }

  function mergedMemberOrders(results) {
    const types = ["smm", "subscription", "vpn"];
    const orders = [];
    results.forEach(function (result, index) {
      if (result.status !== "fulfilled" || !Array.isArray(result.value)) return;
      result.value.forEach(function (order) { orders.push({ ...order, storeOrderType: types[index] }); });
    });
    return orders.sort(function (a, b) {
      const left = new Date(a.createdAt || 0).getTime();
      const right = new Date(b.createdAt || 0).getTime();
      return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
    });
  }

  async function openMemberOrders() {
    const modal = document.querySelector("[data-store-orders-modal]");
    const host = modal?.querySelector("[data-store-orders-list]");
    if (!modal || !host) return;
    host.innerHTML = '<div class="store-dialog-loading"><span class="spinner"></span> Carregando pedidos…</div>';
    openDialog(modal);
    try {
      const results = await Promise.allSettled([
        api("/api/orders"),
        api("/api/subscription-orders"),
        api("/api/vpn/orders"),
      ]);
      const availableSources = results.filter(function (result) { return result.status === "fulfilled"; });
      if (!availableSources.length) throw results.find(function (result) { return result.status === "rejected"; })?.reason || new Error("Não foi possível carregar seus pedidos.");
      const orders = mergedMemberOrders(results);
      const unavailableSources = results.filter(function (result) { return result.status === "rejected" && Number(result.reason?.status) !== 404; }).length;
      const toolbar = '<div class="store-order-toolbar"><span>' + orders.length + ' pedido' + (orders.length === 1 ? "" : "s") + '</span><button type="button" data-store-refresh-orders>' + storeIcon("history") + ' Atualizar</button></div>';
      const content = orders.length
        ? '<div class="store-order-list">' + orders.map(memberOrderCard).join("") + "</div>"
        : '<div class="store-dialog-empty">' + storeIcon("history") + '<h3>Nenhum pedido realizado</h3><p>Suas compras de serviços, assinaturas e VPN aparecerão aqui.</p></div>';
      const warning = unavailableSources ? '<p class="store-order-warning">Alguns tipos de pedido não puderam ser atualizados agora. Tente novamente.</p>' : "";
      host.innerHTML = toolbar + content + warning;
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
      setTimeout(openMemberOrders, 180);
    } catch (error) {
      toast(error.message, true);
    } finally {
      if (button && document.body.contains(button)) { button.disabled = false; button.innerHTML = button.dataset.label || "Finalizar com a carteira"; }
    }
  }

  async function handleProfilePassword(form) {
    const data = values(form);
    if (String(data.newPassword || "").length < 6) return toast("A nova senha precisa ter pelo menos 6 caracteres.", true);
    if (data.newPassword !== data.confirmPassword) return toast("As novas senhas não coincidem.", true);
    const button = form.querySelector('button[type="submit"]');
    if (button) { button.disabled = true; button.dataset.label = button.innerHTML; button.textContent = "Salvando…"; }
    try {
      const result = await api("/api/account/password", { method: "POST", body: { currentPassword: data.currentPassword, newPassword: data.newPassword } });
      saveSession({ ...(session() || {}), ...result });
      form.reset();
      toast("Senha alterada com sucesso.");
    } catch (error) {
      toast(error.message, true);
    } finally {
      if (button && document.body.contains(button)) { button.disabled = false; button.innerHTML = button.dataset.label || "Salvar nova senha"; }
    }
  }

  async function handleNewTicket(form) {
    const data = values(form);
    const button = form.querySelector('button[type="submit"]');
    if (button) { button.disabled = true; button.dataset.label = button.innerHTML; button.textContent = "Enviando…"; }
    try {
      const ticket = await api("/api/tickets", { method: "POST", body: { subject: data.subject, message: data.message } });
      toast("Ticket criado com sucesso.");
      await renderTicketDetail(ticket.id);
    } catch (error) {
      toast(error.message, true);
    } finally {
      if (button && document.body.contains(button)) { button.disabled = false; button.innerHTML = button.dataset.label || "Enviar ticket"; }
    }
  }

  async function handleTicketReply(form) {
    const data = values(form);
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      await api("/api/tickets/" + encodeURIComponent(form.dataset.ticketId) + "/messages", { method: "POST", body: { message: data.message } });
      await renderTicketDetail(form.dataset.ticketId);
    } catch (error) {
      toast(error.message, true);
    } finally {
      if (button && document.body.contains(button)) button.disabled = false;
    }
  }

  document.addEventListener("submit", function (event) {
    const walletDeposit = event.target.closest("[data-store-wallet-deposit]");
    if (walletDeposit) {
      event.preventDefault();
      event.stopImmediatePropagation();
      handleWalletDeposit(walletDeposit);
      return;
    }
    const smmOrder = event.target.closest("[data-store-smm-order]");
    if (smmOrder) {
      event.preventDefault();
      event.stopImmediatePropagation();
      handleSmmOrder(smmOrder);
      return;
    }
    const profilePassword = event.target.closest("[data-store-profile-password]");
    if (profilePassword) {
      event.preventDefault();
      event.stopImmediatePropagation();
      handleProfilePassword(profilePassword);
      return;
    }
    const newTicket = event.target.closest("[data-store-new-ticket]");
    if (newTicket) {
      event.preventDefault();
      event.stopImmediatePropagation();
      handleNewTicket(newTicket);
      return;
    }
    const ticketReply = event.target.closest("[data-store-ticket-reply]");
    if (ticketReply) {
      event.preventDefault();
      event.stopImmediatePropagation();
      handleTicketReply(ticketReply);
      return;
    }
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
    const profileInput = event.target.closest("[data-store-profile-photo-input]");
    if (profileInput && profileInput.files && profileInput.files[0]) {
      compressProfilePhoto(profileInput.files[0]).then(function (photoDataUrl) {
        return api("/api/account/profile-photo", { method: "PATCH", body: { photoDataUrl: photoDataUrl } });
      }).then(function () {
        toast("Foto de perfil atualizada.");
        return openProfile();
      }).catch(function (error) {
        toast(error.message, true);
      }).finally(function () { profileInput.value = ""; });
      return;
    }
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
    const walletAmount = event.target.closest("[data-store-wallet-amount]");
    if (walletAmount) {
      updateWalletDepositPreview(walletAmount);
      return;
    }
    const smmQuantity = event.target.closest("[data-store-smm-quantity]");
    if (smmQuantity) {
      updateSmmCharge(smmQuantity);
      return;
    }
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
    const moreToggle = event.target.closest("[data-store-toggle-more]");
    if (moreToggle) {
      event.preventDefault();
      toggleMoreMenu(moreToggle);
      return;
    }
    if (!event.target.closest(".store-more-wrap")) closeMoreMenu();
    const openSearch = event.target.closest("[data-store-open-search]");
    if (openSearch) {
      event.preventDefault();
      const modal = document.querySelector("[data-store-search-modal]");
      openDialog(modal);
      setTimeout(function () { modal?.querySelector("[data-store-search]")?.focus(); }, 180);
      return;
    }
    const openProfileButton = event.target.closest("[data-store-open-profile]");
    if (openProfileButton) {
      event.preventDefault();
      openProfile();
      return;
    }
    const openWalletButton = event.target.closest("[data-store-open-wallet]");
    if (openWalletButton) {
      event.preventDefault();
      openWallet();
      return;
    }
    const walletRetry = event.target.closest("[data-store-wallet-retry], [data-store-wallet-refresh]");
    if (walletRetry) {
      event.preventDefault();
      loadWalletDialog(walletRetry.closest("[data-store-wallet-modal]"));
      return;
    }
    const walletValue = event.target.closest("[data-store-wallet-value]");
    if (walletValue) {
      event.preventDefault();
      const form = walletValue.closest("[data-store-wallet-deposit]");
      const input = form?.querySelector("[data-store-wallet-amount]");
      if (input) {
        input.value = walletValue.dataset.storeWalletValue || "";
        updateWalletDepositPreview(input);
        input.focus();
      }
      return;
    }
    const whatsapp = event.target.closest("[data-store-whatsapp]");
    if (whatsapp) {
      event.preventDefault();
      closeMoreMenu();
      window.location.href = WHATSAPP_URL;
      return;
    }
    const openTicketsButton = event.target.closest("[data-store-open-tickets]");
    if (openTicketsButton) {
      event.preventDefault();
      openSupport("tickets");
      return;
    }
    const openOrders = event.target.closest("[data-store-open-orders]");
    if (openOrders) {
      event.preventDefault();
      closeMoreMenu();
      const previousDialog = openOrders.closest(".store-dialog-backdrop");
      if (previousDialog && !previousDialog.matches("[data-store-orders-modal]")) {
        closeDialog(previousDialog);
        setTimeout(openMemberOrders, 170);
      } else {
        openMemberOrders();
      }
      return;
    }
    const refreshOrders = event.target.closest("[data-store-refresh-orders]");
    if (refreshOrders) {
      event.preventDefault();
      openMemberOrders();
      return;
    }
    const supportMode = event.target.closest("[data-store-support-mode]");
    if (supportMode) {
      event.preventDefault();
      if (supportMode.dataset.storeSupportMode === "tickets") renderTicketList();
      else {
        const host = document.querySelector("[data-store-support-content]");
        if (host) host.innerHTML = supportNewMarkup();
      }
      return;
    }
    const ticketView = event.target.closest("[data-store-ticket-view]");
    if (ticketView) {
      event.preventDefault();
      renderTicketDetail(ticketView.dataset.storeTicketView);
      return;
    }
    const ticketClose = event.target.closest("[data-store-ticket-close]");
    if (ticketClose) {
      event.preventDefault();
      if (!window.confirm("Deseja encerrar este ticket?")) return;
      try {
        await api("/api/tickets/" + encodeURIComponent(ticketClose.dataset.storeTicketClose) + "/close", { method: "PATCH" });
        toast("Ticket encerrado.");
        await renderTicketDetail(ticketClose.dataset.storeTicketClose);
      } catch (error) { toast(error.message, true); }
      return;
    }
    const choosePhoto = event.target.closest("[data-store-choose-profile-photo]");
    if (choosePhoto) {
      event.preventDefault();
      choosePhoto.closest("[data-store-profile-content]")?.querySelector("[data-store-profile-photo-input]")?.click();
      return;
    }
    const logout = event.target.closest("[data-store-logout]");
    if (logout) {
      event.preventDefault();
      localStorage.removeItem(SESSION_KEY);
      window.location.reload();
      return;
    }
    const community = event.target.closest("[data-store-community]");
    if (community) {
      event.preventDefault();
      window.location.href = DISCORD_URL;
      return;
    }
    const carouselDot = event.target.closest("[data-store-carousel-dot]");
    if (carouselDot) {
      event.preventDefault();
      const section = carouselDot.closest(".store-category-section");
      scrollStoreCarousel(section?.querySelector("[data-store-carousel]"), Number(carouselDot.dataset.storeCarouselDot || 0));
      return;
    }
    const expand = event.target.closest("[data-store-category-expand]");
    if (expand) {
      event.preventDefault();
      const section = expand.closest(".store-category-section");
      if (!section) return;
      const carousel = section.querySelector("[data-store-carousel]");
      if (carousel) carousel.scrollLeft = 0;
      section.classList.toggle("store-category-expanded");
      const expanded = section.classList.contains("store-category-expanded");
      const label = expand.querySelector("span");
      const count = expand.querySelector("b");
      if (label) label.textContent = expanded ? "Mostrar menos" : "Ver mais";
      if (count) count.hidden = expanded;
      updateStoreCarousel(carousel);
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
      openSmmProduct(smm);
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
  document.addEventListener("scroll", function (event) {
    const carousel = event.target?.closest?.("[data-store-carousel]");
    if (!carousel || carousel.dataset.storeCarouselScrollQueued === "true") return;
    carousel.dataset.storeCarouselScrollQueued = "true";
    requestAnimationFrame(function () {
      delete carousel.dataset.storeCarouselScrollQueued;
      updateStoreCarousel(carousel);
    });
  }, true);
  document.addEventListener("keydown", function (event) {
    const carousel = event.target?.closest?.("[data-store-carousel]");
    if (carousel && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const current = Number(carousel.dataset.storeCarouselPageActive || 0);
      scrollStoreCarousel(carousel, current + (event.key === "ArrowRight" ? 1 : -1));
      return;
    }
    if (event.key !== "Escape") return;
    closeMoreMenu();
    const openDialogs = document.querySelectorAll(".store-dialog-backdrop.open");
    if (openDialogs.length) closeDialog(openDialogs[openDialogs.length - 1]);
  });
  window.addEventListener("resize", function () {
    document.querySelectorAll("[data-store-carousel]").forEach(function (carousel) {
      scrollStoreCarousel(carousel, Number(carousel.dataset.storeCarouselPageActive || 0), "auto");
    });
  });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) scheduleSync(); });
  scheduleSync();
})();
