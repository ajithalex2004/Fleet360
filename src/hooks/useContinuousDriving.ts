'use client';

/**
 * src/hooks/useContinuousDriving.ts
 *
 * React hook that loads the tenant's CBA-driven continuous-driving
 * limit, starts a continuous-driving watcher for the current shift,
 * and returns the live state. The host calls `notifyBreakEnded()`
 * when a break actually happened (e.g. the behavior watcher's
 * IDLE_END event).
 *
 * Lifecycle:
 *   - On mount, fetches /api/driver-app/cba/continuous-driving-limit
 *   - If an active shift exists, uses its startedAt as the baseline
 *   - Polls state every tickIntervalMs (default 30s)
 *   - On unmount, stops the watcher
 *
 * The hook is resilient to fetch failures (falls back to platform
 * default) and to missing shifts (no baseline → no state, returns null).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createContinuousDrivingWatcher,
  type ContinuousDrivingState,
  type ContinuousDrivingWatcher,
} from '@/lib/driver-offline/continuous-driving-watcher';

export interface UseContinuousDrivingOptions {
  /** Override the tick interval (default 30s). */
  tickIntervalMs?: number;
  /** When a level transition happens (e.g. ok → warning). */
  onLevelChange?: (prev: string, next: string, state: ContinuousDrivingState) => void;
  /** Polling interval for refreshing the limit (default 5 min). */
  refreshLimitIntervalMs?: number;
}

export interface UseContinuousDrivingResult {
  /** Current state, or null while loading / not on a shift. */
  state: ContinuousDrivingState | null;
  /** Where the limit came from — 'CBA' or 'PLATFORM_DEFAULT'. */
  source: 'CBA' | 'PLATFORM_DEFAULT' | null;
  /** The CBA rule that supplied the limit, if any. */
  rule: { id: string; name: string; value: number; unit: string } | null;
  /** Notifies the watcher that the driver just took a break. */
  notifyBreakEnded: () => void;
  /** True if the data is still being loaded. */
  loading: boolean;
  /** Last error from either fetch (does not block the watcher). */
  err: string | null;
}

interface LimitResponse {
  limitHours: number;
  limitMs: number;
  source: 'CBA' | 'PLATFORM_DEFAULT';
  rule: { id: string; name: string; value: number; unit: string } | null;
  jurisdiction: string | null;
}

interface CurrentShiftResponse {
  shift: { id: string; startedAt: string; status: string } | null;
}

export function useContinuousDriving(
  opts: UseContinuousDrivingOptions = {},
): UseContinuousDrivingResult {
  const [state, setState] = useState<ContinuousDrivingState | null>(null);
  const [source, setSource] = useState<'CBA' | 'PLATFORM_DEFAULT' | null>(null);
  const [rule, setRule] = useState<UseContinuousDrivingResult['rule']>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const watcherRef = useRef<ContinuousDrivingWatcher | null>(null);
  const limitRef = useRef<number | null>(null);

  const refreshLimit = useCallback(async (): Promise<number | null> => {
    try {
      const r = await fetch('/api/driver-app/cba/continuous-driving-limit', { credentials: 'include' });
      if (!r.ok) {
        setErr(`Failed to load CBA limit (${r.status})`);
        return null;
      }
      const data: LimitResponse = await r.json();
      setSource(data.source);
      setRule(data.rule);
      setErr(null);
      return data.limitMs;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'network error');
      return null;
    }
  }, []);

  const ensureShift = useCallback(async (): Promise<number | null> => {
    try {
      const r = await fetch('/api/driver-app/shift/current', { credentials: 'include' });
      if (!r.ok) return null;
      const data: CurrentShiftResponse = await r.json();
      if (!data.shift) return null;
      return new Date(data.shift.startedAt).getTime();
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      const [limitMs, shiftStartAt] = await Promise.all([
        refreshLimit(),
        ensureShift(),
      ]);
      if (cancelled) return;

      if (!limitMs || !shiftStartAt) {
        // No limit (CBA API failed) or no active shift → no state
        setLoading(false);
        return;
      }

      limitRef.current = limitMs;
      const watcher = createContinuousDrivingWatcher({
        limitMs,
        shiftStartAt,
        tickIntervalMs: opts.tickIntervalMs,
        onChange: (s) => {
          if (!cancelled) setState(s);
        },
        onLevelChange: opts.onLevelChange,
      });
      watcherRef.current = watcher;
      watcher.start();
      setLoading(false);
    })();

    // Refresh the limit periodically in case the tenant's CBA changes
    const refreshMs = opts.refreshLimitIntervalMs ?? 5 * 60_000;
    const refreshTimer = setInterval(async () => {
      const newLimit = await refreshLimit();
      if (cancelled) return;
      if (newLimit && watcherRef.current) {
        watcherRef.current.setLimit(newLimit);
        limitRef.current = newLimit;
      }
    }, refreshMs);
    if (typeof (refreshTimer as { unref?: () => void }).unref === 'function') {
      (refreshTimer as { unref: () => void }).unref();
    }

    return () => {
      cancelled = true;
      clearInterval(refreshTimer);
      if (watcherRef.current) {
        watcherRef.current.stop();
        watcherRef.current = null;
      }
    };
    // We intentionally omit `opts` from deps to avoid resetting the
    // watcher on every render. The hook consumers can use a ref to
    // update callbacks if needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const notifyBreakEnded = useCallback(() => {
    watcherRef.current?.injectBreakEnded();
  }, []);

  return { state, source, rule, notifyBreakEnded, loading, err };
}
