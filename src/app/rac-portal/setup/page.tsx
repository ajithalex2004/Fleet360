'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Building2, Car, CheckCircle2, ShieldCheck } from 'lucide-react';
import { DEFAULT_PASSWORD_POLICY, MAX_PASSWORD_LENGTH } from '@/lib/password-policy';
import { formatRacPortalRole } from '../rac-portal-shell';

interface InvitePreview {
  valid: boolean;
  email?: string;
  fullName?: string | null;
  role?: string;
  expiresAt?: string;
  companyName?: string | null;
  tenantName?: string | null;
  error?: string;
}

function RacSetupForm() {
  const searchParams = useSearchParams() ?? new URLSearchParams();
  const router = useRouter();
  const token = searchParams.get('token')?.trim() ?? '';

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [validating, setValidating] = useState(true);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setPreview({ valid: false, error: 'Missing invitation token in URL.' });
      setValidating(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/rac-portal/auth/setup?token=${encodeURIComponent(token)}`, {
          cache: 'no-store',
        });
        const data = (await res.json()) as InvitePreview;
        if (!cancelled) setPreview(data);
      } catch {
        if (!cancelled) {
          setPreview({ valid: false, error: 'Unable to verify invitation link right now.' });
        }
      } finally {
        if (!cancelled) setValidating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const checks = useMemo(() => {
    const emailLocal = preview?.email?.split('@')[0]?.toLowerCase() ?? '';
    const containsEmail =
      emailLocal.length >= 4 && password.length > 0 && password.toLowerCase().includes(emailLocal);
    return [
      {
        label: `Between ${DEFAULT_PASSWORD_POLICY.minLength} and ${MAX_PASSWORD_LENGTH} characters`,
        ok:
          password.length >= DEFAULT_PASSWORD_POLICY.minLength &&
          password.length <= MAX_PASSWORD_LENGTH,
      },
      {
        label: 'Contains an alphabet letter (A–Z or a–z)',
        ok: /[A-Za-z]/.test(password),
      },
      {
        label: 'Contains a numeric digit (0–9)',
        ok: /\d/.test(password),
      },
      {
        label: 'Contains a special character (! @ # $ % ^ & *)',
        ok: /[^A-Za-z0-9]/.test(password),
      },
      {
        label: 'Does not contain your email username',
        ok: password.length > 0 && !containsEmail,
      },
    ];
  }, [password, preview?.email]);

  const allChecksPass = checks.every((c) => c.ok);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!token || !preview?.valid) return;
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/rac-portal/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? 'Failed to activate corporate portal account.');
        return;
      }
      router.replace('/rac-portal');
    } catch {
      setError('Network error while activating your account.');
    } finally {
      setBusy(false);
    }
  };

  if (validating) {
    return (
      <div className="py-8 text-center space-y-3">
        <div className="w-7 h-7 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-xs text-slate-400">Verifying corporate invitation…</p>
      </div>
    );
  }

  if (!preview?.valid) {
    return (
      <div className="space-y-4">
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 text-rose-300 text-xs flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-rose-200">Invitation Unavailable</p>
            <p className="mt-1">{preview?.error ?? 'This invitation link is invalid or has expired.'}</p>
          </div>
        </div>
        <Link
          href="/rac-portal/login"
          className="block w-full text-center py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-white/10 text-xs font-semibold text-white transition-colors"
        >
          Go to Corporate Sign In →
        </Link>
      </div>
    );
  }

  const roleMeta = formatRacPortalRole(preview.role);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-xl bg-cyan-500/10 border border-cyan-500/30 p-3.5 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-cyan-200 flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-cyan-400" />
            {preview.companyName ?? 'Corporate Account'}
          </span>
          <span
            className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${roleMeta.badgeClass}`}
          >
            {roleMeta.fullLabel}
          </span>
        </div>
        <p className="text-xs text-slate-300 font-mono">{preview.email}</p>
        {preview.tenantName && (
          <p className="text-[11px] text-slate-400">Provider: {preview.tenantName}</p>
        )}
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-3.5 py-2.5 text-rose-300 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          Create Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          maxLength={MAX_PASSWORD_LENGTH}
          autoComplete="new-password"
          placeholder="Minimum 8 characters"
          className="w-full bg-slate-800/90 border border-white/10 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
        />
        <ul className="pt-1.5 space-y-1">
          {checks.map((c) => (
            <li
              key={c.label}
              className={`flex items-center gap-2 text-[11px] ${
                c.ok ? 'text-emerald-300' : 'text-slate-500'
              }`}
            >
              <span>{c.ok ? '✓' : '•'}</span>
              <span>{c.label}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          Confirm Password
        </label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          maxLength={MAX_PASSWORD_LENGTH}
          autoComplete="new-password"
          placeholder="Re-enter password"
          className="w-full bg-slate-800/90 border border-white/10 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
        />
      </div>

      <button
        type="submit"
        disabled={busy || !allChecksPass || password !== confirm}
        className="w-full py-2.5 bg-gradient-to-r from-cyan-500 to-teal-600 hover:opacity-95 disabled:opacity-50 text-white font-semibold rounded-xl text-sm shadow-lg shadow-cyan-500/20 inline-flex items-center justify-center gap-2 transition-all"
      >
        <CheckCircle2 className="w-4 h-4" />
        {busy ? 'Activating Account…' : 'Activate & Enter Portal'}
      </button>
    </form>
  );
}

export default function RacPortalSetupPage() {
  return (
    <div className="w-full max-w-md space-y-6">
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500 to-teal-600 shadow-xl shadow-cyan-500/25">
          <Car className="w-7 h-7 text-white" />
        </div>
        <div>
          <p className="text-2xl font-black text-white tracking-tight">
            Fleet<span className="text-cyan-400">360</span>
          </p>
          <p className="text-xs uppercase tracking-widest text-cyan-300/80 font-semibold mt-0.5">
            Corporate Portal Onboarding
          </p>
        </div>
      </div>

      <div className="bg-slate-900/95 border border-white/10 rounded-2xl p-7 shadow-2xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">Welcome to B2B Mobility</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Verify your invitation details and choose your corporate portal password.
            </p>
          </div>
          <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
        </div>

        <Suspense
          fallback={<div className="py-6 text-center text-xs text-slate-500">Loading setup…</div>}
        >
          <RacSetupForm />
        </Suspense>
      </div>
    </div>
  );
}
