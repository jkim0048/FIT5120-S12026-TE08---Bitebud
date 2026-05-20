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

/** Compose the in-memory bucket key from route prefix and client IP. */
function rateLimitKey(req: FastifyRequest, prefix: string): string {
  // Rate limit is intentionally keyed by IP (not user id) to prevent easy header spoofing.
  const identity = req.ip || "unknown";
  return `${prefix}:${identity}`;
}

/**
 * Bump and check the IP rate-limit bucket for this request. When the bucket exceeds `opts.limit` in
 * `opts.windowMs`, this function sends a 429 response on `reply` (the caller should return early after).
 */
export function enforceRateLimit(
  req: FastifyRequest,
  reply: FastifyReply,
  opts: RateLimitOpts,
): void {
  const now = Date.now();
  const bucketKey = rateLimitKey(req, opts.keyPrefix);
  const currentBucket = buckets.get(bucketKey);
  if (!currentBucket || now - currentBucket.windowStart >= opts.windowMs) {
    buckets.set(bucketKey, { windowStart: now, count: 1 });
    return;
  }
  currentBucket.count += 1;
  if (currentBucket.count <= opts.limit) return;

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((opts.windowMs - (now - currentBucket.windowStart)) / 1000),
  );
  void reply
    .header("Retry-After", String(retryAfterSeconds))
    .status(429)
    .send({
      // Keep message generic to avoid giving attackers tuning hints.
      error: "Too many requests. Please wait a moment and try again.",
      code: "RATE_LIMITED",
      retryAfterSeconds,
    });
}

