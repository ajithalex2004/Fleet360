'use client';

/**
 * Top-of-page banner that appears whenever the current session is an
 * impersonation (set by /api/admin/impersonate). Provides a one-click
 * exit back to the platform admin's original session.
 *
 * Polls /api/auth/me on mount and on route change. No-op if not
 * impersonating, so it's safe to mount in the root layout.
 */

import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { getClientMe, clearClientMeCache } from '@/lib/client-session';

interface MeResponse { impersonatedBy?: string | null; tenantName?: string; userId?: string; }

export default function ImpersonationBanner() {
  const [info, setInfo]       = useState<MeResponse | null>(null);
  const [stopping, setStop]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getClientMe();
        if (!cancelled) setInfo(data);
      } catch { /* swallow */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!info?.impersonatedBy) return null;

  const stop = async () => {
    setStop(true);
    try {
      const r = await fetch('/api/admin/impersonate/stop', { method: 'POST' });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        alert(data?.error ?? 'Could not stop impersonating.');
        return;
      }
      clearClientMeCache();
      window.location.href = '/admin/tenants';
    } finally {
      setStop(false);
    }
  };

  return (
    <div className="sticky top-0 z-[100] w-full bg-amber-500 text-amber-950 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-3 text-sm">
        <ShieldAlert className="w-4 h-4 flex-shrink-0" />
        <span className="font-semibold">Impersonating</span>
        <span className="opacity-80">
          {info.tenantName ? <>tenant <strong>{info.tenantName}</strong></> : 'this tenant'}
          {info.userId ? <> as user <code className="font-mono text-xs">{info.userId}</code></> : null}
        </span>
        <span className="ml-auto" />
        <button
          onClick={stop}
          disabled={stopping}
          className="bg-amber-950/90 hover:bg-amber-950 disabled:opacity-50 text-amber-50 font-semibold rounded-md px-3 py-1 text-xs"
        >
          {stopping ? 'Stopping…' : 'Stop impersonating'}
        </button>
      </div>
    </div>
  );
}
