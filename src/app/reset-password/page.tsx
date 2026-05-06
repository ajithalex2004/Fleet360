'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { KeyRound, CheckCircle2 } from 'lucide-react';

const RULES = [
  { test: (p: string) => p.length >= 10, label: 'At least 10 characters' },
  { test: (p: string) => /[A-Z]/.test(p), label: 'One uppercase letter (A-Z)' },
  { test: (p: string) => /[a-z]/.test(p), label: 'One lowercase letter (a-z)' },
  { test: (p: string) => /\d/.test(p), label: 'One digit (0-9)' },
  { test: (p: string) => /[^A-Za-z0-9]/.test(p), label: 'One symbol (e.g. !@#$%)' },
];

function ResetInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const token = sp.get('token') ?? '';

  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const allRulesMet = RULES.every(r => r.test(pw));
  const matches = pw.length > 0 && pw === confirm;
  const canSubmit = !!token && allRulesMet && matches && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErrors([]);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: pw }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrors(data.errors ?? [data.error ?? 'Reset failed']);
      } else {
        setDone(true);
        setTimeout(() => router.push('/login'), 2000);
      }
    } catch {
      setErrors(['Reset failed. Try again.']);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-slate-900/60 border border-white/10 rounded-3xl p-8 backdrop-blur-md shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600 to-purple-600 flex items-center justify-center">
              <KeyRound className="w-6 h-6 text-white" strokeWidth={1.75} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Reset password</h1>
              <p className="text-xs text-slate-400">Pick a strong password you don't reuse elsewhere.</p>
            </div>
          </div>

          {!token ? (
            <div className="space-y-3">
              <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200">
                Missing reset token. Make sure you opened the link from your email.
              </div>
              <Link href="/forgot-password" className="block text-center text-sm text-violet-400 hover:text-violet-300">
                Request a new reset link
              </Link>
            </div>
          ) : done ? (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-200 flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                <span>Password updated. Redirecting to sign in…</span>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1.5 font-semibold">New password</label>
                <input
                  type="password" required value={pw} onChange={e => setPw(e.target.value)}
                  autoComplete="new-password" autoFocus minLength={10}
                  className="w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-white/10 text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1.5 font-semibold">Confirm password</label>
                <input
                  type="password" required value={confirm} onChange={e => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  className="w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-white/10 text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
                />
                {confirm.length > 0 && !matches && (
                  <p className="text-xs text-rose-300 mt-1">Passwords don't match.</p>
                )}
              </div>

              <ul className="space-y-1 text-xs">
                {RULES.map((r, i) => {
                  const met = r.test(pw);
                  return (
                    <li key={i} className={`flex items-center gap-2 ${met ? 'text-emerald-300' : 'text-slate-500'}`}>
                      <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center text-[8px] ${met ? 'border-emerald-400 bg-emerald-500/30' : 'border-slate-600'}`}>
                        {met ? '✓' : ''}
                      </span>
                      {r.label}
                    </li>
                  );
                })}
              </ul>

              {errors.length > 0 && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 space-y-1">
                  {errors.map((e, i) => <div key={i}>• {e}</div>)}
                </div>
              )}

              <button type="submit" disabled={!canSubmit}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white font-semibold hover:opacity-90 disabled:opacity-50">
                {busy ? 'Updating…' : 'Update password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <ResetInner />
    </Suspense>
  );
}
