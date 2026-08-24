(function () {
  "use strict";

  const railwayPublicUrl = "https://tw-store-application.up.railway.app";
  const currentOrigin = window.location && /^(https?:)$/.test(window.location.protocol)
    ? window.location.origin
    : railwayPublicUrl;
  const scheduled = new Map();

  function schedule(key, callback) {
    const name = String(key || "default");
    if (scheduled.has(name)) return;
    const run = function () {
      scheduled.delete(name);
      callback();
    };
    const handle = typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame(run)
      : window.setTimeout(run, 16);
    scheduled.set(name, handle);
  }

  window.TW_STORE_CONFIG = Object.freeze({
    apiBaseUrl: currentOrigin.replace(/\/+$/, ""),
    railwayPublicUrl,
    requestTimeoutMs: 15_000,
    schedule,
  });
})();
