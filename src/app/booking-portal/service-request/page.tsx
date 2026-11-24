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
import { ArrowLeft, CheckCircle2, Clock, Copy, Loader2, Send } from 'lucide-react';
import { getServiceIcon } from '@/lib/service-tickets/icons';
import { TICKET_PRIORITIES, type FormFieldDef, type TicketPriority } from '@/types/service-tickets';

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

const field = 'w-full rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] px-3.5 py-2.5 text-sm text-[var(--text-main)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-500/20';
const label = 'block text-xs font-semibold text-[var(--text-muted)] mb-1.5';

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
    // Field Service (FM_) categories first: that's what most employees come here for.
    return [...byCat.entries()].sort(([a], [b]) => Number(b.startsWith('FM_')) - Number(a.startsWith('FM_')));
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
  const sla = t ? (t.slaByPriority?.[priority] ?? t.defaultSlaHours) : undefined;
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
        <p className="text-[var(--text-muted)]">
          Reference <strong className="font-mono text-cyan-300">{created.readableId ?? '—'}</strong>
          {created.status === 'Awaiting Approval' ? ' is waiting for approval.' : ' is with the service desk.'}
        </p>
        {created.slaTargetHours ? (
          <p className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)]"><Clock className="w-4 h-4" /> Target: within {slaText(created.slaTargetHours)}</p>
        ) : null}
        {trackUrl && (
          <div className="flex items-center gap-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-2 text-left">
            <code className="flex-1 truncate text-xs text-[var(--text-muted)] px-2">{trackUrl}</code>
            <button type="button" onClick={() => { void navigator.clipboard.writeText(trackUrl); setCopied(true); }}
              className="inline-flex items-center gap-1 rounded-lg bg-[var(--bg-surface-hover)] hover:bg-white/15 px-3 py-1.5 text-xs font-semibold text-[var(--text-main)]">
              <Copy className="w-3.5 h-3.5" /> {copied ? 'Copied' : 'Copy tracking link'}
            </button>
          </div>
        )}
        <div className="flex justify-center gap-3 pt-2">
          <Link href="/booking-portal/my-bookings" className="rounded-xl border border-[var(--border-subtle)] px-5 py-2.5 text-sm font-semibold text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]">View my requests</Link>
          <button type="button" onClick={reset} className="rounded-xl bg-cyan-600 hover:bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-white">Raise another</button>
        </div>
      </div>
    );
  }

  // ── Step 2: form ────────────────────────────────────────────────────
  if (t) {
    const Icon = getServiceIcon(t.iconName);
    return (
      <form onSubmit={submit} className="max-w-3xl mx-auto space-y-6">
        <button type="button" onClick={() => setTypeKey('')} className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-main)]">
          <ArrowLeft className="w-4 h-4" /> All request types
        </button>
        <div className="flex items-start gap-4">
          <span className="w-12 h-12 rounded-2xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] flex items-center justify-center text-cyan-400"><Icon className="w-6 h-6" /></span>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-cyan-400">{t.categoryName}</p>
            <h1 className="text-2xl font-extrabold text-[var(--text-main)]">{t.name}</h1>
            <p className="text-sm text-[var(--text-muted)] mt-1">{t.description}</p>
          </div>
        </div>

        <div className="rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-6 space-y-5">
          <div>
            <label className={label} htmlFor="sr-title">Short summary</label>
            <input id="sr-title" className={field} value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)}
              placeholder={`e.g. ${t.name} — ${String(custom.area ?? 'meeting room 12.04')}`} />
          </div>

          {fields.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {fields.map((f) => (
                <DynamicField key={f.key} def={f} value={custom[f.key]} onChange={(v) => setCustom((c) => ({ ...c, [f.key]: v }))} />
              ))}
            </div>
          )}

          <div>
            <label className={label} htmlFor="sr-desc">Details</label>
            <textarea id="sr-desc" className={`${field} min-h-28`} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="What's wrong, since when, anything the team should know" />
          </div>

          <fieldset>
            <legend className={label}>Priority</legend>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {TICKET_PRIORITIES.map((p) => (
                <label key={p} className={`cursor-pointer rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                  priority === p ? 'border-cyan-400/70 bg-cyan-500/10 text-[var(--text-main)]' : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-white/25'}`}>
                  <input type="radio" name="priority" value={p} checked={priority === p} onChange={() => setPriority(p)} className="sr-only" />
                  <span className="block font-bold">{p}</span>
                  <span className="block text-[11px] text-[var(--text-muted)]">{PRIORITY_HINT[p]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--text-muted)]">
            {sla ? <span className="inline-flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Target: within {slaText(sla)}</span> : null}
            {awaitsApproval && <span className="text-amber-300">Needs approval before work starts</span>}
          </div>
        </div>

        {error && <p role="alert" className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-sm text-rose-300">{error}</p>}

        <div className="flex justify-end">
          <button type="submit" disabled={submitting}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-cyan-500/20 disabled:opacity-60">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Submit request
          </button>
        </div>
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
        <p className="rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-6 text-[var(--text-muted)]">
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
                  className="group text-left rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-cyan-400/60 p-5 transition-all hover:shadow-xl hover:shadow-cyan-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
                  <span className="w-10 h-10 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] flex items-center justify-center text-cyan-400 mb-3"><Icon className="w-5 h-5" /></span>
                  <span className="block font-bold text-[var(--text-main)] group-hover:text-cyan-300">{cfg.name}</span>
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
  const req = def.required ? <span className="text-rose-400"> *</span> : null;
  if (def.type === 'checkbox') {
    return (
      <label htmlFor={id} className="flex items-center gap-2 text-sm text-[var(--text-muted)] sm:col-span-2">
        <input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 accent-cyan-500" />
        {def.label}
      </label>
    );
  }
  return (
    <div className={def.type === 'textarea' ? 'sm:col-span-2' : ''}>
      <label htmlFor={id} className={label}>{def.label}{req}</label>
      {def.type === 'select' ? (
        <select id={id} className={field} required={def.required} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {def.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : def.type === 'textarea' ? (
        <textarea id={id} className={field} required={def.required} value={String(value ?? '')} placeholder={def.placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} className={field} required={def.required} placeholder={def.placeholder}
          type={def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : def.type === 'datetime' ? 'datetime-local' : 'text'}
          min={def.min} max={def.max} value={String(value ?? '')}
          onChange={(e) => onChange(def.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />
      )}
    </div>
  );
}
