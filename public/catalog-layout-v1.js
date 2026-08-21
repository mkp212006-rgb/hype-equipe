(function () {
  "use strict";

  const SESSION_KEY = "tw-store.session.v3";
  const API_URL = window.location.origin;
  const app = document.getElementById("app");
  if (!app) return;

  let memberServicesCache = null;
  let adminServicesCache = null;
  let syncScheduled = false;

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

  function firstNumber() {
    for (let i = 0; i < arguments.length; i += 1) {
      const number = Number(arguments[i]);
      if (Number.isFinite(number)) return number;
    }
    return NaN;
  }

  function serviceId(service) {
    return firstNumber(service && service.service, service && service.serviceId, service && service.id);
  }

  function serviceName(service) {
    return String(service && (service.customName || service.displayName || service.name) || "Serviço");
  }

  function serviceCategory(service) {
    return String(service && (service.categoryName || service.customCategory || service.category) || "Sem categoria");
  }

  function serviceDescription(service) {
    return String(service && (service.description || service.customDescription) || "").trim();
  }

  function servicePrice(service) {
    return firstNumber(
      service && service.pricePerThousandBRL,
      service && service.rateBRL,
      service && service.sellingRateBRL,
      service && service.price_per_thousand_brl
    );
  }

  function serviceMin(service) {
    const value = firstNumber(service && service.min, service && service.min_quantity);
    return Number.isFinite(value) ? value : "—";
  }

  function serviceMax(service) {
    const value = firstNumber(service && service.max, service && service.max_quantity);
    return Number.isFinite(value) ? value : "—";
  }

  function averageTime(service) {
    const candidates = [
      service && service.averageTime,
      service && service.avgTime,
      service && service.average_time,
      service && service.deliveryTime,
      service && service.delivery_time,
      service && service.time,
    ];
    const found = candidates.find(function (value) { return value != null && String(value).trim(); });
    return found == null ? "Não informado" : String(found).trim();
  }

  function refillText(service) {
    if (!service || service.refill == null) return "";
    return service.refill ? "Recarga disponível" : "Sem recarga";
  }

  function icon(name) {
    const paths = {
      search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.7-3.7"/>',
      chevron: '<path d="m9 18 6-6-6-6"/>',
      down: '<path d="m7 9 5 5 5-5"/>',
      category: '<path d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v5H4zM14 15h6v5h-6z"/>',
      box: '<path d="m21 8-9-5-9 5 9 5Z"/><path d="m3 8 9 5 9-5v8l-9 5-9-5Z"/><path d="M12 13v8"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      edit: '<path d="M4 20h4l11-11-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    };
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || paths.box) + '</svg>';
  }

  async function api(path) {
    const current = session();
    if (!current || !current.token) throw new Error("Sessão inválida.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(API_URL + path, {

      headers: { Accept: "application/json", Authorization: "Bearer " + current.token },
    }, signal: controller.signal });
    clearTimeout(timeout);
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
    if (!response.ok) throw new Error(data.error || "Não foi possível carregar o catálogo.");
    return data;
  }

  async function memberServices() {
    if (memberServicesCache) return memberServicesCache;
    const data = await api("/api/services");
    memberServicesCache = Array.isArray(data) ? data : [];
    return memberServicesCache;
  }

  async function adminServices() {
    if (adminServicesCache) return adminServicesCache;
    const data = await api("/admin/services");
    adminServicesCache = Array.isArray(data) ? data : [];
    return adminServicesCache;
  }

  function currentService(services, select) {
    const wanted = Number(select && select.value);
    return services.find(function (service) { return serviceId(service) === wanted; }) || null;
  }

  function summaryMarkup(service, fallbackText) {
    if (!service) {
      return '<span class="catalog-select-main"><b>' + escapeHtml(fallbackText || "Selecionar") + '</b></span>' + icon("down");
    }
    return '<span class="catalog-select-main"><span class="catalog-id-pill">' + escapeHtml(serviceId(service)) + '</span><b>' + escapeHtml(serviceName(service)) + '</b></span>' + icon("down");
  }

  function categoryButtonMarkup(category) {
    return '<span class="catalog-select-main"><span class="catalog-select-leading">' + icon("category") + '</span><b>' + escapeHtml(category || "Selecionar categoria") + '</b></span>' + icon("down");
  }

  function serviceOptionMarkup(service, selected) {
    const price = servicePrice(service);
    const desc = serviceDescription(service);
    const refill = refillText(service);
    const details = [
      desc,
      'Mín. ' + serviceMin(service) + ' • Máx. ' + serviceMax(service),
      'Tempo: ' + averageTime(service),
      refill,
    ].filter(Boolean);
    return '<button type="button" class="catalog-service-option ' + (selected ? 'selected' : '') + '" data-catalog-service-id="' + escapeHtml(serviceId(service)) + '">' +
      '<span class="catalog-service-line"><span class="catalog-id-pill">' + escapeHtml(serviceId(service)) + '</span><strong>' + escapeHtml(serviceName(service)) + '</strong><span class="catalog-option-arrow">' + icon("chevron") + '</span></span>' +
      '<span class="catalog-service-description">' + escapeHtml(details.join(' | ')) + '</span>' +
      '<span class="catalog-service-price">' + (Number.isFinite(price) ? money(price) + ' por 1.000' : 'Preço definido no aplicativo') + '</span>' +
      (selected ? '<span class="catalog-selected-check">' + icon("check") + '</span>' : '') +
    '</button>';
  }

  function closeMemberPanels(root, except) {
    root.querySelectorAll("[data-catalog-panel]").forEach(function (panel) {
      if (panel !== except) panel.hidden = true;
    });
    root.querySelectorAll("[data-catalog-toggle]").forEach(function (button) {
      button.classList.toggle("open", !button.nextElementSibling.hidden);
    });
  }

  async function enhanceMemberOrder(form) {
    if (!form || ["true", "loading"].includes(form.dataset.catalogLayoutEnhanced)) return;
    form.dataset.catalogLayoutEnhanced = "loading";
    try {
      const services = await memberServices();
      if (!form.isConnected) return;
      const categorySelect = form.querySelector("[data-order-category]");
      const serviceSelect = form.querySelector("[data-order-service]");
      const searchInput = form.querySelector("[data-order-search]");
      if (!categorySelect || !serviceSelect) return;

      form.dataset.catalogLayoutEnhanced = "true";
      form.classList.add("catalog-layout-member");

      const categoryShell = categorySelect.closest(".smm-select-shell");
      const serviceShell = serviceSelect.closest(".smm-select-shell");
      if (!categoryShell || !serviceShell) return;
      categoryShell.classList.add("catalog-native-select-shell");
      serviceShell.classList.add("catalog-native-select-shell");

      const categoryUi = document.createElement("div");
      categoryUi.className = "catalog-choice";
      categoryUi.innerHTML = '<button type="button" class="catalog-select-button" data-catalog-toggle="category"></button><div class="catalog-choice-panel catalog-category-panel" data-catalog-panel="category" hidden></div>';
      categoryShell.insertAdjacentElement("afterend", categoryUi);

      const serviceUi = document.createElement("div");
      serviceUi.className = "catalog-choice";
      serviceUi.innerHTML = '<button type="button" class="catalog-select-button" data-catalog-toggle="service"></button><div class="catalog-choice-panel catalog-service-panel" data-catalog-panel="service" hidden></div>';
      serviceShell.insertAdjacentElement("afterend", serviceUi);

      const categoryButton = categoryUi.querySelector("[data-catalog-toggle='category']");
      const serviceButton = serviceUi.querySelector("[data-catalog-toggle='service']");
      const categoryPanel = categoryUi.querySelector("[data-catalog-panel='category']");
      const servicePanel = serviceUi.querySelector("[data-catalog-panel='service']");

      function matchingServices() {
        const category = String(categorySelect.value || "");
        const query = String(searchInput && searchInput.value || "").trim().toLocaleLowerCase("pt-BR");
        return services.filter(function (service) {
          if (serviceCategory(service) !== category) return false;
          if (!query) return true;
          const haystack = [serviceId(service), serviceName(service), serviceDescription(service), serviceCategory(service)].join(" ").toLocaleLowerCase("pt-BR");
          return haystack.includes(query);
        });
      }

      function renderCategory() {
        const current = String(categorySelect.value || "");
        categoryButton.innerHTML = categoryButtonMarkup(current);
        categoryPanel.innerHTML = Array.from(categorySelect.options).map(function (option) {
          const selected = option.value === current;
          return '<button type="button" class="catalog-category-option ' + (selected ? 'selected' : '') + '" data-catalog-category-value="' + escapeHtml(option.value) + '"><span>' + icon("category") + '</span><b>' + escapeHtml(option.textContent || option.value) + '</b>' + (selected ? icon("check") : icon("chevron")) + '</button>';
        }).join("");
      }

      function renderServices() {
        const selected = currentService(services, serviceSelect);
        serviceButton.innerHTML = summaryMarkup(selected, serviceSelect.disabled ? "Nenhum serviço encontrado" : "Selecionar serviço");
        const matches = matchingServices();
        servicePanel.innerHTML = matches.length
          ? matches.map(function (service) { return serviceOptionMarkup(service, selected && serviceId(service) === serviceId(selected)); }).join("")
          : '<div class="catalog-empty-options">Nenhum serviço encontrado nesta categoria.</div>';
      }

      function syncAll() {
        renderCategory();
        renderServices();
      }

      categoryButton.addEventListener("click", function () {
        categoryPanel.hidden = !categoryPanel.hidden;
        closeMemberPanels(form, categoryPanel.hidden ? null : categoryPanel);
      });
      serviceButton.addEventListener("click", function () {
        servicePanel.hidden = !servicePanel.hidden;
        closeMemberPanels(form, servicePanel.hidden ? null : servicePanel);
      });

      categoryPanel.addEventListener("click", function (event) {
        const option = event.target.closest("[data-catalog-category-value]");
        if (!option) return;
        categorySelect.value = option.dataset.catalogCategoryValue;
        categorySelect.dispatchEvent(new Event("change", { bubbles: true }));
        categoryPanel.hidden = true;
        setTimeout(syncAll, 0);
      });

      servicePanel.addEventListener("click", function (event) {
        const option = event.target.closest("[data-catalog-service-id]");
        if (!option) return;
        const value = String(option.dataset.catalogServiceId || "");
        const nativeOption = Array.from(serviceSelect.options).find(function (item) { return item.value === value; });
        if (!nativeOption) return;
        serviceSelect.value = value;
        serviceSelect.dispatchEvent(new Event("change", { bubbles: true }));
        servicePanel.hidden = true;
        setTimeout(syncAll, 0);
      });

      categorySelect.addEventListener("change", function () { setTimeout(syncAll, 0); });
      serviceSelect.addEventListener("change", function () { setTimeout(renderServices, 0); });
      if (searchInput) searchInput.addEventListener("input", function () { setTimeout(renderServices, 0); });

      syncAll();
    } catch (error) {
      form.dataset.catalogLayoutEnhanced = "error";
    }
  }

  function findAdminServiceCard(id) {
    const form = app.querySelector('[data-form="service-edit"][data-service-id="' + String(id).replace(/\"/g, '') + '"]');
    return form && form.closest(".service-card");
  }

  async function enhanceAdminCatalog(page) {
    if (!page || ["true", "loading"].includes(page.dataset.catalogBrowserEnhanced)) return;
    page.dataset.catalogBrowserEnhanced = "loading";
    try {
      const services = await adminServices();
      if (!page.isConnected) return;
      page.dataset.catalogBrowserEnhanced = "true";

      const heading = page.querySelector(".page-heading");
      if (!heading) return;
      const browser = document.createElement("section");
      browser.className = "card catalog-admin-browser";
      browser.setAttribute("data-catalog-admin-browser", "true");
      browser.innerHTML =
        '<div class="catalog-browser-heading"><div><span class="eyebrow">CATÁLOGO ORGANIZADO</span><h2>Localizar serviço</h2><p>Encontre rapidamente um produto e abra a edição completa abaixo.</p></div></div>' +
        '<label class="field catalog-admin-search"><span class="field-label">Procurar</span><span class="catalog-search-control">' + icon("search") + '<input type="search" placeholder="Nome ou ID do serviço" data-catalog-admin-search autocomplete="off" /></span></label>' +
        '<div class="field"><span class="field-label">Categoria</span><div class="catalog-choice"><button type="button" class="catalog-select-button" data-catalog-admin-toggle="category"></button><div class="catalog-choice-panel catalog-category-panel" data-catalog-admin-panel="category" hidden></div></div></div>' +
        '<div class="field"><span class="field-label">Serviço</span><div class="catalog-choice"><button type="button" class="catalog-select-button" data-catalog-admin-toggle="service"></button><div class="catalog-choice-panel catalog-service-panel" data-catalog-admin-panel="service" hidden></div></div></div>' +
        '<div class="catalog-admin-selected" data-catalog-admin-selected></div>';
      heading.insertAdjacentElement("afterend", browser);

      const search = browser.querySelector("[data-catalog-admin-search]");
      const categoryButton = browser.querySelector("[data-catalog-admin-toggle='category']");
      const serviceButton = browser.querySelector("[data-catalog-admin-toggle='service']");
      const categoryPanel = browser.querySelector("[data-catalog-admin-panel='category']");
      const servicePanel = browser.querySelector("[data-catalog-admin-panel='service']");
      const selectedBox = browser.querySelector("[data-catalog-admin-selected]");
      const categories = Array.from(new Set(services.map(serviceCategory))).sort(function (a, b) { return a.localeCompare(b, "pt-BR"); });
      let category = "__all__";
      let selectedId = services.length ? serviceId(services[0]) : NaN;

      function filtered() {
        const query = String(search.value || "").trim().toLocaleLowerCase("pt-BR");
        return services.filter(function (service) {
          if (category !== "__all__" && serviceCategory(service) !== category) return false;
          if (!query) return true;
          const haystack = [serviceId(service), serviceName(service), serviceDescription(service), serviceCategory(service)].join(" ").toLocaleLowerCase("pt-BR");
          return haystack.includes(query);
        });
      }

      function selectedService() {
        const list = filtered();
        return list.find(function (service) { return serviceId(service) === Number(selectedId); }) || list[0] || null;
      }

      function render() {
        const list = filtered();
        const selected = selectedService();
        if (selected) selectedId = serviceId(selected);
        categoryButton.innerHTML = categoryButtonMarkup(category === "__all__" ? "Todas as categorias" : category);
        categoryPanel.innerHTML = ['__all__'].concat(categories).map(function (item) {
          const label = item === "__all__" ? "Todas as categorias" : item;
          const active = item === category;
          return '<button type="button" class="catalog-category-option ' + (active ? 'selected' : '') + '" data-catalog-admin-category="' + escapeHtml(item) + '"><span>' + icon("category") + '</span><b>' + escapeHtml(label) + '</b>' + (active ? icon("check") : icon("chevron")) + '</button>';
        }).join("");
        serviceButton.innerHTML = summaryMarkup(selected, "Nenhum serviço encontrado");
        servicePanel.innerHTML = list.length ? list.map(function (service) {
          return serviceOptionMarkup(service, selected && serviceId(service) === serviceId(selected));
        }).join("") : '<div class="catalog-empty-options">Nenhum serviço encontrado.</div>';
        if (!selected) {
          selectedBox.innerHTML = '<div class="catalog-empty-options">Ajuste a busca ou categoria para encontrar um serviço.</div>';
        } else {
          const price = servicePrice(selected);
          selectedBox.innerHTML = '<div class="catalog-admin-selected-copy"><span class="catalog-id-pill">' + escapeHtml(serviceId(selected)) + '</span><div><strong>' + escapeHtml(serviceName(selected)) + '</strong><small>' + escapeHtml(serviceCategory(selected)) + ' • ' + escapeHtml(serviceDescription(selected) || 'Sem descrição') + '</small><small>Mín. ' + escapeHtml(serviceMin(selected)) + ' • Máx. ' + escapeHtml(serviceMax(selected)) + ' • ' + escapeHtml(averageTime(selected)) + '</small><b>' + (Number.isFinite(price) ? money(price) + ' / 1.000' : 'Preço não informado') + '</b></div></div><button type="button" class="button button-secondary button-small" data-catalog-admin-edit="' + escapeHtml(serviceId(selected)) + '">' + icon("edit") + ' Editar este serviço</button>';
        }
      }

      function toggle(panel) {
        [categoryPanel, servicePanel].forEach(function (item) { if (item !== panel) item.hidden = true; });
        panel.hidden = !panel.hidden;
      }

      categoryButton.addEventListener("click", function () { toggle(categoryPanel); });
      serviceButton.addEventListener("click", function () { toggle(servicePanel); });
      search.addEventListener("input", render);
      categoryPanel.addEventListener("click", function (event) {
        const option = event.target.closest("[data-catalog-admin-category]");
        if (!option) return;
        category = option.dataset.catalogAdminCategory;
        categoryPanel.hidden = true;
        render();
      });
      servicePanel.addEventListener("click", function (event) {
        const option = event.target.closest("[data-catalog-service-id]");
        if (!option) return;
        selectedId = Number(option.dataset.catalogServiceId);
        servicePanel.hidden = true;
        render();
      });
      browser.addEventListener("click", function (event) {
        const edit = event.target.closest("[data-catalog-admin-edit]");
        if (!edit) return;
        const card = findAdminServiceCard(edit.dataset.catalogAdminEdit);
        if (!card) return;
        card.classList.add("catalog-admin-focus-card");
        card.scrollIntoView({ behavior: "smooth", block: "start" });
        setTimeout(function () { card.classList.remove("catalog-admin-focus-card"); }, 1800);
      });

      render();
    } catch (error) {
      page.dataset.catalogBrowserEnhanced = "error";
    }
  }

  function sync() {
    syncScheduled = false;
    const current = session();
    if (!current || !current.token) return;
    if (current.role === "member") {
      const form = app.querySelector('[data-form="new-order"]');
      if (form) enhanceMemberOrder(form);
      return;
    }
    if (current.role === "admin") {
      const page = app.querySelector(".admin-catalog-page");
      if (page) enhanceAdminCatalog(page);
    }
  }

  function scheduleSync() {
    if (syncScheduled) return;
    syncScheduled = true;
    setTimeout(sync, 0);
  }

  const observer = new MutationObserver(scheduleSync);
  observer.observe(app, { childList: true, subtree: true });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) scheduleSync(); });
  scheduleSync();
})();
