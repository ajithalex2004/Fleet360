'use client';

/**
 * /admin/security/mfa — Enrol or disable TOTP MFA for the logged-in user.
 *
 * Two-step enrolment:
 *  1. POST /api/auth/mfa/enroll          → returns secret + otpauth URI
 *  2. POST /api/auth/mfa/enroll/verify   → returns one-time recovery codes
 *
 * Disable: POST /api/auth/mfa/disable with password + (TOTP code OR recovery code).
 *
 * Note: QR image rendering is intentionally omitted (no extra npm dep).
 * Users add the secret manually in their authenticator app — every modern
 * authenticator (Google, Microsoft, 1Password, Authy) supports manual entry.
 */

import { useEffect, useState } from 'react';
import { ShieldCheck, KeyRound, Copy, Check, AlertCircle, RefreshCw } from 'lucide-react';

interface Status { mfaEnabled: boolean; }
interface EnrolResponse { ok: true; secret: string; otpauthUri: string; issuer: string; account: string; }

export default function MfaSecurityPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [enrol,  setEnrol]  = useState<EnrolResponse | null>(null);
  const [code,   setCode]   = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  // Disable flow
  const [showDisable, setShowDisable] = useState(false);
  const [disablePw,   setDisablePw]   = useState('');
  const [disableCode, setDisableCode] = useState('');

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [copied,  setCopied]  = useState<string | null>(null);

  const loadStatus = async () => {
    const res = await fetch('/api/auth/mfa/status').catch(() => null);
    if (!res?.ok) { setStatus({ mfaEnabled: false }); return; }
    const data = await res.json();
    setStatus({ mfaEnabled: !!data?.mfaEnabled });
  };

  useEffect(() => { void loadStatus(); }, []);

  const startEnrol = async () => {
    setLoading(true); setError(null); setRecoveryCodes(null);
    try {
      const res = await fetch('/api/auth/mfa/enroll', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to start MFA enrolment');
      setEnrol(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const completeEnrol = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code)) { setError('Enter the 6-digit code from your authenticator.'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/mfa/enroll/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Verification failed');
      setRecoveryCodes(data.recoveryCodes);
      setEnrol(null);
      setCode('');
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const disable = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!disablePw) { setError('Enter your password.'); return; }
    if (!/^\d{6}$/.test(disableCode) && !/^[a-f0-9]{5}-[a-f0-9]{5}$/i.test(disableCode)) {
      setError('Enter a 6-digit code or a recovery code.'); return;
    }
    setLoading(true);
    try {
      const isRecovery = disableCode.includes('-');
      const res = await fetch('/api/auth/mfa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: disablePw,
          code:         isRecovery ? undefined : disableCode,
          recoveryCode: isRecovery ? disableCode : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Disable failed');
      setShowDisable(false); setDisablePw(''); setDisableCode('');
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Disable failed');
    } finally {
      setLoading(false);
    }
  };

  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <div className="flex items-start gap-3">
        <div className={`p-3 rounded-xl ${status?.mfaEnabled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
          <ShieldCheck className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Multi-factor authentication</h1>
          <p className="text-slate-400 text-sm mt-1">
            {status?.mfaEnabled
              ? 'MFA is active on your account. Disable below if you need to re-enrol.'
              : 'Add a second factor (authenticator app) to your sign-in.'}
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {recoveryCodes && (
        <div className="bg-amber-500/10 border border-amber-500/40 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2 text-amber-300 font-semibold">
            <KeyRound className="w-5 h-5" /> Save these recovery codes
          </div>
          <p className="text-sm text-slate-300">
            Each code works once and replaces your authenticator if you lose it.
            You will <strong>not</strong> see them again.
          </p>
          <div className="grid grid-cols-2 gap-2 font-mono text-sm bg-slate-900/60 border border-white/10 rounded-lg p-4">
            {recoveryCodes.map(c => <div key={c} className="text-amber-200">{c}</div>)}
          </div>
          <button onClick={() => copy(recoveryCodes.join('\n'), 'recovery')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded-lg text-sm text-amber-200">
            {copied === 'recovery' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied === 'recovery' ? 'Copied' : 'Copy all'}
          </button>
        </div>
      )}

      {/* Status: not yet enrolled and no enrolment in flight */}
      {!status?.mfaEnabled && !enrol && !recoveryCodes && (
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">Set up MFA</h2>
          <ol className="list-decimal list-inside text-sm text-slate-300 space-y-1">
            <li>Install an authenticator app (Google Authenticator, 1Password, Authy, Microsoft Authenticator).</li>
            <li>Tap the button below to generate your setup key.</li>
            <li>Add the key to your authenticator and enter the 6-digit code it shows.</li>
          </ol>
          <button onClick={startEnrol} disabled={loading}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-white font-semibold text-sm">
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            {loading ? 'Working…' : 'Start enrolment'}
          </button>
        </div>
      )}

      {/* Enrolment step 2: secret displayed, awaiting verification code */}
      {enrol && (
        <form onSubmit={completeEnrol} className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 space-y-5">
          <h2 className="text-lg font-semibold text-white">Add this key to your authenticator</h2>

          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wide text-slate-400">Account</div>
            <div className="text-sm text-white">{enrol.issuer} &mdash; {enrol.account}</div>
          </div>

          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wide text-slate-400">Setup key</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-slate-900/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-emerald-300 break-all">
                {enrol.secret}
              </code>
              <button type="button" onClick={() => copy(enrol.secret, 'secret')}
                className="px-3 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-200 text-sm inline-flex items-center gap-2">
                {copied === 'secret' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied === 'secret' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-slate-500">
              In your authenticator: <strong>Add account → Enter setup key</strong>. Account name: {enrol.account}. Type: Time-based.
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">6-digit code</label>
            <input
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              className="w-40 bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-lg font-mono text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-3">
            <button type="submit" disabled={loading || code.length !== 6}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-white font-semibold text-sm">
              {loading ? 'Verifying…' : 'Verify and enable MFA'}
            </button>
            <button type="button" onClick={() => { setEnrol(null); setCode(''); setError(null); }}
              className="px-4 py-2.5 text-slate-400 hover:text-white text-sm">Cancel</button>
          </div>
        </form>
      )}

      {/* MFA already on: show disable form */}
      {status?.mfaEnabled && !recoveryCodes && (
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">Disable MFA</h2>
          <p className="text-sm text-slate-300">
            Disabling MFA removes the second-factor requirement on your account. We&rsquo;ll
            require your password and a current authenticator (or recovery) code to confirm.
          </p>

          {!showDisable ? (
            <button onClick={() => setShowDisable(true)}
              className="px-4 py-2 border border-rose-500/40 hover:bg-rose-500/10 text-rose-300 rounded-lg text-sm">
              Disable MFA
            </button>
          ) : (
            <form onSubmit={disable} className="space-y-3 max-w-md">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Your password</label>
                <input type="password" value={disablePw} onChange={e => setDisablePw(e.target.value)}
                  autoComplete="current-password"
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-500" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Authenticator OR recovery code</label>
                <input value={disableCode} onChange={e => setDisableCode(e.target.value)}
                  placeholder="000000  or  a3f9c-7e1b8"
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-500" />
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={loading}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 rounded-lg text-white font-semibold text-sm">
                  {loading ? 'Disabling…' : 'Confirm disable'}
                </button>
                <button type="button" onClick={() => { setShowDisable(false); setDisablePw(''); setDisableCode(''); setError(null); }}
                  className="px-4 py-2 text-slate-400 hover:text-white text-sm">Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
