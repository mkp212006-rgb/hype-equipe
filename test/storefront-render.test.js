import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("renders the AMOLED Tw Store structure with balanced interactive markup", async () => {
  const original = await readFile(new URL("../public/storefront-v2.js", import.meta.url), "utf8");
  const source = original.replace(/\}\)\(\);\s*$/, "window.__renderMemberStorefront = renderMemberStorefront;\nwindow.__openSmmProduct = openSmmProduct;\nwindow.__setMemberProducts = function (items) { memberProducts = items; };\nwindow.__supportNewMarkup = supportNewMarkup;\nwindow.__moreMenu = moreMenu;\nwindow.__walletContentMarkup = walletContentMarkup;\nwindow.__catalogSection = catalogSection;\nwindow.__memberOrderCard = memberOrderCard;\nwindow.__mergedMemberOrders = mergedMemberOrders;\n})();");
  const app = { querySelector: () => null };
  const classList = { add() {}, remove() {}, toggle() {} };
  const storage = { getItem: () => JSON.stringify({ role: "member", username: "cliente", member: "Cliente" }), setItem() {}, removeItem() {} };
  const document = {
    body: { contains: () => true, classList },
    getElementById: (id) => id === "app" ? app : { innerHTML: "" },
    addEventListener() {},
    querySelector: () => null,
  };
  const window = {
    TW_STORE_CONFIG: {},
    location: { origin: "https://tw.example" },
    crypto: { randomUUID: () => "22222222-2222-4222-8222-222222222222" },
    addEventListener() {},
  };
  const context = vm.createContext({
    window,
    document,
    localStorage: storage,
    sessionStorage: storage,
    MutationObserver: class { observe() {} },
    Intl,
    URL,
    console,
    setTimeout: () => 1,
    clearTimeout() {},
    requestAnimationFrame: (callback) => callback(),
  });
  vm.runInContext(source, context);

  const main = {
    classList,
    dataset: {},
    innerHTML: "",
    querySelector: (selector) => selector === ".balance-value" ? { textContent: "R$ 50,00" } : null,
    closest: () => ({ classList }),
  };
  const subscription = {
    id: "subscription:11111111-1111-4111-8111-111111111111",
    sourceId: "11111111-1111-4111-8111-111111111111",
    kind: "subscription",
    name: "Netflix Premium",
    description: "Conta mensal",
    categoryId: 1,
    categoryName: "Assinaturas",
    imageUrl: "",
    badge: "Mais vendido",
    priceBRL: 9.9,
    priceLabel: "À vista no Pix",
    featured: true,
    sortOrder: 0,
    enabled: true,
  };
  const smm = {
    id: "smm:101",
    sourceId: 101,
    kind: "smm",
    name: "Seguidores Instagram",
    description: "Entrega gradual conforme a descrição cadastrada.",
    categoryId: 2,
    categoryName: "Instagram",
    imageUrl: "",
    badge: "Popular",
    priceBRL: 12.5,
    priceLabel: "por 1.000",
    min: 100,
    max: 10000,
    featured: false,
    sortOrder: 1,
    enabled: true,
  };
  window.__renderMemberStorefront(main, {
    categories: [{ id: 1, name: "Assinaturas", sortOrder: 0, enabled: true }, { id: 2, name: "Instagram", sortOrder: 1, enabled: true }],
    products: [subscription, smm],
  });

  assert.match(main.innerHTML, /tw-store-icon\.png/);
  assert.match(main.innerHTML, /Bem Vindo\(a\)/);
  assert.match(main.innerHTML, /Produtos em Destaque/);
  assert.match(main.innerHTML, /data-store-subscription-order/);
  assert.match(main.innerHTML, /E-mail que receberá a assinatura/);
  assert.match(main.innerHTML, /data-store-toggle-more/);
  assert.match(main.innerHTML, /data-store-open-profile/);
  assert.match(main.innerHTML, /data-store-whatsapp/);
  assert.match(main.innerHTML, /data-store-open-tickets/);
  assert.match(main.innerHTML, /data-store-open-orders/);
  assert.match(main.innerHTML, /Meus pedidos/);
  assert.doesNotMatch(main.innerHTML, /Minhas assinaturas/);
  assert.match(main.innerHTML, /data-store-community[\s\S]*?fill="currentColor" stroke="none"/);
  assert.match(main.innerHTML, /store-header-left/);
  assert.match(main.innerHTML, /store-header-wallet/);
  assert.match(main.innerHTML, /class="store-header-wallet" data-store-open-wallet/);
  assert.match(main.innerHTML, /data-store-wallet-modal/);
  assert.match(main.innerHTML, /Abrir carteira e adicionar saldo/);
  assert.doesNotMatch(main.innerHTML, /class="store-header-wallet" data-nav="wallet"/);
  assert.match(main.innerHTML, /R\$ 50,00/);
  assert.match(main.innerHTML, /data-store-smm="101"/);
  assert.match(main.innerHTML, /data-store-smm-modal/);
  assert.doesNotMatch(main.innerHTML, /store-mosaic/);
  assert.doesNotMatch(main.innerHTML, /store-cart-button/);
  assert.doesNotMatch(main.innerHTML, /data-nav="settings"/);
  assert.doesNotMatch(main.innerHTML, /data-nav="new-order"/);
  assert.doesNotMatch(main.innerHTML, /LMT Store/i);

  const walletMarkup = window.__walletContentMarkup({
    balance: 50,
    transactions: [{ type: "deposit", amount: 20, description: "Depósito aprovado", createdAt: "2026-08-25T12:00:00.000Z" }],
  });
  assert.match(walletMarkup, /data-store-wallet-deposit/);
  assert.match(walletMarkup, /data-store-wallet-amount/);
  assert.match(walletMarkup, /data-store-wallet-value="50"/);
  assert.match(walletMarkup, /Taxa de pagamento \(5%\)/);
  assert.match(walletMarkup, /Continuar para o Mercado Pago/);
  assert.match(walletMarkup, /Últimas movimentações/);
  assert.match(walletMarkup, /R\$\s*50,00/);

  const allOrderMarkup = [
    window.__memberOrderCard({
      storeOrderType: "smm",
      id: "smm-order-1",
      providerOrderId: 987,
      serviceName: "Seguidores Instagram",
      quantity: 1000,
      chargeBRL: 12.5,
      remains: 300,
      status: "In progress",
      link: "https://instagram.com/twstore",
      createdAt: "2026-08-25T13:00:00.000Z",
    }),
    window.__memberOrderCard({
      storeOrderType: "subscription",
      productName: "Netflix Premium",
      priceBRL: 9.9,
      deliveryEmail: "cliente@example.com",
      deliveryData: "login: cliente",
      status: "fulfilled",
      createdAt: "2026-08-25T12:00:00.000Z",
    }),
    window.__memberOrderCard({
      storeOrderType: "vpn",
      productName: "VPN 30 dias",
      priceBRL: 15,
      durationDays: 30,
      accessType: "ssh",
      login: "twcliente",
      password: "senha-segura",
      status: "active",
      createdAt: "2026-08-25T11:00:00.000Z",
    }),
  ].join("");
  assert.match(allOrderMarkup, /SERVIÇO SMM/);
  assert.match(allOrderMarkup, /ASSINATURA/);
  assert.match(allOrderMarkup, /ACESSO VPN/);
  assert.match(allOrderMarkup, /Abrir destino/);
  assert.match(allOrderMarkup, /Dados enviados/);
  assert.match(allOrderMarkup, /Dados do acesso/);
  assert.match(allOrderMarkup, /senha-segura/);

  const merged = window.__mergedMemberOrders([
    { status: "fulfilled", value: [{ id: "smm-old", createdAt: "2026-08-23T10:00:00.000Z" }] },
    { status: "fulfilled", value: [{ id: "subscription-new", createdAt: "2026-08-25T10:00:00.000Z" }] },
    { status: "fulfilled", value: [{ id: "vpn-middle", createdAt: "2026-08-24T10:00:00.000Z" }] },
  ]);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].id, "subscription-new");
  assert.equal(merged[0].storeOrderType, "subscription");
  assert.equal(merged[1].storeOrderType, "vpn");
  assert.equal(merged[2].storeOrderType, "smm");

  const carouselProducts = Array.from({ length: 5 }, (_item, index) => ({
    ...subscription,
    id: `subscription:${index + 1}`,
    sourceId: String(index + 1),
    name: `Assinatura ${index + 1}`,
    sortOrder: index,
  }));
  const carouselMarkup = window.__catalogSection("Assinaturas", carouselProducts, "subscriptions");
  assert.match(carouselMarkup, /data-store-carousel/);
  assert.match(carouselMarkup, /data-store-carousel-pages="3"/);
  assert.equal((carouselMarkup.match(/data-store-carousel-page="/g) || []).length, 3);
  assert.equal((carouselMarkup.match(/data-store-carousel-dot="/g) || []).length, 3);
  assert.match(carouselMarkup, /data-store-carousel-dot="2"/);
  assert.match(carouselMarkup, /aria-current="true"/);
  assert.match(carouselMarkup, /data-store-category-expand/);
  assert.match(carouselMarkup, /Ver mais/);

  for (const tag of ["div", "section", "article", "button"]) {
    const opening = (carouselMarkup.match(new RegExp(`<${tag}(?:\\s|>)`, "g")) || []).length;
    const closing = (carouselMarkup.match(new RegExp(`</${tag}>`, "g")) || []).length;
    assert.equal(opening, closing, `${tag} carousel markup should be balanced`);
  }

  for (const tag of ["div", "section", "button", "form", "header", "footer"]) {
    const opening = (main.innerHTML.match(new RegExp(`<${tag}(?:\\s|>)`, "g")) || []).length;
    const closing = (main.innerHTML.match(new RegExp(`</${tag}>`, "g")) || []).length;
    assert.equal(opening, closing, `${tag} markup should be balanced`);
  }

  const smmHost = { innerHTML: "", querySelector: () => null };
  const smmModal = { hidden: true, classList, querySelector: (selector) => selector === "[data-store-smm-content]" ? smmHost : null };
  document.querySelector = (selector) => selector === "[data-store-smm-modal]" ? smmModal : null;
  window.__setMemberProducts([smm]);
  window.__openSmmProduct({ dataset: { storeSmm: "101" }, closest: () => null });
  assert.match(smmHost.innerHTML, /Link do perfil ou publicação/);
  assert.match(smmHost.innerHTML, /name="quantity"/);
  assert.match(smmHost.innerHTML, /Entrega gradual conforme a descrição cadastrada/);
  assert.match(smmHost.innerHTML, /Informações do serviço/);
  assert.equal(smmModal.hidden, false);

  for (const tag of ["div", "section", "article", "button", "form", "label"]) {
    const opening = (smmHost.innerHTML.match(new RegExp(`<${tag}(?:\\s|>)`, "g")) || []).length;
    const closing = (smmHost.innerHTML.match(new RegExp(`</${tag}>`, "g")) || []).length;
    assert.equal(opening, closing, `${tag} SMM markup should be balanced`);
  }

  const supportMarkup = window.__supportNewMarkup();
  assert.match(supportMarkup, /data-store-new-ticket/);
  assert.match(supportMarkup, /Meus tickets/);
  const menuMarkup = window.__moreMenu({ member: "Cliente", username: "cliente" });
  assert.match(menuMarkup, /data-store-open-profile/);
  assert.match(menuMarkup, /data-store-open-tickets/);
  assert.match(menuMarkup, /data-store-whatsapp/);
});
