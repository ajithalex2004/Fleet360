/**
 * src/lib/driver-offline/continuous-driving-watcher.ts
 *
 * Live tracker for the "continuous driving" CBA rule. Counts the time
 * the driver has been driving since the last break (or since the
 * shift started, if no break has been taken yet), and surfaces an
 * escalating alert level as the tenant's CBA limit approaches.
 *
 * Alert levels (drivingMs / limitMs):
 *   0    .. 0.80  →  ok       (green)     no alert
 *   0.80 .. 1.00  →  warning  (yellow)    "break soon"
 *   1.00 .. 1.20  →  critical (orange)    "over the limit"
 *   > 1.20        →  breach   (red)       "stop driving now"
 *
 * The host loads the limit (from /api/driver-app/cba/continuous-
 * driving-limit) and passes it to createContinuousDrivingWatcher.
 * The watcher is *clock-driven* — it has no opinion on what counts
 * as a break. The host injects break events via `injectBreakEnded()`
 * (typically wired to the behavior watcher's IDLE_END events) and
 * shift-start via `injectShiftStart()`.
 *
 * Pure logic, no DOM, no fetch. Fully unit-testable with a mocked
 * clock. Used by the driver app's behavior page and today page.
 */

export type AlertLevel = 'ok' | 'warning' | 'critical' | 'breach';

export interface ContinuousDrivingState {
  /** ms since the last break ended (or shift start, if no break yet). */
  drivingMs: number;
  /** ms since the shift started. Equals drivingMs when no break has been taken. */
  shiftMs: number;
  /** The limit in ms (from CBA). */
  limitMs: number;
  /** ratio = drivingMs / limitMs, e.g. 1.0 means "right at the limit". */
  ratio: number;
  /** Derived alert level. */
  level: AlertLevel;
  /** ms until the limit is reached. Negative = past limit. */
  msUntilLimit: number;
  /** The label for the current level, suitable for the UI. */
  levelLabel: string;
  /** When the last break ended (or shift start), as epoch ms. */
  baselineAt: number;
  /** When this state was computed. */
  computedAt: number;
}

export interface ContinuousDrivingWatcherOptions {
  /** The CBA limit in ms. Required. */
  limitMs: number;
  /** When the shift started (epoch ms). Required. */
  shiftStartAt: number;
  /** How often the watcher should fire onChange, in ms. Default 30000. */
  tickIntervalMs?: number;
  /** Override the clock (for tests). */
  now?: () => number;
  /** Called on every tick (including the first sync tick at start). */
  onChange: (state: ContinuousDrivingState) => void;
  /** Called only when the alert level transitions (e.g. ok → warning). */
  onLevelChange?: (prev: AlertLevel, next: AlertLevel, state: ContinuousDrivingState) => void;
}

export interface ContinuousDrivingWatcher {
  /** Start ticking. Idempotent. */
  start(): void;
  /** Stop ticking. Safe to call multiple times. */
  stop(): void;
  /** True if the watcher is currently ticking. */
  isRunning(): boolean;
  /** Notify the watcher that the driver just took a break. */
  injectBreakEnded(at?: number): void;
  /** Notify the watcher that the limit has been reloaded (e.g. new shift). */
  setLimit(limitMs: number): void;
  /** Snapshot the current state (no callbacks). */
  getState(): ContinuousDrivingState;
  /** Compute state for an arbitrary timestamp (used by tests). */
  peek(at: number): ContinuousDrivingState;
}

/**
 * Resolve an alert level from a ratio (drivingMs / limitMs).
 * Exported for testing the boundary conditions.
 */
export function alertLevelForRatio(ratio: number): AlertLevel {
  if (ratio < 0.80) return 'ok';
  if (ratio < 1.00) return 'warning';
  if (ratio < 1.20) return 'critical';
  return 'breach';
}

export const ALERT_LEVEL_META: Record<AlertLevel, { label: string; cls: string; emoji: string }> = {
  ok:       { label: 'On track',     cls: 'bg-emerald-500/15 text-emerald-300',  emoji: '✅' },
  warning:  { label: 'Break soon',   cls: 'bg-amber-500/15 text-amber-300',      emoji: '⚠️' },
  critical: { label: 'Over limit',   cls: 'bg-orange-500/15 text-orange-300',    emoji: '🛑' },
  breach:   { label: 'Stop driving', cls: 'bg-rose-500/15 text-rose-300',         emoji: '🚨' },
};

export function createContinuousDrivingWatcher(
  opts: ContinuousDrivingWatcherOptions,
): ContinuousDrivingWatcher {
  const tickIntervalMs = opts.tickIntervalMs ?? 30_000;
  const now = opts.now ?? (() => Date.now());

  let limitMs = opts.limitMs;
  let baselineAt = opts.shiftStartAt;
  let shiftStartAt = opts.shiftStartAt;
  let lastLevel: AlertLevel = 'ok';
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let lastComputed: ContinuousDrivingState | null = null;

  function compute(at: number): ContinuousDrivingState {
    const drivingMs = Math.max(0, at - baselineAt);
    const shiftMs = Math.max(0, at - shiftStartAt);
    const ratio = limitMs > 0 ? drivingMs / limitMs : 0;
    const level = alertLevelForRatio(ratio);
    const meta = ALERT_LEVEL_META[level];
    return {
      drivingMs,
      shiftMs,
      limitMs,
      ratio,
      level,
      msUntilLimit: limitMs - drivingMs,
      levelLabel: meta.label,
      baselineAt,
      computedAt: at,
    };
  }

  function tick() {
    const at = now();
    const prev = lastComputed;
    const next = compute(at);
    lastComputed = next;
    if (prev && prev.level !== next.level && opts.onLevelChange) {
      try { opts.onLevelChange(prev.level, next.level, next); } catch { /* swallow */ }
    }
    try { opts.onChange(next); } catch { /* swallow */ }
  }

  return {
    start() {
      if (running) return;
      running = true;
      // Fire once synchronously so the UI has a state on first render
      tick();
      timer = setInterval(tick, tickIntervalMs);
      // Don't keep the event loop alive just for this timer
      if (typeof (timer as { unref?: () => void }).unref === 'function') {
        (timer as { unref: () => void }).unref();
      }
    },
    stop() {
      if (!running) return;
      running = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    isRunning() {
      return running;
    },
    injectBreakEnded(at) {
      const ts = at ?? now();
      const prevLevel = lastComputed?.level ?? lastLevel;
      baselineAt = ts;
      // Tick at the same moment as the break so the state is
      // consistent (drivingMs = 0, ratio = 0, level = ok). If we
      // ticked at now() instead, callers passing a future `at`
      // would see a negative drivingMs and a clamped ratio of 0.
      const next = compute(ts);
      lastComputed = next;
      lastLevel = next.level;
      if (prevLevel !== next.level && opts.onLevelChange) {
        try { opts.onLevelChange(prevLevel, next.level, next); } catch { /* swallow */ }
      }
      try { opts.onChange(next); } catch { /* swallow */ }
    },
    setLimit(newLimitMs) {
      if (!Number.isFinite(newLimitMs) || newLimitMs <= 0) return;
      limitMs = newLimitMs;
      tick();
    },
    getState() {
      return lastComputed ?? compute(now());
    },
    peek(at) {
      return compute(at);
    },
  };
}
