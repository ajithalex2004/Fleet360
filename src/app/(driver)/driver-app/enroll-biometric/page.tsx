/**
 * src/app/(driver)/driver-app/enroll-biometric/page.tsx
 *
 * One-time biometric enrollment. The driver signs in with their
 * temporary password (issued by the IT admin or via a self-serve
 * "first login" flow) and then registers their device's biometric.
 * After this, subsequent logins go straight through the biometric
 * prompt with no password.
 *
 * The ceremony is:
 *   1. We probe `isUserVerifyingPlatformAuthenticatorAvailable()` to
 *      see if the browser / OS actually has a biometric (TouchID,
 *      FaceID, Windows Hello, Android BiometricPrompt).
 *   2. If yes — show "Register fingerprint / face" and run the
 *      WebAuthn ceremony.
 *   3. If no — show a clear "biometric not available on this device"
 *      message with "Continue" as the primary action (no dead-end).
 *   4. On success we redirect to /today.
 *
 * Dev affordance: `?devSkip=1` auto-redirects to /today without
 * touching WebAuthn — useful for browser testing where the dev
 * machine has no authenticator.
 */

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { BackButton } from '@/components/driver-app/BackButton';

type ProbeState = 'probing' | 'available' | 'unavailable' | 'error';

export default function EnrollBiometricPage() {
  const router = useRouter();
  const [probe, setProbe] = useState<ProbeState>('probing');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const probedRef = useRef(false);

  // Dev affordance — `?devSkip=1` skips biometric enrollment entirely
  // and goes straight to /menu. Useful for browser testing.
  //
  // We use `window.location.search` rather than `useSearchParams()` so
  // the page doesn't need a `<Suspense>` boundary for static export.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('devSkip') === '1') {
      router.replace('/driver-app/menu');
    }
  }, [router]);

  // Probe whether the device actually has a platform authenticator.
  // `isUserVerifyingPlatformAuthenticatorAvailable()` is the W3C way
  // to ask "can I do TouchID / FaceID / Android BiometricPrompt
  // here?". `true` means yes, `false` means no biometric hardware or
  // it's been disabled in the OS.
  useEffect(() => {
    if (probedRef.current) return;
    probedRef.current = true;

    async function probeAuth() {
      try {
        if (typeof window === 'undefined' || !window.PublicKeyCredential
            || typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') {
          setProbe('unavailable');
          return;
        }
        const ok = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        setProbe(ok ? 'available' : 'unavailable');
      } catch (e) {
        // Some browsers throw on this call (e.g. when WebAuthn is
        // explicitly disabled). Treat as "unavailable" rather than
        // dead-ending the user.
        setProbe('unavailable');
        void e;
      }
    }
    void probeAuth();
  }, []);

  const enroll = async () => {
    setBusy(true);
    setErr(null);
    try {
      const startModule = await import('@simplewebauthn/browser');
      const startRes = await fetch('/api/driver-app/auth/biometric/register', {
        method: 'POST',
        credentials: 'include',
      });
      if (!startRes.ok) throw new Error(`start failed: ${startRes.status}`);
      const options = await startRes.json();
      const attestation = await startModule.startRegistration(options);
      const finishRes = await fetch('/api/driver-app/auth/biometric/register/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ response: attestation }),
      });
      if (!finishRes.ok) {
        const t = await finishRes.text();
        throw new Error(`finish failed: ${finishRes.status} ${t.slice(0, 200)}`);
      }
      router.replace('/driver-app/menu');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'enrollment failed';
      if (msg.includes('NotAllowed')) {
        setErr('Cancelled. Tap the button to try again.');
        setBusy(false);
        return;
      }
      setErr(msg);
      setBusy(false);
    }
  };

  // While probing, show a neutral loading state. The probe is fast
  // (sub-100ms) so this is barely visible.
  if (probe === 'probing') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-stretch justify-center px-6 py-10">
        <div className="mb-2 flex justify-start">
          <BackButton />
        </div>
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-700 text-2xl font-bold text-white">
            ⋯
          </div>
          <h1 className="text-2xl font-bold text-white">Checking your device…</h1>
        </div>
      </main>
    );
  }

  // Biometric not available — show a clear "skip" experience instead
  // of letting the user tap a button that will fail.
  if (probe === 'unavailable') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-stretch justify-center px-6 py-10">
        <div className="mb-2 flex justify-start">
          <BackButton />
        </div>
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-700 text-2xl font-bold text-white">
            🔒
          </div>
          <h1 className="text-2xl font-bold text-white">You're signed in</h1>
          <p className="mt-2 text-sm text-slate-400">
            Your device doesn't support fingerprint or face sign-in. That's fine — you can still
            use the app. On your next visit, sign in with your password.
          </p>
        </div>

        <button
          type="button"
          onClick={() => router.replace('/driver-app/menu')}
          className="rounded-xl bg-violet-600 px-4 py-4 text-base font-semibold text-white transition hover:bg-violet-500"
        >
          Continue to app
        </button>

        <p className="mt-4 text-center text-xs text-slate-500">
          For fingerprint / face sign-in, use the native iOS or Android app.
        </p>
      </main>
    );
  }

  // Biometric IS available — show the original registration flow.
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-stretch justify-center px-6 py-10">
      <div className="mb-2 flex justify-start">
        <BackButton />
      </div>
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600 text-2xl font-bold text-white">
          ✓
        </div>
        <h1 className="text-2xl font-bold text-white">You're signed in</h1>
        <p className="mt-2 text-sm text-slate-400">
          One last step: register your device's biometric so you can sign in faster next time.
        </p>
      </div>

      {err && (
        <div role="alert" className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
          {err}
        </div>
      )}

      <button
        type="button"
        onClick={enroll}
        disabled={busy}
        className="rounded-xl bg-violet-600 px-4 py-4 text-base font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
      >
        {busy ? 'Waiting for biometric…' : 'Register fingerprint / face'}
      </button>

      <button
        type="button"
        onClick={() => router.replace('/driver-app/menu')}
        className="mt-3 w-full rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-300 hover:bg-white/5"
      >
        Skip for now
      </button>
    </main>
  );
}
