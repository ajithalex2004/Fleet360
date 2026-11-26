'use client';

/** Customer Portal — active requests with each request's lifecycle and assigned technician. */

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Activity, Phone, Mail, UserRound, Loader2 } from 'lucide-react';
import { Panel } from '@/components/ui/page-theme';
import { FormAlert } from '@/components/ui/form-kit';
import { formatSlaHours } from '@/lib/service-tickets/priority-tiers';
import {
  fetchRequests, isActive, slaState, stageIndex, stageLabel, fmtDateTime, STAGES,
  ENTITLEMENT_LABEL, PRIORITY_LABEL, PRIORITY_TONE, SLA_LABEL, SLA_TONE, type CustomerRequest,
} from '../portal-shared';

function RequestsView() {
  const router = useRouter();
  const selectedId = useSearchParams().get('id');
  const [list, setList] = useState<CustomerRequest[] | null>(null);
  const [detail, setDetail] = useState<CustomerRequest | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { fetchRequests('?scope=active').then(setList).catch((e: Error) => setErr(e.message)); }, []);

  const current = selectedId ?? list?.[0]?.id ?? null;
  useEffect(() => {
    if (!current) { setDetail(null); return; }
    void (async () => {
      const res = await fetch(`/api/customer-portal/fsm/requests/${current}`, { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) setDetail(data.request); else setErr(data?.error ?? 'Could not load the request');
    })();
  }, [current]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[22rem_minmax(0,1fr)] gap-4 items-start">
      <Panel title="Active requests" icon={Activity} accent="blue">
        {err && <FormAlert>{err}</FormAlert>}
        {!list && <Loader2 className="w-5 h-5 animate-spin text-[var(--text-muted)]" />}
        {list && list.length === 0 && <p className="text-sm text-[var(--text-muted)]">No open requests.</p>}
        <div className="space-y-1.5">
          {list?.map((r) => (
            <button key={r.id} type="button" onClick={() => router.replace(`/customer-portal/requests?id=${r.id}`)}
              className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                r.id === current ? 'border-blue-500/50 bg-blue-500/10' : 'border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]'}`}>
              <p className="font-mono text-[10px] text-[var(--text-muted)]">{r.readableId}</p>
              <p className="text-xs font-semibold truncate">{r.title}</p>
              <p className="text-[10px] text-[var(--text-muted)]">{stageLabel(r.status)} · {r.siteName ?? '—'}</p>
            </button>
          ))}
        </div>
      </Panel>

      {detail ? <RequestDetail r={detail} /> : current ? <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" /></div> : null}
    </div>
  );
}

function RequestDetail({ r }: { r: CustomerRequest }) {
  const stage = stageIndex(r.status);
  const sla = slaState(r);
  const done = !isActive(r.status);
  return (
    <Panel title={r.title} subtitle={`${r.readableId ?? ''} · ${[r.siteName, r.assetNo && `${r.assetNo} ${r.assetName ?? ''}`, r.entitlementType && ENTITLEMENT_LABEL[r.entitlementType]].filter(Boolean).join(' · ')}`}
      icon={Activity} accent="blue"
      actions={<span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${PRIORITY_TONE[r.priority] ?? ''}`}>{PRIORITY_LABEL[r.priority] ?? r.priority}</span>}>
      <div className="space-y-5 text-xs">
        {/* Lifecycle stepper */}
        <div>
          <div className="grid grid-cols-6 gap-1">
            {STAGES.map((s, i) => (
              <div key={s} className={`h-1.5 rounded-full ${i < stage || done ? 'bg-emerald-500' : i === stage ? 'bg-blue-500' : 'bg-[var(--bg-surface-hover)]'}`} />
            ))}
          </div>
          <div className="grid grid-cols-6 gap-1 mt-1.5 text-[10px]">
            {STAGES.map((s, i) => <span key={s} className={i === stage && !done ? 'text-blue-500 font-semibold' : 'text-[var(--text-muted)]'}>{s}</span>)}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            ['Status', stageLabel(r.status)],
            ['Response SLA', formatSlaHours(r.sla?.responseHours)],
            ['On-site SLA', formatSlaHours(r.sla?.onSiteHours)],
            ['Resolution SLA', formatSlaHours(r.sla?.resolutionHours)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">{k}</p>
              <p className="text-sm font-bold">{v}</p>
            </div>
          ))}
        </div>
        <p className={`font-semibold ${SLA_TONE[sla]}`}>Resolution SLA: {SLA_LABEL[sla]}{r.serviceNeededAt ? ` · Service needed at ${fmtDateTime(r.serviceNeededAt)}` : ''}</p>

        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider mb-2">Stage history</p>
            <ol className="space-y-2 border-l border-[var(--border-subtle)] pl-3">
              {[...r.lifecycle].reverse().map((h, i) => (
                <li key={i}>
                  <p className="font-semibold">{stageLabel(h.status)}</p>
                  <p className="text-[var(--text-muted)]">{fmtDateTime(h.at)} · by {h.by}</p>
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] p-3 self-start">
            <p className="text-[11px] font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5"><UserRound className="w-3.5 h-3.5" /> Assigned technician</p>
            {r.technician ? (
              <div className="space-y-1">
                <p className="text-sm font-bold">{r.technician.name}</p>
                {r.technician.mobile && <a href={`tel:${r.technician.mobile}`} className="flex items-center gap-1.5 text-blue-500"><Phone className="w-3.5 h-3.5" /> {r.technician.mobile}</a>}
                {r.technician.email && <a href={`mailto:${r.technician.email}`} className="flex items-center gap-1.5 text-blue-500"><Mail className="w-3.5 h-3.5" /> {r.technician.email}</a>}
              </div>
            ) : (
              <p className="text-[var(--text-muted)]">Not assigned yet.</p>
            )}
          </div>
        </div>

        {r.description && <p className="text-[var(--text-muted)] border-t border-[var(--border-subtle)] pt-3">{r.description}</p>}
      </div>
    </Panel>
  );
}

export default function CustomerPortalRequests() {
  return <Suspense fallback={null}><RequestsView /></Suspense>;
}
