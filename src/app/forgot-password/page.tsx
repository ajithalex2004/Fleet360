'use client';

import { useState } from 'react';

export default function ForgotPasswordPage() {
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) { setError('Please enter your email.'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not send reset link.');
      } else {
        setSent(true);
      }
    } catch {
      setError('Network error — please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <div className="text-4xl font-black text-white tracking-tight">
            XL <span className="text-blue-500">AI</span>
          </div>
          <p className="text-slate-400 text-sm">Smart Mobility Platform</p>
        </div>

        <div className="bg-slate-900 border border-white/10 rounded-2xl p-8 shadow-2xl space-y-6">
          <div>
            <h1 className="text-xl font-bold text-white">Reset your password</h1>
            <p className="text-slate-400 text-sm mt-1">
              {sent
                ? "Check your inbox — if an account exists for that email, we've sent a reset link."
                : 'Enter the email on your account and we’ll send you a reset link.'}
            </p>
          </div>

          {error && (
            <div className="bg-red-950/50 border border-red-500/40 rounded-lg px-4 py-3 text-red-300 text-sm">
              {error}
            </div>
          )}

          {!sent ? (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@yourcompany.com"
                  autoComplete="email"
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <button type="submit" disabled={loading}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-lg text-sm">
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          ) : (
            <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-lg p-4 text-emerald-300 text-sm">
              The link expires in 60 minutes. Didn&rsquo;t get it? Check your spam folder, or
              <button onClick={() => setSent(false)} className="ml-1 underline">try again</button>.
            </div>
          )}

          <div className="text-center">
            <a href="/login" className="text-xs text-slate-400 hover:text-white">&larr; Back to sign in</a>
          </div>
        </div>
      </div>
    </div>
  );
}
