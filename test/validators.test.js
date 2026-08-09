import assert from "node:assert/strict";
import test from "node:test";
import { HttpError, httpUrl, quantity, uuid } from "../src/validators.js";

test("validates order quantities against service bounds", () => {
  assert.equal(quantity("100", 50, 1000), 100);
  assert.throws(() => quantity(10, 50, 1000), (error) => error instanceof HttpError && error.status === 400);
});

test("accepts only HTTP(S) links", () => {
  assert.equal(httpUrl("https://instagram.com/example"), "https://instagram.com/example");
  assert.throws(() => httpUrl("javascript:alert(1)"), /http/);
});

test("validates UUID order identifiers", () => {
  assert.equal(uuid("ef1eb514-b78e-4bc6-b3a6-8f8c5591486c"), "ef1eb514-b78e-4bc6-b3a6-8f8c5591486c");
  assert.throws(() => uuid("1"), /inválido/);
});
