'use client';

/**
 * Customer Portal — new Transport request. Pick one of the company's Transport
 * services; its form (as the provider set it up) loads below with the contact
 * fields prefilled. The server checks the answers again and returns any
 * problems field by field.
 */

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Truck, Send, Loader2, Calculator } from 'lucide-react';
import {
  FormPanel, FormSection, FormField, FormAlert, FormFooter, PrimaryButton, SecondaryButton, TextAreaInput,
} from '@/components/ui/form-kit';
import { DynamicRequestForm } from '@/components/forms/DynamicRequestForm';
import {
  BookingDocumentDropzone,
  type UploadedBookingDocument,
  type DocumentUploadSlot,
} from '@/components/booking/BookingDocumentDropzone';
import type { RequestFormDef, RequestValues } from '@/lib/transport-catalog/form-schema';
import { canRaiseRequests, type TransportCategory } from '@/lib/customer-portal/catalog';
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
  const [uploadedDocs, setUploadedDocs] = useState<UploadedBookingDocument[]>([]);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const logisticsUploadSlots = useMemo<DocumentUploadSlot[]>(
    () => [
      {
        docType: 'commercial-invoice',
        label: 'Commercial Invoice',
        description: 'PDF, XLSX, DOCX, or Image (for shipper & customs valuation)',
        accept: '.pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.docx,.doc',
        maxMb: 15,
      },
      {
        docType: 'packing-list',
        label: 'Packing List / Cargo Manifest',
        description: 'PDF, XLSX, CSV, or Image (itemized pallet weights & dimensions)',
        accept: '.pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.txt',
        maxMb: 15,
      },
      {
        docType: 'msds',
        label: 'MSDS / Dangerous Goods Sheet',
        description: 'Material Safety Data Sheet (required when Hazmat is declared)',
        accept: '.pdf,.png,.jpg,.jpeg,.webp,.docx,.doc',
        maxMb: 15,
        highlighted: values.isHazmat === true,
        highlightNote: 'Hazmat declared — attach official MSDS / SDS document for carrier safety clearance',
      },
      {
        docType: 'customs-permit',
        label: 'BOL Instructions / Customs Permit',
        description: 'Bill of Lading instructions, POA, or GCC import/export permit',
        accept: '.pdf,.png,.jpg,.jpeg,.webp,.docx,.doc',
        maxMb: 15,
        highlighted: values.customsClearance === true,
        highlightNote: 'Customs brokerage enabled — attach commercial permit or clearance instructions',
      },
    ],
    [values.isHazmat, values.customsClearance]
  );

  const schoolBusUploadSlots = useMemo<DocumentUploadSlot[]>(
    () => [
      {
        docType: 'student-photo',
        label: 'Student Passport-Style Photo',
        description: 'JPG, PNG, or WebP — printed on RFID bus boarding card & driver roster',
        accept: '.jpg,.jpeg,.png,.webp',
        maxMb: 5,
        imagePreview: true,
        highlighted: true,
      },
      {
        docType: 'parent-emirates-id',
        label: 'Parent / Guardian Emirates ID Copy',
        description: 'PDF, JPG, or PNG (front & back copy for RTA guardian verification)',
        accept: '.pdf,.jpg,.jpeg,.png,.webp',
        maxMb: 10,
      },
      {
        docType: 'medical-certificate',
        label: 'Medical / Allergy Action Plan',
        description: 'Doctor note or EpiPen protocol shared confidentially with bus attendant',
        accept: '.pdf,.jpg,.jpeg,.png,.webp',
        maxMb: 10,
        highlighted: values.epiPenOnBoard === true || !!String(values.medicalConditions ?? '').trim(),
        highlightNote: 'Medical condition / EpiPen noted — attach emergency care plan for bus attendant',
      },
    ],
    [values.epiPenOnBoard, values.medicalConditions]
  );

  useEffect(() => {
    setLoaded(null); setUploadedDocs([]); setErrors({}); setErr(null);
    if (!category) return;
    void (async () => {
      const res = await fetch(`/api/customer-portal/transport/forms/${category}`, { cache: 'no-store' });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) { setErr(d?.error ?? 'Could not load the form'); return; }
      setLoaded(d); setValues(d.prefill ?? {});
    })();
  }, [category]);

  if (me && !canRaiseRequests(me.user.roles.TRANSPORT)) {
    return <FormAlert tone="info">Your role can view requests but not raise them. Ask your company admin for Requester access.</FormAlert>;
  }
  const cats = me?.transportCategories ?? [];

  const submit = async () => {
    if (!loaded) return;
    setBusy(true); setErr(null); setErrors({});
    try {
      const res = await fetch('/api/customer-portal/transport/requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: loaded.category.category,
          values,
          customerNote: note,
          attachments: uploadedDocs,
        }),
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
          {loaded.category.category === 'LOGISTICS' && (
            <BookingDocumentDropzone
              domain="logistics"
              title="Shipping & Compliance Documents"
              subtitle="Attach commercial invoice, packing list, MSDS, or customs permits — stored privately in cloud storage"
              slots={logisticsUploadSlots}
              documents={uploadedDocs}
              onChange={setUploadedDocs}
              uploadEndpoint="/api/customer-portal/transport/uploads"
            />
          )}
          {loaded.category.category === 'SCHOOL_BUS' && (
            <BookingDocumentDropzone
              domain="school-bus"
              title="Student Photo & Guardian Verification Documents"
              subtitle="Upload student photo for RFID boarding card, parent Emirates ID copy, and any medical action plan"
              slots={schoolBusUploadSlots}
              documents={uploadedDocs}
              onChange={setUploadedDocs}
              uploadEndpoint="/api/customer-portal/transport/uploads"
            />
          )}
          {loaded.category.category === 'LOGISTICS' && <LogisticsQuote values={values} />}
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

interface RateQuote {
  matched: boolean; estimate?: boolean; reason?: string | null;
  contractNo?: string | null; currency: string; total: number;
}

/**
 * Logistics only: the rate for this lane from the Logistics rate engine, as
 * the Shipper portal showed it — a contract rate, an indicative estimate, or
 * "priced on review". It does not book: the operations team confirms the rate
 * when they review the request.
 */
function LogisticsQuote({ values }: { values: RequestValues }) {
  const origin = String(values.origin ?? '').trim();
  const destination = String(values.destination ?? '').trim();
  const vehicle = String(values.vehicleCategory ?? '');
  const date = String(values.startDate ?? '');
  const weight = Number(values.weight ?? 0);
  const [quote, setQuote] = useState<RateQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!origin || !destination) { setQuote(null); setLoading(false); return; }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/shipper-portal/rates/quote', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            origin, destination, vehicleType: vehicle || null, shipmentDate: date || null,
            totalWeightKg: weight > 0 ? weight : null,
          }),
        });
        setQuote(res.ok ? await res.json() : null);
      } catch { setQuote(null); } finally { setLoading(false); }
    }, 600);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [origin, destination, vehicle, date, weight]);

  if (!origin || !destination) return null;
  const contract = quote?.matched === true && quote.estimate !== true;
  const estimate = quote && !contract && quote.total > 0;
  const money = (q: RateQuote) => `${q.currency} ${Number(q.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <FormSection title="Rate" icon={Calculator} columns={1}>
      {loading ? <p className="text-[var(--text-muted)] inline-flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking the rate for this lane…</p>
        : contract ? <p><span className="text-sm font-bold">{money(quote!)}</span> <span className="text-[var(--text-muted)]">contract rate{quote!.contractNo ? ` (${quote!.contractNo})` : ''}. Our team confirms it when they review your request.</span></p>
        : estimate ? <p><span className="text-sm font-bold">{money(quote!)}</span> <span className="text-[var(--text-muted)]">indicative estimate — there is no contract for this lane. Our team prices your load on review.</span></p>
        : <p className="text-[var(--text-muted)]">Our team will price this load when they review your request.</p>}
    </FormSection>
  );
}

export default function NewTransportRequestPage() {
  return <Suspense fallback={null}><NewTransportRequest /></Suspense>;
}
