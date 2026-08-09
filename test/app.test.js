import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createApp } from "../src/app.js";
import { hashSecret } from "../src/crypto.js";

async function startTestServer() {
  const adminHash = await hashSecret("unit-test-password-123");
  const teamHash = await hashSecret("team-code-123");
  const admin = {
    username: "admin",
    password_hash: adminHash,
    token_version: 1,
    must_change_password: true,
  };
  const fakeDb = {
    healthcheck: async () => {},
    getTeamAuth: async () => ({ codeHash: teamHash, tokenVersion: 1 }),
    getAdmin: async (username) => username === "admin" ? admin : null,
    recordAdminLogin: async () => {},
    listServices: async () => [],
    listOrders: async () => [],
    countOrders: async () => 0,
  };
  const fakeSmm = {
    isConfigured: () => false,
    balance: async () => ({ balance: 0, currency: "USD" }),
  };
  const config = {
    nodeEnv: "test",
    jwtSecret: "z".repeat(48),
    tokenTtlSeconds: 3600,
    publicDirectory: new URL("../public", import.meta.url).pathname,
  };
  const app = await createApp({ config, db: fakeDb, smm: fakeSmm });
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
    role: "admin",
    mustChangePassword: true,
  });
});

test("member login rejects an incorrect shared code", async (context) => {
  const server = await startTestServer();
  context.after(server.close);
  const response = await fetch(`${server.baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Pessoa", accessCode: "wrong-code" }),
  });
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /incorreto/);
});
