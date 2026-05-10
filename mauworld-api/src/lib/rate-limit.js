// Tiny in-memory IP rate limiter. Sufficient for a single Render instance.
// If the API is ever scaled to multiple replicas, swap this for a shared
// store (Redis, Supabase RPC, etc.) — the public surface stays the same.

function getClientIp(req) {
  // Render terminates TLS in front of Node and forwards via X-Forwarded-For.
  // Take the first entry, which is the original client IP.
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").trim();
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

/**
 * Create a fixed-window IP rate limiter.
 *
 * @param {{ name: string, windowMs: number, max: number }} options
 * @returns {(req, res, next) => void} Express middleware. Throws HttpError(429)
 *   when an IP exceeds `max` requests inside `windowMs`.
 */
export function createIpRateLimit({ name, windowMs, max }) {
  if (!name || typeof name !== "string") {
    throw new Error("createIpRateLimit: name is required");
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("createIpRateLimit: windowMs must be a positive number");
  }
  if (!Number.isFinite(max) || max <= 0) {
    throw new Error("createIpRateLimit: max must be a positive number");
  }

  const counters = new Map();
  let lastSweep = Date.now();

  function sweep(now) {
    if (now - lastSweep < windowMs) {
      return;
    }
    lastSweep = now;
    for (const [key, entry] of counters) {
      if (entry.resetAt <= now) {
        counters.delete(key);
      }
    }
  }

  return function rateLimitMiddleware(req, res, next) {
    const ip = getClientIp(req);
    const key = `${name}:${ip}`;
    const now = Date.now();
    sweep(now);
    const existing = counters.get(key);
    if (!existing || existing.resetAt <= now) {
      counters.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (existing.count >= max) {
      const retrySec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retrySec));
      res.status(429).json({
        ok: false,
        error: `Too many ${name} requests; retry in ${retrySec}s.`,
        retryAfterSeconds: retrySec,
      });
      return undefined;
    }
    existing.count += 1;
    return next();
  };
}
