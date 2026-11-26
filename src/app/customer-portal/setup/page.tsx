'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { KeyRound, Wrench } from 'lucide-react';
import { FormPanel, FormSection, FormField, FormAlert, FormFooter, TextInput, PrimaryButton } from '@/components/ui/form-kit';

function SetupForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [invite, setInvite] = useState<{ email: string; fullName: string | null; customerName: string } | null>(null);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/customer-portal/auth/setup?token=${encodeURIComponent(token)}`);
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) setInvite(data); else setErr(data?.error ?? 'This invite link is invalid or has expired.');
      setChecking(false);
    })();
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (password !== confirm) { setErr('The two passwords do not match.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/customer-portal/auth/setup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) { setErr(data?.error ?? 'Could not set your password'); return; }
      router.replace('/customer-portal');
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="w-full max-w-md">
      <FormPanel title="Set your password" subtitle={invite ? `${invite.customerName} · ${invite.email}` : 'Customer Portal'} icon={Wrench}>
        {err && <FormAlert>{err}</FormAlert>}
        {!checking && invite && (
          <>
            <FormSection title="New password" icon={KeyRound} columns={1}>
              <FormField label="Password" htmlFor="cp-new" hint="At least 8 characters, with a letter, a number and a symbol">
                <TextInput id="cp-new" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
              </FormField>
              <FormField label="Confirm password" htmlFor="cp-confirm">
                <TextInput id="cp-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </FormField>
            </FormSection>
            <FormFooter>
              <PrimaryButton type="submit" icon={KeyRound} busy={busy}>{busy ? 'Saving…' : 'Set password and sign in'}</PrimaryButton>
            </FormFooter>
          </>
        )}
      </FormPanel>
    </form>
  );
}

export default function CustomerPortalSetupPage() {
  return <Suspense fallback={null}><SetupForm /></Suspense>;
}
