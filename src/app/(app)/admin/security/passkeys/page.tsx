'use client';

/**
 * /admin/security/passkeys — the signed-in user's passkeys.
 *
 * High-impact admin actions (roles, permissions, users, tenants, platform
 * operations) need a passkey check within the last 5 minutes; see
 * src/lib/auth/step-up-policy.ts. Adding the first passkey asks for the
 * password (and authenticator code with MFA); adding another, or removing
 * one, asks for an existing passkey (StepUpProvider handles that prompt).
 */

import { useCallback, useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { AlertCircle, Fingerprint, KeyRound, Loader2, ShieldCheck, Trash2 } from 'lucide-react';

interface Passkey {
  id: string;
  deviceName: string;
  rpId: string;
  createdAt: string;
  lastUsedAt: string | null;
  usableHere: boolean;
}

interface PasskeyInfo {
  configured: boolean;
  rpId: string | null;
  passkeys: Passkey[];
  firstPasskeyReauth: 'password' | 'password+mfa' | 'recent-sign-in';
  impersonating: boolean;
}

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString() : 'Never');

export default function PasskeysPage() {
  const [info, setInfo] = useState<PasskeyInfo | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/auth/passkeys').catch(() => null);
    if (!res?.ok) { setError('Could not load your passkeys.'); return; }
    setInfo(await res.json());
  }, []);

  useEffect(() => { void load(); }, [load]);

  const first = (info?.passkeys.length ?? 0) === 0;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    try {
      const isRecovery = code.includes('-');
      const optRes = await fetch('/api/auth/passkeys/register/options', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(first ? {
          password: password || undefined,
          mfaCode: code && !isRecovery ? code : undefined,
          recoveryCode: code && isRecovery ? code : undefined,
        } : {}),
      });
      const options = await optRes.json().catch(() => ({}));
      if (!optRes.ok) throw new Error(options.message ?? options.error ?? 'Could not start adding a passkey.');
      const response = await startRegistration(options);
      const res = await fetch('/api/auth/passkeys/register/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response, deviceName: deviceName || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Could not add the passkey.');
      setNotice(`Passkey "${data.passkey?.deviceName ?? 'new passkey'}" added.`);
      setPassword(''); setCode(''); setDeviceName('');
      await load();
    } catch (err) {
      setError(err instanceof Error && err.name === 'NotAllowedError' ? 'The passkey prompt was cancelled or timed out.' : err instanceof Error ? err.message : 'Could not add the passkey.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Passkey) => {
    if (!confirm(`Remove the passkey "${p.deviceName}"?`)) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/auth/passkeys/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Could not remove the passkey.');
      setNotice(`Passkey "${p.deviceName}" removed.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the passkey.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <div className="flex items-start gap-3">
        <div className={`p-3 rounded-xl ${first ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
          <Fingerprint className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">Passkeys</h1>
          <p className="text-[var(--text-muted)] text-xs mt-1">
            Changing roles, permissions, users or tenants asks for a passkey (fingerprint, face, device PIN or a security key).
            One check covers 5 minutes.
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}
      {notice && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3 text-emerald-300 text-sm flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" /> {notice}
        </div>
      )}

      {info && !info.configured && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-amber-300 text-sm">
          Passkeys are not configured on this server yet. An operator must set WEBAUTHN_RP_ID and WEBAUTHN_ORIGINS.
        </div>
      )}

      {info?.impersonating && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-amber-300 text-sm">
          You are impersonating another user. These are your own passkeys; stop impersonating to add or remove them.
        </div>
      )}

      <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 space-y-3">
        <h2 className="text-lg font-semibold text-[var(--text-main)]">Your passkeys</h2>
        {!info && <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
        {info && info.passkeys.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">No passkeys yet. Add one below before your next high-impact admin action.</p>
        )}
        {info?.passkeys.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 border border-[var(--border-subtle)] rounded-xl px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-[var(--text-main)] truncate">{p.deviceName}</div>
              <div className="text-xs text-[var(--text-muted)]">
                Added {fmt(p.createdAt)} · Last used {fmt(p.lastUsedAt)}
                {!p.usableHere && <span className="text-amber-300"> · registered for {p.rpId}, not usable here</span>}
              </div>
            </div>
            <button onClick={() => remove(p)} disabled={busy || info.impersonating}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 disabled:opacity-50">
              <Trash2 className="w-3.5 h-3.5" /> Remove
            </button>
          </div>
        ))}
      </div>

      {info?.configured && !info.impersonating && (
        <form onSubmit={add} className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 space-y-3">
          <h2 className="text-lg font-semibold text-[var(--text-main)]">Add a passkey</h2>
          <p className="text-sm text-[var(--text-muted)]">
            {first
              ? info.firstPasskeyReauth === 'recent-sign-in'
                ? 'Your account signs in without a password: add your first passkey within 10 minutes of signing in.'
                : 'Confirm your password to add your first passkey.'
              : 'You will be asked for one of your existing passkeys first.'}
            {' '}Adding a second passkey (another device or a security key) keeps you in if one is lost.
          </p>
          {first && info.firstPasskeyReauth !== 'recent-sign-in' && (
            <input type="password" autoComplete="current-password" placeholder="Password" value={password}
              onChange={(e) => setPassword(e.target.value)} required
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-transparent px-3 py-2 text-sm text-[var(--text-main)]" />
          )}
          {first && info.firstPasskeyReauth === 'password+mfa' && (
            <input autoComplete="one-time-code" placeholder="Authenticator code or recovery code" value={code}
              onChange={(e) => setCode(e.target.value.trim())} required
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-transparent px-3 py-2 text-sm text-[var(--text-main)]" />
          )}
          <input placeholder="Name (optional), e.g. Work laptop" value={deviceName} maxLength={80}
            onChange={(e) => setDeviceName(e.target.value)}
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-transparent px-3 py-2 text-sm text-[var(--text-main)]" />
          <button type="submit" disabled={busy}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-white font-semibold text-sm">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            {busy ? 'Waiting for your device…' : 'Add passkey'}
          </button>
        </form>
      )}

      <p className="text-xs text-[var(--text-muted)]">
        Lost every passkey? A platform administrator can reset them; you then add a new one with your password.
      </p>
    </div>
  );
}
