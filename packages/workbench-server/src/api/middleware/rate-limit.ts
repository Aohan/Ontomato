import { Request, Response, NextFunction } from "express";
import { tApp } from "../../i18n";

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

/**
 * Simple in-memory token bucket rate limiter.
 *
 * Configured per-route or globally to prevent abuse.
 * Uses the client IP as the default key.
 */
export function rateLimiter(opts?: {
  /** Max requests allowed in the window (default 60) */
  maxRequests?: number;
  /** Time window in seconds (default 60) */
  windowSeconds?: number;
  /** Custom key extractor (default uses req.ip) */
  keyExtractor?: (req: Request) => string;
  /** Custom error message */
  message?: string;
}) {
  const maxRequests = opts?.maxRequests ?? 60;
  const windowMs = (opts?.windowSeconds ?? 60) * 1000;
  const refillRate = maxRequests / (opts?.windowSeconds ?? 60);
  const message = opts?.message ?? tApp("foundation.rateLimit.tooManyRequests");

  const buckets = new Map<string, TokenBucket>();

  // Periodically clean up stale entries
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now - bucket.lastRefill > windowMs * 2) {
        buckets.delete(key);
      }
    }
  }, 60_000);
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = opts?.keyExtractor ? opts.keyExtractor(req) : (req.ip ?? "unknown");
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: maxRequests, lastRefill: now };
      buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(maxRequests, bucket.tokens + elapsed * refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      res.status(429).json({
        success: false,
        error: message,
        code: "RATE_LIMITED",
      });
      return;
    }

    bucket.tokens -= 1;
    next();
  };
}
