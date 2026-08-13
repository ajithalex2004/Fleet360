/**
 * Sliding-window rate limiter for multi-tenant API protection.
 *
 * Strategy:
 *  - When Upstash Redis is configured (UPSTASH_REDIS_REST_URL +
 *    UPSTASH_REDIS_REST_TOKEN) the limiter uses @upstash/ratelimit sliding
 *    window counters stored in Redis — state is shared across every serverless
 *    instance / container so limits are truly per-tenant-globally.
 *
 *  - When Redis is not configured (dev, CI, local) it falls back to the
 *    original in-process Map<string, number[]> implementation. Limits are
 *    per-process only, but the app still runs without Redis.
 *
 * The public API (`check`, `getLimitForPlan`, `RateLimitResult`) is unchanged
 * so middleware.ts requires no modifications.
 */

import { getRedis } from '@/lib/upstash';

export interface RateLimiterOptions {
  /** Window size in milliseconds. */
  windowMs: number;
  /** Default maximum requests per window. */
  maxRequests: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

// ── In-process fallback (dev / no Redis) ─────────────────────────────────────

class InMemoryRateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly store: Map<string, number[]> = new Map();

  constructor(options: RateLimiterOptions) {
    this.windowMs    = options.windowMs;
    this.maxRequests = options.maxRequests;
  }

  check(key: string, limit?: number): RateLimitResult {
    const effectiveLimit = limit ?? this.maxRequests;
    const now            = Date.now();
    const windowStart    = now - this.windowMs;

    const timestamps = (this.store.get(key) ?? []).filter(t => t > windowStart);
    const allowed    = timestamps.length < effectiveLimit;

    if (allowed) timestamps.push(now);
    this.store.set(key, timestamps);

    const remaining = Math.max(0, effectiveLimit - timestamps.length);
    const oldest    = timestamps[0];
    const resetMs   = oldest ? oldest + this.windowMs : now + this.windowMs;

    return { allowed, remaining, resetMs };
  }

  cleanup(): void {
    const now         = Date.now();
    const windowStart = now - this.windowMs;
    for (const [key, timestamps] of this.store.entries()) {
      const fresh = timestamps.filter(t => t > windowStart);
      if (fresh.length === 0) this.store.delete(key);
      else this.store.set(key, fresh);
    }
  }
}

// ── Upstash sliding-window limiter ───────────────────────────────────────────

/**
 * Lazily-created Ratelimit instances per (windowMs, limit) pair.
 * @upstash/ratelimit requires a fixed limit at construction time, so we keep
 * one instance per distinct limit value we encounter.
 */
const _redisLimiters: Map<string, import('@upstash/ratelimit').Ratelimit> = new Map();

async function checkWithRedis(
  key: string,
  windowMs: number,
  limit: number,
): Promise<RateLimitResult> {
  // Dynamic import so the module resolves at runtime after npm install.
  const { Ratelimit } = await import('@upstash/ratelimit');
  const redis = getRedis()!;

  const cacheKey = `${windowMs}:${limit}`;
  if (!_redisLimiters.has(cacheKey)) {
    _redisLimiters.set(
      cacheKey,
      new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(limit, `${Math.round(windowMs / 1000)} s`),
        prefix:  'rl:fleet360',
      }),
    );
  }

  const limiter = _redisLimiters.get(cacheKey)!;
  const result  = await limiter.limit(key);

  return {
    allowed:   result.success,
    remaining: result.remaining,
    resetMs:   result.reset,
  };
}

// ── Public class ─────────────────────────────────────────────────────────────

export class RateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly fallback: InMemoryRateLimiter;

  constructor(options: RateLimiterOptions) {
    this.windowMs    = options.windowMs;
    this.maxRequests = options.maxRequests;
    this.fallback    = new InMemoryRateLimiter(options);
  }

  /**
   * Check and record a request for `key`.
   * Uses Redis sliding window when Upstash is configured, otherwise falls back
   * to the in-process store.
   */
  async check(key: string, limit?: number): Promise<RateLimitResult> {
    const effectiveLimit = limit ?? this.maxRequests;
    const redis = getRedis();

    if (redis) {
      try {
        return await checkWithRedis(key, this.windowMs, effectiveLimit);
      } catch (err) {
        // Redis unreachable — degrade gracefully to in-memory so requests
        // aren't blocked due to an infrastructure hiccup.
        console.warn('[rate-limiter] Redis error, falling back to in-memory:', err);
      }
    }

    return this.fallback.check(key, effectiveLimit);
  }

  /** Prune the in-process fallback store (no-op when Redis is active). */
  cleanup(): void {
    this.fallback.cleanup();
  }

  /**
   * Returns the per-minute request limit for a given plan.
   */
  static getLimitForPlan(plan: string): number {
    switch (plan?.toUpperCase()) {
      case 'TRIAL':        return 60;
      case 'STANDARD':     return 200;
      case 'PROFESSIONAL': return 500;
      case 'ENTERPRISE':   return 1_000;
      default:             return 60;
    }
  }
}
