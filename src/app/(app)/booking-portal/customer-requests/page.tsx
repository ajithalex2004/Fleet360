'use client';

/**
 * Booking Portal → Customer requests: Transport requests raised by customers
 * in the Customer Portal. Staff approve or reject (when the category needs
 * approval), confirm, assign a driver and vehicle, start and complete them.
 * Each step is added to the stage history the customer sees. Approved
 * Logistics requests also appear in the Logistics review inbox.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Inbox, X, CheckCircle2, XCircle, UserCheck, Play, Flag, Ban, Link2 } from 'lucide-react';
import SmartDataGrid, { type SmartDataGridColumn } from '@/components/ui/SmartDataGrid';
import {
  FormPanel, FormSection, FormField, FormAlert, FormFooter, TextInput, TextAreaInput, SelectInput, PrimaryButton, SecondaryButton,
} from '@/components/ui/form-kit';
import { TRANSPORT_CATEGORIES, TRANSPORT_CATEGORY_LABEL } from '@/lib/customer-portal/catalog';
import { CATEGORY_DEFINITIONS } from '@/lib/transport-catalog/default-forms';
import { allFields } from '@/lib/transport-catalog/form-schema';
import {
  fmtDateTime, fmtService, MODULE_LABEL, STATUS_LABEL, STATUS_TONE, type TransportRequest, type TransportStatus,
} from '@/app/customer-portal/transport/transport-shared';

interface StaffRequest extends TransportRequest { customerId: string; customerName: string | null; customerCode: string | null; staffNote: string | null }

type Action = 'approve' | 'reject' | 'confirm' | 'assign' | 'start' | 'complete' | 'cancel';
const ACTIONS: Record<TransportStatus, Action[]> = {
  PENDING_APPROVAL: ['approve', 'reject', 'cancel'],
  SUBMITTED: ['confirm', 'assign', 'reject', 'cancel'],
  CONFIRMED: ['assign', 'complete', 'cancel'],
  ASSIGNED: ['start', 'assign', 'complete', 'cancel'],
  IN_PROGRESS: ['complete', 'cancel'],
  COMPLETED: [], REJECTED: [], CANCELLED: [],
};
const ACTION_UI: Record<Action, { label: string; icon: typeof CheckCircle2 }> = {
  approve: { label: 'Approve', icon: CheckCircle2 }, reject: { label: 'Reject', icon: XCircle },
  confirm: { label: 'Confirm', icon: CheckCircle2 }, assign: { label: 'Assign driver', icon: UserCheck },
  start: { label: 'Start trip', icon: Play }, complete: { label: 'Complete', icon: Flag }, cancel: { label: 'Cancel', icon: Ban },
};
const STATUS_FILTERS = [
  { value: 'active', label: 'Open' }, { value: 'PENDING_APPROVAL', label: 'Awaiting approval' },
  { value: 'COMPLETED', label: 'Completed' }, { value: '', label: 'All' },
];

export default function CustomerRequestsPage() {
  const [status, setStatus] = useState('active');
  const [category, setCategory] = useState('');
  const [rows, setRows] = useState<StaffRequest[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<StaffRequest | null>(null);

  const load = useCallback(async () => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (category) q.set('category', category);
    const res = await fetch(`/api/booking-portal/customer-requests?${q.toString()}`, { cache: 'no-store' });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.ok) { setErr(d?.error ?? 'Could not load customer requests'); return; }
    setErr(null); setRows(d.requests);
  }, [status, category]);
  useEffect(() => { setRows(null); void load(); }, [load]);

  const columns = useMemo<SmartDataGridColumn<StaffRequest>[]>(() => [
    { key: 'no', header: 'Request ID', accessor: (r) => r.requestNo, render: (r) => <span className="font-mono text-[11px] whitespace-nowrap">{r.requestNo}</span> },
    { key: 'customer', header: 'Customer', filter: 'select', accessor: (r) => r.customerName ?? r.customerId, render: (r) => <span className="text-xs font-semibold">{r.customerName ?? r.customerId}</span> },
    { key: 'cat', header: 'Service', filter: 'select', accessor: (r) => r.categoryTitle },
    { key: 'route', header: 'Pickup → drop-off', accessor: (r) => [r.pickup, r.dropoff].filter(Boolean).join(' → ') || '—' },
    { key: 'when', header: 'Service date', filter: false, accessor: (r) => r.serviceDate ?? '', render: (r) => <span className="text-xs whitespace-nowrap">{fmtService(r)}</span> },
    {
      key: 'status', header: 'Status', filter: 'select', accessor: (r) => STATUS_LABEL[r.status],
      render: (r) => <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold whitespace-nowrap ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span>,
    },
    { key: 'driver', header: 'Driver', accessor: (r) => r.driver?.name ?? '—' },
    { key: 'created', header: 'Raised', filter: false, accessor: (r) => r.createdAt, render: (r) => <span className="text-xs whitespace-nowrap">{fmtDateTime(r.createdAt)}</span> },
  ], []);

  return (
    <div className="space-y-4">
      {err && <FormAlert>{err}</FormAlert>}
      <div className="flex flex-wrap gap-3 items-end rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
        <label className="text-xs font-semibold min-w-[180px]">Status
          <SelectInput value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1">
            {STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </SelectInput>
        </label>
        <label className="text-xs font-semibold min-w-[200px]">Service
          <SelectInput value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1">
            <option value="">All services</option>
            {TRANSPORT_CATEGORIES.map((c) => <option key={c} value={c}>{TRANSPORT_CATEGORY_LABEL[c]}</option>)}
          </SelectInput>
        </label>
      </div>
      <SmartDataGrid<StaffRequest>
        rows={rows ?? []} columns={columns} getRowId={(r) => r.id} loading={!rows} onRowClick={(r) => setOpen(r)}
        emptyMessage="No customer requests here." toolbar={{ title: 'Customer Transport requests', exportName: 'customer-transport-requests' }}
      />
      {open && <RequestDrawer r={open} onClose={() => setOpen(null)} onChanged={(r) => { setOpen(r); void load(); }} />}
    </div>
  );
}

function RequestDrawer({ r, onClose, onChanged }: { r: StaffRequest; onClose: () => void; onChanged: (r: StaffRequest) => void }) {
  const [form, setForm] = useState({ driverName: r.driver?.name ?? '', driverPhone: r.driver?.phone ?? '', vehicle: r.vehicle ?? '', note: '', staffNote: r.staffNote ?? '' });
  const [busy, setBusy] = useState<Action | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fields = useMemo(() => allFields(CATEGORY_DEFINITIONS[r.category].form), [r.category]);
  // Answers in form order, then any the form no longer has.
  const answers = useMemo(() => {
    const known = fields.filter((f) => f.key in r.values).map((f) => [f.label, r.values[f.key]] as const);
    const extra = Object.entries(r.values).filter(([k]) => !fields.some((f) => f.key === k));
    return [...known, ...extra];
  }, [fields, r.values]);

  const act = async (action: Action) => {
    if ((action === 'cancel' || action === 'reject') && !window.confirm(`${ACTION_UI[action].label} ${r.requestNo}?`)) return;
    setBusy(action); setErr(null);
    try {
      const res = await fetch('/api/booking-portal/customer-requests', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: r.id, action, ...form }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) { setErr(d?.error ?? 'Could not update the request'); return; }
      setForm((f) => ({ ...f, note: '' }));
      onChanged(d.request);
    } finally { setBusy(null); }
  };

  const actions = ACTIONS[r.status];
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" role="dialog" aria-modal="true" aria-label={`Request ${r.requestNo}`}>
      <div className="w-full max-w-2xl h-full overflow-y-auto bg-[var(--bg-main)] p-4">
        <FormPanel title={`${r.categoryTitle} — ${r.requestNo}`} subtitle={`${r.customerName ?? r.customerId}${r.customerCode ? ` (${r.customerCode})` : ''} · requested by ${r.requestedByName ?? '—'}`}
          icon={Inbox} actions={<SecondaryButton icon={X} onClick={onClose}>Close</SecondaryButton>}>
          {err && <FormAlert>{err}</FormAlert>}
          <div className="flex flex-wrap items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
            {r.routed && <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)]"><Link2 className="w-3 h-3" /> {MODULE_LABEL[r.routed.module] ?? r.routed.module} {r.routed.ref}</span>}
          </div>

          <FormSection title="Request" columns={2}>
            {answers.map(([k, v]) => (
              <div key={k} className="text-xs">
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">{k}</p>
                <p className="font-semibold break-words">{typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}</p>
              </div>
            ))}
            {r.customerNote && <p className="md:col-span-full text-xs text-[var(--text-muted)]">Customer note: {r.customerNote}</p>}
          </FormSection>

          {actions.length > 0 && (
            <FormSection title="Next step" columns={2}>
              <FormField label="Driver name"><TextInput value={form.driverName} onChange={set('driverName')} /></FormField>
              <FormField label="Driver mobile"><TextInput value={form.driverPhone} onChange={set('driverPhone')} placeholder="+971 5x xxx xxxx" /></FormField>
              <FormField label="Vehicle" span="full"><TextInput value={form.vehicle} onChange={set('vehicle')} placeholder="Plate number and model" /></FormField>
              <FormField label="Message to the customer" hint="Shown in the stage history (required when rejecting)" span="full">
                <TextInput value={form.note} onChange={set('note')} maxLength={500} />
              </FormField>
              <FormField label="Internal note" hint="Staff only" span="full"><TextAreaInput value={form.staffNote} onChange={set('staffNote')} maxLength={1000} /></FormField>
            </FormSection>
          )}

          <FormSection title="Stage history" columns={1}>
            <ol className="space-y-2 border-l border-[var(--border-subtle)] pl-3 text-xs">
              {[...r.lifecycle].reverse().map((h, i) => (
                <li key={i}>
                  <p className="font-semibold">{STATUS_LABEL[h.status] ?? h.status}</p>
                  <p className="text-[var(--text-muted)]">{fmtDateTime(h.at)} · by {h.by}{h.note ? ` · ${h.note}` : ''}</p>
                </li>
              ))}
            </ol>
          </FormSection>

          {actions.length > 0 && (
            <FormFooter secondary={
              <div className="flex flex-wrap gap-2">
                {actions.filter((a) => a === 'reject' || a === 'cancel').map((a) => {
                  const A = ACTION_UI[a];
                  return <SecondaryButton key={a} icon={A.icon} disabled={!!busy} onClick={() => void act(a)}>{A.label}</SecondaryButton>;
                })}
              </div>
            }>
              <div className="flex flex-wrap gap-2">
                {actions.filter((a) => a !== 'reject' && a !== 'cancel').map((a) => {
                  const A = ACTION_UI[a];
                  return <PrimaryButton key={a} icon={A.icon} busy={busy === a} disabled={!!busy} onClick={() => void act(a)}>{A.label}</PrimaryButton>;
                })}
              </div>
            </FormFooter>
          )}
        </FormPanel>
      </div>
    </div>
  );
}
