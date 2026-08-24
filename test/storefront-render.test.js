import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("renders the AMOLED Tw Store structure with balanced interactive markup", async () => {
  const original = await readFile(new URL("../public/storefront-v2.js", import.meta.url), "utf8");
  const source = original.replace(/\}\)\(\);\s*$/, "window.__renderMemberStorefront = renderMemberStorefront;\n})();");
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
  window.__renderMemberStorefront(main, {
    categories: [{ id: 1, name: "Assinaturas", sortOrder: 0, enabled: true }],
    products: [subscription],
  });

  assert.match(main.innerHTML, /tw-store-icon\.png/);
  assert.match(main.innerHTML, /Bem Vindo\(a\)/);
  assert.match(main.innerHTML, /Produtos em Destaque/);
  assert.match(main.innerHTML, /data-store-subscription-order/);
  assert.match(main.innerHTML, /E-mail que receberá a assinatura/);
  assert.doesNotMatch(main.innerHTML, /LMT Store/i);

  for (const tag of ["div", "section", "button", "form", "header", "footer"]) {
    const opening = (main.innerHTML.match(new RegExp(`<${tag}(?:\\s|>)`, "g")) || []).length;
    const closing = (main.innerHTML.match(new RegExp(`</${tag}>`, "g")) || []).length;
    assert.equal(opening, closing, `${tag} markup should be balanced`);
  }
});
