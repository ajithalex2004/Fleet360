'use client';

/**
 * /leasing-portal/setup?token=...
 *
 * Landing page for the invitation email link. Reads the raw token from
 * the query string, asks the lessee to pick a password, and exchanges
 * (token, password) for a session via POST /api/leasing-portal/auth/setup.
 */

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Car, AlertCircle, CheckCircle2 } from 'lucide-react';
import { DEFAULT_PASSWORD_POLICY } from '@/lib/password-policy';

const POLICY = DEFAULT_PASSWORD_POLICY;

function SetupForm() {
  const params = useSearchParams() ?? new URLSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';

  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [busy, setBusy]           = useState(false);
  const [err, setErr]             = useState<string | null>(null);

  const checks = useMemo(() => {
    const pw = password;
    return [
      { label: `At least ${POLICY.minLength} characters`, ok: pw.length >= POLICY.minLength },
      ...(POLICY.requireUpper  ? [{ label: 'An uppercase letter (A–Z)', ok: /[A-Z]/.test(pw) }]      : []),
      ...(POLICY.requireLower  ? [{ label: 'A lowercase letter (a–z)',  ok: /[a-z]/.test(pw) }]      : []),
      ...(POLICY.requireDigit  ? [{ label: 'A digit (0–9)',             ok: /\d/.test(pw) }]         : []),
      ...(POLICY.requireSymbol ? [{ label: 'A symbol (e.g. ! @ # $)',   ok: /[^A-Za-z0-9]/.test(pw) }] : []),
    ];
  }, [password]);
  const allOk = checks.every(c => c.ok);

  useEffect(() => {
    if (!token) setErr('Missing setup token in the link. Please use the link from your invitation email.');
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!token) return;
    if (password !== confirm) {
      setErr('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/leasing-portal/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password, email: email.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data?.error ?? 'Setup failed'); return; }
      router.replace('/leasing-portal');
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {err && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {err}
        </div>
      )}

      <div className="space-y-1">
        <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Your email (optional)</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
        <p className="text-[10px] text-slate-500">Used only to check the password is strong enough.</p>
      </div>

      <div className="space-y-1">
        <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Choose a password</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)}
          required minLength={POLICY.minLength} autoComplete="new-password"
          placeholder={`At least ${POLICY.minLength} characters`}
          className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
        <ul className="mt-2 space-y-0.5">
          {checks.map(c => (
            <li key={c.label} className={`flex items-center gap-1.5 text-[11px] ${c.ok ? 'text-cyan-300' : 'text-slate-500'}`}>
              <span aria-hidden="true">{c.ok ? '✓' : '•'}</span>
              {c.label}
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-1">
        <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Confirm password</label>
        <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
          required minLength={POLICY.minLength} autoComplete="new-password"
          className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
      </div>

      <button type="submit" disabled={busy || !token || !allOk || password !== confirm}
        className="w-full py-2.5 bg-gradient-to-r from-cyan-600 to-teal-600 hover:opacity-90 disabled:opacity-50 text-white font-semibold rounded-lg text-sm inline-flex items-center justify-center gap-2">
        {busy ? 'Setting up…' : (<><CheckCircle2 className="w-4 h-4" /> Set up my access</>)}
      </button>
    </form>
  );
}

export default function LeasingPortalSetupPage() {
  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500 to-teal-600 shadow-lg shadow-cyan-500/30">
          <Car className="w-7 h-7 text-white" />
        </div>
        <div>
          <p className="text-2xl font-black text-white tracking-tight">
            Fleet<span className="text-cyan-400">360</span>
          </p>
          <p className="text-[11px] uppercase tracking-widest text-cyan-300/70">Leasing Portal Setup</p>
        </div>
      </div>

      <div className="bg-slate-900 border border-white/10 rounded-2xl p-7 shadow-2xl space-y-4">
        <div>
          <h1 className="text-lg font-bold text-white">Welcome</h1>
          <p className="text-slate-400 text-xs mt-0.5">
            Set a password for your Fleet360 leasing portal account.
          </p>
        </div>
        <Suspense fallback={
          <div className="text-slate-500 text-sm">Loading…</div>
        }>
          <SetupForm />
        </Suspense>
      </div>
    </div>
  );
}
