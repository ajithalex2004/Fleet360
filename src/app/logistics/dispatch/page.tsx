'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  combineMasterOptions,
  masterLabel,
  masterValue,
  LogisticsMessage,
  readLogisticsApiError,
  ShipmentValidationSummary,
  type LogisticsApiError,
  type LogisticsComplianceBlocker,
  useLogisticsMasterData,
  useShipmentValidation,
  validateShipmentPayload,
} from '@/components/logistics/master-data-fields';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Booking {
  id: string;
  bookingRef: string | null;
  serviceType: string;
  status: string | null;
  requestorName: string | null;
  startDate: string | null;
  endDate: string | null;
  vehicleId: string | null;
  notes: string | null;
  createdAt: string | null;
}

interface StatusHistory {
  id: string;
  from_status: string | null;
  to_status: string;
  changed_by: string | null;
  note: string | null;
  changed_at: string;
}

interface Vehicle { id: string; plateNumber?: string | null; make?: string | null; model?: string | null; }
interface Driver  { id: string; firstName: string; lastName: string; }

function parseNotes(notes: string | null): {
  origin?: string; destination?: string; driverId?: string;
  driverName?: string; vehiclePlate?: string; cargo?: string;
  shipmentType?: string; weightKg?: number; distanceKm?: number;
} {
  if (!notes) return {};
  try { return JSON.parse(notes); } catch { return { cargo: notes }; }
}

function localDateTime(hoursFromNow = 0) {
  const date = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function toIsoOrNull(value: string) {
  return value ? new Date(value).toISOString() : null;
}

// ── 10-stage lifecycle ────────────────────────────────────────────────────────

type StageKey =
  | 'PENDING' | 'APPROVED' | 'ASSIGNED' | 'DISPATCHED'
  | 'ENROUTE_PICKUP' | 'LOADED' | 'ENROUTE_DELIVERY'
  | 'DELIVERED' | 'POD_SUBMITTED' | 'CLOSED' | 'CANCELLED'
  // legacy aliases kept for backward compat
  | 'CONFIRMED' | 'ACTIVE' | 'COMPLETED';

interface Stage {
  status: StageKey;
  label: string;
  icon: string;
  color: string;
  bg: string;
  headerBg: string;
  phase: 'pre' | 'transit' | 'done' | 'terminal';
  nextStatus?: StageKey;
  nextLabel?: string;
}

const STAGES: Stage[] = [
  { status: 'PENDING',          label: 'Created',           icon: '📋', phase: 'pre',
    color: 'text-amber-400',   bg: 'bg-amber-500/5',   headerBg: 'bg-amber-500/10 border-amber-500/20',
    nextStatus: 'APPROVED',     nextLabel: 'Approve' },
  { status: 'APPROVED',         label: 'Approved',          icon: '✅', phase: 'pre',
    color: 'text-sky-400',     bg: 'bg-sky-500/5',     headerBg: 'bg-sky-500/10 border-sky-500/20',
    nextStatus: 'ASSIGNED',     nextLabel: 'Assign' },
  { status: 'ASSIGNED',         label: 'Assigned',          icon: '🤵', phase: 'pre',
    color: 'text-violet-400',  bg: 'bg-violet-500/5',  headerBg: 'bg-violet-500/10 border-violet-500/20',
    nextStatus: 'DISPATCHED',   nextLabel: 'Dispatch' },
  { status: 'DISPATCHED',       label: 'Dispatched',        icon: '🚦', phase: 'transit',
    color: 'text-orange-400',  bg: 'bg-orange-500/5',  headerBg: 'bg-orange-500/10 border-orange-500/20',
    nextStatus: 'ENROUTE_PICKUP', nextLabel: 'Confirm Pickup' },
  { status: 'ENROUTE_PICKUP',   label: 'En-route Pickup',   icon: '🗺️', phase: 'transit',
    color: 'text-cyan-400',    bg: 'bg-cyan-500/5',    headerBg: 'bg-cyan-500/10 border-cyan-500/20',
    nextStatus: 'LOADED',       nextLabel: 'Mark Loaded' },
  { status: 'LOADED',           label: 'Loaded',            icon: '📦', phase: 'transit',
    color: 'text-yellow-400',  bg: 'bg-yellow-500/5',  headerBg: 'bg-yellow-500/10 border-yellow-500/20',
    nextStatus: 'ENROUTE_DELIVERY', nextLabel: 'Depart' },
  { status: 'ENROUTE_DELIVERY', label: 'En-route Delivery', icon: '🚛', phase: 'transit',
    color: 'text-emerald-400', bg: 'bg-emerald-500/5', headerBg: 'bg-emerald-500/10 border-emerald-500/20',
    nextStatus: 'DELIVERED',    nextLabel: 'Mark Delivered' },
  { status: 'DELIVERED',        label: 'Delivered',         icon: '📍', phase: 'done',
    color: 'text-teal-400',    bg: 'bg-teal-500/5',    headerBg: 'bg-teal-500/10 border-teal-500/20',
    nextStatus: 'POD_SUBMITTED', nextLabel: 'Submit POD' },
  { status: 'POD_SUBMITTED',    label: 'POD Submitted',     icon: '📝', phase: 'done',
    color: 'text-green-400',   bg: 'bg-green-500/5',   headerBg: 'bg-green-500/10 border-green-500/20',
    nextStatus: 'CLOSED',       nextLabel: 'Close Trip' },
  { status: 'CLOSED',           label: 'Closed',            icon: '🔒', phase: 'done',
    color: 'text-slate-400',   bg: 'bg-slate-500/5',   headerBg: 'bg-slate-500/10 border-slate-500/20' },
  { status: 'CANCELLED',        label: 'Cancelled',         icon: '❌', phase: 'terminal',
    color: 'text-red-400',     bg: 'bg-red-500/5',     headerBg: 'bg-red-500/10 border-red-500/20' },
];

// Map legacy statuses to their display column
const LEGACY_MAP: Record<string, StageKey> = {
  CONFIRMED: 'APPROVED',
  ACTIVE:    'ENROUTE_DELIVERY',
  COMPLETED: 'CLOSED',
};

function resolveDisplayStatus(status: string): StageKey {
  return (LEGACY_MAP[status] ?? status) as StageKey;
}

const STAGE_MAP = Object.fromEntries(STAGES.map(s => [s.status, s])) as Record<StageKey, Stage>;

const PHASE_LABELS = {
  pre:      { label: 'Pre-Dispatch', color: 'text-amber-400' },
  transit:  { label: 'In Transit',   color: 'text-emerald-400' },
  done:     { label: 'Completed',    color: 'text-teal-400' },
  terminal: { label: 'Terminal',     color: 'text-red-400' },
};

// ── Assign / Dispatch Modal ───────────────────────────────────────────────────

function AssignModal({
  booking,
  targetStatus,
  onClose,
  onDone,
}: {
  booking: Booking;
  targetStatus: StageKey;
  onClose: () => void;
  onDone: () => void;
}) {
  const notes    = parseNotes(booking.notes);
  const [vehicles,    setVehicles]    = useState<Vehicle[]>([]);
  const [drivers,     setDrivers]     = useState<Driver[]>([]);
  const [vehicleId,   setVehicleId]   = useState(booking.vehicleId ?? '');
  const [driverId,    setDriverId]    = useState(notes.driverId ?? '');
  const [origin,      setOrigin]      = useState(notes.origin ?? '');
  const [destination, setDestination] = useState(notes.destination ?? '');
  const [note,        setNote]        = useState('');
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  const [apiError,    setApiError]    = useState<LogisticsApiError | null>(null);
  const [complianceBlockers, setComplianceBlockers] = useState<LogisticsComplianceBlocker[]>([]);
  const [overrideReason, setOverrideReason] = useState('');
  const masterData = useLogisticsMasterData(['PICKUP_LOCATION', 'AIRPORT', 'COUNTRY']);
  const locationOptions = combineMasterOptions(
    masterData.optionsFor('PICKUP_LOCATION'),
    masterData.optionsFor('AIRPORT'),
    masterData.optionsFor('COUNTRY'),
  );

  useEffect(() => {
    Promise.all([
      fetch('/api/vehicles?usage=LOGISTICS&status=AVAILABLE').then(r => r.ok ? r.json() : []),
      fetch('/api/drivers?assignmentType=LOGISTICS').then(r => r.ok ? r.json() : []),
    ]).then(([v, d]) => {
      setVehicles(Array.isArray(v) ? v : v.data ?? []);
      setDrivers(Array.isArray(d) ? d : d.data ?? []);
    }).catch(() => {});
  }, []);

  const handle = async () => {
    setSaving(true);
    setError('');
    setApiError(null);
    try {
      const selectedDriver  = drivers.find(d => d.id === driverId);
      const selectedVehicle = vehicles.find(v => v.id === vehicleId);
      const requestOverride = complianceBlockers.length > 0 && overrideReason.trim().length > 0;
      const res = await fetch(`/api/logistics/trips/${booking.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status:       targetStatus,
          changedBy:    'Dispatcher',
          note:         note || undefined,
          vehicleId:    vehicleId || undefined,
          driverId:     driverId  || undefined,
          driverName:   selectedDriver  ? `${selectedDriver.firstName} ${selectedDriver.lastName}` : undefined,
          vehiclePlate: selectedVehicle?.plateNumber ?? undefined,
          overrideCompliance: requestOverride,
          overrideReason: requestOverride ? overrideReason.trim() : undefined,
        }),
      });
      if (!res.ok) {
        const parsed = await readLogisticsApiError(res);
        setApiError(parsed);
        setComplianceBlockers(parsed.blockers);
        return;
      }
      // Also patch origin/destination if changed
      if (origin !== notes.origin || destination !== notes.destination) {
        const notesObj = { ...notes, origin, destination };
        await fetch(`/api/bookings/${booking.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes: JSON.stringify(notesObj) }),
        });
      }
      setComplianceBlockers([]);
      setOverrideReason('');
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const stageInfo = STAGE_MAP[targetStatus];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-white/20 rounded-2xl p-6 w-full max-w-lg shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-white">{stageInfo?.icon} {stageInfo?.label ?? targetStatus}</h3>
            <p className="text-slate-400 text-xs mt-0.5">
              <span className="font-mono text-white">{booking.bookingRef ?? booking.id.slice(0, 8)}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none">✕</button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Assign Vehicle</label>
              <select value={vehicleId} onChange={e => setVehicleId(e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40">
                <option value="">— Select —</option>
                {vehicles.map(v => (
                  <option key={v.id} value={v.id}>{v.plateNumber ?? v.id.slice(0, 8)} {v.make} {v.model}</option>
                ))}
                {vehicles.length === 0 && <option disabled>No vehicles available</option>}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Assign Driver</label>
              <select value={driverId} onChange={e => setDriverId(e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40">
                <option value="">— Select —</option>
                {drivers.map(d => (
                  <option key={d.id} value={d.id}>{d.firstName} {d.lastName}</option>
                ))}
                {drivers.length === 0 && <option disabled>No drivers found</option>}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Origin</label>
              <select value={origin} onChange={e => setOrigin(e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40">
                <option value="">{masterData.loading ? 'Loading locations...' : 'Select origin'}</option>
                {locationOptions.map(item => (
                  <option key={`origin-${item.type}-${item.id}`} value={masterValue(item)}>{masterLabel(item)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Destination</label>
              <select value={destination} onChange={e => setDestination(e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40">
                <option value="">{masterData.loading ? 'Loading locations...' : 'Select destination'}</option>
                {locationOptions.map(item => (
                  <option key={`destination-${item.type}-${item.id}`} value={masterValue(item)}>{masterLabel(item)}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Note (optional)</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Any notes for this transition"
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40" />
          </div>
        </div>

        {apiError && (
          <LogisticsMessage
            type={apiError.code === 'LOGISTICS_OVERRIDE_APPROVAL_REQUIRED' ? 'warning' : 'error'}
            title={apiError.code === 'LOGISTICS_OVERRIDE_APPROVAL_REQUIRED' ? 'Approval queued' : 'Dispatch action blocked'}
            message={apiError.message}
            issues={apiError.issues}
            warnings={apiError.warnings}
            blockers={apiError.blockers}
            approvalRequest={apiError.approvalRequest}
          />
        )}

        {complianceBlockers.length > 0 && apiError?.code !== 'LOGISTICS_OVERRIDE_APPROVAL_REQUIRED' && (
          <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-200">
              Super Admin override reason
            </p>
            <textarea
              value={overrideReason}
              onChange={event => setOverrideReason(event.target.value)}
              rows={3}
              placeholder="Explain why dispatch should proceed despite the listed compliance blockers."
              className="w-full rounded-xl border border-amber-400/30 bg-slate-950/70 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-amber-300 focus:outline-none"
            />
            <p className="text-xs text-amber-100/80">
              Saving again will queue an approval request. Dispatch executes only after approval.
            </p>
          </div>
        )}

        {!apiError && error && (
          <LogisticsMessage type="error" title="Dispatch action failed" message={error} />
        )}

        {false && !apiError && error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5 text-red-400 text-xs">⚠️ {error}</div>
        )}

        <div className="flex gap-3 pt-1">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-300 text-sm hover:bg-slate-800 transition-colors">
            Cancel
          </button>
          <button onClick={handle} disabled={saving}
            className={`flex-1 py-2.5 rounded-xl text-white font-semibold text-sm transition-colors disabled:opacity-40 ${stageInfo?.headerBg ?? 'bg-amber-500/20 border-amber-500/30'} border`}>
            {saving
              ? 'Saving...'
              : complianceBlockers.length > 0 && overrideReason.trim()
                ? 'Request override approval'
                : `${stageInfo?.icon} ${stageInfo?.nextLabel ?? stageInfo?.label}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Status Timeline (expandable) ──────────────────────────────────────────────

function StatusTimeline({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const [history, setHistory] = useState<StatusHistory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/logistics/trips/${bookingId}/status`)
      .then(r => r.ok ? r.json() : [])
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [bookingId]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-white/20 rounded-2xl p-5 w-full max-w-sm shadow-2xl space-y-3 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between sticky top-0 bg-slate-900 pb-2">
          <h3 className="text-sm font-bold text-white">🕐 Status Timeline</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none">✕</button>
        </div>
        {loading ? (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-slate-800 rounded-lg animate-pulse" />)}</div>
        ) : history.length === 0 ? (
          <p className="text-slate-500 text-xs text-center py-4">No history recorded yet</p>
        ) : (
          <ol className="relative border-l border-white/10 ml-2 space-y-3">
            {history.map((h, i) => {
              const stage = STAGE_MAP[h.to_status as StageKey];
              return (
                <li key={h.id} className="ml-4">
                  <div className={`absolute -left-1.5 mt-1 w-3 h-3 rounded-full border border-slate-900 ${i === history.length - 1 ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className={`text-xs font-semibold ${stage?.color ?? 'text-white'}`}>
                        {stage?.icon} {stage?.label ?? h.to_status}
                      </p>
                      {h.note && <p className="text-xs text-slate-500 mt-0.5">{h.note}</p>}
                      {h.changed_by && <p className="text-xs text-slate-600">by {h.changed_by}</p>}
                    </div>
                    <time className="text-xs text-slate-600 flex-shrink-0">
                      {new Date(h.changed_at).toLocaleString('en-AE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </time>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

// ── New Trip Modal ────────────────────────────────────────────────────────────

function NewTripModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const masterData = useLogisticsMasterData(['CUSTOMER', 'SHIPPER', 'PICKUP_LOCATION', 'AIRPORT', 'COUNTRY', 'SERVICE_TYPE']);
  const [form, setForm] = useState({
    requestorName: '', origin: '', destination: '', cargo: '',
    shipmentType: 'FTL',
    pickupWindowFrom: localDateTime(1),
    pickupWindowTo: localDateTime(3),
    deliveryWindowFrom: localDateTime(6),
    deliveryWindowTo: localDateTime(10),
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const [apiError, setApiError] = useState<LogisticsApiError | null>(null);

  const customerOptions = combineMasterOptions(masterData.optionsFor('CUSTOMER'), masterData.optionsFor('SHIPPER'));
  const locationOptions = combineMasterOptions(masterData.optionsFor('PICKUP_LOCATION'), masterData.optionsFor('AIRPORT'), masterData.optionsFor('COUNTRY'));
  const serviceTypeOptions = masterData.optionsFor('SERVICE_TYPE');

  const shipmentPayload = useMemo(() => ({
    cargoOwnerName: form.requestorName || null,
    pickupWindowFrom: toIsoOrNull(form.pickupWindowFrom),
    pickupWindowTo: toIsoOrNull(form.pickupWindowTo),
    deliveryWindowFrom: toIsoOrNull(form.deliveryWindowFrom),
    deliveryWindowTo: toIsoOrNull(form.deliveryWindowTo),
    shipmentType: form.shipmentType || null,
    originName: form.origin || null,
    destinationName: form.destination || null,
    stops: [
      {
        sequenceNo: 1,
        stopType: 'PICKUP',
        locationName: form.origin || null,
        plannedArrivalAt: toIsoOrNull(form.pickupWindowFrom),
        plannedDepartAt: toIsoOrNull(form.pickupWindowTo),
      },
      {
        sequenceNo: 2,
        stopType: 'DELIVERY',
        locationName: form.destination || null,
        plannedArrivalAt: toIsoOrNull(form.deliveryWindowFrom),
        plannedDepartAt: toIsoOrNull(form.deliveryWindowTo),
      },
    ],
  }), [form]);
  const validation = useShipmentValidation(shipmentPayload, masterData.tenantId);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  const handleCreate = async () => {
    if (!masterData.tenantId) { setError('Tenant context is still loading. Please try again.'); return; }
    if (!form.pickupWindowFrom) { setError('Pickup ready time is required'); return; }
    setSaving(true); setError(''); setApiError(null);
    try {
      const validationResult = await validateShipmentPayload(shipmentPayload, masterData.tenantId);
      if (!validationResult.ok) {
        setError(validationResult.issues.join(' '));
        return;
      }
      const ref = `LOG-${Date.now().toString(36).toUpperCase()}`;
      const res = await fetch(`/api/logistics/shipments?tenantId=${encodeURIComponent(masterData.tenantId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...shipmentPayload,
          shipmentNo: ref,
          cargoOwnerName: form.requestorName || 'Operations',
          status: 'PENDING',
          sourceChannel: 'dispatch-board',
          notes: JSON.stringify({
            origin: form.origin, destination: form.destination,
            cargo: form.cargo, shipmentType: form.shipmentType,
          }),
        }),
      });
      if (!res.ok) {
        const parsed = await readLogisticsApiError(res);
        setApiError(parsed);
        throw new Error(parsed.message);
      }
      onCreated(); onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create trip');
    } finally { setSaving(false); }
  };

  const fallbackServiceTypes = ['FTL','LTL','EXPRESS','REEFER'].map(code => ({
    id: code,
    type: 'SERVICE_TYPE',
    code,
    label: code,
    status: 'ACTIVE',
  }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-white/20 rounded-2xl p-6 w-full max-w-2xl shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">➕ New Logistics Trip</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none">✕</button>
        </div>

        <div className="hidden grid-cols-2 gap-3">
          {[
            { key: 'requestorName', label: 'Customer / Requestor', span: true, placeholder: 'Company or person' },
            { key: 'origin',        label: 'Origin',               span: false, placeholder: 'Pickup address' },
            { key: 'destination',   label: 'Destination',          span: false, placeholder: 'Delivery address' },
            { key: 'cargo',         label: 'Cargo Description',    span: true,  placeholder: 'What is being transported?' },
            { key: 'startDate',     label: 'Start Date',           span: false, type: 'date', placeholder: '' },
          ].map(f => (
            <div key={f.key} className={f.span ? 'col-span-2' : ''}>
              <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">{f.label}</label>
              <input type={f.type ?? 'text'} value={form[f.key as keyof typeof form]}
                onChange={set(f.key)} placeholder={f.placeholder}
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40" />
            </div>
          ))}
          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Shipment Type</label>
            <select value={form.shipmentType} onChange={set('shipmentType')}
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40">
              <option value="">— Select —</option>
              {['FTL','LTL','FCL','LCL','REEFER','SPECIAL'].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Customer / Requestor</label>
            <select value={form.requestorName} onChange={set('requestorName')}
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40">
              <option value="">{masterData.loading ? 'Loading customers...' : 'Select customer / shipper'}</option>
              {customerOptions.map(item => <option key={`${item.type}-${item.code}`} value={masterValue(item)}>{masterLabel(item)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Origin</label>
            <select value={form.origin} onChange={set('origin')}
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40">
              <option value="">Select origin</option>
              {locationOptions.map(item => <option key={`origin-${item.type}-${item.code}`} value={masterValue(item)}>{masterLabel(item)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Destination</label>
            <select value={form.destination} onChange={set('destination')}
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40">
              <option value="">Select destination</option>
              {locationOptions.map(item => <option key={`destination-${item.type}-${item.code}`} value={masterValue(item)}>{masterLabel(item)}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Cargo Description</label>
            <textarea value={form.cargo} onChange={set('cargo')} rows={2} placeholder="What is being transported?"
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40" />
          </div>
          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Service Type</label>
            <select value={form.shipmentType} onChange={set('shipmentType')}
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40">
              <option value="">Select service type</option>
              {(serviceTypeOptions.length ? serviceTypeOptions : fallbackServiceTypes).map(item => (
                <option key={`${item.type}-${item.code}`} value={item.code}>{masterLabel(item)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Pickup Ready</label>
            <input type="datetime-local" value={form.pickupWindowFrom} onChange={set('pickupWindowFrom')}
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40" />
          </div>
          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Pickup Deadline</label>
            <input type="datetime-local" value={form.pickupWindowTo} onChange={set('pickupWindowTo')}
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40" />
          </div>
          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Delivery ETA</label>
            <input type="datetime-local" value={form.deliveryWindowFrom} onChange={set('deliveryWindowFrom')}
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40" />
          </div>
          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Delivery Deadline</label>
            <input type="datetime-local" value={form.deliveryWindowTo} onChange={set('deliveryWindowTo')}
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40" />
          </div>
        </div>

        {masterData.error && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2.5 text-amber-200 text-xs">{masterData.error}</div>
        )}
        <ShipmentValidationSummary result={validation.result} validating={validation.validating} />

        {apiError && (
          <LogisticsMessage
            type="error"
            title="Shipment validation failed"
            message={apiError.message}
            issues={apiError.issues}
            warnings={apiError.warnings}
          />
        )}

        {!apiError && error && (
          <LogisticsMessage type="error" title="Shipment creation failed" message={error} />
        )}

        {false && error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5 text-red-400 text-xs">⚠️ {error}</div>
        )}
        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-300 text-sm hover:bg-slate-800 transition-colors">
            Cancel
          </button>
          <button onClick={handleCreate} disabled={saving || !validation.result.ok}
            className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm transition-colors disabled:opacity-40">
            {saving ? 'Creating…' : '➕ Create Trip'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Booking Card ──────────────────────────────────────────────────────────────

function BookingCard({
  booking,
  onTransition,
  onAssign,
  onViewHistory,
  transitioning,
}: {
  booking: Booking;
  onTransition: (id: string, status: StageKey) => void;
  onAssign: (booking: Booking, target: StageKey) => void;
  onViewHistory: (id: string) => void;
  transitioning: boolean;
}) {
  const notes   = parseNotes(booking.notes);
  const rawStatus = booking.status ?? 'PENDING';
  const displayStatus = resolveDisplayStatus(rawStatus);
  const stage   = STAGE_MAP[displayStatus];
  const nextStageKey = stage?.nextStatus;
  const nextStage    = nextStageKey ? STAGE_MAP[nextStageKey] : null;

  // Determine if next transition needs a modal (ASSIGNED requires vehicle+driver)
  const needsModal = (nextStageKey === 'ASSIGNED' || nextStageKey === 'DISPATCHED') && !notes.driverId;

  return (
    <div className={`border border-white/10 hover:border-white/20 rounded-xl p-3.5 space-y-2 transition-all ${stage?.bg ?? 'bg-slate-900/80'}`}>
      {/* Ref + date */}
      <div className="flex items-start justify-between gap-1">
        <span className="font-mono text-xs text-white font-semibold truncate">
          {booking.bookingRef ?? booking.id.slice(0, 8)}
        </span>
        <span className="text-xs text-slate-600 flex-shrink-0">
          {booking.startDate ? new Date(booking.startDate).toLocaleDateString('en-AE', { day: '2-digit', month: 'short' }) : '—'}
        </span>
      </div>

      {/* Shipment type badge */}
      {notes.shipmentType && (
        <span className="inline-block px-1.5 py-0.5 rounded text-xs font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20">
          {notes.shipmentType}
        </span>
      )}

      {/* Route */}
      {(notes.origin || notes.destination) && (
        <div className="text-xs leading-relaxed">
          {notes.origin && <p className="text-emerald-400 truncate">↑ {notes.origin}</p>}
          {notes.destination && <p className="text-red-400 truncate">↓ {notes.destination}</p>}
        </div>
      )}

      {/* Customer */}
      {booking.requestorName && (
        <p className="text-xs text-slate-500 truncate">👤 {booking.requestorName}</p>
      )}

      {/* Assigned */}
      {(notes.vehiclePlate || notes.driverName) && (
        <div className="text-xs space-y-0.5">
          {notes.vehiclePlate && <p className="text-amber-400">🚛 {notes.vehiclePlate}</p>}
          {notes.driverName   && <p className="text-blue-400">🤵 {notes.driverName}</p>}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-1.5 pt-1">
        {/* Next stage button */}
        {nextStage && (
          <button
            disabled={transitioning}
            onClick={() => needsModal ? onAssign(booking, nextStageKey!) : onTransition(booking.id, nextStageKey!)}
            className={`flex-1 text-xs border rounded-lg py-1.5 font-medium transition-colors disabled:opacity-40
              ${nextStage.headerBg} ${nextStage.color} hover:brightness-125`}>
            {nextStage.icon} {stage?.nextLabel ?? nextStageKey}
          </button>
        )}
        {/* ePOD quick link for DELIVERED status */}
        {displayStatus === 'DELIVERED' && (
          <Link href={`/logistics/trips/${booking.id}/pod`}
            className="flex-1 text-xs border rounded-lg py-1.5 font-medium text-center
              bg-teal-500/10 border-teal-500/30 text-teal-400 hover:bg-teal-500/20 transition-colors">
            📝 POD
          </Link>
        )}
        {/* Cancel */}
        {(displayStatus === 'PENDING' || displayStatus === 'APPROVED' || displayStatus === 'ASSIGNED') && (
          <button
            disabled={transitioning}
            onClick={() => onTransition(booking.id, 'CANCELLED')}
            className="text-xs text-red-500 hover:text-red-400 px-1.5 disabled:opacity-40 transition-colors"
            title="Cancel trip">✕</button>
        )}
        {/* Documents */}
        <Link href={`/logistics/trips/${booking.id}/documents`}
          className="text-xs text-slate-600 hover:text-slate-400 px-1.5 transition-colors"
          title="View documents">📎</Link>
        {/* Manifest */}
        <Link href={`/logistics/trips/${booking.id}/manifest`}
          className="text-xs text-slate-600 hover:text-slate-400 px-1.5 transition-colors"
          title="Cargo manifest">📋</Link>
        {/* History */}
        <button
          onClick={() => onViewHistory(booking.id)}
          className="text-xs text-slate-600 hover:text-slate-400 px-1.5 transition-colors"
          title="View timeline">⏱</button>
      </div>
    </div>
  );
}

// ── SLA Alert Banner ──────────────────────────────────────────────────────────

interface SlaAlert {
  id: string; bookingRef: string | null; tier: 'WARNING' | 'BREACHED' | 'CRITICAL';
  hoursLate: number; customerName: string | null; deadline: string;
}

function SlaAlertBanner() {
  const [alerts, setAlerts]   = useState<SlaAlert[]>([]);
  const [open,   setOpen]     = useState(false);

  useEffect(() => {
    const load = () =>
      fetch('/api/logistics/sla').then(r => r.ok ? r.json() : null)
        .then(d => d?.alerts && setAlerts(d.alerts)).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  if (!alerts.length) return null;

  const critical = alerts.filter(a => a.tier === 'CRITICAL').length;
  const breached = alerts.filter(a => a.tier === 'BREACHED').length;
  const warning  = alerts.filter(a => a.tier === 'WARNING').length;

  return (
    <div className={`rounded-xl border px-4 py-3 ${
      critical > 0 ? 'bg-red-500/10 border-red-500/30 text-red-400'
      : breached > 0 ? 'bg-orange-500/10 border-orange-500/30 text-orange-400'
      : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-sm font-medium">
          <span>{critical > 0 ? '🚨' : breached > 0 ? '⚠️' : '⏰'}</span>
          <span>
            SLA Alerts:
            {critical > 0 && <span className="ml-2 text-red-400 font-bold">{critical} Critical</span>}
            {breached > 0 && <span className="ml-2 text-orange-400">{breached} Breached</span>}
            {warning  > 0 && <span className="ml-2 text-amber-400">{warning} Warning</span>}
          </span>
        </div>
        <button onClick={() => setOpen(o => !o)} className="text-xs opacity-70 hover:opacity-100 transition-opacity">
          {open ? 'Hide ▲' : 'Show ▼'}
        </button>
      </div>
      {open && (
        <div className="mt-3 space-y-2">
          {alerts.map(a => (
            <div key={a.id} className={`text-xs flex items-center justify-between gap-2 px-3 py-2 rounded-lg border ${
              a.tier === 'CRITICAL' ? 'border-red-500/20 bg-red-500/5'
              : a.tier === 'BREACHED' ? 'border-orange-500/20 bg-orange-500/5'
              : 'border-amber-500/20 bg-amber-500/5'
            }`}>
              <span className="font-mono text-white">{a.bookingRef ?? a.id.slice(0, 8)}</span>
              <span>{a.customerName ?? '—'}</span>
              <span>Due: {new Date(a.deadline).toLocaleDateString('en-AE')}</span>
              <span className={`font-semibold ${a.tier === 'CRITICAL' ? 'text-red-400' : a.tier === 'BREACHED' ? 'text-orange-400' : 'text-amber-400'}`}>
                {a.hoursLate > 0 ? `+${a.hoursLate}h late` : `Due in ${Math.abs(a.hoursLate)}h`}
              </span>
              <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${
                a.tier === 'CRITICAL' ? 'border-red-500/30 text-red-400'
                : a.tier === 'BREACHED' ? 'border-orange-500/30 text-orange-400'
                : 'border-amber-500/30 text-amber-400'
              }`}>{a.tier}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Dispatch Board ────────────────────────────────────────────────────────────

type PhaseFilter = 'all' | 'pre' | 'transit' | 'done';

export default function LogisticsDispatchPage() {
  const [bookings,       setBookings]       = useState<Booking[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [assignTarget,   setAssignTarget]   = useState<{ booking: Booking; next: StageKey } | null>(null);
  const [showNewTrip,    setShowNewTrip]    = useState(false);
  const [historyId,      setHistoryId]      = useState<string | null>(null);
  const [transitioning,  setTransitioning]  = useState<string | null>(null);
  const [lastRefresh,    setLastRefresh]    = useState<Date>(new Date());
  const [phase,          setPhase]          = useState<PhaseFilter>('all');
  const [loadError,      setLoadError]      = useState<string | null>(null);

  // withBackfill: only the FIRST load reconciles legacy bookings into shipment
  // orders (an expensive, write-heavy pass). The 30s polls skip it so they stay
  // fast and reliable. Re-running the backfill on every poll made the board's
  // GET time out under DB latency — and because the old code swallowed the
  // error silently, a freshly-created trip simply never appeared with no hint
  // as to why. That was the "New Trip not reflecting on the Dispatch Board" bug.
  const load = useCallback(async (withBackfill = false) => {
    try {
      const url = `/api/logistics/shipments?view=booking&limit=500${withBackfill ? '' : '&autoBackfill=false'}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        setLoadError(`Couldn’t refresh the board (server returned ${res.status}). Showing the last loaded data — retrying shortly.`);
        return;
      }
      const data = await res.json();
      setBookings(Array.isArray(data) ? data : data.data ?? []);
      setLoadError(null);
      setLastRefresh(new Date());
    } catch {
      setLoadError('Couldn’t reach the server to refresh the board. Showing the last loaded data — retrying shortly.');
    }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load(true);                                   // first load reconciles legacy bookings
    const t = setInterval(() => load(false), 30_000);  // polls skip the heavy backfill
    return () => clearInterval(t);
  }, [load]);

  const handleTransition = async (id: string, status: StageKey) => {
    setTransitioning(id);
    try {
      await fetch(`/api/logistics/trips/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, changedBy: 'Dispatcher' }),
      });
      await load();
    } catch { /* silent */ }
    finally { setTransitioning(null); }
  };

  // Visible stages based on phase filter
  const visibleStages = STAGES.filter(s => {
    if (s.status === 'CANCELLED') return false; // show separately
    if (phase === 'all')     return true;
    if (phase === 'pre')     return s.phase === 'pre';
    if (phase === 'transit') return s.phase === 'transit';
    if (phase === 'done')    return s.phase === 'done';
    return true;
  });

  // Map each booking to its display column
  const getColumn = (b: Booking) => resolveDisplayStatus(b.status ?? 'PENDING');

  const cols = visibleStages.map(stage => ({
    ...stage,
    items: bookings.filter(b => getColumn(b) === stage.status),
  }));

  const cancelledItems = bookings.filter(b => b.status === 'CANCELLED');
  const inTransit = bookings.filter(b => {
    const d = resolveDisplayStatus(b.status ?? '');
    return ['DISPATCHED','ENROUTE_PICKUP','LOADED','ENROUTE_DELIVERY'].includes(d);
  }).length;

  return (
    <>
      {assignTarget && (
        <AssignModal
          booking={assignTarget.booking}
          targetStatus={assignTarget.next}
          onClose={() => setAssignTarget(null)}
          onDone={load}
        />
      )}
      {showNewTrip && (
        <NewTripModal onClose={() => setShowNewTrip(false)} onCreated={load} />
      )}
      {historyId && (
        <StatusTimeline bookingId={historyId} onClose={() => setHistoryId(null)} />
      )}

      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Dispatch Board</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              10-stage trip lifecycle · Refreshed {lastRefresh.toLocaleTimeString()}
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {inTransit > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full animate-pulse">
                🚛 {inTransit} In Transit
              </div>
            )}
            <button onClick={() => setShowNewTrip(true)}
              className="bg-amber-500 hover:bg-amber-400 text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors">
              ➕ New Trip
            </button>
          </div>
        </div>

        {/* Load-error banner — surfaces a failed refresh instead of silently
            showing stale data (which is how a freshly-created trip used to
            appear "missing"). */}
        {loadError && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-300">
            <span>⚠️ {loadError}</span>
            <button onClick={() => load(false)}
              className="whitespace-nowrap rounded-lg border border-amber-500/40 px-3 py-1 text-xs font-medium text-amber-200 hover:bg-amber-500/20">
              Retry now
            </button>
          </div>
        )}

        {/* SLA Alert Banner */}
        <SlaAlertBanner />

        {/* Phase filter tabs */}
        <div className="flex items-center gap-2 flex-wrap">
          {(['all','pre','transit','done'] as PhaseFilter[]).map(p => {
            const labels: Record<PhaseFilter, string> = {
              all:     'All Stages',
              pre:     '📋 Pre-Dispatch',
              transit: '🚛 In Transit',
              done:    '✅ Completed',
            };
            const counts: Record<PhaseFilter, number> = {
              all:     bookings.length,
              pre:     bookings.filter(b => ['PENDING','APPROVED','ASSIGNED','CONFIRMED'].includes(b.status ?? '')).length,
              transit: bookings.filter(b => ['DISPATCHED','ENROUTE_PICKUP','LOADED','ENROUTE_DELIVERY','ACTIVE'].includes(b.status ?? '')).length,
              done:    bookings.filter(b => ['DELIVERED','POD_SUBMITTED','CLOSED','COMPLETED'].includes(b.status ?? '')).length,
            };
            return (
              <button key={p} onClick={() => setPhase(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  phase === p
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                    : 'text-slate-400 border-white/10 hover:border-white/20 hover:text-white'
                }`}>
                {labels[p]} <span className="ml-1 opacity-60">{counts[p]}</span>
              </button>
            );
          })}
          {cancelledItems.length > 0 && (
            <span className="ml-auto text-xs text-red-400 opacity-60">
              {cancelledItems.length} cancelled
            </span>
          )}
        </div>

        {/* Phase group labels */}
        {phase === 'all' && (
          <div className="flex gap-4 text-xs text-slate-600 border-b border-white/5 pb-2">
            {Object.entries(PHASE_LABELS).filter(([k]) => k !== 'terminal').map(([, v]) => (
              <span key={v.label} className={v.color}>{v.label}</span>
            ))}
          </div>
        )}

        {/* Kanban */}
        {loading ? (
          <div className="flex gap-4 overflow-x-auto pb-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex-shrink-0 w-52 space-y-3">
                <div className="h-8 bg-slate-800/60 rounded-xl animate-pulse" />
                {[...Array(2)].map((__, j) => <div key={j} className="h-28 bg-slate-800/60 rounded-xl animate-pulse" />)}
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto pb-4">
            <div className="flex gap-3 items-start" style={{ minWidth: `${visibleStages.length * 220}px` }}>
              {cols.map(col => (
                <div key={col.status} className="flex-shrink-0 w-52">
                  {/* Column header */}
                  <div className={`flex items-center justify-between px-3 py-2 rounded-xl border mb-3 ${col.headerBg}`}>
                    <span className={`text-xs font-semibold ${col.color}`}>{col.icon} {col.label}</span>
                    <span className={`text-xs font-bold ${col.color} bg-black/20 rounded-full px-1.5 py-0.5`}>
                      {col.items.length}
                    </span>
                  </div>
                  {/* Cards */}
                  <div className="space-y-2.5 min-h-[120px]">
                    {col.items.length === 0 ? (
                      <div className="border border-dashed border-white/5 rounded-xl p-5 text-center">
                        <p className="text-slate-700 text-xs">Empty</p>
                      </div>
                    ) : (
                      col.items.map(b => (
                        <BookingCard
                          key={b.id}
                          booking={b}
                          onTransition={handleTransition}
                          onAssign={(booking, next) => setAssignTarget({ booking, next })}
                          onViewHistory={setHistoryId}
                          transitioning={transitioning === b.id}
                        />
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
