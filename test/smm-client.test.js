import assert from "node:assert/strict";
import test from "node:test";
import { SmmApiError, SmmClient } from "../src/smm-client.js";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("normalizes the standard SMM services response", async () => {
  let submittedBody;
  const client = new SmmClient({
    apiUrl: "https://provider.example/api/v2",
    apiKey: "test-key",
    fetchFn: async (_url, options) => {
      submittedBody = options.body;
      return jsonResponse([{ service: "123", name: "Likes", category: "Instagram", type: "Default", rate: "1.25", min: "10", max: "1000", refill: true, cancel: "false" }]);
    },
  });
  const services = await client.services();
  assert.equal(submittedBody.get("key"), "test-key");
  assert.equal(submittedBody.get("action"), "services");
  assert.deepEqual(services[0], {
    service: 123,
    name: "Likes",
    category: "Instagram",
    type: "Default",
    rate: 1.25,
    min: 10,
    max: 1000,
    refill: true,
    cancel: false,
    raw: { service: "123", name: "Likes", category: "Instagram", type: "Default", rate: "1.25", min: "10", max: "1000", refill: true, cancel: "false" },
  });
});

test("surfaces provider errors without leaking the API key", async () => {
  const client = new SmmClient({
    apiUrl: "https://provider.example/api/v2",
    apiKey: "secret-provider-key",
    fetchFn: async () => jsonResponse({ error: "Invalid service" }),
  });
  await assert.rejects(() => client.addOrder({ serviceId: 1, link: "https://example.com", quantity: 10 }), (error) => {
    assert.equal(error instanceof SmmApiError, true);
    assert.equal(error.message, "Invalid service");
    assert.equal(error.message.includes("secret-provider-key"), false);
    return true;
  });
});
