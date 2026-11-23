'use client';

import { Suspense, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import AuthShell, { authStyles } from '@/components/marketing/AuthShell';

const RULES = [
  { test: (p: string) => p.length >= 8,          label: 'At least 8 characters' },
  { test: (p: string) => /[a-zA-Z]/.test(p),     label: 'One alphabet letter' },
  { test: (p: string) => /\d/.test(p),            label: 'One numeric digit' },
  { test: (p: string) => /[^A-Za-z0-9]/.test(p),  label: 'One special character or symbol' },
];

// Next.js 15 requires useSearchParams to live under a Suspense boundary
// when the route is statically prerendered. Wrap the body so the build
// step can prerender the page shell while leaving the search-params-
// dependent inner subtree for client-side render. Without this, `next
// build` errors with "useSearchParams() should be wrapped in a suspense
// boundary".
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}

function ResetPasswordInner() {
  const params = useSearchParams() ?? new URLSearchParams();
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

  const s = authStyles;
  return (
    <AuthShell eyebrow="Account recovery">
      <div>
        <h1 className={s.title}>Set a new password</h1>
        <p className={s.lede}>
          {done
            ? 'Your password has been reset. You can sign in now.'
            : 'Choose a strong password. The reset link expires after 60 minutes.'}
        </p>
      </div>

      {error && <div className={s.error} role="alert"><span>{error}</span></div>}

      {done ? (
        <a href="/login" className={s.primary}>Go to sign in <span aria-hidden="true">→</span></a>
      ) : (
        <form onSubmit={submit} className={s.form}>
          <label className={s.field}>
            <span className={s.label}>New password</span>
            <input
              type={show ? 'text' : 'password'}
              value={pw}
              onChange={e => setPw(e.target.value)}
              autoComplete="new-password"
              className={s.input}
              required
            />
          </label>
          <label className={s.field}>
            <span className={s.label}>Confirm password</span>
            <input
              type={show ? 'text' : 'password'}
              value={pw2}
              onChange={e => setPw2(e.target.value)}
              autoComplete="new-password"
              className={s.input}
              required
            />
          </label>
          <label className={s.checkbox}>
            <input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} />
            Show passwords
          </label>

          <ul className={s.rules}>
            {ruleStatus.map(r => (
              <li key={r.label} className={r.pass ? s.rulePass : s.ruleFail}>
                {r.pass ? '✓' : '○'} {r.label}
              </li>
            ))}
            <li className={matches ? s.rulePass : s.ruleFail}>
              {matches ? '✓' : '○'} Passwords match
            </li>
          </ul>

          <button type="submit" disabled={loading || !allPass || !matches} className={s.primary}>
            {loading ? 'Resetting…' : 'Reset password'} <span aria-hidden="true">→</span>
          </button>
        </form>
      )}

      <div className={s.center}>
        <a href="/login" className={s.link}>&larr; Back to sign in</a>
      </div>
    </AuthShell>
  );
}
