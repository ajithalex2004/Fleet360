'use client';

/**
 * /shipper-portal/setup?token=...
 *
 * Landing page for the invitation email link. Reads the raw token from
 * the query string, asks the user to pick a password, and exchanges
 * (token, password) for a session via POST /api/shipper-portal/auth/setup.
 */

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Ship, AlertCircle, CheckCircle2 } from 'lucide-react';

function SetupForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';

  const [email, setEmail]         = useState('');           // optional — used in policy check
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [busy, setBusy]           = useState(false);
  const [err, setErr]             = useState<string | null>(null);

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
      const res = await fetch('/api/shipper-portal/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password, email: email.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data?.error ?? 'Setup failed'); return; }
      router.replace('/shipper-portal');
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
          placeholder="you@yourcompany.com"
          className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
        <p className="text-[10px] text-slate-500">Used only to check the password is strong enough.</p>
      </div>

      <div className="space-y-1">
        <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Choose a password</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)}
          required minLength={8} autoComplete="new-password"
          placeholder="At least 8 characters"
          className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
      </div>

      <div className="space-y-1">
        <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Confirm password</label>
        <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
          required minLength={8} autoComplete="new-password"
          className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
      </div>

      <button type="submit" disabled={busy || !token}
        className="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-90 disabled:opacity-50 text-white font-semibold rounded-lg text-sm inline-flex items-center justify-center gap-2">
        {busy ? 'Setting up…' : (<><CheckCircle2 className="w-4 h-4" /> Set up my access</>)}
      </button>
    </form>
  );
}

export default function ShipperPortalSetupPage() {
  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/30">
          <Ship className="w-7 h-7 text-white" />
        </div>
        <div>
          <p className="text-2xl font-black text-white tracking-tight">
            Fleet<span className="text-emerald-400">360</span>
          </p>
          <p className="text-[11px] uppercase tracking-widest text-emerald-300/70">Shipper Portal Setup</p>
        </div>
      </div>

      <div className="bg-slate-900 border border-white/10 rounded-2xl p-7 shadow-2xl space-y-4">
        <div>
          <h1 className="text-lg font-bold text-white">Welcome</h1>
          <p className="text-slate-400 text-xs mt-0.5">
            Set a password for your Fleet360 portal account.
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
