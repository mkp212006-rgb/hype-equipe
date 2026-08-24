import assert from "node:assert/strict";
import test from "node:test";
import { decryptDeliveryData, encryptDeliveryData, normalizeDeliveryEmail } from "../src/storefront-features.js";

test("normalizes the subscription delivery email", () => {
  assert.equal(normalizeDeliveryEmail("  Cliente@Example.COM "), "cliente@example.com");
});

test("rejects invalid subscription delivery emails", () => {
  for (const value of ["", "sem-arroba", "a@b", "nome @example.com", "@example.com"]) {
    assert.throws(() => normalizeDeliveryEmail(value), /e-mail válido/);
  }
});

test("encrypts subscription delivery data at rest", () => {
  const secret = "s".repeat(48);
  const data = "Login: cliente@example.com\nSenha: segredo-forte";
  const encrypted = encryptDeliveryData(data, secret);
  assert.doesNotMatch(encrypted, /segredo-forte/);
  assert.equal(decryptDeliveryData(encrypted, secret), data);
  assert.equal(decryptDeliveryData(encrypted, "x".repeat(48)), "");
});
