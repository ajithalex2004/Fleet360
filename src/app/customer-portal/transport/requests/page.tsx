'use client';

/** Customer Portal — Transport: open requests with each request's stages, driver and vehicle. */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Activity, Phone, UserRound, Car, Loader2, XCircle, Link2 } from 'lucide-react';
import { Panel } from '@/components/ui/page-theme';
import { FormAlert, SecondaryButton } from '@/components/ui/form-kit';
import { usePortal } from '../../portal-shell';
import {
  fetchTransportRequests, fmtDateTime, fmtService, isOpen, MODULE_LABEL, STAGES, STATUS_LABEL, STATUS_TONE,
  type TransportRequest,
} from '../transport-shared';

function RequestsView() {
  const router = useRouter();
  const selectedId = useSearchParams().get('id');
  const [list, setList] = useState<TransportRequest[] | null>(null);
  const [detail, setDetail] = useState<TransportRequest | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { fetchTransportRequests('?scope=active').then(setList).catch((e: Error) => setErr(e.message)); }, []);

  const current = selectedId ?? list?.[0]?.id ?? null;
  const loadDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/customer-portal/transport/requests/${id}`, { cache: 'no-store' });
    const d = await res.json().catch(() => null);
    if (res.ok && d?.ok) setDetail(d.request); else setErr(d?.error ?? 'Could not load the request');
  }, []);
  useEffect(() => { if (current) void loadDetail(current); else setDetail(null); }, [current, loadDetail]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[22rem_minmax(0,1fr)] gap-4 items-start">
      <Panel title="Open requests" icon={Activity} accent="blue">
        {err && <FormAlert>{err}</FormAlert>}
        {!list && <Loader2 className="w-5 h-5 animate-spin text-[var(--text-muted)]" />}
        {list && list.length === 0 && <p className="text-sm text-[var(--text-muted)]">No open requests.</p>}
        <div className="space-y-1.5">
          {list?.map((r) => (
            <button key={r.id} type="button" onClick={() => router.replace(`/customer-portal/transport/requests?id=${r.id}`)}
              className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                r.id === current ? 'border-blue-500/50 bg-blue-500/10' : 'border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]'}`}>
              <p className="font-mono text-[10px] text-[var(--text-muted)]">{r.requestNo}</p>
              <p className="text-xs font-semibold truncate">{r.categoryTitle}{r.pickup ? ` · ${r.pickup}` : ''}</p>
              <p className="text-[10px] text-[var(--text-muted)]">{STATUS_LABEL[r.status]} · {fmtService(r)}</p>
            </button>
          ))}
        </div>
      </Panel>
      {detail ? <RequestDetail r={detail} onChanged={(r) => { setDetail(r); setList((l) => l?.filter((x) => x.id !== r.id || isOpen(r.status)) ?? l); }} />
        : current ? <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" /></div> : null}
    </div>
  );
}

function RequestDetail({ r, onChanged }: { r: TransportRequest; onChanged: (r: TransportRequest) => void }) {
  const me = usePortal();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const stage = STAGES.indexOf(r.status);
  const ended = r.status === 'REJECTED' || r.status === 'CANCELLED';
  const canCancel = me?.user.roles.TRANSPORT !== 'VIEWER' && (r.status === 'PENDING_APPROVAL' || r.status === 'SUBMITTED');

  const cancel = async () => {
    if (!window.confirm(`Cancel request ${r.requestNo}?`)) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/customer-portal/transport/requests/${r.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) { setErr(d?.error ?? 'Could not cancel'); return; }
      onChanged(d.request);
    } finally { setBusy(false); }
  };

  return (
    <Panel title={`${r.categoryTitle} — ${r.requestNo}`} subtitle={[r.pickup, r.dropoff].filter(Boolean).join(' → ') || undefined}
      icon={Activity} accent="blue"
      actions={<span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span>}>
      <div className="space-y-5 text-xs">
        {err && <FormAlert>{err}</FormAlert>}
        {r.status === 'PENDING_APPROVAL' && <FormAlert tone="info">Waiting for your service provider to approve this request.</FormAlert>}
        {ended ? (
          <FormAlert tone="warning">This request was {STATUS_LABEL[r.status].toLowerCase()}.{r.lifecycle.at(-1)?.note ? ` ${r.lifecycle.at(-1)?.note}` : ''}</FormAlert>
        ) : (
          <div>
            <div className="grid grid-cols-5 gap-1">
              {STAGES.map((s, i) => (
                <div key={s} className={`h-1.5 rounded-full ${i < stage || r.status === 'COMPLETED' ? 'bg-emerald-500' : i === stage ? 'bg-blue-500' : 'bg-[var(--bg-surface-hover)]'}`} />
              ))}
            </div>
            <div className="grid grid-cols-5 gap-1 mt-1.5 text-[10px]">
              {STAGES.map((s, i) => <span key={s} className={i === stage && r.status !== 'COMPLETED' ? 'text-blue-500 font-semibold' : 'text-[var(--text-muted)]'}>{STATUS_LABEL[s]}</span>)}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[['Service date', fmtService(r)], ['Pickup', r.pickup ?? '—'], ['Drop-off', r.dropoff ?? '—'], ['Vehicle type', r.vehicleCategory ?? '—']].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">{k}</p>
              <p className="text-sm font-bold break-words">{v}</p>
            </div>
          ))}
        </div>
        {r.routed && (
          <p className="flex items-center gap-1.5 text-[var(--text-muted)]"><Link2 className="w-3.5 h-3.5" /> Sent to {MODULE_LABEL[r.routed.module] ?? r.routed.module}{r.routed.ref ? ` ${r.routed.ref}` : ''}</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider mb-2">Stage history</p>
            <ol className="space-y-2 border-l border-[var(--border-subtle)] pl-3">
              {[...r.lifecycle].reverse().map((h, i) => (
                <li key={i}>
                  <p className="font-semibold">{STATUS_LABEL[h.status] ?? h.status}</p>
                  <p className="text-[var(--text-muted)]">{fmtDateTime(h.at)} · by {h.by}</p>
                  {h.note && <p className="text-[var(--text-muted)] italic">{h.note}</p>}
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] p-3 self-start space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5"><UserRound className="w-3.5 h-3.5" /> Driver and vehicle</p>
            {r.driver || r.vehicle ? (
              <div className="space-y-1">
                {r.driver && <p className="text-sm font-bold">{r.driver.name}</p>}
                {r.driver?.phone && <a href={`tel:${r.driver.phone}`} className="flex items-center gap-1.5 text-blue-500"><Phone className="w-3.5 h-3.5" /> {r.driver.phone}</a>}
                {r.vehicle && <p className="flex items-center gap-1.5"><Car className="w-3.5 h-3.5" /> {r.vehicle}</p>}
              </div>
            ) : <p className="text-[var(--text-muted)]">Not assigned yet.</p>}
          </div>
        </div>

        {r.customerNote && <p className="text-[var(--text-muted)] border-t border-[var(--border-subtle)] pt-3">Your note: {r.customerNote}</p>}
        {canCancel && (
          <div className="flex justify-end">
            <SecondaryButton icon={XCircle} disabled={busy} onClick={() => void cancel()}>Cancel request</SecondaryButton>
          </div>
        )}
      </div>
    </Panel>
  );
}

export default function TransportRequestsPage() {
  return <Suspense fallback={null}><RequestsView /></Suspense>;
}
