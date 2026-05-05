import type { FastifyReply, FastifyRequest } from "fastify";

type RateLimitOpts = {
  keyPrefix: string;
  limit: number;
  windowMs: number;
};

type Bucket = { windowStart: number; count: number };

// Simple in-memory limiter (good for single instance; resets on restart).
// Note: in a multi-instance deployment you’d want Redis/Upstash/etc so limits are shared.
const buckets = new Map<string, Bucket>();

function rateLimitKey(req: FastifyRequest, prefix: string): string {
  // Rate limit is intentionally keyed by IP (not user id) to prevent easy header spoofing.
  const identity = req.ip || "unknown";
  return `${prefix}:${identity}`;
}

export function enforceRateLimit(
  req: FastifyRequest,
  reply: FastifyReply,
  opts: RateLimitOpts,
): void {
  const now = Date.now();
  const key = rateLimitKey(req, opts.keyPrefix);
  const cur = buckets.get(key);
  if (!cur || now - cur.windowStart >= opts.windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    return;
  }
  cur.count += 1;
  if (cur.count <= opts.limit) return;

  const retryAfterSec = Math.max(1, Math.ceil((opts.windowMs - (now - cur.windowStart)) / 1000));
  void reply
    .header("Retry-After", String(retryAfterSec))
    .status(429)
    .send({
      // Keep message generic to avoid giving attackers tuning hints.
      error: "Too many requests. Please wait a moment and try again.",
      code: "RATE_LIMITED",
      retryAfterSeconds: retryAfterSec,
    });
}

