'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

interface InvitationInfo {
  tenantName: string;
  email: string;
  roleName: string;
  expiresAt: string;
}

const RULES = [
  { test: (p: string) => p.length >= 10,         label: 'At least 10 characters' },
  { test: (p: string) => /[A-Z]/.test(p),        label: 'One uppercase letter' },
  { test: (p: string) => /[a-z]/.test(p),        label: 'One lowercase letter' },
  { test: (p: string) => /\d/.test(p),           label: 'One digit' },
  { test: (p: string) => /[^A-Za-z0-9]/.test(p), label: 'One symbol' },
];

export default function InvitationAcceptPage() {
  const params = useParams<{ token: string }>();
  const token  = params?.token ?? '';

  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [existingUser, setExistingUser] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName,  setLastName]  = useState('');
  const [pw,  setPw]  = useState('');
  const [pw2, setPw2] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!token) return;
      try {
        const r = await fetch(`/api/auth/invitation/${encodeURIComponent(token)}`);
        const data = await r.json();
        if (!r.ok) {
          setLoadError(data?.error ?? 'Invitation could not be loaded.');
          return;
        }
        setInfo(data.invitation);
        setExistingUser(!!data.existingUser);
      } catch {
        setLoadError('Network error — try again.');
      }
    })();
  }, [token]);

  const ruleStatus = useMemo(() => RULES.map(r => ({ ...r, pass: r.test(pw) })), [pw]);
  const allPass = ruleStatus.every(r => r.pass);
  const matches = pw.length > 0 && pw === pw2;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!info) return;

    if (existingUser) {
      if (!pw) { setError('Enter your existing password.'); return; }
    } else {
      if (!firstName.trim() || !lastName.trim()) { setError('First and last name are required.'); return; }
      if (!allPass)  { setError('Password does not meet the policy.'); return; }
      if (!matches)  { setError('Passwords do not match.'); return; }
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/invitation/accept', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          password: pw,
          ...(existingUser ? {} : { firstName: firstName.trim(), lastName: lastName.trim() }),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.errors?.join(' · ') ?? data.error ?? 'Could not accept invitation.');
        return;
      }
      localStorage.setItem('xl_mobility_session', JSON.stringify({ userId: data.user.id, tenantId: data.tenant.id }));
      window.location.href = '/platform';
    } catch {
      setError('Network error — try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) return shell(<ErrorCard message={loadError} />);
  if (!info)     return shell(<div className="text-slate-400 animate-pulse text-sm text-center">Loading invitation…</div>);

  return shell(
    <div className="bg-slate-900 border border-white/10 rounded-2xl p-8 shadow-2xl space-y-6">
      <div>
        <div className="text-slate-400 text-xs uppercase tracking-wide">You&rsquo;ve been invited</div>
        <h1 className="text-xl font-bold text-white mt-1">Join {info.tenantName}</h1>
        <p className="text-slate-400 text-sm mt-1">
          As <strong className="text-blue-300">{info.roleName}</strong>. Sent to <code className="text-emerald-300">{info.email}</code>.
        </p>
      </div>

      {error && (
        <div className="bg-red-950/50 border border-red-500/40 rounded-lg px-4 py-3 text-red-300 text-sm">{error}</div>
      )}

      {existingUser ? (
        <p className="text-slate-300 text-sm">
          We found an existing XL AI account for <strong>{info.email}</strong>.
          Enter your password to add this organisation to your account.
        </p>
      ) : (
        <p className="text-slate-300 text-sm">Set a password to create your account.</p>
      )}

      <form onSubmit={submit} className="space-y-4">
        {!existingUser && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">First name</label>
              <input value={firstName} onChange={e => setFirstName(e.target.value)} required
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Last name</label>
              <input value={lastName} onChange={e => setLastName(e.target.value)} required
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
            {existingUser ? 'Existing password' : 'New password'}
          </label>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)}
            autoComplete={existingUser ? 'current-password' : 'new-password'}
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
        </div>

        {!existingUser && (
          <>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Confirm password</label>
              <input type="password" value={pw2} onChange={e => setPw2(e.target.value)}
                autoComplete="new-password"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
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
          </>
        )}

        <button type="submit" disabled={submitting}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-lg text-sm">
          {submitting ? 'Joining…' : `Join ${info.tenantName}`}
        </button>
      </form>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="bg-slate-900 border border-rose-500/30 rounded-2xl p-8 shadow-2xl space-y-4">
      <h1 className="text-xl font-bold text-white">Invitation unavailable</h1>
      <p className="text-rose-300 text-sm">{message}</p>
      <a href="/login" className="inline-block text-blue-400 hover:text-blue-300 text-sm">&larr; Sign in</a>
    </div>
  );
}

function shell(children: React.ReactNode) {
  return (
    <div className="min-h-screen bg-[#0c1a3e] flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <div className="text-4xl font-black text-white tracking-tight">
            XL <span className="text-blue-500">AI</span>
          </div>
          <p className="text-slate-400 text-sm">Smart Mobility Platform</p>
        </div>
        {children}
      </div>
    </div>
  );
}
