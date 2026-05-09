'use client';

import { useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';

const RULES = [
  { test: (p: string) => p.length >= 10,           label: 'At least 10 characters' },
  { test: (p: string) => /[A-Z]/.test(p),          label: 'One uppercase letter' },
  { test: (p: string) => /[a-z]/.test(p),          label: 'One lowercase letter' },
  { test: (p: string) => /\d/.test(p),             label: 'One digit' },
  { test: (p: string) => /[^A-Za-z0-9]/.test(p),   label: 'One symbol' },
];

export default function ResetPasswordPage() {
  const params = useSearchParams();
  const token  = params.get('token') ?? '';

  const [pw,  setPw]  = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done,  setDone]  = useState(false);

  const ruleStatus = useMemo(() => RULES.map(r => ({ ...r, pass: r.test(pw) })), [pw]);
  const allPass = ruleStatus.every(r => r.pass);
  const matches = pw.length > 0 && pw === pw2;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!token) { setError('Reset link is missing or invalid.'); return; }
    if (!allPass) { setError('Password does not meet the policy.'); return; }
    if (!matches) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: pw }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.errors?.join(' · ') ?? data.error ?? 'Reset failed.');
      } else {
        setDone(true);
      }
    } catch {
      setError('Network error — please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0c1a3e] flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <div className="text-4xl font-black text-white tracking-tight">
            XL <span className="text-blue-500">AI</span>
          </div>
          <p className="text-slate-400 text-sm">Smart Mobility Platform</p>
        </div>

        <div className="bg-slate-900 border border-white/10 rounded-2xl p-8 shadow-2xl space-y-6">
          <div>
            <h1 className="text-xl font-bold text-white">Set a new password</h1>
            <p className="text-slate-400 text-sm mt-1">
              {done
                ? 'Your password has been reset. You can sign in now.'
                : 'Choose a strong password. The reset link expires after 60 minutes.'}
            </p>
          </div>

          {error && (
            <div className="bg-red-950/50 border border-red-500/40 rounded-lg px-4 py-3 text-red-300 text-sm">
              {error}
            </div>
          )}

          {done ? (
            <a href="/login"
               className="block text-center py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg text-sm">
              Go to sign in
            </a>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">New password</label>
                <input
                  type={show ? 'text' : 'password'}
                  value={pw}
                  onChange={e => setPw(e.target.value)}
                  autoComplete="new-password"
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Confirm password</label>
                <input
                  type={show ? 'text' : 'password'}
                  value={pw2}
                  onChange={e => setPw2(e.target.value)}
                  autoComplete="new-password"
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                <label className="inline-flex items-center gap-2 text-xs text-slate-400 mt-1">
                  <input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} className="accent-blue-500" />
                  Show passwords
                </label>
              </div>

              <ul className="space-y-1 text-xs">
                {ruleStatus.map(r => (
                  <li key={r.label} className={r.pass ? 'text-emerald-400' : 'text-slate-500'}>
                    {r.pass ? '✓' : '○'} {r.label}
                  </li>
                ))}
                <li className={matches ? 'text-emerald-400' : 'text-slate-500'}>
                  {matches ? '✓' : '○'} Passwords match
                </li>
              </ul>

              <button type="submit" disabled={loading || !allPass || !matches}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-lg text-sm">
                {loading ? 'Resetting…' : 'Reset password'}
              </button>
            </form>
          )}

          <div className="text-center">
            <a href="/login" className="text-xs text-slate-400 hover:text-white">&larr; Back to sign in</a>
          </div>
        </div>
      </div>
    </div>
  );
}
