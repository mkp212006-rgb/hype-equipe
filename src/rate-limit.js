export function rateLimit(options) {
  const windowMs = options.windowMs;
  const maximum = options.maximum;
  const buckets = new Map();
  let lastCleanup = Date.now();

  return function limit(req, res, next) {
    const now = Date.now();
    if (now - lastCleanup > windowMs) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
      lastCleanup = now;
    }

    const key = `${options.name || "default"}:${req.ip || req.socket.remoteAddress || "unknown"}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    res.setHeader("RateLimit-Limit", String(maximum));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, maximum - bucket.count)));
    res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > maximum) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." });
    }
    next();
  };
}
