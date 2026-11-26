'use client';

/**
 * Customer Management → Transport Services catalogue.
 *
 * The tenant chooses which Transport categories it offers to customers
 * (Rent-a-Car, Logistics, …), whether their requests need approval, and
 * adjusts each category's request form: hide fields or change which are
 * required. Fields needed to route a request are locked. The preview shows
 * the form customers will fill in and can check a sample entry the same way
 * a real request will be checked.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Truck, Eye, ListChecks, Save, RotateCcw, Lock, CheckCircle2, Menu as MenuIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import {
  FormPanel, FormSection, FormAlert, FormFooter, PrimaryButton, SecondaryButton, CheckboxField,
} from '@/components/ui/form-kit';
import { DynamicRequestForm } from '@/components/forms/DynamicRequestForm';
import type { TransportCategory } from '@/lib/customer-portal/catalog';
import {
  applyOverrides, type FieldOverrides, type RequestFormDef, type RequestValues,
} from '@/lib/transport-catalog/form-schema';

interface TenantCategory {
  category: TransportCategory; title: string; description: string; vehicleUsage: string; menu: string[];
  form: RequestFormDef; effectiveForm: RequestFormDef;
  enabled: boolean; approvalRequired: boolean; fieldOverrides: FieldOverrides;
}

const COMMON_MENU = ['New request', 'Active requests', 'History'];

export default function TransportCatalogPage() {
  const [cats, setCats] = useState<TenantCategory[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<TransportCategory | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/customers/transport-catalog', { cache: 'no-store' });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.ok) { setErr(d?.error ?? 'Could not load the catalogue'); return; }
    setCats(d.categories); setCanEdit(!!d.canEdit);
    setSelected((s) => s ?? d.categories[0]?.category ?? null);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async (category: TransportCategory, patch: Record<string, unknown>) => {
    setErr(null);
    const res = await fetch('/api/customers/transport-catalog', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category, ...patch }),
    });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.ok) { setErr(d?.error ?? 'Could not save'); return false; }
    setCats((cs) => cs?.map((c) => (c.category === category ? d.category : c)) ?? cs);
    return true;
  }, []);

  const current = cats?.find((c) => c.category === selected) ?? null;
  const offered = cats?.filter((c) => c.enabled).length ?? 0;

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader title="Transport Services catalogue" icon={Truck} accent="blue"
        subtitle="Choose the Transport categories you offer to customers and adjust each request form. Give categories to customers in Customer Portal access." />
      {err && <FormAlert>{err}</FormAlert>}
      {!canEdit && cats && <FormAlert tone="info">View only. A tenant admin can change the catalogue.</FormAlert>}
      {cats && offered === 0 && (
        <FormAlert tone="warning">No Transport category is offered yet. Turn on the ones you provide; only those can be given to customers.</FormAlert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[20rem_minmax(0,1fr)] gap-4 items-start">
        <div className="space-y-2">
          {!cats && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
          {cats?.map((c) => {
            const changes = Object.keys(c.fieldOverrides).length;
            return (
              <div key={c.category} role="button" tabIndex={0} onClick={() => setSelected(c.category)}
                onKeyDown={(e) => { if (e.key === 'Enter') setSelected(c.category); }}
                className={`rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                  c.category === selected ? 'border-blue-500/50 bg-blue-500/10' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)]'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold">{c.title}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">{c.description}</p>
                  </div>
                  <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={c.enabled} disabled={!canEdit} aria-label={`Offer ${c.title}`}
                      onChange={() => void save(c.category, { enabled: !c.enabled })}
                      className="rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0" />
                    {c.enabled ? 'Offered' : 'Off'}
                  </label>
                </div>
                <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                  {c.approvalRequired ? 'Approval required' : 'No approval'} · {changes ? `${changes} field change${changes > 1 ? 's' : ''}` : 'Default form'}
                </p>
              </div>
            );
          })}
        </div>

        {current && <CategoryEditor key={current.category} cat={current} canEdit={canEdit} onSave={save} />}
      </div>
    </div>
  );
}

function CategoryEditor({ cat, canEdit, onSave }: {
  cat: TenantCategory; canEdit: boolean; onSave: (c: TransportCategory, patch: Record<string, unknown>) => Promise<boolean>;
}) {
  const [tab, setTab] = useState<'fields' | 'preview'>('fields');
  const [draft, setDraft] = useState<FieldOverrides>(cat.fieldOverrides);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(cat.fieldOverrides);
  const previewForm = useMemo(() => applyOverrides(cat.form, draft), [cat.form, draft]);

  const setFlag = (key: string, flag: 'hidden' | 'required', value: boolean, defaultRequired: boolean) => {
    setSaved(false);
    setDraft((d) => {
      const next = { ...(d[key] ?? {}) };
      if (flag === 'hidden') { if (value) next.hidden = true; else delete next.hidden; }
      else if (value === defaultRequired) delete next.required; else next.required = value;
      const out = { ...d };
      if (Object.keys(next).length) out[key] = next; else delete out[key];
      return out;
    });
  };

  const saveFields = async () => {
    setBusy(true);
    try { if (await onSave(cat.category, { fieldOverrides: draft })) setSaved(true); } finally { setBusy(false); }
  };

  return (
    <FormPanel title={cat.title} subtitle={`${cat.description} · vehicle usage: ${cat.vehicleUsage}`} icon={Truck}
      actions={
        <div className="flex gap-1.5">
          <SecondaryButton icon={ListChecks} onClick={() => setTab('fields')} className={tab === 'fields' ? '!border-blue-500/50 !text-blue-600' : ''}>Fields</SecondaryButton>
          <SecondaryButton icon={Eye} onClick={() => setTab('preview')} className={tab === 'preview' ? '!border-blue-500/50 !text-blue-600' : ''}>Preview</SecondaryButton>
        </div>
      }>
      <div className="flex flex-wrap gap-6">
        <CheckboxField label="Offered to customers" checked={cat.enabled} disabled={!canEdit}
          hint="Only offered categories can be given to customers" onChange={(v) => void onSave(cat.category, { enabled: v })} />
        <CheckboxField label="Requests need approval" checked={cat.approvalRequired} disabled={!canEdit}
          hint="A customer's request waits for approval before it is dispatched" onChange={(v) => void onSave(cat.category, { approvalRequired: v })} />
      </div>

      <FormSection title="Customer Portal menu" icon={MenuIcon} columns={1}>
        <div className="flex flex-wrap gap-1.5">
          {[...COMMON_MENU, ...cat.menu].map((m) => (
            <span key={m} className="px-2 py-0.5 rounded-full border border-[var(--border-subtle)] text-[11px] font-semibold">{m}</span>
          ))}
        </div>
      </FormSection>

      {tab === 'fields' ? (
        <>
          {cat.form.sections.map((s) => (
            <FormSection key={s.key} title={s.title} columns={1}>
              <div className="divide-y divide-[var(--border-subtle)]">
                {s.fields.map((f) => {
                  const o = draft[f.key] ?? {};
                  const hidden = !f.core && !!o.hidden;
                  const required = f.core ? true : o.required ?? !!f.required;
                  return (
                    <div key={f.key} className={`flex flex-wrap items-center justify-between gap-2 py-1.5 ${hidden ? 'opacity-50' : ''}`}>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold">{f.label}</p>
                        <p className="text-[10px] text-[var(--text-muted)]">
                          {f.type}{f.options ? ` · ${f.options.length} options` : ''}{f.showIf ? ' · shown conditionally' : ''}
                        </p>
                      </div>
                      {f.core ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--text-muted)]"><Lock className="w-3 h-3" /> Needed to route the request</span>
                      ) : (
                        <div className="flex items-center gap-4 text-[11px]">
                          <label className="inline-flex items-center gap-1.5 cursor-pointer">
                            <input type="checkbox" checked={!hidden} disabled={!canEdit} aria-label={`Show ${f.label}`}
                              onChange={(e) => setFlag(f.key, 'hidden', !e.target.checked, !!f.required)}
                              className="rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0" /> Show
                          </label>
                          <label className="inline-flex items-center gap-1.5 cursor-pointer">
                            <input type="checkbox" checked={required} disabled={!canEdit || hidden || f.type === 'toggle'} aria-label={`Require ${f.label}`}
                              onChange={(e) => setFlag(f.key, 'required', e.target.checked, !!f.required)}
                              className="rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0" /> Required
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </FormSection>
          ))}
          {canEdit && (
            <FormFooter secondary={
              <SecondaryButton icon={RotateCcw} disabled={Object.keys(draft).length === 0} onClick={() => { setDraft({}); setSaved(false); }}>Reset to default</SecondaryButton>
            }>
              {saved && !dirty && <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600"><CheckCircle2 className="w-4 h-4" /> Saved</span>}
              <PrimaryButton icon={Save} busy={busy} disabled={!dirty} onClick={() => void saveFields()}>Save form changes</PrimaryButton>
            </FormFooter>
          )}
        </>
      ) : (
        <Preview category={cat.category} form={previewForm} unsaved={dirty} canCheck={canEdit} />
      )}
    </FormPanel>
  );
}

function Preview({ category, form, unsaved, canCheck }: { category: TransportCategory; form: RequestFormDef; unsaved: boolean; canCheck: boolean }) {
  const [values, setValues] = useState<RequestValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string | null>(null);
  const check = async () => {
    setResult(null);
    const res = await fetch('/api/customers/transport-catalog', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category, values }),
    });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.ok) { setResult(d?.error ?? 'Could not check'); return; }
    setErrors(d.errors ?? {});
    setResult(d.valid ? 'This entry would be accepted.' : `${Object.keys(d.errors).length} field(s) need attention.`);
  };
  return (
    <div className="space-y-3">
      <FormAlert tone="info">
        This is the form customers will fill in{unsaved ? ' once you save your field changes' : ''}.
        {canCheck ? ' Fill it in and press Check to see how a request would be validated (against the saved form).' : ''}
      </FormAlert>
      <DynamicRequestForm form={form} values={values} errors={errors}
        onChange={(k, v) => { setValues((p) => ({ ...p, [k]: v })); setErrors((e) => { const n = { ...e }; delete n[k]; return n; }); }} />
      {canCheck && (
        <FormFooter secondary={result ? <span className="text-xs font-semibold">{result}</span> : undefined}>
          <PrimaryButton icon={CheckCircle2} onClick={() => void check()}>Check</PrimaryButton>
        </FormFooter>
      )}
      <p className="text-[11px] text-[var(--text-muted)]">Give this category to customers in <Link href="/customer-mgmt/portal-access" className="text-blue-600 hover:underline">Customer Portal access</Link>.</p>
    </div>
  );
}
