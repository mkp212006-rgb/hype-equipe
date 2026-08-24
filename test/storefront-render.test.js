import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("renders the AMOLED Tw Store structure with balanced interactive markup", async () => {
  const original = await readFile(new URL("../public/storefront-v2.js", import.meta.url), "utf8");
  const source = original.replace(/\}\)\(\);\s*$/, "window.__renderMemberStorefront = renderMemberStorefront;\nwindow.__openSmmProduct = openSmmProduct;\nwindow.__setMemberProducts = function (items) { memberProducts = items; };\nwindow.__supportNewMarkup = supportNewMarkup;\nwindow.__moreMenu = moreMenu;\n})();");
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
  assert.match(main.innerHTML, /store-header-left/);
  assert.match(main.innerHTML, /store-header-wallet/);
  assert.match(main.innerHTML, /class="store-header-wallet" data-nav="wallet"/);
  assert.match(main.innerHTML, /Abrir carteira e adicionar saldo/);
  assert.match(main.innerHTML, /R\$ 50,00/);
  assert.match(main.innerHTML, /data-store-smm="101"/);
  assert.match(main.innerHTML, /data-store-smm-modal/);
  assert.doesNotMatch(main.innerHTML, /store-mosaic/);
  assert.doesNotMatch(main.innerHTML, /store-cart-button/);
  assert.doesNotMatch(main.innerHTML, /data-nav="settings"/);
  assert.doesNotMatch(main.innerHTML, /data-nav="new-order"/);
  assert.doesNotMatch(main.innerHTML, /LMT Store/i);

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
