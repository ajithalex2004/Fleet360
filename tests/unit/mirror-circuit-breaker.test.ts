/**
 * Unit tests for src/lib/mirror-circuit-breaker.ts
 *
 * What is tested:
 *  - Allows writes while under the failure threshold
 *  - Opens the breaker after exactly `threshold` consecutive failures
 *  - Fires the onOpen hook exactly once when transitioning to open
 *  - Stays open for `cooldownMs` even if recordFailure is called again
 *  - Transitions to half-open after cooldown elapses (next isOpen() returns false)
 *  - A successful write in half-open closes the breaker permanently
 *  - A failed write in half-open re-opens with a fresh cooldown window
 *  - A successful write resets the failure counter (below threshold)
 *  - The onOpen hook fires again on a fresh open after a half-open probe failure
 *
 * Prerequisites: none — pure unit tests, no DB or server required.
 *
 * The breaker is intentionally injectable with a fake clock via the `now`
 * config option, so we don't have to use vi.useFakeTimers() (which would
 * also affect the rest of the test suite's setup.ts).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MirrorCircuitBreaker } from '@/lib/mirror-circuit-breaker';

describe('MirrorCircuitBreaker', () => {
  let currentTime = 1_700_000_000_000;
  const advance = (ms: number) => { currentTime += ms; };

  beforeEach(() => {
    currentTime = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => currentTime);
  });

  describe('under threshold', () => {
    it('stays closed', () => {
      const cb = new MirrorCircuitBreaker({ threshold: 3, cooldownMs: 60_000, now: () => currentTime });
      expect(cb.isOpen()).toBe(false);
      cb.recordFailure();
      expect(cb.isOpen()).toBe(false);
      cb.recordFailure();
      expect(cb.isOpen()).toBe(false);
    });
  });

  describe('crossing the threshold', () => {
    it('opens after exactly threshold consecutive failures', () => {
      const cb = new MirrorCircuitBreaker({ threshold: 3, cooldownMs: 60_000, now: () => currentTime });
      cb.recordFailure();
      cb.recordFailure();
      const opened = cb.recordFailure();
      expect(opened).toBe(true);
      expect(cb.isOpen()).toBe(true);
    });

    it('fires onOpen exactly once on the threshold-crossing call', () => {
      const onOpen = vi.fn();
      const cb = new MirrorCircuitBreaker({
        threshold: 3, cooldownMs: 60_000, now: () => currentTime, onOpen,
      });
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();                          // crosses → fires onOpen
      cb.recordFailure();                          // still open, no re-fire
      cb.recordFailure();                          // still open, no re-fire
      expect(onOpen).toHaveBeenCalledTimes(1);
    });
  });

  describe('cooldown behaviour', () => {
    it('stays open for cooldownMs even if more failures arrive', () => {
      const cb = new MirrorCircuitBreaker({ threshold: 2, cooldownMs: 60_000, now: () => currentTime });
      cb.recordFailure();
      cb.recordFailure();                          // opens; cooldownEnd = now + 60s
      advance(30_000);
      cb.recordFailure();                          // still in cooldown
      expect(cb.isOpen()).toBe(true);
      advance(29_000);                              // now 59s past original
      expect(cb.isOpen()).toBe(true);
    });

    it('transitions to half-open after cooldown elapses', () => {
      const cb = new MirrorCircuitBreaker({ threshold: 2, cooldownMs: 60_000, now: () => currentTime });
      cb.recordFailure();
      cb.recordFailure();                          // opens
      advance(60_001);
      expect(cb.isOpen()).toBe(false);             // half-open: probe allowed
    });
  });

  describe('half-open recovery', () => {
    it('a successful write after half-open closes the breaker', () => {
      const cb = new MirrorCircuitBreaker({ threshold: 2, cooldownMs: 60_000, now: () => currentTime });
      cb.recordFailure();
      cb.recordFailure();                          // opens
      advance(60_001);
      expect(cb.isOpen()).toBe(false);             // half-open
      cb.recordSuccess();
      expect(cb.state.open).toBe(false);
      expect(cb.state.failCount).toBe(0);
      // And stays closed under further traffic
      advance(120_000);
      expect(cb.isOpen()).toBe(false);
    });

    it('a failed probe re-opens with a fresh cooldown', () => {
      const onOpen = vi.fn();
      const cb = new MirrorCircuitBreaker({
        threshold: 2, cooldownMs: 60_000, now: () => currentTime, onOpen,
      });
      cb.recordFailure();
      cb.recordFailure();                          // opens (onOpen #1)
      advance(60_001);
      expect(cb.isOpen()).toBe(false);             // half-open
      cb.recordFailure();                          // probe fails
      expect(cb.isOpen()).toBe(true);              // re-opened
      expect(onOpen).toHaveBeenCalledTimes(2);     // fires onOpen again
      // And the new cooldown is full-length from the probe time
      advance(59_999);
      expect(cb.isOpen()).toBe(true);
      advance(2);
      expect(cb.isOpen()).toBe(false);             // new cooldown expired
    });
  });

  describe('success resets counter', () => {
    it('a success below the threshold resets failCount', () => {
      const cb = new MirrorCircuitBreaker({ threshold: 3, cooldownMs: 60_000, now: () => currentTime });
      cb.recordFailure();
      cb.recordFailure();                          // 2/3
      cb.recordSuccess();
      expect(cb.state.failCount).toBe(0);
      cb.recordFailure();
      cb.recordFailure();                          // 2/3 again — must NOT open
      expect(cb.isOpen()).toBe(false);
    });
  });
});