'use client';
/**
 * /logistics/shipping-requests — the demand intake inbox. Operators review
 * shipper-submitted (or self-entered) requests and convert accepted ones into
 * shipment orders ("job orders"). Conversion creates a PRIVATE/DRAFT order; the
 * operator then posts it to the marketplace or assigns it from the load board.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Inbox, Plus, X, MapPin, Package, Truck, Clock, ArrowRight,
  CheckCircle2, FileText, Building2, PackageCheck,
} from 'lucide-react';
import { PageHeader, KpiCard } from '@/components/ui/page-theme';
import LogisticsDataGrid, { type DataGridColumn } from '@/components/logistics/LogisticsDataGrid';
import CargoClassificationPanel, { type CargoClassificationMeta } from '@/components/logistics/CargoClassificationPanel';

type RequestMetadata = CargoClassificationMeta;
interface ShippingRequest {
  id: string;
  requestNo: string;
  shipperId: string;
  shipperName: string | null;
  shipperCode: string | null;
  status: string;
  shipmentType: string | null;
  originName: string | null;
  destinationName: string | null;
  pickupWindowFrom: string | null;
  deliveryWindowTo: string | null;
  requestedVehicleType: string | null;
  totalWeightKg: number | null;
  cargoValueAmount: number | null;
  currency: string | null;
  goodsDescription: string | null;
  specialInstructions: string | null;
  referenceNo: string | null;
  shipmentOrderId: string | null;
  reviewNotes: string | null;
  metadata: RequestMetadata | null;
  createdAt: string | null;
}
interface ShipperLite { id: string; name: string; customerCode: string | null; }
interface MasterItem { type: string; code: string; label: string; }

const STATUS_FILTERS = ['', 'SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'CONVERTED', 'REJECTED', 'CANCELLED'];

const chipColor = (s: string): string => {
  switch (s) {
    case 'ACCEPTED': case 'CONVERTED': return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
    case 'SUBMITTED': return 'bg-blue-500/20 text-blue-300 border-blue-500/40';
    case 'UNDER_REVIEW': return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    case 'REJECTED': return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
    default: return 'bg-slate-600/30 text-slate-300 border-slate-500/40';
  }
};
function Chip({ value }: { value: string }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${chipColor(value)}`}>{value.replace(/_/g, ' ')}</span>;
}
const dt = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-AE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

const EMPTY = {
  shipperId: '', shipmentType: '', originName: '', destinationName: '',
  pickupWindowFrom: '', deliveryWindowTo: '', requestedVehicleType: '',
  totalWeightKg: '', cargoValueAmount: '', goodsDescription: '', specialInstructions: '', referenceNo: '',
};

export default function ShippingRequestsPage() {
  const [rows, setRows] = useState<ShippingRequest[]>([]);
  const [shippers, setShippers] = useState<ShipperLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ShippingRequest | null>(null);
  const [master, setMaster] = useState<MasterItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set('status', statusFilter);
      const res = await fetch(`/api/logistics/shipping-requests?${qs}`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setRows(body.data ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  const loadShippers = useCallback(async () => {
    try {
      const res = await fetch('/api/logistics/shippers?limit=500', { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setShippers(body.data ?? []);
    } catch { /* silent */ }
  }, []);

  const loadMaster = useCallback(async () => {
    try {
      const res = await fetch('/api/logistics/master-data', { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setMaster(body.data ?? []);
    } catch { /* silent */ }
  }, []);

  const openForm = () => {
    setForm({ ...EMPTY }); setFormError(null); setShowForm(true);
    void loadShippers(); void loadMaster();
  };

  const submit = async () => {
    if (!form.shipperId) { setFormError('Select a shipper.'); return; }
    setSaving(true); setFormError(null);
    try {
      const res = await fetch('/api/logistics/shipping-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to create request');
      setShowForm(false); setForm({ ...EMPTY });
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create request');
    } finally { setSaving(false); }
  };

  const total = rows.length;
  const open = rows.filter(r => r.status === 'SUBMITTED' || r.status === 'UNDER_REVIEW').length;
  const accepted = rows.filter(r => r.status === 'ACCEPTED').length;
  const converted = rows.filter(r => r.status === 'CONVERTED').length;

  const columns = useMemo<DataGridColumn<ShippingRequest>[]>(() => [
    {
      key: 'request', header: 'Request', accessor: r => r.requestNo,
      render: r => (<div><div className="font-mono text-xs text-white">{r.requestNo}</div><div className="text-xs text-slate-500">{r.shipmentType ?? '—'}{r.referenceNo ? ` · ${r.referenceNo}` : ''}</div></div>),
    },
    { key: 'shipper', header: 'Shipper', accessor: r => r.shipperName ?? '' },
    {
      key: 'lane', header: 'Lane', accessor: r => `${r.originName ?? ''} → ${r.destinationName ?? ''}`,
      render: r => (<span><span className="text-white">{r.originName ?? '—'}</span><ArrowRight className="w-3 h-3 inline mx-1 text-slate-600" /><span className="text-white">{r.destinationName ?? '—'}</span></span>),
    },
    { key: 'pickup', header: 'Pickup', accessor: r => r.pickupWindowFrom ?? '', filter: false, render: r => <span className="text-slate-400 text-xs">{dt(r.pickupWindowFrom)}</span> },
    { key: 'status', header: 'Status', accessor: r => r.status, filter: 'select', render: r => <Chip value={r.status} /> },
  ], []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shipping requests"
        subtitle="Review shipper demand and convert it into job orders"
        icon={Inbox}
        accent="emerald"
        actions={
          <button type="button" onClick={openForm}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-all shadow-lg shadow-emerald-500/30">
            <Plus className="w-4 h-4" /> New request
          </button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Requests"   value={total}     sub="All time"               icon={Inbox}        accent="emerald" />
        <KpiCard label="Open"       value={open}      sub="Submitted / in review"  icon={Clock}        accent="amber"   />
        <KpiCard label="Accepted"   value={accepted}  sub="Ready to convert"       icon={CheckCircle2} accent="emerald" />
        <KpiCard label="Converted"  value={converted} sub="Now job orders"         icon={PackageCheck} accent="emerald" />
      </div>

      <LogisticsDataGrid
        rows={rows}
        columns={columns}
        getRowId={r => r.id}
        onRowClick={r => setSelected(r)}
        selectedId={selected?.id ?? null}
        loading={loading}
        emptyMessage="No shipping requests — file one for a shipper, or wait for portal submissions."
        toolbar={{
          title: 'Intake inbox',
          exportName: 'shipping-requests',
          actions: (
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="bg-slate-950/60 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-emerald-500/40">
              {STATUS_FILTERS.map(s => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
            </select>
          ),
        }}
      />

      {showForm && (
        <RequestDrawer
          form={form} setForm={setForm} shippers={shippers} master={master} saving={saving} error={formError}
          onClose={() => setShowForm(false)} onSubmit={submit}
        />
      )}

      {selected && (
        <RequestDetail
          request={selected}
          onClose={() => setSelected(null)}
          onChanged={(updated) => {
            setRows(prev => prev.map(r => r.id === updated.id ? updated : r));
            setSelected(updated);
          }}
        />
      )}
    </div>
  );
}

/* ── New request drawer ───────────────────────────────────────────────────── */
function RequestDrawer({
  form, setForm, shippers, master, saving, error, onClose, onSubmit,
}: {
  form: typeof EMPTY;
  setForm: React.Dispatch<React.SetStateAction<typeof EMPTY>>;
  shippers: ShipperLite[]; master: MasterItem[]; saving: boolean; error: string | null;
  onClose: () => void; onSubmit: () => void;
}) {
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));
  const locations = master.filter(m => ['PICKUP_LOCATION', 'COUNTRY', 'AIRPORT'].includes(m.type));
  const vehicles = master.filter(m => m.type === 'VEHICLE_TYPE');
  const services = master.filter(m => m.type === 'SERVICE_TYPE');
  const opts = (items: MasterItem[]) => items.map(m => <option key={`${m.type}:${m.code}`} value={m.label}>{m.label}</option>);
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-slate-950 border-l border-white/10 h-full overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white flex items-center gap-2"><Inbox className="w-5 h-5 text-emerald-300" /> New shipping request</h2>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div>}

        <Field label="Shipper *">
          <select value={form.shipperId} onChange={set('shipperId')} className={inputCls}>
            <option value="">Select a shipper…</option>
            {shippers.map(s => <option key={s.id} value={s.id}>{s.name}{s.customerCode ? ` (${s.customerCode})` : ''}</option>)}
          </select>
        </Field>
        <Field label="Cargo / service type">
          <select value={form.shipmentType} onChange={set('shipmentType')} className={inputCls}>
            <option value="">Select…</option>
            {opts(services)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Origin">
            <select value={form.originName} onChange={set('originName')} className={inputCls}>
              <option value="">Select…</option>
              {opts(locations)}
            </select>
          </Field>
          <Field label="Destination">
            <select value={form.destinationName} onChange={set('destinationName')} className={inputCls}>
              <option value="">Select…</option>
              {opts(locations)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pickup from"><input type="datetime-local" value={form.pickupWindowFrom} onChange={set('pickupWindowFrom')} className={inputCls} /></Field>
          <Field label="Deliver by"><input type="datetime-local" value={form.deliveryWindowTo} onChange={set('deliveryWindowTo')} className={inputCls} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Vehicle">
            <select value={form.requestedVehicleType} onChange={set('requestedVehicleType')} className={inputCls}>
              <option value="">Any</option>
              {opts(vehicles)}
            </select>
          </Field>
          <Field label="Weight (kg)"><input value={form.totalWeightKg} onChange={set('totalWeightKg')} className={inputCls} inputMode="decimal" /></Field>
          <Field label="Value"><input value={form.cargoValueAmount} onChange={set('cargoValueAmount')} className={inputCls} inputMode="decimal" /></Field>
        </div>
        <Field label="Goods description"><input value={form.goodsDescription} onChange={set('goodsDescription')} className={inputCls} placeholder="Palletised FMCG" /></Field>
        <Field label="Special instructions"><input value={form.specialInstructions} onChange={set('specialInstructions')} className={inputCls} /></Field>
        <Field label="Your reference (PO)"><input value={form.referenceNo} onChange={set('referenceNo')} className={inputCls} /></Field>

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onSubmit} disabled={saving}
            className="flex-1 rounded-xl bg-emerald-600 text-white font-medium px-4 py-2.5 text-sm hover:bg-emerald-500 disabled:opacity-50">
            {saving ? 'Filing…' : 'File request'}
          </button>
          <button type="button" onClick={onClose} className="rounded-xl border border-white/10 text-slate-300 px-4 py-2.5 text-sm hover:bg-slate-800">Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ── Detail + review/convert drawer ───────────────────────────────────────── */
function RequestDetail({
  request, onClose, onChanged,
}: {
  request: ShippingRequest;
  onClose: () => void;
  onChanged: (r: ShippingRequest) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [converted, setConverted] = useState<{ shipmentNo: string | null } | null>(null);

  const terminal = request.status === 'CONVERTED' || request.status === 'REJECTED' || request.status === 'CANCELLED';
  const canConvert = !terminal;

  const setStatus = async (status: string) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/logistics/shipping-requests/${request.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to update status');
      onChanged(body.data as ShippingRequest);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to update status'); }
    finally { setBusy(false); }
  };

  const convert = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/logistics/shipping-requests/${request.id}/convert`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to convert');
      const data = body.data as { request: ShippingRequest; shipment: { shipmentNo: string | null } };
      onChanged(data.request);
      setConverted({ shipmentNo: data.shipment?.shipmentNo ?? null });
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to convert'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-slate-950 border-l border-white/10 h-full overflow-y-auto p-6 space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-white font-mono">{request.requestNo}</h2>
            <div className="mt-1"><Chip value={request.status} /></div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 space-y-3">
          <div className="flex items-start gap-2 text-sm">
            <MapPin className="w-4 h-4 text-emerald-300 mt-0.5 shrink-0" />
            <span className="text-white font-medium">{request.originName ?? '—'}</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-600 mt-0.5" />
            <span className="text-white font-medium">{request.destinationName ?? '—'}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Info icon={Building2} label="Shipper" value={request.shipperName} />
            <Info icon={Package} label="Cargo" value={request.shipmentType} />
            <Info icon={Truck} label="Vehicle" value={request.requestedVehicleType} />
            <Info icon={Package} label="Weight" value={request.totalWeightKg != null ? `${request.totalWeightKg} kg` : null} />
            <Info icon={Clock} label="Pickup" value={dt(request.pickupWindowFrom)} />
            <Info icon={Clock} label="Deliver by" value={dt(request.deliveryWindowTo)} />
            <Info icon={FileText} label="Reference" value={request.referenceNo} />
            <Info icon={Package} label="Value" value={request.cargoValueAmount != null ? `${request.currency ?? ''} ${request.cargoValueAmount.toLocaleString()}` : null} />
          </div>
          {request.goodsDescription && <div className="text-xs text-slate-400">Goods: {request.goodsDescription}</div>}
          {request.specialInstructions && <div className="text-xs text-slate-400">Instructions: {request.specialInstructions}</div>}
        </div>

        <CargoClassificationPanel metadata={request.metadata} />

        {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div>}

        {converted ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-4 text-center text-sm text-emerald-200">
            <PackageCheck className="w-6 h-6 mx-auto mb-1" />
            Job order <span className="font-mono font-semibold">{converted.shipmentNo ?? 'created'}</span> created.
            <div className="text-xs text-emerald-300/70 mt-1">Post it to the marketplace or assign it from the load board.</div>
          </div>
        ) : request.status === 'CONVERTED' ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 text-center">
            Already converted into a job order.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {request.status !== 'UNDER_REVIEW' && <ActionBtn onClick={() => setStatus('UNDER_REVIEW')} busy={busy} label="Mark under review" tone="amber" />}
              {request.status !== 'ACCEPTED' && <ActionBtn onClick={() => setStatus('ACCEPTED')} busy={busy} label="Accept" tone="emerald" />}
              <ActionBtn onClick={() => setStatus('REJECTED')} busy={busy} label="Reject" tone="rose" />
              <ActionBtn onClick={() => setStatus('CANCELLED')} busy={busy} label="Cancel" tone="slate" />
            </div>
            {canConvert && (
              <button type="button" onClick={convert} disabled={busy}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-semibold px-4 py-2.5 text-sm hover:opacity-90 disabled:opacity-50">
                <PackageCheck className="w-4 h-4" /> {busy ? 'Converting…' : 'Convert to job order'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Cargo classification panel — shipper-declared Haulage + customs + hazmat ───
   The portal stashes these on metadata.{haulage,customs,hazmat}. We render a
   pair of compact panels so the operator sees the regulatory context at review
   time. Renders nothing when no data is present (defaults preserved). */
/* ── small bits ───────────────────────────────────────────────────────────── */
const inputCls = 'w-full bg-slate-950/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/40 mt-1';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-[11px] uppercase tracking-wider text-slate-500">{label}</label>{children}</div>;
}
function Info({ icon: Icon, label, value }: { icon: typeof Package; label: string; value: string | null }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1"><Icon className="w-3 h-3" /> {label}</div>
      <div className="text-slate-200 mt-0.5 truncate">{value || '—'}</div>
    </div>
  );
}
const TONES: Record<string, string> = {
  emerald: 'bg-emerald-600/90 hover:bg-emerald-500 text-white',
  amber: 'bg-amber-600/90 hover:bg-amber-500 text-white',
  rose: 'border border-rose-500/40 text-rose-300 hover:bg-rose-500/10',
  slate: 'border border-white/10 text-slate-300 hover:bg-slate-800',
};
function ActionBtn({ onClick, busy, label, tone }: { onClick: () => void; busy: boolean; label: string; tone: string }) {
  return (
    <button type="button" onClick={onClick} disabled={busy}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 transition-colors ${TONES[tone] ?? TONES.slate}`}>
      {label}
    </button>
  );
}
