'use client';

import { useState } from 'react';
import AuthShell, { authStyles } from '@/components/marketing/AuthShell';

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

  const s = authStyles;
  return (
    <AuthShell eyebrow="Account recovery">
      <div>
        <h1 className={s.title}>Reset your password</h1>
        <p className={s.lede}>
          {sent
            ? "Check your inbox — if an account exists for that email, we've sent a reset link."
            : 'Enter the email on your account and we’ll send you a reset link.'}
        </p>
      </div>

      {error && <div className={s.error} role="alert"><span>{error}</span></div>}

      {!sent ? (
        <form onSubmit={submit} className={s.form}>
          <label className={s.field}>
            <span className={s.label}>Email address</span>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@yourcompany.com"
              autoComplete="email"
              className={s.input}
              required
            />
          </label>
          <button type="submit" disabled={loading} className={s.primary}>
            {loading ? 'Sending…' : 'Send reset link'} <span aria-hidden="true">→</span>
          </button>
        </form>
      ) : (
        <div className={s.success}>
          The link expires in 60 minutes. Didn&rsquo;t get it? Check your spam folder, or
          <button type="button" onClick={() => setSent(false)} className={s.accentLink} style={{ marginLeft: 4 }}>try again</button>.
        </div>
      )}

      <div className={s.center}>
        <a href="/login" className={s.link}>&larr; Back to sign in</a>
      </div>
    </AuthShell>
  );
}
