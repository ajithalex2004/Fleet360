/**
 * In-memory sliding window rate limiter for multi-tenant API protection.
 * Each key tracks an array of request timestamps within the window.
 */

export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

export class RateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly store: Map<string, number[]>;

  constructor(options: RateLimiterOptions) {
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
    this.store = new Map();
  }

  check(key: string, limit?: number): RateLimitResult {
    const effectiveLimit = limit ?? this.maxRequests;
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Get existing timestamps and filter to current window
    const timestamps = (this.store.get(key) ?? []).filter(t => t > windowStart);

    const allowed = timestamps.length < effectiveLimit;

    if (allowed) {
      timestamps.push(now);
    }

    this.store.set(key, timestamps);

    const remaining = Math.max(0, effectiveLimit - timestamps.length);
    // Reset time is when the oldest request in the window will expire
    const oldestInWindow = timestamps[0];
    const resetMs = oldestInWindow ? oldestInWindow + this.windowMs : now + this.windowMs;

    return { allowed, remaining, resetMs };
  }

  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const [key, timestamps] of this.store.entries()) {
      const fresh = timestamps.filter(t => t > windowStart);
      if (fresh.length === 0) {
        this.store.delete(key);
      } else {
        this.store.set(key, fresh);
      }
    }
  }

  /**
   * Returns the per-minute request limit for a given plan.
   */
  static getLimitForPlan(plan: string): number {
    switch (plan?.toUpperCase()) {
      case 'TRIAL':        return 60;
      case 'STANDARD':     return 200;
      case 'PROFESSIONAL': return 500;
      case 'ENTERPRISE':   return 1000;
      default:             return 60;
    }
  }
}
