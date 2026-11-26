'use client';

/**
 * Customer Portal — new Transport request. Pick one of the company's Transport
 * services; its form (as the provider set it up) loads below with the contact
 * fields prefilled. The server checks the answers again and returns any
 * problems field by field.
 */

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Truck, Send, Loader2 } from 'lucide-react';
import {
  FormPanel, FormSection, FormField, FormAlert, FormFooter, PrimaryButton, SecondaryButton, TextAreaInput,
} from '@/components/ui/form-kit';
import { DynamicRequestForm } from '@/components/forms/DynamicRequestForm';
import type { RequestFormDef, RequestValues } from '@/lib/transport-catalog/form-schema';
import type { TransportCategory } from '@/lib/customer-portal/catalog';
import { usePortal } from '../../portal-shell';

interface LoadedForm {
  category: { category: TransportCategory; title: string; description: string; approvalRequired: boolean };
  form: RequestFormDef;
  prefill: RequestValues;
}

function NewTransportRequest() {
  const me = usePortal();
  const router = useRouter();
  const params = useSearchParams();
  const category = params.get('category') as TransportCategory | null;
  const [loaded, setLoaded] = useState<LoadedForm | null>(null);
  const [values, setValues] = useState<RequestValues>({});
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLoaded(null); setErrors({}); setErr(null);
    if (!category) return;
    void (async () => {
      const res = await fetch(`/api/customer-portal/transport/forms/${category}`, { cache: 'no-store' });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) { setErr(d?.error ?? 'Could not load the form'); return; }
      setLoaded(d); setValues(d.prefill ?? {});
    })();
  }, [category]);

  if (me?.user.roles.TRANSPORT === 'VIEWER') {
    return <FormAlert tone="info">Your role can view requests but not raise them. Ask your company admin for Requester access.</FormAlert>;
  }
  const cats = me?.transportCategories ?? [];

  const submit = async () => {
    if (!loaded) return;
    setBusy(true); setErr(null); setErrors({});
    try {
      const res = await fetch('/api/customer-portal/transport/requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: loaded.category.category, values, customerNote: note }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        setErrors(d?.fieldErrors ?? {});
        setErr(d?.error ?? 'Could not submit your request');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      router.push(`/customer-portal/transport/requests?id=${d.request.id}`);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <FormSection title="Request type" icon={Truck} columns={4}>
        {cats.length === 0 && <p className="text-[var(--text-muted)] md:col-span-full">No Transport services are available for your company yet.</p>}
        {cats.map((c) => (
          <button key={c.category} type="button" onClick={() => router.replace(`/customer-portal/transport/new?category=${c.category}`)}
            className={`text-left rounded-xl border px-3 py-2 transition-colors ${
              c.category === category ? 'border-blue-500/60 bg-blue-500/10' : 'border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]'}`}>
            <p className="text-xs font-bold">{c.title}</p>
            <p className="text-[10px] text-[var(--text-muted)]">{c.description}</p>
          </button>
        ))}
      </FormSection>

      {category && !loaded && !err && <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" /></div>}
      {err && <FormAlert>{err}{Object.keys(errors).length ? ` (${Object.keys(errors).length} field${Object.keys(errors).length > 1 ? 's' : ''})` : ''}</FormAlert>}

      {loaded && (
        <FormPanel title={`New ${loaded.category.title} request`} subtitle={loaded.category.description} icon={Truck}
          actions={<SecondaryButton onClick={() => router.push('/customer-portal/transport')}>Cancel</SecondaryButton>}>
          {loaded.category.approvalRequired && (
            <FormAlert tone="info">{loaded.category.title} requests are approved by your service provider before they are arranged.</FormAlert>
          )}
          <DynamicRequestForm form={loaded.form} values={values} errors={errors}
            onChange={(k, v) => { setValues((p) => ({ ...p, [k]: v })); setErrors((e) => { const n = { ...e }; delete n[k]; return n; }); }} />
          <FormSection title="Note to the operations team" columns={1}>
            <FormField label="Anything else we should know" hint="Optional">
              <TextAreaInput value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
            </FormField>
          </FormSection>
          <FormFooter>
            <PrimaryButton icon={Send} busy={busy} onClick={() => void submit()}>{busy ? 'Submitting…' : 'Submit request'}</PrimaryButton>
          </FormFooter>
        </FormPanel>
      )}
    </div>
  );
}

export default function NewTransportRequestPage() {
  return <Suspense fallback={null}><NewTransportRequest /></Suspense>;
}
