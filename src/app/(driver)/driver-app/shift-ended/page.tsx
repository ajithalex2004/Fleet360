/**
 * src/app/(driver)/driver-app/shift-ended/page.tsx
 *
 * Landing page after the driver ends their shift. The session cookie
 * is still valid — this is a "shift is closed, what next?" screen,
 * NOT a sign-out. The driver can:
 *
 *   1. Start a new shift (POSTs to /api/driver-app/shift/current,
 *      then routes to /shift-checklist for the new shift's
 *      checklist)
 *   2. Sign out (clears the session and goes back to launcher)
 *   3. View shift history (opens /driver-app/shift-history)
 *
 * The session is preserved between ending a shift and starting a new
 * one so the driver doesn't have to re-authenticate for every
 * vehicle swap or shift change.
 */

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BackButton } from '@/components/driver-app/BackButton';

export default function ShiftEndedPage() {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'new' | 'signout' | 'history'>(null);
  const [err, setErr] = useState<string | null>(null);

  const startNewShift = async () => {
    if (busy) return;
    setBusy('new');
    setErr(null);
    try {
      const r = await fetch('/api/driver-app/shift/current', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error(`start failed: ${r.status}`);
      router.replace('/driver-app/shift-checklist');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'start failed');
      setBusy(null);
    }
  };

  const signOut = async () => {
    if (busy) return;
    setBusy('signout');
    setErr(null);
    try {
      // The /api/auth/logout endpoint clears both session cookies.
      // A hard reload forces the launcher to re-evaluate from a
      // clean state (otherwise router.replace would soft-navigate
      // and the cached boot state would still see the cookie).
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // ignore — proceed with hard reload
    }
    window.location.replace('/driver-app');
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-stretch justify-center px-6 py-10">
      <div className="mb-2 flex justify-start">
        <BackButton />
      </div>
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-700 text-3xl">
          🌙
        </div>
        <h1 className="text-2xl font-bold text-white">Shift ended</h1>
        <p className="mt-2 text-sm text-slate-400">
          Your shift has been closed. You can start a new one or sign out.
        </p>
      </div>

      {err && (
        <div role="alert" className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          {err}
        </div>
      )}

      <button
        type="button"
        onClick={startNewShift}
        disabled={busy !== null}
        className="rounded-xl bg-violet-600 px-4 py-4 text-base font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
      >
        {busy === 'new' ? 'Starting…' : 'Start a new shift'}
      </button>

      <button
        type="button"
        onClick={() => router.push('/driver-app/shift-history')}
        disabled={busy !== null}
        className="mt-3 rounded-xl border border-white/10 px-4 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/5 disabled:opacity-50"
      >
        View shift history
      </button>

      <button
        type="button"
        onClick={signOut}
        disabled={busy !== null}
        className="mt-3 rounded-xl border border-rose-500/30 px-4 py-3 text-sm font-medium text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-50"
      >
        {busy === 'signout' ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}
