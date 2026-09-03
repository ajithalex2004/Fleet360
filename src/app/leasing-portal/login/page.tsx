'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Car, AlertCircle } from 'lucide-react';

export default function LeasingPortalLoginPage() {
  const router = useRouter();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/leasing-portal/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data?.error ?? 'Login failed'); return; }
      router.replace('/leasing-portal');
    } finally { setBusy(false); }
  };

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
          <p className="text-[11px] uppercase tracking-widest text-cyan-300/70">Leasing Portal</p>
        </div>
      </div>

      <form onSubmit={submit}
        className="bg-slate-900 border border-white/10 rounded-2xl p-7 space-y-4 shadow-2xl">
        <div>
          <h1 className="text-lg font-bold text-white">Sign in</h1>
          <p className="text-slate-400 text-xs mt-0.5">View your contracts, pay invoices, and manage your lease.</p>
        </div>

        {err && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5" /> {err}
          </div>
        )}

        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            required autoComplete="email"
            placeholder="you@example.com"
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            required autoComplete="current-password"
            placeholder="••••••••"
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
        </div>

        <button type="submit" disabled={busy}
          className="w-full py-2.5 bg-gradient-to-r from-cyan-600 to-teal-600 hover:opacity-90 disabled:opacity-50 text-white font-semibold rounded-lg text-sm">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="text-[11px] text-slate-500 text-center pt-2">
          No account yet? Your account is created when your leasing company invites you.
        </p>
      </form>
    </div>
  );
}
