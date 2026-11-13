'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Building2, Car, Lock, ShieldCheck } from 'lucide-react';

export default function RacPortalLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantCode, setTenantCode] = useState('');
  const [showTenantCode, setShowTenantCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, string> = {
        email: email.trim(),
        password,
      };
      if (tenantCode.trim()) {
        payload.tenantCode = tenantCode.trim();
      }
      const res = await fetch('/api/rac-portal/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && data?.requiresTenantCode) {
          setShowTenantCode(true);
        }
        setError(data?.error ?? 'Sign-in failed. Check your corporate credentials.');
        return;
      }
      router.replace('/rac-portal');
    } catch {
      setError('Network error while connecting to Corporate Mobility Portal.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-md space-y-6">
      <div className="text-center space-y-2.5">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500 to-teal-600 shadow-xl shadow-cyan-500/25">
          <Car className="w-7 h-7 text-white" />
        </div>
        <div>
          <p className="text-2xl font-black text-white tracking-tight">
            Fleet<span className="text-cyan-400">360</span>
          </p>
          <p className="text-xs uppercase tracking-widest text-cyan-300/80 font-semibold mt-0.5">
            Corporate B2B Rent-A-Car Portal
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-slate-900/95 border border-white/10 rounded-2xl p-7 space-y-4 shadow-2xl"
      >
        <div className="space-y-1">
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Building2 className="w-5 h-5 text-cyan-400" />
            Corporate Account Sign In
          </h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            Book live fleet vehicles at contracted corporate tariffs, place instant card pre-authorizations, and manage agreements & invoices.
          </p>
        </div>

        {error && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-3.5 py-2.5 text-rose-300 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Corporate Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="mobility.manager@company.ae"
            className="w-full bg-slate-800/90 border border-white/10 rounded-xl px-3.5 py-2.5 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            maxLength={256}
            autoComplete="current-password"
            placeholder="••••••••••••"
            className="w-full bg-slate-800/90 border border-white/10 rounded-xl px-3.5 py-2.5 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
        </div>

        {showTenantCode ? (
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-cyan-300 uppercase tracking-wider">
              RAC Provider Code
            </label>
            <input
              type="text"
              value={tenantCode}
              onChange={(e) => setTenantCode(e.target.value)}
              placeholder="e.g. gulf-rac or provider code"
              className="w-full bg-slate-800/90 border border-cyan-500/40 rounded-xl px-3.5 py-2.5 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
        ) : (
          <div className="text-right">
            <button
              type="button"
              onClick={() => setShowTenantCode(true)}
              className="text-[11px] text-slate-400 hover:text-cyan-300 transition-colors"
            >
              Sign in to a specific RAC provider code?
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full py-2.5 bg-gradient-to-r from-cyan-500 to-teal-600 hover:opacity-95 disabled:opacity-50 text-white font-semibold rounded-xl text-sm shadow-lg shadow-cyan-500/20 transition-all inline-flex items-center justify-center gap-2"
        >
          <Lock className="w-4 h-4" />
          {busy ? 'Authenticating…' : 'Sign in to Corporate Portal'}
        </button>

        <div className="pt-3 border-t border-white/10 space-y-2">
          <div className="flex items-start gap-2 text-[11px] text-slate-400 bg-slate-800/50 border border-white/5 rounded-xl p-3">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <span className="text-slate-200 font-semibold">Enterprise Security:</span>{' '}
              Isolated corporate B2B session with PCI-DSS tokenized pre-authorization holds and contracted UAE fleet tariffs.
            </div>
          </div>
          <p className="text-[11px] text-slate-500 text-center">
            Need access? Ask your company&apos;s B2B Mobility Administrator or Fleet360 Account Manager for an invitation link.
          </p>
        </div>
      </form>
    </div>
  );
}
