'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  ShipmentValidationSummary,
  combineMasterOptions,
  masterLabel,
  masterValue,
  useLogisticsMasterData,
  useShipmentValidation,
  validateShipmentPayload,
  type LogisticsMasterDataItem,
} from '@/components/logistics/master-data-fields';

interface Trip {
  id: string;
  bookingRef: string;
  status: string;
  serviceType: string;
  startDate: string | null;
  endDate: string | null;
  requestorName: string | null;
  notes?: string | null;
}

type ShipmentDetail = {
  id: string;
  shipmentNo: string;
  cargoOwnerCustomerId: string | null;
  cargoOwnerName: string | null;
  cargoOwnerEmail: string | null;
  cargoOwnerPhone: string | null;
  shipmentType: string | null;
  status: string;
  priority: string | null;
  originName: string | null;
  originAddress: string | null;
  destinationName: string | null;
  destinationAddress: string | null;
  pickupWindowFrom: string | null;
  pickupWindowTo: string | null;
  deliveryWindowFrom: string | null;
  deliveryWindowTo: string | null;
  requestedVehicleType: string | null;
};

type ShipmentEditForm = {
  cargoOwnerName: string;
  cargoOwnerEmail: string;
  cargoOwnerPhone: string;
  shipmentType: string;
  requestedVehicleType: string;
  status: string;
  priority: string;
  originName: string;
  destinationName: string;
  pickupWindowFrom: string;
  pickupWindowTo: string;
  deliveryWindowFrom: string;
  deliveryWindowTo: string;
};

// Full 10-stage badge map + legacy statuses
const STATUS_BADGE: Record<string, string> = {
  PENDING:          'bg-amber-500/20 text-amber-400 border-amber-500/30',
  APPROVED:         'bg-sky-500/20 text-sky-400 border-sky-500/30',
  CONFIRMED:        'bg-sky-500/20 text-sky-400 border-sky-500/30',
  ASSIGNED:         'bg-violet-500/20 text-violet-400 border-violet-500/30',
  DISPATCHED:       'bg-orange-500/20 text-orange-400 border-orange-500/30',
  ENROUTE_PICKUP:   'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  LOADED:           'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  ENROUTE_DELIVERY: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  ACTIVE:           'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  DELIVERED:        'bg-teal-500/20 text-teal-400 border-teal-500/30',
  POD_SUBMITTED:    'bg-green-500/20 text-green-400 border-green-500/30',
  CLOSED:           'bg-slate-500/20 text-slate-400 border-slate-500/30',
  COMPLETED:        'bg-slate-500/20 text-slate-400 border-slate-500/30',
  CANCELLED:        'bg-red-500/20 text-red-400 border-red-500/30',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Created', APPROVED: 'Approved', CONFIRMED: 'Approved',
  ASSIGNED: 'Assigned', DISPATCHED: 'Dispatched',
  ENROUTE_PICKUP: 'En-route Pickup', LOADED: 'Loaded',
  ENROUTE_DELIVERY: 'En-route Delivery', ACTIVE: 'En-route Delivery',
  DELIVERED: 'Delivered', POD_SUBMITTED: 'POD Submitted',
  CLOSED: 'Closed', COMPLETED: 'Closed', CANCELLED: 'Cancelled',
};

const ALL_STATUSES = [
  'ALL', 'PENDING', 'APPROVED', 'ASSIGNED', 'DISPATCHED',
  'ENROUTE_PICKUP', 'LOADED', 'ENROUTE_DELIVERY', 'DELIVERED',
  'POD_SUBMITTED', 'CLOSED', 'CANCELLED',
];

// Group tabs for cleaner UI
const TAB_GROUPS = [
  { key: 'ALL',        label: 'All' },
  { key: 'ACTIVE_ALL', label: '🚛 In Progress' },
  { key: 'DONE_ALL',   label: '✅ Completed' },
  { key: 'CANCELLED',  label: '❌ Cancelled' },
];

const ACTIVE_STATUSES  = new Set(['PENDING','APPROVED','CONFIRMED','ASSIGNED','DISPATCHED','ENROUTE_PICKUP','LOADED','ENROUTE_DELIVERY','ACTIVE']);
const DONE_STATUSES    = new Set(['DELIVERED','POD_SUBMITTED','CLOSED','COMPLETED']);

function parseNotes(notes: string | null | undefined) {
  if (!notes) return {};
  try { return JSON.parse(notes); } catch { return {}; }
}

function toDateTimeInput(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function toIsoOrNull(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function hydrateEditForm(shipment: ShipmentDetail): ShipmentEditForm {
  return {
    cargoOwnerName: shipment.cargoOwnerName ?? '',
    cargoOwnerEmail: shipment.cargoOwnerEmail ?? '',
    cargoOwnerPhone: shipment.cargoOwnerPhone ?? '',
    shipmentType: shipment.shipmentType ?? '',
    requestedVehicleType: shipment.requestedVehicleType ?? '',
    status: shipment.status ?? 'PENDING',
    priority: shipment.priority ?? 'NORMAL',
    originName: shipment.originName ?? shipment.originAddress ?? '',
    destinationName: shipment.destinationName ?? shipment.destinationAddress ?? '',
    pickupWindowFrom: toDateTimeInput(shipment.pickupWindowFrom),
    pickupWindowTo: toDateTimeInput(shipment.pickupWindowTo),
    deliveryWindowFrom: toDateTimeInput(shipment.deliveryWindowFrom),
    deliveryWindowTo: toDateTimeInput(shipment.deliveryWindowTo),
  };
}

function findMasterByLabel(items: LogisticsMasterDataItem[], value: string) {
  return items.find(item => masterValue(item) === value || item.code === value || item.label === value) ?? null;
}

export default function LogisticsTripsPage() {
  const [trips,     setTrips]     = useState<Trip[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [activeTab, setActiveTab] = useState('ALL');
  const [search,    setSearch]    = useState('');
  const [selectedShipment, setSelectedShipment] = useState<ShipmentDetail | null>(null);
  const [editForm, setEditForm] = useState<ShipmentEditForm | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [editNotice, setEditNotice] = useState('');

  const masterData = useLogisticsMasterData(['CUSTOMER', 'SHIPPER', 'PICKUP_LOCATION', 'AIRPORT', 'COUNTRY', 'SERVICE_TYPE']);
  const customerOptions = useMemo(
    () => combineMasterOptions(masterData.optionsFor('CUSTOMER'), masterData.optionsFor('SHIPPER')),
    [masterData],
  );
  const locationOptions = useMemo(
    () => combineMasterOptions(masterData.optionsFor('PICKUP_LOCATION'), masterData.optionsFor('AIRPORT'), masterData.optionsFor('COUNTRY')),
    [masterData],
  );
  const serviceTypeOptions = masterData.optionsFor('SERVICE_TYPE');
  const shipmentEditPayload = useMemo(() => {
    if (!editForm) return null;
    return {
      cargoOwnerName: editForm.cargoOwnerName,
      shipmentType: editForm.shipmentType,
      originName: editForm.originName,
      destinationName: editForm.destinationName,
      pickupWindowFrom: toIsoOrNull(editForm.pickupWindowFrom),
      pickupWindowTo: toIsoOrNull(editForm.pickupWindowTo),
      deliveryWindowFrom: toIsoOrNull(editForm.deliveryWindowFrom),
      deliveryWindowTo: toIsoOrNull(editForm.deliveryWindowTo),
      stops: [
        {
          stopType: 'PICKUP',
          sequenceNo: 1,
          locationName: editForm.originName,
          plannedArrivalAt: toIsoOrNull(editForm.pickupWindowFrom),
          plannedDepartAt: toIsoOrNull(editForm.pickupWindowTo),
        },
        {
          stopType: 'DELIVERY',
          sequenceNo: 2,
          locationName: editForm.destinationName,
          plannedArrivalAt: toIsoOrNull(editForm.deliveryWindowFrom),
          plannedDepartAt: toIsoOrNull(editForm.deliveryWindowTo),
        },
      ],
    };
  }, [editForm]);
  const shipmentValidation = useShipmentValidation(shipmentEditPayload, masterData.tenantId);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/logistics/shipments?view=booking&limit=500', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setTrips(Array.isArray(data) ? data : data.data ?? []);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openShipmentEdit = async (trip: Trip) => {
    const notes = parseNotes(trip.notes) as { shipmentId?: string };
    const shipmentId = notes.shipmentId ?? trip.id;
    setEditLoading(true);
    setEditError('');
    setEditNotice('');
    try {
      const params = masterData.tenantId ? `?tenantId=${encodeURIComponent(masterData.tenantId)}` : '';
      const res = await fetch(`/api/logistics/shipments/${shipmentId}${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const shipment = data.shipment as ShipmentDetail;
      setSelectedShipment(shipment);
      setEditForm(hydrateEditForm(shipment));
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to load shipment detail');
    } finally {
      setEditLoading(false);
    }
  };

  const saveShipmentEdit = async () => {
    if (!selectedShipment || !editForm || !shipmentEditPayload) return;
    setEditSaving(true);
    setEditError('');
    setEditNotice('');
    try {
      const validation = await validateShipmentPayload(shipmentEditPayload, masterData.tenantId);
      if (!validation.ok) {
        setEditError(validation.issues.join(' '));
        return;
      }
      const selectedCustomer = findMasterByLabel(customerOptions, editForm.cargoOwnerName);
      const selectedOrigin = findMasterByLabel(locationOptions, editForm.originName);
      const selectedDestination = findMasterByLabel(locationOptions, editForm.destinationName);
      const params = masterData.tenantId ? `?tenantId=${encodeURIComponent(masterData.tenantId)}` : '';
      const res = await fetch(`/api/logistics/shipments/${selectedShipment.id}${params}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cargoOwnerCustomerId: selectedCustomer?.id ?? selectedShipment.cargoOwnerCustomerId,
          cargoOwnerName: editForm.cargoOwnerName,
          cargoOwnerEmail: editForm.cargoOwnerEmail || null,
          cargoOwnerPhone: editForm.cargoOwnerPhone || null,
          shipmentType: editForm.shipmentType || null,
          requestedVehicleType: editForm.requestedVehicleType || null,
          status: editForm.status,
          priority: editForm.priority,
          originName: editForm.originName,
          originAddress: selectedOrigin?.description ?? selectedShipment.originAddress,
          destinationName: editForm.destinationName,
          destinationAddress: selectedDestination?.description ?? selectedShipment.destinationAddress,
          pickupWindowFrom: toIsoOrNull(editForm.pickupWindowFrom),
          pickupWindowTo: toIsoOrNull(editForm.pickupWindowTo),
          deliveryWindowFrom: toIsoOrNull(editForm.deliveryWindowFrom),
          deliveryWindowTo: toIsoOrNull(editForm.deliveryWindowTo),
          stops: shipmentEditPayload.stops,
          metadata: {
            source: 'trips-detail-edit',
            masterDataGoverned: true,
            selectedCustomerCode: selectedCustomer?.code ?? null,
            originCode: selectedOrigin?.code ?? null,
            destinationCode: selectedDestination?.code ?? null,
          },
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const shipment = data.shipment as ShipmentDetail;
      setSelectedShipment(shipment);
      setEditForm(hydrateEditForm(shipment));
      setEditNotice('Shipment saved through governed master data.');
      await load();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save shipment');
    } finally {
      setEditSaving(false);
    }
  };

  const filtered = trips.filter(t => {
    const matchTab = activeTab === 'ALL'        ? true
                   : activeTab === 'ACTIVE_ALL'  ? ACTIVE_STATUSES.has(t.status)
                   : activeTab === 'DONE_ALL'    ? DONE_STATUSES.has(t.status)
                   : t.status === activeTab;
    const notes = parseNotes(t.notes);
    const origin = typeof notes.origin === 'string' ? notes.origin : null;
    const destination = typeof notes.destination === 'string' ? notes.destination : null;
    const matchSearch = !search || [t.bookingRef, t.requestorName, origin, destination]
      .some(v => v?.toLowerCase().includes(search.toLowerCase()));
    return matchTab && matchSearch;
  });

  const tabCounts = {
    ALL:        trips.length,
    ACTIVE_ALL: trips.filter(t => ACTIVE_STATUSES.has(t.status)).length,
    DONE_ALL:   trips.filter(t => DONE_STATUSES.has(t.status)).length,
    CANCELLED:  trips.filter(t => t.status === 'CANCELLED').length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Trips &amp; Dispatch</h1>
          <p className="text-slate-400 text-sm mt-0.5">Full 10-stage logistics lifecycle</p>
        </div>
        <Link href="/logistics/dispatch"
          className="bg-amber-500 hover:bg-amber-400 text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors">
          🚦 Dispatch Board
        </Link>
      </div>

      {/* Group tabs */}
      <div className="flex gap-2 flex-wrap">
        {TAB_GROUPS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              activeTab === tab.key
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                : 'text-slate-400 border-white/10 hover:border-white/20 hover:text-white'
            }`}>
            {tab.label} <span className="ml-1 opacity-60">{tabCounts[tab.key as keyof typeof tabCounts] ?? ''}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search by booking ref, customer, origin, destination…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40"
      />

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-slate-800/60 rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-16 text-center">
          <div className="text-5xl mb-3">🚛</div>
          <p className="text-slate-400">No logistics trips found</p>
          <p className="text-slate-600 text-xs mt-1">Bookings with service_type = LOGISTICS appear here</p>
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-3">Ref</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-left px-5 py-3">Type</th>
                <th className="text-left px-5 py-3">Route</th>
                <th className="text-left px-5 py-3">Customer</th>
                <th className="text-left px-5 py-3">Start</th>
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(trip => {
                const notes = parseNotes(trip.notes);
                const origin = typeof notes.origin === 'string' ? notes.origin : null;
                const destination = typeof notes.destination === 'string' ? notes.destination : null;
                const shipmentType = typeof notes.shipmentType === 'string' ? notes.shipmentType : null;
                return (
                  <tr key={trip.id} className="border-b border-white/5 last:border-0 hover:bg-slate-800/40 transition-colors">
                    <td className="px-5 py-3 font-mono text-xs text-white">{trip.bookingRef}</td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_BADGE[trip.status] ?? STATUS_BADGE.PENDING}`}>
                        {STATUS_LABEL[trip.status] ?? trip.status}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {shipmentType ? (
                        <span className="px-1.5 py-0.5 rounded text-xs font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20">
                          {shipmentType}
                        </span>
                      ) : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-5 py-3 text-slate-300 max-w-xs truncate">
                      {origin && destination
                        ? `${origin} → ${destination}`
                        : origin ?? destination ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-300">{trip.requestorName ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-400 text-xs">
                      {trip.startDate ? new Date(trip.startDate).toLocaleDateString('en-AE') : '—'}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => openShipmentEdit(trip)}
                          className="text-xs font-semibold text-emerald-400 transition-colors hover:text-emerald-300"
                        >
                          Edit
                        </button>
                        <Link href={`/track/${encodeURIComponent(trip.bookingRef)}`} target="_blank"
                          className="text-xs text-slate-500 hover:text-slate-300 transition-colors" title="Customer tracker">
                          🔗 Track
                        </Link>
                        <Link href={`/logistics/trips/${trip.id}/documents`}
                          className="text-xs text-slate-500 hover:text-slate-300 transition-colors" title="Documents">
                          📎
                        </Link>
                        <Link href={`/logistics/trips/${trip.id}/manifest`}
                          className="text-xs text-slate-500 hover:text-slate-300 transition-colors" title="Cargo manifest">
                          📋
                        </Link>
                        <Link href={`/logistics/dispatch`}
                          className="text-xs text-amber-400 hover:text-amber-300 transition-colors">
                          Board →
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(selectedShipment || editLoading || editError) && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
          <div className="h-full w-full max-w-2xl overflow-y-auto border-l border-white/10 bg-slate-950 shadow-2xl">
            <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/95 px-6 py-5 backdrop-blur">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">Governed shipment detail</p>
                  <h2 className="mt-1 text-xl font-bold text-white">
                    {selectedShipment?.shipmentNo ?? 'Loading shipment'}
                  </h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Edit master-data-backed shipment fields with timeline validation.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setSelectedShipment(null);
                    setEditForm(null);
                    setEditError('');
                    setEditNotice('');
                  }}
                  className="rounded-xl border border-white/10 px-3 py-2 text-sm font-bold text-slate-200 hover:bg-white/5"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="space-y-5 p-6">
              {editLoading && (
                <div className="rounded-2xl border border-white/10 bg-slate-900 p-8 text-center text-sm font-semibold text-slate-300">
                  Loading shipment detail...
                </div>
              )}
              {editError && (
                <div className="rounded-2xl border border-rose-300 bg-rose-100 px-4 py-3 text-sm font-semibold text-rose-950">
                  {editError}
                </div>
              )}
              {editNotice && (
                <div className="rounded-2xl border border-emerald-300 bg-emerald-100 px-4 py-3 text-sm font-semibold text-emerald-950">
                  {editNotice}
                </div>
              )}

              {editForm && (
                <>
                  {masterData.error && (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-950">
                      {masterData.error}
                    </div>
                  )}

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-1.5">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Customer / Shipper</span>
                      <select
                        value={editForm.cargoOwnerName}
                        onChange={e => setEditForm(form => form && { ...form, cargoOwnerName: e.target.value })}
                        className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-emerald-400"
                      >
                        <option value="">Select customer / shipper</option>
                        {customerOptions.map(item => (
                          <option key={`${item.type}:${item.id}`} value={masterValue(item)}>{masterLabel(item)}</option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Service Type</span>
                      <select
                        value={editForm.shipmentType}
                        onChange={e => setEditForm(form => form && { ...form, shipmentType: e.target.value })}
                        className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-emerald-400"
                      >
                        <option value="">Select service type</option>
                        {serviceTypeOptions.map(item => (
                          <option key={item.id} value={item.code}>{masterLabel(item)}</option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Origin</span>
                      <select
                        value={editForm.originName}
                        onChange={e => setEditForm(form => form && { ...form, originName: e.target.value })}
                        className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-emerald-400"
                      >
                        <option value="">Select origin</option>
                        {locationOptions.map(item => (
                          <option key={`${item.type}:${item.id}:origin`} value={masterValue(item)}>{masterLabel(item)}</option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Destination</span>
                      <select
                        value={editForm.destinationName}
                        onChange={e => setEditForm(form => form && { ...form, destinationName: e.target.value })}
                        className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-emerald-400"
                      >
                        <option value="">Select destination</option>
                        {locationOptions.map(item => (
                          <option key={`${item.type}:${item.id}:destination`} value={masterValue(item)}>{masterLabel(item)}</option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Pickup Ready</span>
                      <input
                        type="datetime-local"
                        value={editForm.pickupWindowFrom}
                        onChange={e => setEditForm(form => form && { ...form, pickupWindowFrom: e.target.value })}
                        className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-emerald-400"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Pickup Deadline</span>
                      <input
                        type="datetime-local"
                        value={editForm.pickupWindowTo}
                        onChange={e => setEditForm(form => form && { ...form, pickupWindowTo: e.target.value })}
                        className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-emerald-400"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Delivery ETA</span>
                      <input
                        type="datetime-local"
                        value={editForm.deliveryWindowFrom}
                        onChange={e => setEditForm(form => form && { ...form, deliveryWindowFrom: e.target.value })}
                        className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-emerald-400"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Delivery Deadline</span>
                      <input
                        type="datetime-local"
                        value={editForm.deliveryWindowTo}
                        onChange={e => setEditForm(form => form && { ...form, deliveryWindowTo: e.target.value })}
                        className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-emerald-400"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Vehicle Type</span>
                      <input
                        value={editForm.requestedVehicleType}
                        onChange={e => setEditForm(form => form && { ...form, requestedVehicleType: e.target.value })}
                        className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-emerald-400"
                        placeholder="Truck, reefer, flatbed..."
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Status</span>
                      <select
                        value={editForm.status}
                        onChange={e => setEditForm(form => form && { ...form, status: e.target.value })}
                        className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-emerald-400"
                      >
                        {ALL_STATUSES.filter(status => status !== 'ALL').map(status => (
                          <option key={status} value={status}>{STATUS_LABEL[status] ?? status}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <ShipmentValidationSummary
                    result={shipmentValidation.result}
                    validating={shipmentValidation.validating}
                  />

                  <div className="flex justify-end gap-3 border-t border-white/10 pt-4">
                    <button
                      onClick={() => selectedShipment && setEditForm(hydrateEditForm(selectedShipment))}
                      className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-white/5"
                    >
                      Reset
                    </button>
                    <button
                      onClick={saveShipmentEdit}
                      disabled={editSaving || shipmentValidation.validating || !shipmentValidation.result.ok}
                      className="rounded-xl bg-emerald-100 px-4 py-2 text-sm font-bold text-emerald-950 hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {editSaving ? 'Saving...' : 'Save governed shipment'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
