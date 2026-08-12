/**
 * Unit tests for src/lib/rate-limiter.ts
 *
 * What is tested:
 *  - Basic sliding window: allows up to N requests in windowMs, blocks the (N+1)th
 *  - Per-call limit override (used by plan-tier limits)
 *  - resetMs advances as the oldest request ages out
 *  - cleanup() evicts fully-expired keys but preserves partially-expired ones
 *  - getLimitForPlan() returns the documented limits per plan tier
 *
 * Prerequisites: none — pure unit tests, no DB or server required.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RateLimiter } from '@/lib/rate-limiter';

describe('RateLimiter.check()', () => {
  let now = 1_700_000_000_000;

  beforeEach(() => {
    now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });

  it('allows requests up to the configured limit', async () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 5 });
    for (let i = 0; i < 5; i++) {
      const r = await limiter.check('tenant-1:/api/x');
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(5 - i - 1);
    }
  });

  it('blocks the request that exceeds the limit', async () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 3 });
    await limiter.check('k');
    await limiter.check('k');
    await limiter.check('k');
    const blocked = await limiter.check('k');
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('uses the per-call limit override when provided', async () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1000 });
    // Override down to 2 for this call:
    await limiter.check('k', 2);
    await limiter.check('k', 2);
    const blocked = await limiter.check('k', 2);
    expect(blocked.allowed).toBe(false);
  });

  it('keeps separate counters per key', async () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 2 });
    expect((await limiter.check('tenant-a:/api/x')).allowed).toBe(true);
    expect((await limiter.check('tenant-a:/api/x')).allowed).toBe(true);
    expect((await limiter.check('tenant-a:/api/x')).allowed).toBe(false);
    // tenant-b is unaffected
    expect((await limiter.check('tenant-b:/api/x')).allowed).toBe(true);
    expect((await limiter.check('tenant-b:/api/x')).allowed).toBe(true);
  });

  it('lets requests age out of the window', async () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 2 });
    await limiter.check('k');
    await limiter.check('k');
    expect((await limiter.check('k')).allowed).toBe(false);

    // Advance past the window
    now += 61_000;
    expect((await limiter.check('k')).allowed).toBe(true);
  });

  it('resetMs points to when the oldest in-window request expires', async () => {
    const initialNow = 1_700_000_000_000;
    now = initialNow;
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 5 });
    await limiter.check('k');                          // oldest in window
    now += 5_000;
    await limiter.check('k');                          // newer
    const r = await limiter.check('k');                // newest, doesn't push resetMs
    // Oldest is initialNow; reset = initialNow + windowMs
    expect(r.resetMs).toBe(initialNow + 60_000);
    // And resetMs is strictly after "now"
    expect(r.resetMs).toBeGreaterThan(now);
  });
});

describe('RateLimiter.cleanup()', () => {
  let now = 1_700_000_000_000;

  beforeEach(() => {
    now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });

  it('removes keys whose entries are all outside the window', async () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 5 });
    await limiter.check('expired-key');
    now += 120_000;
    limiter.cleanup();
    // After cleanup the slot should be available again
    expect((await limiter.check('expired-key')).allowed).toBe(true);
  });

  it('keeps keys with at least one in-window entry', async () => {
    // limit=1 so any preserved in-window entry blocks the next request.
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1 });
    await limiter.check('mixed-key');                   // t=0
    now += 30_000;
    await limiter.check('mixed-key');                   // t=30_000 — would normally be blocked
                                                        // (we expect allowed=true because limit
                                                        //  is per-check, but the entry IS stored)
    // Wait — limit=1 means first check is allowed=true, stores [t=0].
    // Second check sees [t=0] in window, allowed=false, store unchanged.
    // So we need a different scenario to exercise cleanup-with-partial-window.

    // New scenario: limit=2, two entries, first out-of-window after time advance.
    const limiter2 = new RateLimiter({ windowMs: 60_000, maxRequests: 2 });
    await limiter2.check('mixed-key');                  // t=0
    now += 30_000;
    await limiter2.check('mixed-key');                  // t=30_000, store [0, 30_000]
    now += 50_000;                                      // t=80_000 — 0 is out, 30_000 is in
    limiter2.cleanup();
    // After cleanup, store = [30_000]; one slot left at limit=2
    const r1 = await limiter2.check('mixed-key');       // allowed (now 2 in window)
    expect(r1.allowed).toBe(true);
    const r2 = await limiter2.check('mixed-key');       // blocked
    expect(r2.allowed).toBe(false);
  });
});

describe('RateLimiter.getLimitForPlan()', () => {
  it.each([
    ['TRIAL', 60],
    ['STANDARD', 200],
    ['PROFESSIONAL', 500],
    ['ENTERPRISE', 1000],
    ['unknown-plan', 60],                       // falls back to TRIAL
    [undefined, 60],
    ['', 60],
  ])('plan %s → %i req/min', (plan, expected) => {
    // Cast to any to exercise the runtime defensive path (plan may be undefined)
    expect(RateLimiter.getLimitForPlan(plan as unknown as string)).toBe(expected);
  });

  it('is case-insensitive', () => {
    expect(RateLimiter.getLimitForPlan('enterprise')).toBe(1000);
    expect(RateLimiter.getLimitForPlan('Enterprise')).toBe(1000);
  });
});
