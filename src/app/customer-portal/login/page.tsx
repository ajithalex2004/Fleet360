'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LogIn, Wrench } from 'lucide-react';
import { FormPanel, FormSection, FormField, FormAlert, FormFooter, TextInput, PrimaryButton } from '@/components/ui/form-kit';

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!email.trim() || !password) { setErr('Enter your email and password'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/customer-portal/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) { setErr(data?.error ?? 'Unable to sign in'); return; }
      router.replace(next && next.startsWith('/customer-portal') ? next : '/customer-portal');
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="w-full max-w-md">
      <FormPanel title="Customer Portal" subtitle="Sign in to raise and track your service requests" icon={Wrench}>
        {err && <FormAlert>{err}</FormAlert>}
        <FormSection title="Sign in" icon={LogIn} columns={1}>
          <FormField label="Email" htmlFor="cp-email">
            <TextInput id="cp-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" autoFocus />
          </FormField>
          <FormField label="Password" htmlFor="cp-password">
            <TextInput id="cp-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </FormField>
        </FormSection>
        <FormFooter>
          <PrimaryButton type="submit" icon={LogIn} busy={busy}>{busy ? 'Signing in…' : 'Sign in'}</PrimaryButton>
        </FormFooter>
        <p className="text-[11px] text-[var(--text-muted)]">New here? Use the invite link your service provider sent you to set your password.</p>
      </FormPanel>
    </form>
  );
}

export default function CustomerPortalLoginPage() {
  return <Suspense fallback={null}><LoginForm /></Suspense>;
}
