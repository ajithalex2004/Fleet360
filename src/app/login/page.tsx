'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { clearClientSession, setClientSession, setClientSessionSnapshot } from '@/lib/client-session';
import { useLanguage } from '@/contexts/LanguageContext';
import AuthShell, { authStyles } from '@/components/marketing/AuthShell';

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

  const s = authStyles;
  const identity = branding?.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={branding.logoUrl} alt={branding.productName ?? branding.tenantName ?? ''} />
  ) : branding?.productName ? (
    <span className={s.productName}>{branding.productName}</span>
  ) : null;

  return (
    <AuthShell
      dir={isRTL ? 'rtl' : 'ltr'}
      identity={identity}
      eyebrow={branding?.tagline ? branding.tagline : tLabel('Fleet Management Platform')}
      footer={`Fleet360 · ${tLabel('Multi-Tenant Platform')}`}
    >
      <div>
        <h1 className={s.title}>
          {mfaStep ? tLabel('Two-factor required') : tLabel('Sign in')}
        </h1>
        <p className={s.lede}>
          {mfaStep
            ? (useRecovery
                ? tLabel('Enter one of your recovery codes.')
                : tLabel('Enter the 6-digit code from your authenticator app.'))
            : tLabel('Welcome back — enter your credentials below.')}
        </p>
      </div>

      {error && <div className={s.error} role="alert"><span>{error}</span></div>}

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
          className={s.form}
        >
          <label className={s.field}>
            <span className={s.label}>{tLabel('Work email')}</span>
            <input
              type="email"
              value={ssoEmail}
              onChange={e => setSsoEmail(e.target.value)}
              required
              autoFocus
              placeholder="you@yourcompany.com"
              className={s.input}
            />
          </label>
          <button type="submit" className={s.primary}>
            {tLabel('Continue with SSO')} <span aria-hidden="true">→</span>
          </button>
          <div className={s.center}>
            <button type="button" onClick={() => { setSsoMode(false); setError(null); }} className={s.link}>
              &larr; {tLabel('Sign in with password instead')}
            </button>
          </div>
        </form>
      ) : !mfaStep ? (
        <form onSubmit={handleLogin} className={s.form}>
          <label className={s.field}>
            <span className={s.label}>{tLabel('Email or Username')}</span>
            <input
              type="text"
              name="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="username or you@yourcompany.com"
              autoComplete="username"
              className={s.input}
              required
            />
          </label>

          <div className={s.field}>
            <label className={s.label} htmlFor="login-password">{tLabel('Password')}</label>
            <div className={s.inputWrap}>
              <input
                id="login-password"
                type={showPw ? 'text' : 'password'}
                name="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                className={s.input}
                required
              />
              <button type="button" onClick={() => setShowPw(v => !v)} className={s.reveal} tabIndex={-1}>
                {showPw ? tLabel('Hide') : tLabel('Show')}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading} className={s.primary}>
            {loading ? tLabel('Signing in…') : tLabel('Sign in')} <span aria-hidden="true">→</span>
          </button>

          <div className={s.row}>
            <button type="button" onClick={() => { setSsoMode(true); setError(null); }} className={s.accentLink}>
              {tLabel('Sign in with SSO →')}
            </button>
            <a href="/forgot-password" className={s.link}>{tLabel('Forgot your password?')}</a>
          </div>
        </form>
      ) : (
        <form onSubmit={handleMfa} className={s.form}>
          <label className={s.field}>
            <span className={s.label}>{useRecovery ? tLabel('Recovery code') : tLabel('Authenticator code')}</span>
            <input
              value={mfaCode}
              onChange={e => setMfaCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode={useRecovery ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              placeholder={useRecovery ? 'a3f9c-7e1b8' : '000000'}
              className={`${s.input} ${s.code}`}
              autoFocus
              required
            />
          </label>

          <button type="submit" disabled={loading} className={s.primary}>
            {loading ? tLabel('Verifying…') : tLabel('Verify and continue')} <span aria-hidden="true">→</span>
          </button>

          <div className={s.row}>
            <button
              type="button"
              onClick={() => { setUseRecovery(v => !v); setMfaCode(''); setError(null); }}
              className={s.link}
            >
              {useRecovery ? tLabel('Use authenticator instead') : tLabel('Use a recovery code')}
            </button>
            <button
              type="button"
              onClick={() => { setMfaStep(false); setMfaCode(''); setUseRecovery(false); setError(null); }}
              className={s.link}
            >
              &larr; {tLabel('Back')}
            </button>
          </div>
        </form>
      )}

      {!mfaStep && !ssoMode && (
        <>
          <div className={s.divider}>{tLabel('New to Fleet360?')}</div>
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="Self-service organisation onboarding is currently disabled"
            className={s.secondary}
          >
            {tLabel('Create your organisation')}
          </button>
        </>
      )}
    </AuthShell>
  );
}
