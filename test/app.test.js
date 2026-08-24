import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import test from "node:test";
import vm from "node:vm";
import { createApp } from "../src/app.js";
import { hashSecret } from "../src/crypto.js";

async function startTestServer() {
  const adminHash = await hashSecret("unit-test-password-123");
  const memberHash = await hashSecret("member-password-123");
  const admin = {
    username: "admin",
    password_hash: adminHash,
    token_version: 1,
    must_change_password: true,
  };
  const fakeDb = {
    healthcheck: async () => {},
    getAdmin: async (username) => username === "admin" ? admin : null,
    getUser: async (username) => username === "pessoa" ? {
      username: "pessoa",
      name: "Pessoa",
      password_hash: memberHash,
      token_version: 1,
      active: true,
    } : null,
    recordAdminLogin: async () => {},
    recordUserLogin: async () => {},
    listServices: async () => [],
    listOrders: async () => [],
    countOrders: async () => 0,
  };
  const fakeSmm = {
    isConfigured: () => false,
    balance: async () => ({ balance: 0, currency: "USD" }),
  };
  const fakeMercadoPago = {
    isConfigured: () => false,
    isWebhookConfigured: () => false,
  };
  const config = {
    nodeEnv: "test",
    jwtSecret: "z".repeat(48),
    tokenTtlSeconds: 3600,
    publicDirectory: new URL("../public", import.meta.url).pathname,
  };
  const app = await createApp({ config, db: fakeDb, smm: fakeSmm, mercadoPago: fakeMercadoPago });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("admin login creates a working authenticated session", async (context) => {
  const server = await startTestServer();
  context.after(server.close);
  const login = await fetch(`${server.baseUrl}/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "unit-test-password-123" }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  assert.equal(session.role, "admin");
  assert.equal(session.mustChangePassword, true);

  const info = await fetch(`${server.baseUrl}/api/info`, {
    headers: { authorization: `Bearer ${session.token}` },
  });
  assert.equal(info.status, 200);
  assert.deepEqual(await info.json(), {
    member: "Administrador",
    username: "admin",
    role: "admin",
    mustChangePassword: true,
  });
});

test("member login rejects an incorrect password", async (context) => {
  const server = await startTestServer();
  context.after(server.close);
  const response = await fetch(`${server.baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "pessoa", password: "wrong-password" }),
  });
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /incorreto/);
});

test("serves the same-origin runtime configuration without stale asset caching", async (context) => {
  const server = await startTestServer();
  context.after(server.close);

  const home = await fetch(`${server.baseUrl}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get("cache-control") || "", /no-cache/);
  const html = await home.text();
  assert.ok(html.indexOf("runtime-config.js") < html.indexOf("app.js"));

  const runtime = await fetch(`${server.baseUrl}/runtime-config.js`);
  assert.equal(runtime.status, 200);
  assert.match(runtime.headers.get("cache-control") || "", /no-cache/);
  const source = await runtime.text();
  assert.match(source, /window\.location\.origin/);
  assert.match(source, /tw-store-application\.up\.railway\.app/);
  assert.doesNotMatch(source, /hype-equipe-production\.up\.railway\.app/);
});

test("runtime configuration prefers the current origin and coalesces visual work", async () => {
  const source = await readFile(new URL("../public/runtime-config.js", import.meta.url), "utf8");
  const frames = [];
  const window = {
    location: { protocol: "https:", origin: "https://example-service.up.railway.app" },
    requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
    setTimeout,
  };
  vm.runInNewContext(source, { window });
  assert.equal(window.TW_STORE_CONFIG.apiBaseUrl, "https://example-service.up.railway.app");

  let calls = 0;
  window.TW_STORE_CONFIG.schedule("same-task", () => { calls += 1; });
  window.TW_STORE_CONFIG.schedule("same-task", () => { calls += 1; });
  assert.equal(frames.length, 1);
  frames[0]();
  assert.equal(calls, 1);
});

test("serves the storefront layout assets from the same Railway origin", async (context) => {
  const server = await startTestServer();
  context.after(server.close);

  const home = await fetch(`${server.baseUrl}/`);
  const html = await home.text();
  assert.match(html, /storefront-v2\.css/);
  assert.match(html, /storefront-v2\.js/);
  assert.match(html, /theme-color" content="#000000"/);
  assert.match(html, /20260824-modals-2100/);

  const [stylesheet, script, adminScript] = await Promise.all([
    fetch(`${server.baseUrl}/storefront-v2.css`),
    fetch(`${server.baseUrl}/storefront-v2.js`),
    fetch(`${server.baseUrl}/admin-layout-v1.js`),
  ]);
  assert.equal(stylesheet.status, 200);
  assert.equal(script.status, 200);
  assert.equal(adminScript.status, 200);
  const stylesheetSource = await stylesheet.text();
  const scriptSource = await script.text();
  const adminScriptSource = await adminScript.text();
  assert.match(stylesheetSource, /store-mosaic/);
  assert.match(stylesheetSource, /store-reference-header/);
  assert.match(stylesheetSource, /store-feature-grid/);
  assert.match(stylesheetSource, /store-more-menu/);
  assert.match(stylesheetSource, /store-profile-dialog/);
  assert.match(stylesheetSource, /store-support-dialog/);
  assert.match(stylesheetSource, /store-smm-detail-dialog/);
  assert.match(stylesheetSource, /#000/);
  assert.match(scriptSource, /\/api\/storefront/);
  assert.match(scriptSource, /\/api\/subscription-orders/);
  assert.match(scriptSource, /data-store-search/);
  assert.match(scriptSource, /data-store-toggle-more/);
  assert.match(scriptSource, /data-store-open-profile/);
  assert.match(scriptSource, /data-store-open-support/);
  assert.match(scriptSource, /data-store-open-tickets/);
  assert.match(scriptSource, /data-store-smm-order/);
  assert.match(scriptSource, /data-store-profile-password/);
  assert.match(scriptSource, /data-store-new-ticket/);
  assert.match(scriptSource, /data-store-ticket-reply/);
  assert.match(scriptSource, /Link do perfil ou publicação/);
  assert.match(scriptSource, /Informações do serviço/);
  assert.match(scriptSource, /\/api\/account/);
  assert.match(scriptSource, /\/api\/tickets/);
  assert.match(scriptSource, /\/api\/orders/);
  assert.doesNotMatch(scriptSource, /queueServiceSelection/);
  assert.doesNotMatch(scriptSource, /data-nav="settings"/);
  assert.match(scriptSource, /CLIQUE AQUI E GARANTA DESCONTOS EXCLUSIVOS/);
  assert.match(scriptSource, /tw-store-icon\.png/);
  assert.match(adminScriptSource, /\/admin\/subscription-orders/);
  assert.match(adminScriptSource, /Entregas de assinaturas/);
});
