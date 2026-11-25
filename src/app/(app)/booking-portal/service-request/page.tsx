'use client';

/**
 * /booking-portal/service-request — raise a service request from the
 * Booking Portal (field service, support, cleaning…).
 *
 * The cards come from the tenant's service catalogue via
 * /api/service-tickets/form-fields, so any type an admin adds (or the
 * Field Service Management template installs) appears here with no code change. Requests
 * are created as Service Tickets, so SLAs, triage, departments, approvals,
 * tracking links and CSAT all apply. Types that need a vehicle are left to
 * the fleet team in Service Tickets.
 */

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Clock, Copy, FileText, Gauge, Loader2, MapPin, Send } from 'lucide-react';
import { getServiceIcon } from '@/lib/service-tickets/icons';
import { TICKET_PRIORITIES, type FormFieldDef, type TicketPriority } from '@/types/service-tickets';
import { formatSlaHours, priorityLabel } from '@/lib/service-tickets/priority-tiers';
import {
  FormPanel, FormSection, FormField, FormAlert, FormFooter, ReadOnlyValue, CheckboxField,
  TextInput, SelectInput, TextAreaInput, PrimaryButton, SecondaryButton,
} from '@/components/ui/form-kit';

interface TypeConfig {
  name: string;
  description: string;
  iconName: string | null;
  sortOrder: number;
  categoryKey?: string;
  categoryName?: string;
  vehicleRequired: boolean;
  defaultPriority: TicketPriority;
  slaByPriority?: Record<TicketPriority, number>;
  defaultSlaHours: number;
  approvalRequired: boolean;
  approvalEmergencyBypass: boolean;
  /** Field Service catalogue types: priority and SLA set in the Service Catalog & SLA master. */
  catalogSla?: { responseHours: number | null; onSiteHours: number; resolutionHours: number | null } | null;
}

interface Created {
  readableId: string | null;
  status: string;
  slaTargetHours?: number;
  trackingToken?: string;
}

const PRIORITY_HINT: Record<TicketPriority, string> = {
  Low: 'Whenever convenient',
  Medium: 'Normal',
  High: 'Affecting work',
  Critical: 'Safety risk or major outage',
};

function slaText(h?: number) {
  if (!h) return '';
  return h < 24 ? `${h} hour${h === 1 ? '' : 's'}` : `${Math.round(h / 24)} day${h >= 48 ? 's' : ''}`;
}

function ServiceRequestForm() {
  const params = useSearchParams();
  const [types, setTypes] = useState<Record<string, TypeConfig>>({});
  const [fieldsByType, setFieldsByType] = useState<Record<string, FormFieldDef[]>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [typeKey, setTypeKey] = useState<string>('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('Medium');
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/service-tickets/form-fields');
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) throw new Error(data?.error ?? 'Could not load request types');
        setTypes(data.typeConfig ?? {});
        setFieldsByType(data.formFields ?? {});
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : 'Could not load request types');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Request types grouped by category; vehicle-bound fleet types are excluded.
  const groups = useMemo(() => {
    const byCat = new Map<string, { name: string; items: Array<[string, TypeConfig]> }>();
    Object.entries(types)
      .filter(([, t]) => !t.vehicleRequired)
      .sort((a, b) => (a[1].categoryName ?? '').localeCompare(b[1].categoryName ?? '') || a[1].sortOrder - b[1].sortOrder)
      .forEach(([k, t]) => {
        const key = t.categoryKey || 'OTHER';
        if (!byCat.has(key)) byCat.set(key, { name: t.categoryName || 'Other requests', items: [] });
        byCat.get(key)!.items.push([k, t]);
      });
    // Field Service categories (FSM_ catalogue, FM_ facilities) first: that's what most employees come here for.
    const isFsm = (k: string) => k.startsWith('FSM_') || k.startsWith('FM_');
    return [...byCat.entries()].sort(([a], [b]) => Number(isFsm(b)) - Number(isFsm(a)));
  }, [types]);

  // Deep link: /booking-portal/service-request?type=FM_HVAC
  useEffect(() => {
    const t = params.get('type');
    if (t && types[t] && !types[t].vehicleRequired) choose(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types]);

  const choose = (key: string) => {
    setTypeKey(key);
    setPriority(types[key]?.defaultPriority ?? 'Medium');
    setCustom({});
    setError('');
  };

  const t = typeKey ? types[typeKey] : null;
  const fields = typeKey ? fieldsByType[typeKey] ?? [] : [];
  const catalogSla = t?.catalogSla ?? null;
  const sla = t ? (catalogSla?.resolutionHours ?? t.slaByPriority?.[priority] ?? t.defaultSlaHours) : undefined;
  const awaitsApproval = !!t?.approvalRequired && !(t.approvalEmergencyBypass && (priority === 'High' || priority === 'Critical'));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!typeKey || !t) return;
    setSubmitting(true); setError('');
    try {
      const res = await fetch('/api/service-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketType: typeKey,
          title: title.trim() || t.name,
          description: description.trim(),
          priority,
          customFields: { ...custom, source: 'BOOKING_PORTAL' },
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? 'Could not submit the request');
      const tk = data.ticket;
      setCreated({
        readableId: tk.readableId, status: tk.status, slaTargetHours: tk.slaTargetHours,
        trackingToken: tk.customFields?.trackingToken,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the request');
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setCreated(null); setTypeKey(''); setTitle(''); setDescription(''); setCustom({}); setCopied(false);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-24 text-[var(--text-muted)]"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  // ── Confirmation ────────────────────────────────────────────────────
  if (created) {
    const trackUrl = created.trackingToken ? `${window.location.origin}/track-ticket/${created.trackingToken}` : '';
    return (
      <div className="max-w-xl mx-auto py-10 text-center space-y-5">
        <CheckCircle2 className="w-14 h-14 text-emerald-400 mx-auto" />
        <h1 className="text-2xl font-extrabold text-[var(--text-main)]">Request submitted</h1>
        <p className="text-[var(--text-main)]">
          Reference <strong className="font-mono text-blue-500">{created.readableId ?? '—'}</strong>
          {created.status === 'Awaiting Approval' ? ' is waiting for approval.' : ' is with the service desk.'}
        </p>
        {created.slaTargetHours ? (
          <p className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)]"><Clock className="w-4 h-4" /> Target: within {slaText(created.slaTargetHours)}</p>
        ) : null}
        {trackUrl && (
          <div className="flex items-center gap-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-2 text-left">
            <code className="flex-1 truncate text-xs text-[var(--text-main)] px-2">{trackUrl}</code>
            <button type="button" onClick={() => { void navigator.clipboard.writeText(trackUrl); setCopied(true); }}
              className="inline-flex items-center gap-1 rounded-lg bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] px-3 py-1.5 text-xs font-semibold text-[var(--text-main)]">
              <Copy className="w-3.5 h-3.5" /> {copied ? 'Copied' : 'Copy tracking link'}
            </button>
          </div>
        )}
        <div className="flex justify-center gap-3 pt-2">
          <Link href="/booking-portal/my-bookings" className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-5 py-2 text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]">View my requests</Link>
          <button type="button" onClick={reset} className="rounded-lg bg-blue-600 hover:bg-blue-500 px-5 py-2 text-xs font-bold text-white shadow-sm">Raise another</button>
        </div>
      </div>
    );
  }

  // ── Step 2: form ────────────────────────────────────────────────────
  if (t) {
    const Icon = getServiceIcon(t.iconName);
    return (
      <form onSubmit={submit} className="max-w-4xl mx-auto space-y-4">
        <button type="button" onClick={() => setTypeKey('')} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]">
          <ArrowLeft className="w-3.5 h-3.5" /> All request types
        </button>

        <FormPanel
          title={t.name}
          subtitle={[t.categoryName, t.description].filter(Boolean).join(' · ')}
          icon={Icon}
          accent="blue"
        >
          {error && <FormAlert>{error}</FormAlert>}

          <FormSection title="Request details" icon={FileText} columns={2}>
            <FormField label="Short summary" htmlFor="sr-title" span="full" hint="Leave empty to use the service type name">
              <TextInput id="sr-title" value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)}
                placeholder={`e.g. ${t.name} — ${String(custom.area ?? 'meeting room 12.04')}`} />
            </FormField>
            <FormField label="Details" htmlFor="sr-desc" span="full">
              <TextAreaInput id="sr-desc" rows={4} value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="What's wrong, since when, anything the team should know" />
            </FormField>
          </FormSection>

          {fields.length > 0 && (
            <FormSection title="Location & additional details" icon={MapPin} columns={2}>
              {fields.map((f) => (
                <DynamicField key={f.key} def={f} value={custom[f.key]} onChange={(v) => setCustom((c) => ({ ...c, [f.key]: v }))} />
              ))}
            </FormSection>
          )}

          <FormSection title="Priority & SLA" icon={Gauge} columns={catalogSla ? 4 : 1}>
            {catalogSla ? (
              <>
                <ReadOnlyValue label="Priority" value={priorityLabel(t.defaultPriority)}
                  tone={t.defaultPriority === 'Critical' ? 'rose' : t.defaultPriority === 'High' ? 'amber' : t.defaultPriority === 'Medium' ? 'blue' : 'emerald'} />
                <ReadOnlyValue label="SLA response" value={formatSlaHours(catalogSla.responseHours)} />
                <ReadOnlyValue label="SLA on-site arrival" value={formatSlaHours(catalogSla.onSiteHours)} />
                <ReadOnlyValue label="SLA resolution" value={formatSlaHours(catalogSla.resolutionHours)} />
              </>
            ) : (
              <fieldset>
                <legend className="sr-only">Priority</legend>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {TICKET_PRIORITIES.map((p) => (
                    <label key={p} className={`cursor-pointer rounded-lg border px-3 py-2 text-xs transition-colors ${
                      priority === p ? 'border-blue-500 bg-blue-500/10 text-[var(--text-main)]' : 'border-[var(--border-subtle)] bg-[var(--bg-main)] text-[var(--text-main)] hover:border-[var(--border-strong)]'}`}>
                      <input type="radio" name="priority" value={p} checked={priority === p} onChange={() => setPriority(p)} className="sr-only" />
                      <span className="block font-bold">{p}</span>
                      <span className="block text-[10px] text-[var(--text-muted)]">{PRIORITY_HINT[p]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {(sla || awaitsApproval) && (
              <div className="md:col-span-full flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-[var(--text-muted)]">
                {sla && !catalogSla ? <span className="inline-flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Target: within {slaText(sla)}</span> : null}
                {catalogSla && <span>Priority and SLA are set for this service type in the Service Catalog &amp; SLA master.</span>}
                {awaitsApproval && <span className="font-semibold text-amber-600">Needs approval before work starts</span>}
              </div>
            )}
          </FormSection>

          <FormFooter secondary={<SecondaryButton icon={ArrowLeft} onClick={() => setTypeKey('')}>Back</SecondaryButton>}>
            <PrimaryButton type="submit" icon={submitting ? Loader2 : Send} busy={submitting}>
              {submitting ? 'Submitting…' : 'Submit request'}
            </PrimaryButton>
          </FormFooter>
        </FormPanel>
      </form>
    );
  }

  // ── Step 1: choose a type ───────────────────────────────────────────
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-[var(--text-main)] mb-2">Raise a service request</h1>
        <p className="text-[var(--text-muted)]">Report a problem or ask for a service. You&apos;ll get a reference and a link to track it.</p>
      </div>

      {loadError && <p role="alert" className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-sm text-rose-300">{loadError}</p>}

      {!loadError && groups.length === 0 && (
        <p className="rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-6 text-[var(--text-main)]">
          No service requests are set up yet. An administrator can add them in Service Configuration,
          for example by installing the Field Service Management catalogue.
        </p>
      )}

      {groups.map(([catKey, g]) => (
        <section key={catKey} aria-labelledby={`cat-${catKey}`} className="space-y-3">
          <h2 id={`cat-${catKey}`} className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">{g.name}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {g.items.map(([key, cfg]) => {
              const Icon = getServiceIcon(cfg.iconName);
              return (
                <button key={key} type="button" onClick={() => choose(key)}
                  className="group text-left rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-blue-500/60 p-5 transition-all hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                  <span className="w-10 h-10 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] flex items-center justify-center text-blue-500 mb-3"><Icon className="w-5 h-5" /></span>
                  <span className="block font-bold text-[var(--text-main)] group-hover:text-blue-500">{cfg.name}</span>
                  <span className="block text-xs text-[var(--text-muted)] mt-1 leading-relaxed">{cfg.description}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function ServiceRequestPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-24 text-[var(--text-muted)]"><Loader2 className="w-6 h-6 animate-spin" /></div>}>
      <ServiceRequestForm />
    </Suspense>
  );
}

function DynamicField({ def, value, onChange }: { def: FormFieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const id = `sr-${def.key}`;
  if (def.type === 'checkbox') {
    return (
      <div className="md:col-span-full">
        <CheckboxField label={def.required ? `${def.label} *` : def.label} checked={!!value} onChange={(v) => onChange(v)} />
      </div>
    );
  }
  return (
    <FormField label={def.label} required={def.required} htmlFor={id} span={def.type === 'textarea' ? 'full' : undefined}>
      {def.type === 'select' ? (
        <SelectInput id={id} required={def.required} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {def.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </SelectInput>
      ) : def.type === 'textarea' ? (
        <TextAreaInput id={id} required={def.required} value={String(value ?? '')} placeholder={def.placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <TextInput id={id} required={def.required} placeholder={def.placeholder}
          type={def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : def.type === 'datetime' ? 'datetime-local' : 'text'}
          min={def.min} max={def.max} value={String(value ?? '')}
          onChange={(e) => onChange(def.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />
      )}
    </FormField>
  );
}
