/**
 * src/app/(driver)/driver-app/page.tsx
 *
 * Login / launcher for the driver mobile app.
 *
 * The flow is:
 *   1. Driver opens the app → we check if there's a registered
 *      biometric credential (via /api/driver-app/auth/biometric/status).
 *   2. If yes → prompt for biometric immediately. The OS shows the
 *      TouchID / FaceID / Android BiometricPrompt sheet.
 *   3. If verification succeeds → /api/driver-app/auth/biometric/login/finish
 *      mints a session and we navigate to /driver-app/today.
 *   4. If no biometric registered → show "Sign in with password" as
 *      a one-time setup path. After password auth, the user is sent
 *      through biometric registration.
 *
 * The password path is intentionally a fallback. In a real GCC
 * enterprise deploy, drivers authenticate with biometric only after
 * the IT admin has issued them a temporary password.
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

type Phase = 'booting' | 'ready' | 'authing' | 'error' | 'needs-password';

interface BootInfo {
  hasBiometricRegistered: boolean;
  hasSession: boolean;
  usernameHint?: string;
}

export default function DriverAppLauncher() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('booting');
  const [bootInfo, setBootInfo] = useState<BootInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // WebAuthn support detection. The mere existence of
  // `window.PublicKeyCredential` doesn't mean the device has a
  // biometric — every modern browser exposes the API even on
  // machines with no TouchID / FaceID / Windows Hello. The
  // isUserVerifyingPlatformAuthenticatorAvailable() probe is the
  // W3C-canonical way to ask "is there actually a biometric here?".
  // We probe asynchronously and default to `false` until we know.
  const [webAuthnSupported, setWebAuthnSupported] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function probe() {
      try {
        if (typeof window === 'undefined' || !window.PublicKeyCredential
            || typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') {
          if (!cancelled) setWebAuthnSupported(false);
          return;
        }
        const ok = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        if (!cancelled) setWebAuthnSupported(ok);
      } catch {
        if (!cancelled) setWebAuthnSupported(false);
      }
    }
    void probe();
    return () => { cancelled = true; };
  }, []);

  // Derived UI state. Computed at the top of render so it isn't narrowed
  // by individual JSX branches (e.g. `phase === 'needs-password' && ...`
  // would otherwise narrow `phase` to that literal and reject later
  // `phase === 'authing'` checks).
  const isSubmitting = phase === 'authing';

  // After login (password or biometric), route the user to the right
  // place based on the shift state. The flow is:
  //
  //   1. Has session cookie → call /api/driver-app/shift/current
  //   2. Active shift with checklist done → /menu
  //   3. Active shift without checklist → /shift-checklist
  //   4. No active shift → start one, then /shift-checklist
  //
  // This replaces the old behaviour (just send everyone to /menu)
  // which got stuck after End Shift because the menu was meaningless
  // without an active shift.
  const routeAfterLogin = useCallback(async () => {
    try {
      // Try to find an active shift. If none, start one.
      let shiftRes = await fetch('/api/driver-app/shift/current', { credentials: 'include' });
      if (shiftRes.status === 401) {
        // Session lost mid-flow — bounce to launcher
        router.replace('/driver-app');
        return;
      }
      let shift = (await shiftRes.json()).shift;
      if (!shift) {
        // No active shift — start one. The partial unique index
        // closes any stale ACTIVE shift first, so this is safe
        // even after a botched logout.
        const startRes = await fetch('/api/driver-app/shift/current', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!startRes.ok) {
          setErrorMsg(`Could not start shift: ${startRes.status}`);
          setPhase('error');
          return;
        }
        shift = (await startRes.json()).shift;
      }
      // Active shift found (or just started). Check the checklist.
      if (shift.checklist) {
        router.replace('/driver-app/menu');
      } else {
        router.replace('/driver-app/shift-checklist');
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'shift routing failed');
      setPhase('error');
    }
  }, [router]);

  const loadBoot = useCallback(async () => {
    setPhase('booting');
    setErrorMsg(null);
    try {
      const r = await fetch('/api/driver-app/auth/biometric/status', { credentials: 'include' });
      const data = await r.json();
      setBootInfo(data);
      if (data.hasSession) {
        // Has a session — figure out where to go based on shift state.
        await routeAfterLogin();
        return;
      }
      if (data.hasBiometricRegistered && webAuthnSupported) {
        setPhase('ready');
        // Auto-prompt biometric on mount. The OS shows the prompt.
        // The driver can dismiss and re-trigger with the button.
        void doBiometricLogin(data.usernameHint);
        return;
      }
      setPhase('needs-password');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'boot failed');
      setPhase('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, webAuthnSupported, routeAfterLogin]);

  useEffect(() => { void loadBoot(); }, [loadBoot]);

  async function doBiometricLogin(usernameHint?: string) {
    setPhase('authing');
    setErrorMsg(null);
    try {
      const startModule = await import('@simplewebauthn/browser');
      const startRes = await fetch('/api/driver-app/auth/biometric/login/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: usernameHint || username || '' }),
      });
      if (!startRes.ok) {
        if (startRes.status === 404) {
          setErrorMsg('No biometric registered on this device. Use password to sign in.');
          setPhase('needs-password');
          return;
        }
        throw new Error(`start failed: ${startRes.status}`);
      }
      const options = await startRes.json();

      // The browser's get() will throw if the user cancels.
      const assertion = await startModule.startAuthentication(options);
      const finishRes = await fetch('/api/driver-app/auth/biometric/login/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ response: assertion, driverId: options.driverId }),
      });
      if (!finishRes.ok) throw new Error(`finish failed: ${finishRes.status}`);
      // Route based on shift state — the user may not have a shift yet.
      await routeAfterLogin();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'biometric failed';
      // DOMException NotAllowedError = user cancelled the prompt
      if (msg.includes('NotAllowed')) {
        setPhase('ready');
        return;
      }
      setErrorMsg(msg);
      setPhase('error');
    }
  }

  async function doPasswordLogin() {
    setPhase('authing');
    setErrorMsg(null);
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: username, password }),
      });
      if (!r.ok) {
        throw new Error(`login failed: ${r.status}`);
      }
      // After successful login, route to shift-checklist (or menu
      // if the shift is already underway). The launcher used to just
      // send everyone to /menu, which left drivers without an active
      // shift on a dead-end page.
      await routeAfterLogin();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'login failed');
      setPhase('error');
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-stretch justify-center px-6 py-10">
      <div className="mb-10 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-600 text-2xl font-bold text-white">
          F
        </div>
        <h1 className="text-2xl font-bold text-white">Fleet360 Driver</h1>
        <p className="mt-2 text-sm text-slate-400">
          {phase === 'booting' && 'Loading…'}
          {phase === 'ready' && 'Use biometric to sign in'}
          {phase === 'authing' && 'Verifying…'}
          {phase === 'needs-password' && 'Sign in with your driver credentials'}
          {phase === 'error' && (errorMsg ?? 'Something went wrong')}
        </p>
      </div>

      {errorMsg && phase === 'error' && (
        <div role="alert" className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
          {errorMsg}
        </div>
      )}

      {(phase === 'ready' || phase === 'authing') && (
        <button
          type="button"
          onClick={() => bootInfo && doBiometricLogin(bootInfo.usernameHint)}
          disabled={isSubmitting}
          className="w-full rounded-xl bg-violet-600 px-4 py-4 text-base font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
        >
          {phase === 'authing' ? 'Verifying…' : 'Sign in with biometric'}
        </button>
      )}

      {phase === 'needs-password' && (
        <form
          onSubmit={(e) => { e.preventDefault(); void doPasswordLogin(); }}
          className="space-y-3"
        >
          <input
            type="text"
            inputMode="email"
            autoComplete="username"
            required
            placeholder="Driver email or employee ID"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-4 text-base text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
          />
          <input
            type="password"
            autoComplete="current-password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-4 text-base text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-violet-600 px-4 py-4 text-base font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
          >
            Sign in
          </button>
        </form>
      )}

      {phase === 'error' && (
        <button
          type="button"
          onClick={loadBoot}
          className="mt-2 w-full rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-300 hover:bg-white/5"
        >
          Retry
        </button>
      )}

      <footer className="mt-10 text-center text-[11px] uppercase tracking-wider text-slate-600">
        Fleet360 v1.0 · Driver
      </footer>
    </main>
  );
}
