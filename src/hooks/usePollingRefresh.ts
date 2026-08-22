'use client';

import { useEffect, useRef } from 'react';

export type PollingLoadFn = (opts?: { silent?: boolean }) => void | Promise<void>;

/**
 * Background list refresh for FleetDataGrid pages.
 * - Polls on an interval while the tab is visible
 * - Refetches when the tab becomes visible again
 * - Skips while `pause` is true (modals / dialogs open)
 */
export function usePollingRefresh(
  load: PollingLoadFn,
  opts?: {
    intervalMs?: number;
    pause?: boolean;
    enabled?: boolean;
  },
) {
  const intervalMs = opts?.intervalMs ?? 20_000;
  const pause = opts?.pause ?? false;
  const enabled = opts?.enabled ?? true;
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      if (pause) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void loadRef.current({ silent: true });
    };

    const id = setInterval(tick, intervalMs);

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !pause) {
        void loadRef.current({ silent: true });
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, pause, enabled]);
}
