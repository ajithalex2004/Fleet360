'use client';

import { useState, useCallback } from 'react';

export default function LoginPage() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [showPw, setShowPw]     = useState(false);

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message ?? 'Login failed. Please check your credentials.');
        return;
      }

      // Store session info in localStorage for the PermissionContext
      localStorage.setItem(
        'xl_mobility_session',
        JSON.stringify({ userId: data.user.id, tenantId: data.tenant.id }),
      );

      // Hard redirect so the new xl-session cookie is fully applied and
      // TenantSessionBar picks up the logged-in user without a stale cache.
      window.location.href = '/platform';
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [email, password]);

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">

        {/* Logo / Brand */}
        <div className="text-center space-y-2">
          <div className="text-4xl font-black text-white tracking-tight">
            XL <span className="text-blue-500">AI</span>
          </div>
          <p className="text-slate-400 text-sm">Smart Mobility Platform</p>
        </div>

        {/* Card */}
        <div className="bg-slate-900 border border-white/10 rounded-2xl p-8 shadow-2xl space-y-6">
          <div>
            <h1 className="text-xl font-bold text-white">Sign in</h1>
            <p className="text-slate-400 text-sm mt-1">Welcome back — enter your credentials below.</p>
          </div>

          {error && (
            <div className="bg-red-950/50 border border-red-500/40 rounded-lg px-4 py-3 text-red-300 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            {/* Email */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@yourcompany.com"
                autoComplete="email"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            {/* Password */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 pr-10 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
                  tabIndex={-1}
                >
                  {showPw ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors text-sm"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/10" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-slate-900 px-3 text-xs text-slate-500">New to XL AI?</span>
            </div>
          </div>

          <button
            onClick={() => { window.location.href = '/onboarding'; }}
            className="w-full py-2.5 border border-white/10 hover:border-white/20 text-slate-300 hover:text-white text-sm font-medium rounded-lg transition-colors"
          >
            Create your organisation
          </button>
        </div>

        <p className="text-center text-xs text-slate-600">
          XL AI Smart Mobility · Multi-Tenant Platform
        </p>
      </div>
    </div>
  );
}
