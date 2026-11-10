'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { clearClientSession, setClientSession, setClientSessionSnapshot } from '@/lib/client-session';
import { useLanguage } from '@/contexts/LanguageContext';

const SSO_MESSAGES: Record<string, string> = {
  'unknown':                  'No SSO configured for that email domain.',
  'missing-email':            'Enter an email to continue with SSO.',
  'discovery-failed':         'Couldn’t reach your identity provider. Try again or use password sign-in.',
  'missing-state':            'SSO session expired. Try again.',
  'invalid-state':            'SSO session expired or tampered with. Try again.',
  'config-missing':           'SSO is not currently configured for your tenant.',
  'no-claims':                'Your identity provider returned no claims.',
  'no-email':                 'Your identity provider didn’t return an email address.',
  'email-unverified':         'Your identity provider hasn’t verified your email address.',
  'domain-not-allowed':       'That email domain isn’t in this tenant’s allowed list.',
  'tenant-inactive':          'Your tenant is currently inactive.',
  'no-role':                  'No role available to assign you. Contact your administrator.',
  'user-not-provisioned':     'Your account isn’t set up yet, and JIT provisioning is disabled. Contact your administrator.',
  'account-disabled':         'Your account is disabled. Contact your administrator.',
  'membership-missing':       'You’re not a member of this tenant, and JIT provisioning is disabled. Contact your administrator.',
  'membership-disabled':      'Your access to this tenant has been removed. Contact your administrator.',
  'callback-failed':          'SSO sign-in failed. Try again or use password sign-in.',
};

export default function LoginPage() {
  const router = useRouter();
  const { setLanguage, tLabel, isRTL } = useLanguage();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [showPw, setShowPw]     = useState(false);

  // MFA second-factor step
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);

  // SSO step
  const [ssoMode, setSsoMode] = useState(false);
  const [ssoEmail, setSsoEmail] = useState('');

  // Optional white-label branding when arriving via /login?tenant=<code>
  interface PublicBranding {
    productName: string | null; tagline: string | null;
    logoUrl: string | null; primaryColor: string | null;
    tenantName?: string;
    defaultLanguage?: string | null;
  }
  const [branding, setBranding] = useState<PublicBranding | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (branding?.primaryColor) {
      document.documentElement.style.setProperty('--brand-primary', branding.primaryColor);
    }
  }, [branding]);

  // Enforce English always unless tenant branding explicitly specifies Arabic
  useEffect(() => {
    if (branding?.defaultLanguage === 'ar') {
      setLanguage('ar');
    } else {
      setLanguage('en');
    }
  }, [branding?.defaultLanguage, setLanguage]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params  = new URLSearchParams(window.location.search);
    if (params.get('logout') === 'true') {
      clearClientSession();
    } else {
      try {
        const stored = localStorage.getItem('xl_mobility_session');
        const snap =
          localStorage.getItem('xl_mobility_session_snapshot_v2') ||
          localStorage.getItem('xl_mobility_session_snapshot');
        if (stored && snap) {
          fetch('/api/admin/session', { cache: 'no-store' })
            .then((r) => {
              if (r.ok) {
                window.location.assign('/platform');
              } else if (r.status === 401 || r.status === 403 || r.status === 404) {
                clearClientSession();
              }
            })
            .catch(() => {});
        }
      } catch {}
    }

    const ssoFlag = params.get('sso');
    if (ssoFlag && SSO_MESSAGES[ssoFlag]) {
      setError(SSO_MESSAGES[ssoFlag]);
      const emailQ = params.get('email');
      if (emailQ) setSsoEmail(emailQ);
      const clean = new URL(window.location.href);
      clean.searchParams.delete('sso');
      clean.searchParams.delete('email');
      window.history.replaceState({}, '', clean.toString());
    }

    const tenantCode = params.get('tenant');
    const domainParam = params.get('domain');
    const query = tenantCode ? `tenant=${encodeURIComponent(tenantCode)}` : domainParam ? `domain=${encodeURIComponent(domainParam)}` : null;

    if (query) {
      fetch(`/api/branding?${query}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (d?.branding) {
            setBranding(d.branding);
            if (d.branding.defaultLanguage === 'ar') {
              setLanguage('ar');
            } else {
              setLanguage('en');
            }
          } else {
            setLanguage('en');
          }
        })
        .catch(() => { setLanguage('en'); });
    } else {
      setLanguage('en');
    }
  }, [setLanguage]);

  const submit = useCallback(async (overrides?: { mfaCode?: string; recoveryCode?: string }) => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          email: email.trim(),
          password,
          ...(overrides?.mfaCode      ? { mfaCode:      overrides.mfaCode }      : {}),
          ...(overrides?.recoveryCode ? { recoveryCode: overrides.recoveryCode } : {}),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.mfaRequired) {
          setMfaStep(true);
          // Soft message only on the first transition; suppress on retry-after-bad-code
          if (!overrides?.mfaCode && !overrides?.recoveryCode) {
            setError(null);
          } else {
            setError(data.message ?? 'Invalid code.');
          }
          return;
        }
        setError(data.message ?? 'Login failed. Please check your credentials.');
        return;
      }

      setClientSession(data.user.id, data.tenant.id, data.backendToken);
      if (data.user && data.tenant) {
        setClientSessionSnapshot({
          user: data.user,
          tenant: {
            ...data.tenant,
            enabledModules: Array.isArray(data.tenant.enabledModules) ? data.tenant.enabledModules : [],
          },
          permissions: Array.isArray(data.permissions) ? data.permissions : [],
        });
      }
      // Stash the JWT for the Go backend. The Authorization-Bearer
      // fetcher in src/lib/auth/backend-fetch.ts reads from this key.
      // Login response may include backendToken=null when JWT_SECRET is
      // unconfigured on the server — fall back to clearing the slot so
      // a stale token from a previous login isn't reused.
      if (data.backendToken) {
        localStorage.setItem('xl_backend_token', data.backendToken);
      } else {
        localStorage.removeItem('xl_backend_token');
      }
      window.location.assign('/platform');
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [email, password, router]);

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    await submit();
  }, [email, password, submit]);

  const handleMfa = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (useRecovery) {
      if (!/^(?:[a-f0-9]{10}|[a-f0-9]{5})-[a-f0-9]{5}$/i.test(mfaCode.trim())) {
        setError('Recovery code format is xxxxxxxxxx-xxxxx.');
        return;
      }
      await submit({ recoveryCode: mfaCode.trim() });
    } else {
      if (!/^\d{6}$/.test(mfaCode)) {
        setError('Enter the 6-digit code from your authenticator.');
        return;
      }
      await submit({ mfaCode });
    }
  }, [mfaCode, useRecovery, submit]);

  return (
    <div
      dir={isRTL ? 'rtl' : 'ltr'}
      className="relative min-h-screen bg-white text-slate-900 flex items-center justify-center p-4 sm:p-6 overflow-hidden selection:bg-blue-100 selection:text-blue-900"
    >
      {/* Subtle modern white-theme background accents */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:24px_24px] opacity-60"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-[420px] w-[780px] rounded-full bg-gradient-to-tr from-blue-100/70 via-sky-50/50 to-indigo-100/60 blur-3xl"
      />

      <div className="relative z-10 w-full max-w-[420px] space-y-7">
        {/* Brand Header */}
        <div className="text-center space-y-2.5">
          {branding?.logoUrl ? (
            <div className="inline-flex items-center justify-center rounded-2xl bg-white p-3 shadow-md shadow-slate-200/70 ring-1 ring-slate-200/80">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={branding.logoUrl}
                alt={branding.productName ?? branding.tenantName ?? ''}
                className="mx-auto h-12 max-w-[200px] object-contain"
              />
            </div>
          ) : branding?.productName ? (
            <div className="text-3xl font-black text-slate-900 tracking-tight">
              <span>{branding.productName}</span>
            </div>
          ) : (
            <div className="inline-flex items-center justify-center rounded-2xl bg-white p-2.5 shadow-md shadow-slate-200/70 ring-1 ring-slate-200/80">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo-fleet360.png"
                alt="FLEET360"
                className="mx-auto h-16 max-w-[200px] object-contain"
              />
            </div>
          )}
          <div className="space-y-0.5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
              {branding?.productName ?? 'FLEET360'}
            </p>
            <p className="text-slate-500 text-sm font-medium">
              {branding?.tagline ? branding.tagline : tLabel('Fleet Management Platform')}
            </p>
          </div>
        </div>

        {/* Modern White Card */}
        <div className="bg-white/95 backdrop-blur-sm border border-slate-200/90 rounded-3xl p-7 sm:p-9 shadow-[0_20px_50px_-12px_rgba(15,23,42,0.08)] space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              {mfaStep ? tLabel('Two-factor required') : tLabel('Sign in')}
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              {mfaStep
                ? (useRecovery
                    ? tLabel('Enter one of your recovery codes.')
                    : tLabel('Enter the 6-digit code from your authenticator app.'))
                : tLabel('Welcome back — enter your credentials below.')}
            </p>
          </div>

          {error && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-rose-700 text-sm font-medium flex items-start gap-2.5">
              <span className="mt-0.5 inline-block h-2 w-2 rounded-full bg-rose-500 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {ssoMode ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!ssoEmail.trim() || !/.+@.+\..+/.test(ssoEmail)) {
                  setError('Enter a valid work email.');
                  return;
                }
                window.location.href = `/api/auth/sso/initiate?email=${encodeURIComponent(ssoEmail.trim())}`;
              }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  {tLabel('Work email')}
                </label>
                <input
                  type="email"
                  value={ssoEmail}
                  onChange={e => setSsoEmail(e.target.value)}
                  required
                  autoFocus
                  placeholder="you@yourcompany.com"
                  className="w-full bg-slate-50/70 hover:bg-slate-50 focus:bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-indigo-500/15 focus:border-indigo-600 transition-all"
                />
              </div>
              <button
                type="submit"
                className="w-full py-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-semibold rounded-xl text-sm shadow-md shadow-indigo-600/20 transition-all"
              >
                {tLabel('Continue with SSO')}
              </button>
              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => { setSsoMode(false); setError(null); }}
                  className="text-xs font-medium text-slate-500 hover:text-slate-900 transition-colors"
                >
                  &larr; {tLabel('Sign in with password instead')}
                </button>
              </div>
            </form>
          ) : !mfaStep ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  {tLabel('Email or Username')}
                </label>
                <input
                  type="text"
                  name="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="username or you@yourcompany.com"
                  autoComplete="username"
                  className="w-full bg-slate-50/70 hover:bg-slate-50 focus:bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-600 transition-all"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  {tLabel('Password')}
                </label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    name="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="w-full bg-slate-50/70 hover:bg-slate-50 focus:bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 pr-14 text-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-600 transition-all"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800 font-semibold text-xs px-1.5 py-0.5 rounded-md hover:bg-slate-100 transition-colors"
                    tabIndex={-1}
                  >
                    {showPw ? tLabel('Hide') : tLabel('Show')}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 text-white font-semibold rounded-xl text-sm shadow-md shadow-blue-600/20 active:scale-[0.99] transition-all"
              >
                {loading ? tLabel('Signing in…') : tLabel('Sign in')}
              </button>

              <div className="flex items-center justify-between text-xs pt-1">
                <button
                  type="button"
                  onClick={() => { setSsoMode(true); setError(null); }}
                  className="text-indigo-600 hover:text-indigo-700 font-semibold transition-colors"
                >
                  {tLabel('Sign in with SSO →')}
                </button>
                <a
                  href="/forgot-password"
                  className="text-slate-500 hover:text-slate-900 font-medium transition-colors"
                >
                  {tLabel('Forgot your password?')}
                </a>
              </div>
            </form>
          ) : (
            <form onSubmit={handleMfa} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  {useRecovery ? tLabel('Recovery code') : tLabel('Authenticator code')}
                </label>
                <input
                  value={mfaCode}
                  onChange={e => setMfaCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode={useRecovery ? 'text' : 'numeric'}
                  autoComplete="one-time-code"
                  placeholder={useRecovery ? 'a3f9c-7e1b8' : '000000'}
                  className="w-full bg-slate-50/70 focus:bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-900 text-lg font-mono text-center tracking-widest placeholder-slate-300 focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-600 transition-all"
                  autoFocus
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 text-white font-semibold rounded-xl text-sm shadow-md shadow-blue-600/20 transition-all"
              >
                {loading ? tLabel('Verifying…') : tLabel('Verify and continue')}
              </button>

              <div className="flex items-center justify-between text-xs pt-1">
                <button
                  type="button"
                  onClick={() => { setUseRecovery(v => !v); setMfaCode(''); setError(null); }}
                  className="text-slate-500 hover:text-slate-900 font-medium transition-colors"
                >
                  {useRecovery ? tLabel('Use authenticator instead') : tLabel('Use a recovery code')}
                </button>
                <button
                  type="button"
                  onClick={() => { setMfaStep(false); setMfaCode(''); setUseRecovery(false); setError(null); }}
                  className="text-slate-500 hover:text-slate-900 font-medium transition-colors"
                >
                  &larr; {tLabel('Back')}
                </button>
              </div>
            </form>
          )}

          {!mfaStep && !ssoMode && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-white px-3 text-xs font-medium text-slate-400">
                    {tLabel('New to Fleet360?')}
                  </span>
                </div>
              </div>

              <button
                type="button"
                disabled
                aria-disabled="true"
                title="Self-service organisation onboarding is currently disabled"
                className="w-full py-2.5 bg-slate-100 border border-slate-200 text-slate-400 text-sm font-semibold rounded-xl cursor-not-allowed opacity-60 select-none"
              >
                {tLabel('Create your organisation')}
              </button>
            </>
          )}
        </div>

        <p className="text-center text-xs font-medium text-slate-400">
          Fleet360 · {tLabel('Multi-Tenant Platform')}
        </p>
      </div>
    </div>
  );
}
