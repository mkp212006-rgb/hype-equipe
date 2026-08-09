import assert from "node:assert/strict";
import test from "node:test";
import { hashSecret, signToken, verifySecret, verifyToken } from "../src/crypto.js";

test("hashes and verifies secrets without storing plaintext", async () => {
  const hash = await hashSecret("a-secure-test-password");
  assert.match(hash, /^scrypt-v1\$/);
  assert.equal(hash.includes("a-secure-test-password"), false);
  assert.equal(await verifySecret("a-secure-test-password", hash), true);
  assert.equal(await verifySecret("wrong-password", hash), false);
});

test("signs, validates and rejects modified session tokens", () => {
  const secret = "x".repeat(48);
  const token = signToken({ sub: "admin", role: "admin", version: 1 }, secret, { ttlSeconds: 60 });
  assert.equal(verifyToken(token, secret).sub, "admin");
  const replacement = token.endsWith("a") ? "b" : "a";
  const modifiedToken = `${token.slice(0, -1)}${replacement}`;
  assert.notEqual(modifiedToken, token);
  assert.throws(() => verifyToken(modifiedToken, secret), /Token inválido/);
});
