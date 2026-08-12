/**
 * tests/unit/continuous-driving-watcher.test.ts
 *
 * Pins the behavior of the continuous-driving watcher. The watcher
 * is the engine behind the "take a break" alert in the driver app —
 * it counts time since the last break and reports a level (ok,
 * warning, critical, breach) based on the tenant's CBA limit.
 *
 * Run: npx vitest run tests/unit/continuous-driving-watcher.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createContinuousDrivingWatcher,
  alertLevelForRatio,
  ALERT_LEVEL_META,
  type ContinuousDrivingState,
  type AlertLevel,
} from '@/lib/driver-offline/continuous-driving-watcher';

describe('alertLevelForRatio (boundaries)', () => {
  it('0    → ok', () => expect(alertLevelForRatio(0)).toBe('ok'));
  it('0.50 → ok', () => expect(alertLevelForRatio(0.5)).toBe('ok'));
  it('0.79 → ok (just below the warning threshold)', () => expect(alertLevelForRatio(0.79)).toBe('ok'));
  it('0.80 → warning (boundary)', () => expect(alertLevelForRatio(0.80)).toBe('warning'));
  it('0.95 → warning', () => expect(alertLevelForRatio(0.95)).toBe('warning'));
  it('0.99 → warning (just below critical)', () => expect(alertLevelForRatio(0.99)).toBe('warning'));
  it('1.00 → critical (boundary, at the limit)', () => expect(alertLevelForRatio(1.00)).toBe('critical'));
  it('1.10 → critical', () => expect(alertLevelForRatio(1.10)).toBe('critical'));
  it('1.19 → critical (just below breach)', () => expect(alertLevelForRatio(1.19)).toBe('critical'));
  it('1.20 → breach (boundary)', () => expect(alertLevelForRatio(1.20)).toBe('breach'));
  it('2.00 → breach', () => expect(alertLevelForRatio(2.0)).toBe('breach'));
});

describe('ALERT_LEVEL_META', () => {
  it('has a label + cls + emoji for every level', () => {
    const levels: AlertLevel[] = ['ok', 'warning', 'critical', 'breach'];
    for (const lvl of levels) {
      expect(ALERT_LEVEL_META[lvl]).toBeDefined();
      expect(ALERT_LEVEL_META[lvl].label.length).toBeGreaterThan(0);
      expect(ALERT_LEVEL_META[lvl].cls.length).toBeGreaterThan(0);
      expect(ALERT_LEVEL_META[lvl].emoji.length).toBeGreaterThan(0);
    }
  });
});

describe('createContinuousDrivingWatcher', () => {
  let now = 1_700_000_000_000; // fixed "now" for tests
  const limitMs = 4.5 * 60 * 60 * 1000; // 4.5h
  const shiftStartAt = now - 60 * 60 * 1000; // 1h ago
  const states: ContinuousDrivingState[] = [];
  const levelChanges: Array<{ prev: AlertLevel; next: AlertLevel }> = [];
  let watcher: ReturnType<typeof createContinuousDrivingWatcher>;

  beforeEach(() => {
    now = 1_700_000_000_000;
    states.length = 0;
    levelChanges.length = 0;
    watcher = createContinuousDrivingWatcher({
      limitMs,
      shiftStartAt,
      now: () => now,
      tickIntervalMs: 100_000, // long — we drive ticks manually
      onChange: (s) => states.push(s),
      onLevelChange: (prev, next) => levelChanges.push({ prev, next }),
    });
  });

  it('peek() with mocked clock returns the expected state', () => {
    const s = watcher.peek(now);
    expect(s.drivingMs).toBe(now - shiftStartAt);
    expect(s.shiftMs).toBe(now - shiftStartAt);
    expect(s.limitMs).toBe(limitMs);
    expect(s.level).toBe('ok'); // 1h / 4.5h = ~0.22 → ok
    expect(s.msUntilLimit).toBeGreaterThan(0);
  });

  it('start() fires a synchronous first tick (so the UI has a state on mount)', () => {
    watcher.start();
    expect(states).toHaveLength(1);
    expect(watcher.isRunning()).toBe(true);
  });

  it('stop() halts the timer', () => {
    watcher.start();
    watcher.stop();
    expect(watcher.isRunning()).toBe(false);
  });

  it('getState() returns the last computed state', () => {
    watcher.start();
    const s = watcher.getState();
    expect(s.drivingMs).toBeGreaterThan(0);
    expect(s.limitMs).toBe(limitMs);
  });

  it('injectBreakEnded() resets the baseline and ticks', () => {
    watcher.start();
    // Drive forward 2 hours
    now += 2 * 60 * 60 * 1000;
    const before = watcher.peek(now);
    expect(before.drivingMs).toBe(3 * 60 * 60 * 1000);

    // Inject a break right now
    watcher.injectBreakEnded(now);
    const after = watcher.peek(now);
    expect(after.drivingMs).toBe(0);
    expect(after.shiftMs).toBe(3 * 60 * 60 * 1000); // shift time keeps counting
  });

  it('level transitions fire onLevelChange in the right order', () => {
    watcher.start();
    states.length = 0;
    levelChanges.length = 0;

    // Walk the clock forward to drive through the level boundaries.
    // We use a "manual tick" via the public API: setLimit() forces
    // a tick at the current now(), so we change now() then call
    // setLimit() with the same value to force a re-tick. (The
    // setLimit() with the same value is a no-op for the limit but
    // still calls tick().)
    // Step 1: at 81% of limit → warning
    now = shiftStartAt + limitMs * 0.81;
    watcher.setLimit(limitMs);
    expect(levelChanges.find((c) => c.next === 'warning')).toBeDefined();

    // Step 2: at 101% → critical
    now = shiftStartAt + limitMs * 1.01;
    watcher.setLimit(limitMs);
    expect(levelChanges.find((c) => c.next === 'critical')).toBeDefined();

    // Step 3: at 121% → breach
    now = shiftStartAt + limitMs * 1.21;
    watcher.setLimit(limitMs);
    expect(levelChanges.find((c) => c.next === 'breach')).toBeDefined();
  });

  it('level does NOT regress to ok on its own (only via injectBreakEnded or new limit)', () => {
    watcher.start();
    // Get to critical via setLimit ticks
    now = shiftStartAt + limitMs * 1.05;
    watcher.setLimit(limitMs);
    expect(watcher.getState().level).toBe('critical');

    // Advance 10 minutes — still critical
    now += 10 * 60 * 1000;
    const beforeTransitionCount = levelChanges.length;
    watcher.setLimit(limitMs);
    expect(watcher.getState().level).toBe('critical');
    // No new level transition (still critical → critical)
    expect(levelChanges.length).toBe(beforeTransitionCount);
  });

  it('setLimit() with a lower value can drop the level', () => {
    watcher.start();
    // We're 1h in, level = ok at 4.5h limit
    expect(watcher.getState().level).toBe('ok');

    // New limit: 30min → we are at 1h, well over → breach
    watcher.setLimit(30 * 60 * 1000);
    expect(watcher.getState().level).toBe('breach');
  });

  it('setLimit() with a higher value can recover to ok', () => {
    watcher.start();
    watcher.setLimit(30 * 60 * 1000);
    expect(watcher.getState().level).toBe('breach');

    watcher.setLimit(10 * 60 * 60 * 1000); // 10h
    expect(watcher.getState().level).toBe('ok');
  });

  it('setLimit() with invalid input is ignored (does not crash)', () => {
    watcher.start();
    const before = watcher.getState().limitMs;
    watcher.setLimit(0);
    watcher.setLimit(-1);
    watcher.setLimit(Number.NaN);
    expect(watcher.getState().limitMs).toBe(before);
  });

  it('msUntilLimit is negative when past the limit', () => {
    watcher.start();
    // We're 1h into the shift (baseline = shiftStartAt = 1h before
    // the original now). With limit=4.5h, ratio = 1/4.5 ≈ 0.22.
    // Use peek() to project the state forward to "what if the
    // driver is now 1.5× the limit into driving" without mutating
    // the baseline.
    const futureNow = shiftStartAt + limitMs * 1.5;
    const future = watcher.peek(futureNow);
    expect(future.drivingMs).toBe(limitMs * 1.5);
    expect(future.msUntilLimit).toBeLessThan(0);
    expect(future.level).toBe('breach');
  });

  it('idempotent start() does not double-tick', () => {
    watcher.start();
    watcher.start();
    expect(states).toHaveLength(1);
  });

  it('handles shiftStartAt in the future gracefully (drivingMs = 0)', () => {
    const future = now + 60_000;
    const w = createContinuousDrivingWatcher({
      limitMs,
      shiftStartAt: future,
      now: () => now,
      onChange: () => {},
    });
    const s = w.peek(now);
    expect(s.drivingMs).toBe(0);
    expect(s.level).toBe('ok');
  });
});

describe('createContinuousDrivingWatcher — timer behaviour', () => {
  it('emits onChange on every tick (mocked setInterval)', () => {
    vi.useFakeTimers();
    let now = 1_700_000_000_000;
    const states: ContinuousDrivingState[] = [];
    const w = createContinuousDrivingWatcher({
      limitMs: 4.5 * 60 * 60 * 1000,
      shiftStartAt: now - 1000,
      now: () => now,
      tickIntervalMs: 1000,
      onChange: (s) => states.push(s),
    });
    w.start();
    expect(states).toHaveLength(1);

    now += 5000;
    vi.advanceTimersByTime(5000);
    expect(states.length).toBeGreaterThan(1);
    w.stop();
    vi.useRealTimers();
  });
});
