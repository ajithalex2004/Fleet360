'use client';

/**
 * Passkey step-up for high-impact admin actions (src/lib/auth/step-up-policy.ts).
 *
 * The APIs answer such an action with 403 { error: 'step_up_required' } unless
 * the person behind the session passed a passkey check in the last 5
 * minutes. This provider wraps window.fetch: on that answer it asks for the
 * passkey (or, with none yet, offers to add one), then retries the original
 * request once. Pages need no changes; cancelling returns the original 403.
 *
 * The WebAuthn prompt is started from a button click: browsers require a
 * user gesture for it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Fingerprint, KeyRound, Loader2, ShieldAlert, X } from 'lucide-react';

type ReauthMethod = 'password' | 'password+mfa' | 'recent-sign-in';

type Stage =
  | { kind: 'loading' }
  | { kind: 'assert'; options: unknown }
  | { kind: 'enroll'; reauth: ReauthMethod }
  | { kind: 'blocked'; message: string };

const STEP_UP_ERROR = 'step_up_required';

let requestFromProvider: (() => Promise<boolean>) | null = null;
let inFlight: Promise<boolean> | null = null;

/** Ask for a passkey check now; resolves true once it passed. Shared by concurrent callers. */
export function requestStepUp(): Promise<boolean> {
  if (!requestFromProvider) return Promise.resolve(false);
  if (!inFlight) inFlight = requestFromProvider().finally(() => { inFlight = null; });
  return inFlight;
}

function apiPath(input: RequestInfo | URL): string | null {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return url.pathname.startsWith('/api/') ? url.pathname : null;
  } catch {
    return null;
  }
}

async function jsonOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

const message = (data: Record<string, unknown>, fallback: string) =>
  (typeof data.message === 'string' && data.message) || (typeof data.error === 'string' && data.error) || fallback;

export default function StepUpProvider({ children }: { children: React.ReactNode }) {
  const [stage, setStage] = useState<Stage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const baseFetch = useRef<typeof fetch | null>(null);

  const finish = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setStage(null);
    setBusy(false);
    setError(null);
    setPassword('');
    setCode('');
    setDeviceName('');
  }, []);

  const begin = useCallback(async (): Promise<boolean> => {
    const f = baseFetch.current ?? fetch;
    const done = new Promise<boolean>((resolve) => { resolver.current = resolve; });
    setError(null);
    setStage({ kind: 'loading' });
    try {
      const res = await f('/api/auth/step-up/options', { method: 'POST' });
      const data = await jsonOf(res);
      if (res.ok) {
        setStage({ kind: 'assert', options: data });
      } else if (res.status === 409 && data.error === 'no_passkey' && data.canEnroll !== false) {
        const info = await jsonOf(await f('/api/auth/passkeys'));
        const reauth = (info.firstPasskeyReauth as ReauthMethod | undefined) ?? 'password';
        setStage({ kind: 'enroll', reauth });
      } else {
        setStage({ kind: 'blocked', message: message(data, 'Passkey check unavailable.') });
      }
    } catch {
      setStage({ kind: 'blocked', message: 'Could not reach the server.' });
    }
    return done;
  }, []);

  // Wrap fetch once: retry a request answered step_up_required after a passkey check.
  useEffect(() => {
    requestFromProvider = begin;
    if (baseFetch.current) return;
    const original = window.fetch.bind(window);
    baseFetch.current = original;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = apiPath(input);
      if (!path || path.startsWith('/api/auth/step-up/')) return original(input, init);
      const replay = input instanceof Request ? input.clone() : input;
      const res = await original(input, init);
      if (res.status !== 403) return res;
      const data = await res.clone().json().catch(() => null) as { error?: string } | null;
      if (data?.error !== STEP_UP_ERROR) return res;
      if (init?.body instanceof ReadableStream) return res; // cannot be sent twice
      if (!(await requestStepUp())) return res;
      return original(replay, init);
    };
    return () => {
      requestFromProvider = null;
    };
  }, [begin]);

  // Preload the WebAuthn library when the dialog opens: by the click it is
  // cached, so the prompt starts within the click's user activation (Safari).
  useEffect(() => {
    if (stage) void import('@simplewebauthn/browser');
  }, [stage]);

  const assert = async () => {
    if (stage?.kind !== 'assert') return;
    const f = baseFetch.current ?? fetch;
    setBusy(true); setError(null);
    try {
      // Loaded on first use, not with every page.
      const { startAuthentication } = await import('@simplewebauthn/browser');
      const response = await startAuthentication(stage.options as Parameters<typeof startAuthentication>[0]);
      const res = await f('/api/auth/step-up/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response }),
      });
      if (!res.ok) throw new Error(message(await jsonOf(res), 'Passkey check failed.'));
      finish(true);
    } catch (e) {
      setError(e instanceof Error && e.name === 'NotAllowedError' ? 'The passkey prompt was cancelled or timed out.' : e instanceof Error ? e.message : 'Passkey check failed.');
      // A challenge is single use: fetch a fresh one for the next attempt.
      const res = await f('/api/auth/step-up/options', { method: 'POST' }).catch(() => null);
      if (res?.ok) setStage({ kind: 'assert', options: await res.json() });
      setBusy(false);
    }
  };

  const enroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (stage?.kind !== 'enroll') return;
    const f = baseFetch.current ?? fetch;
    setBusy(true); setError(null);
    try {
      const isRecovery = code.includes('-');
      const optRes = await f('/api/auth/passkeys/register/options', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: password || undefined,
          mfaCode: code && !isRecovery ? code : undefined,
          recoveryCode: code && isRecovery ? code : undefined,
        }),
      });
      const options = await jsonOf(optRes);
      if (!optRes.ok) throw new Error(message(options, 'Could not start adding a passkey.'));
      const { startRegistration } = await import('@simplewebauthn/browser');
      const response = await startRegistration(options as unknown as Parameters<typeof startRegistration>[0]);
      const res = await f('/api/auth/passkeys/register/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response, deviceName: deviceName || undefined }),
      });
      if (!res.ok) throw new Error(message(await jsonOf(res), 'Could not add the passkey.'));
      finish(true);
    } catch (err) {
      setError(err instanceof Error && err.name === 'NotAllowedError' ? 'The passkey prompt was cancelled or timed out.' : err instanceof Error ? err.message : 'Could not add the passkey.');
      setBusy(false);
    }
  };

  return (
    <>
      {children}
      {stage && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="step-up-title">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-blue-500/20 text-blue-300">
                  {stage.kind === 'enroll' ? <KeyRound className="w-5 h-5" /> : <Fingerprint className="w-5 h-5" />}
                </div>
                <h2 id="step-up-title" className="text-lg font-semibold text-[var(--text-main)]">
                  {stage.kind === 'enroll' ? 'Add a passkey to continue' : 'Confirm it’s you'}
                </h2>
              </div>
              <button onClick={() => finish(false)} className="text-[var(--text-muted)] hover:text-[var(--text-main)]" aria-label="Cancel">
                <X className="w-5 h-5" />
              </button>
            </div>

            {stage.kind === 'loading' && (
              <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 className="w-4 h-4 animate-spin" /> Preparing passkey check…</div>
            )}

            {stage.kind === 'assert' && (
              <>
                <p className="text-sm text-[var(--text-muted)]">
                  This is a high-impact action. Use your passkey (fingerprint, face or device PIN) to confirm.
                  It stays confirmed for 5 minutes.
                </p>
                <button onClick={assert} disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-white font-semibold text-sm">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4" />}
                  {busy ? 'Waiting for your passkey…' : 'Use passkey'}
                </button>
              </>
            )}

            {stage.kind === 'enroll' && (
              <form onSubmit={enroll} className="space-y-3">
                <p className="text-sm text-[var(--text-muted)]">
                  High-impact admin actions need a passkey. Add one now on this device or a security key.
                  {stage.reauth === 'recent-sign-in'
                    ? ' Your account has no password, so this works within 10 minutes of signing in.'
                    : ' First confirm your password.'}
                </p>
                {stage.reauth !== 'recent-sign-in' && (
                  <input type="password" autoComplete="current-password" placeholder="Password" value={password}
                    onChange={(e) => setPassword(e.target.value)} required
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-transparent px-3 py-2 text-sm text-[var(--text-main)]" />
                )}
                {stage.reauth === 'password+mfa' && (
                  <input inputMode="text" autoComplete="one-time-code" placeholder="Authenticator code or recovery code" value={code}
                    onChange={(e) => setCode(e.target.value.trim())} required
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-transparent px-3 py-2 text-sm text-[var(--text-main)]" />
                )}
                <input placeholder="Name this passkey (optional), e.g. Work laptop" value={deviceName} maxLength={80}
                  onChange={(e) => setDeviceName(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-transparent px-3 py-2 text-sm text-[var(--text-main)]" />
                <button type="submit" disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-white font-semibold text-sm">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                  {busy ? 'Waiting for your device…' : 'Add passkey and continue'}
                </button>
              </form>
            )}

            {stage.kind === 'blocked' && (
              <div className="flex items-start gap-2 text-sm text-amber-300"><ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" /> {stage.message}</div>
            )}

            {error && <div className="text-sm text-rose-300">{error}</div>}
          </div>
        </div>
      )}
    </>
  );
}
