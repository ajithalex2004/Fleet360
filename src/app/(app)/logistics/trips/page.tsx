'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, DatabaseZap, Map, Plus, RefreshCw, Truck, X } from 'lucide-react';
import LogisticsDataGrid, { type DataGridColumn } from '@/components/logistics/LogisticsDataGrid';
import LocationPickerModal, { type PickedLocation } from '@/components/logistics/LocationPickerModal';

interface Shipment {
  id: string;
  shipmentNo: string | null;
  legacyBookingId: string | null;
  status: string;
  shipmentType: string | null;
  marketplaceStatus: string | null;
  cargoOwnerName: string | null;
  originName: string | null;
  originAddress: string | null;
  destinationName: string | null;
  destinationAddress: string | null;
  pickupWindowFrom: string | null;
  deliveryWindowTo: string | null;
  requestedVehicleType: string | null;
  totalWeightKg: number | null;
  customerRateAmount: number | null;
  currency: string | null;
  createdAt: string | null;
}

const EMPTY = {
  cargoOwnerCustomerId: '',
  cargoOwnerName: '',
  originName: '',
  originAddress: '',
  originLat: null as number | null,
  originLng: null as number | null,
  destinationName: '',
  destinationAddress: '',
  destinationLat: null as number | null,
  destinationLng: null as number | null,
  shipmentType: 'FTL',
  requestedVehicleType: '',
  pickupWindowFrom: new Date().toISOString().slice(0, 16),
  deliveryWindowTo: '',
  totalWeightKg: '',
  customerRateAmount: '',
};

// Fixed logistics vehicle-type catalog (client-agnostic — vehicles aren't
// linked to customers in the data model, so this is a standard list).
const VEHICLE_TYPES = [
  '1T Pickup', '3T Truck', '7T Truck', '10T Truck', 'Reefer',
  'Flatbed', 'Lowbed Trailer', '40ft Trailer', 'Box Van', 'Curtain-side',
] as const;

// Fallback shipment types if the SERVICE_TYPE master is unreachable.
const SHIPMENT_TYPE_FALLBACK = [
  { code: 'FTL', label: 'Full Truck Load' },
  { code: 'LTL', label: 'Less Than Truck Load' },
  { code: 'EXPRESS', label: 'Express Delivery' },
  { code: 'REEFER', label: 'Temperature Controlled' },
];

const TAB_GROUPS = [
  { key: 'ALL', label: 'All' },
  { key: 'ACTIVE', label: 'In progress' },
  { key: 'DONE', label: 'Completed' },
  { key: 'CANCELLED', label: 'Cancelled' },
] as const;

const ACTIVE = new Set(['DRAFT', 'PENDING', 'APPROVED', 'ASSIGNED', 'DISPATCHED', 'ENROUTE_PICKUP', 'LOADED', 'ENROUTE_DELIVERY']);
const DONE = new Set(['DELIVERED', 'POD_SUBMITTED', 'CLOSED']);

function dt(value: string | null) {
  return value ? new Date(value).toLocaleDateString('en-AE') : '-';
}

export default function LogisticsTripsPage() {
  const [rows, setRows] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<(typeof TAB_GROUPS)[number]['key']>('ALL');
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Array<{ id: string; nameEn: string; customerCode: string | null }>>([]);
  const [shipmentTypes, setShipmentTypes] = useState<Array<{ code: string; label: string }>>(SHIPMENT_TYPE_FALLBACK);
  const [picker, setPicker] = useState<{ open: boolean; target: 'origin' | 'destination' | null }>({ open: false, target: null });

  // Lazily load the customer + shipment-type masters the first time the form opens.
  const loadMasters = useCallback(async () => {
    try {
      const [cRes, stRes] = await Promise.all([
        fetch('/api/customers?status=ACTIVE', { cache: 'no-store' }),
        fetch('/api/logistics/master-data?type=SERVICE_TYPE', { cache: 'no-store' }),
      ]);
      if (cRes.ok) {
        const cs = await cRes.json();
        if (Array.isArray(cs)) setCustomers(cs.map((c: { id: string; nameEn: string; customerCode: string | null }) => ({ id: c.id, nameEn: c.nameEn, customerCode: c.customerCode })));
      }
      if (stRes.ok) {
        const b = await stRes.json();
        const arr = Array.isArray(b?.data) ? b.data : [];
        if (arr.length) setShipmentTypes(arr.map((m: { code: string; label: string }) => ({ code: m.code, label: m.label })));
      }
    } catch { /* keep fallbacks */ }
  }, []);

  const openNew = () => { setForm({ ...EMPTY }); setShowNew(true); void loadMasters(); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/logistics/shipments?limit=500', { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setRows(Array.isArray(body.data) ? body.data : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const backfill = async () => {
    setMessage(null);
    const res = await fetch('/api/logistics/shipments/backfill-legacy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 500 }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setMessage(`Backfilled ${body.created ?? 0} legacy logistics booking(s) into shipment orders.`);
      await load();
    } else {
      setMessage(body.error || 'Backfill failed');
    }
  };

  const create = async () => {
    setSaving(true); setMessage(null);
    try {
      const pickupIso = form.pickupWindowFrom ? new Date(form.pickupWindowFrom).toISOString() : null;
      const deliveryIso = form.deliveryWindowTo ? new Date(form.deliveryWindowTo).toISOString() : null;
      const res = await fetch('/api/logistics/shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cargoOwnerCustomerId: form.cargoOwnerCustomerId || null,
          cargoOwnerName: form.cargoOwnerName || 'Operations',
          originName: form.originName || null,
          originAddress: form.originAddress || null,
          destinationName: form.destinationName || null,
          destinationAddress: form.destinationAddress || null,
          shipmentType: form.shipmentType,
          requestedVehicleType: form.requestedVehicleType || null,
          pickupWindowFrom: pickupIso,
          deliveryWindowTo: deliveryIso,
          totalWeightKg: form.totalWeightKg ? Number(form.totalWeightKg) : null,
          customerRateAmount: form.customerRateAmount ? Number(form.customerRateAmount) : null,
          status: 'PENDING',
          marketplaceStatus: 'PRIVATE',
          bookingMode: 'SPOT',
          currency: 'AED',
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to create shipment');

      // Persist any map-picked coordinates as pickup/delivery stops (best-effort
      // — the shipment row stores only the names; geo lives at the stop level).
      const newId: string | null = body?.id ?? body?.ID ?? body?.data?.id ?? null;
      const stops: Array<Record<string, unknown>> = [];
      if (form.originLat != null && form.originLng != null) {
        stops.push({ stopType: 'PICKUP', sequenceNo: 1, locationName: form.originName || null, address: form.originAddress || null, latitude: form.originLat, longitude: form.originLng, plannedDepartAt: pickupIso });
      }
      if (form.destinationLat != null && form.destinationLng != null) {
        stops.push({ stopType: 'DELIVERY', sequenceNo: stops.length + 1, locationName: form.destinationName || null, address: form.destinationAddress || null, latitude: form.destinationLat, longitude: form.destinationLng, plannedArrivalAt: deliveryIso });
      }
      let stopsWarning = '';
      if (newId && stops.length > 0) {
        const sres = await fetch(`/api/logistics/shipments/${newId}/stops`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stops }),
        });
        if (!sres.ok) stopsWarning = ' (map coordinates could not be saved)';
      }

      setShowNew(false); setForm({ ...EMPTY });
      setMessage(`Created shipment order.${stopsWarning}`);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Failed to create shipment');
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => rows.filter(row => {
    if (tab === 'ALL') return true;
    if (tab === 'ACTIVE') return ACTIVE.has(row.status);
    if (tab === 'DONE') return DONE.has(row.status);
    return row.status === tab;
  }), [rows, tab]);

  const counts = {
    ALL: rows.length,
    ACTIVE: rows.filter(r => ACTIVE.has(r.status)).length,
    DONE: rows.filter(r => DONE.has(r.status)).length,
    CANCELLED: rows.filter(r => r.status === 'CANCELLED').length,
  };

  const columns = useMemo<DataGridColumn<Shipment>[]>(() => [
    {
      key: 'shipment', header: 'Shipment', accessor: s => s.shipmentNo ?? '',
      render: s => <div><div className="font-mono text-xs text-white">{s.shipmentNo ?? s.id.slice(0, 8)}</div>{s.legacyBookingId && <div className="text-[10px] text-amber-300/80">legacy linked</div>}</div>,
    },
    { key: 'status', header: 'Status', accessor: s => s.status, filter: 'select' },
    { key: 'marketplace', header: 'Marketplace', accessor: s => s.marketplaceStatus ?? '', filter: 'select' },
    {
      key: 'lane', header: 'Lane', accessor: s => `${s.originName ?? s.originAddress ?? ''} ${s.destinationName ?? s.destinationAddress ?? ''}`,
      render: s => <span><span className="text-white">{s.originName ?? s.originAddress ?? '-'}</span><ArrowRight className="mx-1 inline h-3 w-3 text-slate-600" /><span className="text-white">{s.destinationName ?? s.destinationAddress ?? '-'}</span></span>,
    },
    { key: 'customer', header: 'Customer', accessor: s => s.cargoOwnerName ?? '' },
    { key: 'pickup', header: 'Pickup', accessor: s => s.pickupWindowFrom ?? '', filter: false, render: s => <span className="text-xs text-slate-400">{dt(s.pickupWindowFrom)}</span> },
    {
      key: 'actions', header: '', accessor: s => s.id, sortable: false, filter: false, align: 'right',
      render: s => (
        <div className="flex justify-end gap-3">
          <Link href={`/logistics/control-tower?shipment=${encodeURIComponent(s.id)}`} className="text-xs text-sky-300 hover:text-sky-200">Tower</Link>
          <Link href={`/logistics/shipments/${s.id}/manifest`} className="text-xs text-amber-300 hover:text-amber-200">Manifest</Link>
          <Link href={`/logistics/shipments/${s.id}/documents`} className="text-xs text-slate-400 hover:text-white">Docs</Link>
          <Link href={`/logistics/shipments/${s.id}/pod`} className="text-xs text-emerald-300 hover:text-emerald-200">ePOD</Link>
          <Link href={`/shipper-portal/shipments/${s.id}`} className="text-xs text-slate-400 hover:text-white">Portal view</Link>
        </div>
      ),
    },
  ], []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Shipment orders</h1>
          <p className="mt-0.5 text-xs text-slate-400">Canonical freight trips from logistics_shipment_orders.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/5"><RefreshCw className="h-4 w-4" /> Refresh</button>
          <button type="button" onClick={() => void backfill()} className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-200 hover:bg-amber-500/20"><DatabaseZap className="h-4 w-4" /> Backfill legacy</button>
          <button type="button" onClick={openNew} className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400"><Plus className="h-4 w-4" /> New shipment</button>
        </div>
      </div>

      {message && <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-200">{message}</div>}

      <div className="flex flex-wrap gap-2">
        {TAB_GROUPS.map(item => (
          <button key={item.key} type="button" onClick={() => setTab(item.key)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${tab === item.key ? 'border-amber-500/30 bg-amber-500/20 text-amber-300' : 'border-white/10 text-slate-400 hover:bg-white/5 hover:text-white'}`}>
            {item.label} <span className="ml-1 opacity-70">{counts[item.key]}</span>
          </button>
        ))}
      </div>

      <LogisticsDataGrid rows={filtered} columns={columns} getRowId={s => s.id} loading={loading} emptyMessage="No shipment orders found" initialSort={{ key: 'pickup', dir: 'desc' }} toolbar={{ exportName: 'logistics-shipments' }} />

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-slate-950 p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold text-white"><Truck className="h-5 w-5 text-amber-300" /> New shipment order</h2>
              <button type="button" onClick={() => setShowNew(false)} className="rounded-lg p-1 text-slate-400 hover:bg-white/5 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {customers.length > 0 ? (
                <Select label="Customer" value={form.cargoOwnerCustomerId}
                  onChange={v => { const c = customers.find(x => x.id === v); setForm(f => ({ ...f, cargoOwnerCustomerId: v, cargoOwnerName: c?.nameEn ?? '' })); }}
                  options={[{ value: '', label: '— Select customer —' }, ...customers.map(c => ({ value: c.id, label: c.nameEn }))]} />
              ) : (
                <Input label="Customer" value={form.cargoOwnerName} onChange={v => setForm(f => ({ ...f, cargoOwnerName: v }))} />
              )}
              <Select label="Shipment type" value={form.shipmentType}
                onChange={v => setForm(f => ({ ...f, shipmentType: v }))}
                options={shipmentTypes.map(t => ({ value: t.code, label: `${t.code} — ${t.label}` }))} />
              <LocationField label="Origin" name={form.originName} hasCoords={form.originLat != null}
                onName={v => setForm(f => ({ ...f, originName: v }))} onPick={() => setPicker({ open: true, target: 'origin' })} />
              <LocationField label="Destination" name={form.destinationName} hasCoords={form.destinationLat != null}
                onName={v => setForm(f => ({ ...f, destinationName: v }))} onPick={() => setPicker({ open: true, target: 'destination' })} />
              <Select label="Vehicle type" value={form.requestedVehicleType}
                onChange={v => setForm(f => ({ ...f, requestedVehicleType: v }))}
                options={[{ value: '', label: '— Select —' }, ...VEHICLE_TYPES.map(t => ({ value: t, label: t }))]} />
              <Input label="Pickup date & time" type="datetime-local" value={form.pickupWindowFrom} onChange={v => setForm(f => ({ ...f, pickupWindowFrom: v }))} />
              <Input label="Delivery date & time" type="datetime-local" value={form.deliveryWindowTo} onChange={v => setForm(f => ({ ...f, deliveryWindowTo: v }))} />
              <WeightField label="Weight (kg)" value={form.totalWeightKg} onChange={v => setForm(f => ({ ...f, totalWeightKg: v }))} />
              <Input label="Rate (AED)" type="number" value={form.customerRateAmount} onChange={v => setForm(f => ({ ...f, customerRateAmount: v }))} />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShowNew(false)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5">Cancel</button>
              <button type="button" disabled={saving} onClick={() => void create()} className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"><Map className="h-4 w-4" /> {saving ? 'Creating...' : 'Create shipment'}</button>
            </div>
          </div>
        </div>
      )}

      <LocationPickerModal
        open={picker.open}
        title={picker.target === 'destination' ? 'Pick destination' : 'Pick origin'}
        initial={
          picker.target === 'destination'
            ? (form.destinationLat != null && form.destinationLng != null ? { lat: form.destinationLat, lng: form.destinationLng, label: form.destinationName } : null)
            : (form.originLat != null && form.originLng != null ? { lat: form.originLat, lng: form.originLng, label: form.originName } : null)
        }
        onClose={() => setPicker({ open: false, target: null })}
        onPick={(loc: PickedLocation) => {
          setForm(f => picker.target === 'destination'
            ? { ...f, destinationName: loc.name, destinationAddress: loc.address, destinationLat: loc.lat, destinationLng: loc.lng }
            : { ...f, originName: loc.name, originAddress: loc.address, originLat: loc.lat, originLng: loc.lng });
          setPicker({ open: false, target: null });
        }}
      />
    </div>
  );
}

function Input({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">{label}</span><input type={type} value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-500/40" /></label>;
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-500/40">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function LocationField({ label, name, hasCoords, onName, onPick }: { label: string; name: string; hasCoords: boolean; onName: (value: string) => void; onPick: () => void }) {
  return (
    <label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">{label}</span>
      <div className="flex gap-2">
        <input value={name} onChange={e => onName(e.target.value)} placeholder="Type or pick on map" className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-500/40" />
        <button type="button" onClick={onPick} title="Pick on map"
          className={`inline-flex items-center justify-center rounded-xl border px-2.5 ${hasCoords ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-white/10 text-slate-300 hover:bg-white/5'}`}>
          <Map className="h-4 w-4" />
        </button>
      </div>
    </label>
  );
}

function WeightField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const kg = Number(value);
  const tonnes = value !== '' && !Number.isNaN(kg) ? kg / 1000 : null;
  return (
    <label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">{label}</span>
      <div className="flex items-stretch gap-2">
        <div className="flex min-w-[66px] flex-col items-center justify-center rounded-xl border border-white/10 bg-slate-800/60 px-2 py-1 text-center" title="Converted to tonnes">
          <span className="text-sm font-semibold text-amber-300">{tonnes != null ? tonnes.toFixed(2) : '—'}</span>
          <span className="text-[9px] uppercase tracking-wide text-slate-500">tonnes</span>
        </div>
        <input type="number" min="0" step="any" value={value} onChange={e => onChange(e.target.value)} placeholder="kg" className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-500/40" />
      </div>
    </label>
  );
}
