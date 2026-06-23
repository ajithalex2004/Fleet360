'use client';

import { useState, useCallback, useEffect } from 'react';

const SSO_MESSAGES: Record<string, string> = {
  'unknown':                  'No SSO configured for that email domain.',
  'missing-email':            'Enter an email to continue with SSO.',
  'discovery-failed':         'Couldn’t reach your identity provider. Try again or use password sign-in.',
  'missing-state':            'SSO session expired. Try again.',
  'invalid-state':            'SSO session expired or tampered with. Try again.',
  'config-missing':           'SSO is not currently configured for your tenant.',
  'incomplete':               'SSO is configured for your domain, but the setup is incomplete. Contact your administrator.',
  'no-claims':                'Your identity provider returned no claims.',
  'no-email':                 'Your identity provider didn’t return an email address.',
  'domain-not-allowed':       'That email domain isn’t in this tenant’s allowed list.',
  'tenant-inactive':          'Your tenant is currently inactive.',
  'no-role':                  'No role available to assign you. Contact your administrator.',
  'user-not-provisioned':     'Your account isn’t set up yet, and JIT provisioning is disabled. Contact your administrator.',
  'account-disabled':         'Your account is disabled. Contact your administrator.',
  'callback-failed':          'SSO sign-in failed. Try again or use password sign-in.',
};

export default function LoginPage() {
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
  const [ssoChecking, setSsoChecking] = useState(false);
  const [ssoDiscovery, setSsoDiscovery] = useState<string | null>(null);

  // Optional white-label branding when arriving via /login?tenant=<code>
  interface PublicBranding {
    productName: string | null; tagline: string | null;
    logoUrl: string | null; primaryColor: string | null;
    tenantName?: string;
  }
  const [branding, setBranding] = useState<PublicBranding | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (branding?.primaryColor) {
      document.documentElement.style.setProperty('--brand-primary', branding.primaryColor);
    }
  }, [branding]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params  = new URLSearchParams(window.location.search);

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
    if (tenantCode) {
      fetch(`/api/branding?tenant=${encodeURIComponent(tenantCode)}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.branding) setBranding(d.branding); })
        .catch(() => {});
    }
  }, []);

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

      localStorage.setItem(
        'xl_mobility_session',
        JSON.stringify({
          userId: data.user.id,
          tenantId: data.tenant.id,
          customerId: data.customer?.customerId ?? null,
        }),
      );
      window.location.href = data.customer?.customerId ? '/customer' : '/platform';
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [email, password]);

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
      if (!/^[a-f0-9]{5}-[a-f0-9]{5}$/i.test(mfaCode.trim())) {
        setError('Recovery code format is xxxxx-xxxxx.');
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

  const handleSso = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const workEmail = ssoEmail.trim().toLowerCase();
    setError(null);
    setSsoDiscovery(null);
    if (!workEmail || !/.+@.+\..+/.test(workEmail)) {
      setError('Enter a valid work email.');
      return;
    }
    setSsoChecking(true);
    try {
      const res = await fetch('/api/auth/sso/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: workEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ready) {
        const tenantName = data.tenant?.name ? `${data.tenant.name}: ` : '';
        const reason = data.reason === 'incomplete'
          ? `${tenantName}SSO setup is incomplete. Contact your administrator.`
          : data.reason === 'tenant-inactive'
            ? `${tenantName}tenant is inactive.`
            : 'No SSO is configured for that email domain. Use password sign-in or contact your administrator.';
        setError(reason);
        return;
      }
      const returnTo = data.customer?.customerId ? '/customer' : '/platform';
      const label = data.customer?.customerName
        ? `${data.customer.customerName} portal`
        : data.tenant?.name ?? 'your identity provider';
      setSsoDiscovery(`Redirecting to ${label}...`);
      window.location.href = `/api/auth/sso/initiate?email=${encodeURIComponent(workEmail)}&returnTo=${encodeURIComponent(returnTo)}`;
    } catch {
      setError('Could not check SSO for this email. Try again or use password sign-in.');
    } finally {
      setSsoChecking(false);
    }
  }, [ssoEmail]);

  return (
    <div className="relative min-h-screen bg-[var(--app-bg)] flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          {branding?.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={branding.logoUrl} alt={branding.productName ?? branding.tenantName ?? ''}
              className="mx-auto h-10 max-w-[200px] object-contain" />
          ) : (
            <div className="text-4xl font-black text-white tracking-tight">
              {branding?.productName
                ? <span>{branding.productName}</span>
                : <>Fleet<span className="text-blue-500">360</span></>}
            </div>
          )}
          <p className="text-slate-400 text-sm">
            {branding?.tagline ?? 'Fleet Management Platform'}
          </p>
        </div>

        <div className="bg-slate-900 border border-white/10 rounded-2xl p-8 shadow-2xl space-y-6">
          <div>
            <h1 className="text-xl font-bold text-white">{mfaStep ? 'Two-factor required' : 'Sign in'}</h1>
            <p className="text-slate-400 text-sm mt-1">
              {mfaStep
                ? (useRecovery ? 'Enter one of your recovery codes.' : 'Enter the 6-digit code from your authenticator app.')
                : 'Welcome back — enter your credentials below.'}
            </p>
          </div>

          {error && (
            <div className="bg-red-950/50 border border-red-500/40 rounded-lg px-4 py-3 text-red-300 text-sm">
              {error}
            </div>
          )}

          {ssoMode ? (
            <form onSubmit={handleSso} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Work email</label>
                <input type="email" value={ssoEmail} onChange={e => setSsoEmail(e.target.value)} required autoFocus
                  placeholder="you@yourcompany.com"
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
              {ssoDiscovery && <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-200">{ssoDiscovery}</div>}
              <button type="submit" disabled={ssoChecking}
                className="w-full py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold rounded-lg text-sm">
                {ssoChecking ? 'Checking SSO...' : 'Continue with SSO'}
              </button>
              <div className="text-center">
                <button type="button" onClick={() => { setSsoMode(false); setError(null); }}
                  className="text-xs text-slate-400 hover:text-white">&larr; Sign in with password instead</button>
              </div>
            </form>
          ) : !mfaStep ? (
            <form onSubmit={handleLogin} className="space-y-4">
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

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 pr-10 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                  <button type="button" onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs" tabIndex={-1}>
                    {showPw ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <button type="submit" disabled={loading}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-lg text-sm">
                {loading ? 'Signing in…' : 'Sign in'}
              </button>

              <div className="flex items-center justify-between text-xs">
                <button type="button" onClick={() => { setSsoMode(true); setError(null); }}
                  className="text-violet-300 hover:text-violet-200 font-medium">Sign in with SSO →</button>
                <a href="/forgot-password" className="text-slate-400 hover:text-white">Forgot your password?</a>
              </div>
            </form>
          ) : (
            <form onSubmit={handleMfa} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                  {useRecovery ? 'Recovery code' : 'Authenticator code'}
                </label>
                <input
                  value={mfaCode}
                  onChange={e => setMfaCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode={useRecovery ? 'text' : 'numeric'}
                  autoComplete="one-time-code"
                  placeholder={useRecovery ? 'a3f9c-7e1b8' : '000000'}
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-lg font-mono text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                  required
                />
              </div>

              <button type="submit" disabled={loading}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-lg text-sm">
                {loading ? 'Verifying…' : 'Verify and continue'}
              </button>

              <div className="flex items-center justify-between text-xs">
                <button type="button"
                  onClick={() => { setUseRecovery(v => !v); setMfaCode(''); setError(null); }}
                  className="text-slate-400 hover:text-white">
                  {useRecovery ? 'Use authenticator instead' : 'Use a recovery code'}
                </button>
                <button type="button"
                  onClick={() => { setMfaStep(false); setMfaCode(''); setUseRecovery(false); setError(null); }}
                  className="text-slate-400 hover:text-white">
                  &larr; Back
                </button>
              </div>
            </form>
          )}

          {!mfaStep && !ssoMode && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/10" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-slate-900 px-3 text-xs text-slate-500">New to Fleet360?</span>
                </div>
              </div>

              <button
                onClick={() => { window.location.href = '/onboarding'; }}
                className="w-full py-2.5 border border-white/10 hover:border-white/20 text-slate-300 hover:text-white text-sm font-medium rounded-lg">
                Create your organisation
              </button>
            </>
          )}
        </div>

        <p className="text-center text-xs text-slate-600">Fleet360 · Multi-Tenant Platform</p>
      </div>
    </div>
  );
}
