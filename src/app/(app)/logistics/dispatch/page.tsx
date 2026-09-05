'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, RefreshCw, Truck, UserRound, X } from 'lucide-react';

type StageKey =
  | 'PENDING'
  | 'APPROVED'
  | 'ASSIGNED'
  | 'ACTIVE'
  | 'DISPATCHED'
  | 'ENROUTE_PICKUP'
  | 'LOADED'
  | 'ENROUTE_DELIVERY'
  | 'DELIVERED'
  | 'POD_SUBMITTED'
  | 'CLOSED'
  | 'CANCELLED';

interface Shipment {
  id: string;
  shipmentNo: string | null;
  legacyBookingId: string | null;
  status: StageKey | string;
  rawStatus?: string | null;
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
  assignedCarrierId: string | null;
  assignedDriverId: string | null;
  assignedVehicleId: string | null;
  customerRateAmount: number | null;
  currency: string | null;
}

interface Vehicle {
  id: string;
  plateNumber?: string | null;
  licensePlate?: string | null;
  make?: string | null;
  model?: string | null;
  vehicleTypeName?: string | null;
}

interface Driver {
  id: string;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

const STAGES: Array<{
  status: StageKey;
  label: string;
  phase: 'pre' | 'transit' | 'done' | 'terminal';
  next?: StageKey;
  action?: string;
  tone: string;
}> = [
  { status: 'PENDING', label: 'Created', phase: 'pre', next: 'APPROVED', action: 'Approve', tone: 'border-amber-500/25 bg-amber-500/5' },
  { status: 'APPROVED', label: 'Approved', phase: 'pre', next: 'ASSIGNED', action: 'Assign', tone: 'border-sky-500/25 bg-sky-500/5' },
  { status: 'ASSIGNED', label: 'Assigned', phase: 'pre', next: 'DISPATCHED', action: 'Dispatch', tone: 'border-violet-500/25 bg-violet-500/5' },
  { status: 'DISPATCHED', label: 'Dispatched', phase: 'transit', next: 'ENROUTE_PICKUP', action: 'En-route pickup', tone: 'border-orange-500/25 bg-orange-500/5' },
  { status: 'ENROUTE_PICKUP', label: 'En-route pickup', phase: 'transit', next: 'LOADED', action: 'Loaded', tone: 'border-cyan-500/25 bg-cyan-500/5' },
  { status: 'LOADED', label: 'Loaded', phase: 'transit', next: 'ENROUTE_DELIVERY', action: 'Depart', tone: 'border-yellow-500/25 bg-yellow-500/5' },
  { status: 'ENROUTE_DELIVERY', label: 'En-route delivery', phase: 'transit', next: 'DELIVERED', action: 'Delivered', tone: 'border-emerald-500/25 bg-emerald-500/5' },
  { status: 'DELIVERED', label: 'Delivered', phase: 'done', next: 'POD_SUBMITTED', action: 'POD submitted', tone: 'border-teal-500/25 bg-teal-500/5' },
  { status: 'POD_SUBMITTED', label: 'POD submitted', phase: 'done', next: 'CLOSED', action: 'Close', tone: 'border-green-500/25 bg-green-500/5' },
  { status: 'CLOSED', label: 'Closed', phase: 'done', tone: 'border-slate-500/25 bg-slate-500/5' },
  { status: 'CANCELLED', label: 'Cancelled', phase: 'terminal', tone: 'border-rose-500/25 bg-rose-500/5' },
];

const STAGE_MAP = new Map(STAGES.map(stage => [stage.status, stage]));
const ACTIVE_STAGES = STAGES.filter(stage => stage.phase !== 'terminal' && stage.status !== 'CLOSED');

function normalizeDispatchStatus(status?: string | null): StageKey | string {
  switch ((status ?? 'PENDING').toUpperCase()) {
    case 'CONFIRMED':
      return 'APPROVED';
    case 'ACTIVE':
      return 'ENROUTE_DELIVERY';
    case 'COMPLETED':
      return 'CLOSED';
    default:
      return (status ?? 'PENDING').toUpperCase();
  }
}

function normalizeShipment(shipment: Shipment): Shipment {
  return {
    ...shipment,
    rawStatus: shipment.rawStatus ?? shipment.status,
    status: normalizeDispatchStatus(shipment.status),
  };
}

function routeLabel(s: Shipment) {
  return `${s.originName ?? s.originAddress ?? '-'} to ${s.destinationName ?? s.destinationAddress ?? '-'}`;
}

function dateLabel(value: string | null) {
  return value ? new Date(value).toLocaleString('en-AE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
}

function driverName(d: Driver) {
  return d.name || [d.firstName, d.lastName].filter(Boolean).join(' ') || d.id.slice(0, 8);
}

function vehicleName(v: Vehicle) {
  return v.plateNumber || v.licensePlate || [v.make, v.model].filter(Boolean).join(' ') || v.id.slice(0, 8);
}

export default function LogisticsDispatchPage() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<'ALL' | 'PRE' | 'TRANSIT' | 'DONE'>('ALL');
  const [selected, setSelected] = useState<Shipment | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/logistics/shipments?limit=500', { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      const rows = Array.isArray(body.data) ? body.data : Array.isArray(body) ? body : null;
      if (!res.ok) {
        setShipments([]);
        setLoadError(body.error || body.message || `Shipments API returned ${res.status}`);
        return;
      }
      if (!rows) {
        setShipments([]);
        setLoadError('Shipments API returned an unexpected response shape.');
        return;
      }
      setShipments(rows.map(normalizeShipment));
    } catch (error) {
      setShipments([]);
      setLoadError(error instanceof Error ? error.message : 'Failed to load dispatch shipments');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const transition = async (shipment: Shipment, next: StageKey) => {
    setMessage(null);
    const res = await fetch(`/api/logistics/shipments/${shipment.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentStatus: shipment.rawStatus ?? shipment.status, status: next, note: 'Updated from dispatch board' }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(body.error || 'Failed to update shipment status');
      return;
    }
    await load();
  };

  const phaseCounts = useMemo(() => ({
    ALL: shipments.length,
    PRE: shipments.filter(s => ['PENDING', 'APPROVED', 'ASSIGNED'].includes(s.status)).length,
    TRANSIT: shipments.filter(s => ['DISPATCHED', 'ENROUTE_PICKUP', 'LOADED', 'ENROUTE_DELIVERY'].includes(s.status)).length,
    DONE: shipments.filter(s => ['DELIVERED', 'POD_SUBMITTED', 'CLOSED'].includes(s.status)).length,
  }), [shipments]);

  const boardStages = useMemo(() => ACTIVE_STAGES.map(stage => ({
    ...stage,
    items: shipments.filter(shipment => {
      if (phase === 'PRE' && stage.phase !== 'pre') return false;
      if (phase === 'TRANSIT' && stage.phase !== 'transit') return false;
      if (phase === 'DONE' && stage.phase !== 'done') return false;
      return shipment.status === stage.status;
    }),
  })), [phase, shipments]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Dispatch Board</h1>
          <p className="mt-0.5 text-xs text-slate-400">Shipment-order-native execution board for assignment and lifecycle movement.</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/5">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="All" value={phaseCounts.ALL} icon={Truck} active={phase === 'ALL'} onClick={() => setPhase('ALL')} />
        <Metric label="Pre-dispatch" value={phaseCounts.PRE} icon={Clock} active={phase === 'PRE'} onClick={() => setPhase('PRE')} />
        <Metric label="In transit" value={phaseCounts.TRANSIT} icon={ArrowRight} active={phase === 'TRANSIT'} onClick={() => setPhase('TRANSIT')} />
        <Metric label="Done" value={phaseCounts.DONE} icon={CheckCircle2} active={phase === 'DONE'} onClick={() => setPhase('DONE')} />
      </div>

      {message && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
          <AlertTriangle className="h-4 w-4" /> {message}
        </div>
      )}

      {loadError && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
          <AlertTriangle className="h-4 w-4" /> Dispatch shipments could not be loaded: {loadError}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
          {[...Array(8)].map((_, index) => <div key={index} className="h-40 animate-pulse rounded-xl bg-slate-900/80" />)}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {boardStages.map(stage => (
            <section key={stage.status} className={`w-72 flex-shrink-0 rounded-xl border ${stage.tone}`}>
              <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                <div>
                  <h2 className="text-sm font-semibold text-white">{stage.label}</h2>
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">{stage.items.length} load{stage.items.length === 1 ? '' : 's'}</p>
                </div>
              </div>
              <div className="min-h-40 space-y-2 p-2">
                {stage.items.map(shipment => (
                  <ShipmentCard
                    key={shipment.id}
                    shipment={shipment}
                    onAssign={() => setSelected(shipment)}
                    onNext={stage.next ? () => void transition(shipment, stage.next!) : undefined}
                    nextLabel={stage.action}
                  />
                ))}
                {stage.items.length === 0 && <p className="rounded-lg border border-dashed border-white/10 p-4 text-center text-xs text-slate-600">No shipments</p>}
              </div>
            </section>
          ))}
        </div>
      )}

      {selected && (
        <AssignModal
          shipment={selected}
          onClose={() => setSelected(null)}
          onDone={async () => {
            setSelected(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function Metric({ label, value, icon: Icon, active, onClick }: { label: string; value: number; icon: React.ComponentType<{ className?: string }>; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-xl border p-4 text-left transition-colors ${active ? 'border-amber-500/40 bg-amber-500/10' : 'border-white/10 bg-slate-900/70 hover:bg-white/[0.04]'}`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-slate-500">{label}</span>
        <Icon className="h-4 w-4 text-amber-300" />
      </div>
      <div className="mt-2 text-2xl font-bold text-white">{value}</div>
    </button>
  );
}

function ShipmentCard({ shipment, onAssign, onNext, nextLabel }: { shipment: Shipment; onAssign: () => void; onNext?: () => void; nextLabel?: string }) {
  const needsAssignment = !shipment.assignedDriverId && !shipment.assignedVehicleId && !shipment.assignedCarrierId;

  return (
    <article className="rounded-lg border border-white/10 bg-slate-950/80 p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-xs text-amber-300">{shipment.shipmentNo ?? shipment.id.slice(0, 8)}</p>
          <h3 className="mt-1 text-sm font-semibold text-white">{routeLabel(shipment)}</h3>
        </div>
        {shipment.legacyBookingId && <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-200">legacy</span>}
      </div>

      <div className="mt-3 space-y-1 text-xs text-slate-400">
        <p>{shipment.cargoOwnerName ?? 'No customer'} · {shipment.shipmentType ?? 'Freight'}</p>
        <p>Pickup {dateLabel(shipment.pickupWindowFrom)}</p>
        {shipment.requestedVehicleType && <p>Vehicle {shipment.requestedVehicleType}</p>}
      </div>

      {needsAssignment && (
        <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-rose-500/25 bg-rose-500/10 px-2 py-1.5 text-xs text-rose-200">
          <AlertTriangle className="h-3.5 w-3.5" /> Assignment needed
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onAssign} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/5">
          <UserRound className="h-3.5 w-3.5" /> Assign
        </button>
        {onNext && (
          <button type="button" onClick={onNext} className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400">
            {nextLabel ?? 'Move'} <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
        <Link href={`/logistics/shipments/${shipment.id}/manifest`} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/5">
          Manifest
        </Link>
        <Link href={`/logistics/shipments/${shipment.id}/documents`} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/5">
          Docs
        </Link>
        {shipment.status === 'DELIVERED' && (
          <Link href={`/logistics/shipments/${shipment.id}/pod`} className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/20">
            ePOD
          </Link>
        )}
      </div>
    </article>
  );
}

function AssignModal({ shipment, onClose, onDone }: { shipment: Shipment; onClose: () => void; onDone: () => Promise<void> }) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicleId, setVehicleId] = useState(shipment.assignedVehicleId ?? '');
  const [driverId, setDriverId] = useState(shipment.assignedDriverId ?? '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch('/api/fleet/vehicles?vehicleUsage=LOGISTICS&status=AVAILABLE&limit=200', { cache: 'no-store' }).then(r => r.ok ? r.json() : {}),
      fetch('/api/drivers?status=ACTIVE', { cache: 'no-store' }).then(r => r.ok ? r.json() : []),
    ]).then(([vehicleBody, driverBody]: [unknown, unknown]) => {
      if (cancelled) return;
      setVehicles(Array.isArray(vehicleBody) ? vehicleBody : Array.isArray((vehicleBody as any)?.data) ? (vehicleBody as any).data : []);
      setDrivers(Array.isArray(driverBody) ? driverBody : Array.isArray((driverBody as any)?.data) ? (driverBody as any).data : []);
    }).catch(() => {
      if (!cancelled) {
        setVehicles([]);
        setDrivers([]);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const assign = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/logistics/shipments/${shipment.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId: vehicleId || null,
          driverId: driverId || null,
          note: note || null,
          currency: shipment.currency ?? 'AED',
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to assign shipment');
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to assign shipment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-slate-950 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Assign shipment</h2>
            <p className="text-xs text-slate-500">{shipment.shipmentNo ?? shipment.id.slice(0, 8)} · {routeLabel(shipment)}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-white/5 hover:text-white"><X className="h-5 w-5" /></button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Vehicle</span>
            <select value={vehicleId} onChange={e => setVehicleId(e.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-500/40">
              <option value="">Select vehicle</option>
              {vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicleName(vehicle)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Driver</span>
            <select value={driverId} onChange={e => setDriverId(e.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-500/40">
              <option value="">Select driver</option>
              {drivers.map(driver => <option key={driver.id} value={driver.id}>{driverName(driver)}</option>)}
            </select>
          </label>
        </div>

        <label className="mt-3 block">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Note</span>
          <input value={note} onChange={e => setNote(e.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-500/40" />
        </label>

        {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5">Cancel</button>
          <button type="button" disabled={saving || (!driverId && !vehicleId)} onClick={() => void assign()} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50">
            {saving ? 'Assigning...' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  );
}
