'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Map as MapIcon, Plus, CheckCircle2, XCircle, MapPin, AlertTriangle, Clock,
} from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';
import FleetDataGrid, { type DataGridColumn, type KpiTile, type FilterChipDef } from '@/components/ui/FleetDataGrid';
import RowActionsMenu, { type RowAction } from '@/components/ui/RowActionsMenu';
import GoogleMapPickerModal, { type PickedLocation } from '@/components/logistics/GoogleMapPickerModal';

/** Existing stop reused across routes — returned by /api/bus-ops/route-stops. */
interface ExistingStop {
  name: string;
  lat: number;
  lng: number;
  landmark: string | null;
  routeName: string;
}

interface RouteStop { id?: string; stopName: string; sequence: number; estimatedArrivalMins?: number; landmark?: string; gpsLat?: number; gpsLng?: number; }
interface BusRoute  {
  id: string; name: string; code?: string | null; origin: string; destination: string; routeType?: string;
  totalDistanceKm?: number; estimatedDurationMins?: number; capacity?: number;
  isActive?: boolean; notes?: string; stops?: RouteStop[];
  direction?: string | null; shiftType?: string | null;
  departureTime?: string | null; expectedArrivalTime?: string | null;
  assignedVehicleId?: string | null; assignedDriverId?: string | null;
  schedules?: any[]; createdAt?: string;
}

interface VehicleOption { id: string; licensePlate?: string | null; make?: string | null; model?: string | null; seatingCapacity?: number | null }
interface DriverOption  { id: string; name: string; licenseType?: string | null }

// ── New Route modal form ───────────────────────────────────────────────────
type NewRouteForm = {
  name: string;
  code: string;
  direction: 'INBOUND' | 'OUTBOUND';
  shiftType: 'MORNING' | 'EVENING' | 'NIGHT' | 'SPLIT';
  routeType: 'STAFF' | 'SCHOOL' | 'BOTH';
  departureTime: string;
  expectedArrivalTime: string;
  capacity: string;
  isActive: boolean;
  assignedVehicleId: string;
  assignedDriverId: string;
};
type NewRouteStop = {
  stopName: string;
  time: string;
  /** GPS coords when the operator picked from map or from an existing stop. */
  gpsLat?: number;
  gpsLng?: number;
  landmark?: string;
};

/**
 * Origin + destination bookend the intermediate stops. On save they become
 * the first/last RouteStop rows so the DB carries their coords (BusRoute
 * itself has no origin_lat/lng columns), while their names populate
 * BusRoute.origin / BusRoute.destination string fields. Same shape the
 * Route Planner uses.
 */
type NewRouteEndpoint = {
  name: string;
  gpsLat?: number;
  gpsLng?: number;
  landmark?: string;
};

/** Which slot the Google map picker is currently editing. */
type MapPickerTarget = 'stop' | 'origin' | 'destination';

const EMPTY_NEW_ROUTE: NewRouteForm = {
  name: '', code: '',
  direction: 'INBOUND', shiftType: 'MORNING', routeType: 'STAFF',
  departureTime: '07:00', expectedArrivalTime: '',
  capacity: '40', isActive: true,
  assignedVehicleId: '', assignedDriverId: '',
};

export default function RoutesPage() {
  const router                        = useRouter();
  const [routes,        setRoutes]    = useState<BusRoute[]>([]);
  const [selected,      setSelected]  = useState<BusRoute | null>(null);
  const [showStops,     setShowStops] = useState(false);
  const [loading,       setLoading]   = useState(true);
  const [saving,        setSaving]    = useState(false);
  const [error,         setError]     = useState('');
  const [stops,         setStops]     = useState<RouteStop[]>([]);
  const [newStop,       setNewStop]   = useState<{ stopName: string; estimatedArrivalMins: string; landmark: string }>({ stopName:'', estimatedArrivalMins:'', landmark:'' });
  const [deletingId,    setDeletingId]    = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<BusRoute | null>(null);

  // New Route modal state
  const [showNewRoute,     setShowNewRoute]     = useState(false);
  const [creating,         setCreating]         = useState(false);
  /** Id of the route being edited. null = create mode. Switching this + opening
   *  the modal replays the form fields from the row so PATCH targets the same
   *  record; on save we branch on editingRouteId to POST vs PATCH. */
  const [editingRouteId,   setEditingRouteId]   = useState<string | null>(null);
  const [newRoute,         setNewRoute]         = useState<NewRouteForm>(EMPTY_NEW_ROUTE);
  const [newRouteStops,    setNewRouteStops]    = useState<NewRouteStop[]>([]);
  const [newStopDraft,     setNewStopDraft]     = useState<NewRouteStop>({ stopName: '', time: '' });
  const [vehicles,         setVehicles]         = useState<VehicleOption[]>([]);
  const [drivers,          setDrivers]          = useState<DriverOption[]>([]);
  const [existingStops,    setExistingStops]    = useState<ExistingStop[]>([]);
  const [mapPickerFor,     setMapPickerFor]     = useState<MapPickerTarget | null>(null);
  const [newRouteOrigin,   setNewRouteOrigin]   = useState<NewRouteEndpoint>({ name: '' });
  const [newRouteDest,     setNewRouteDest]     = useState<NewRouteEndpoint>({ name: '' });

  const loadRoutes = useCallback(async () => {
    setLoading(true);
    try {
      // Bypass browser cache — response carries Cache-Control: private, max-age=30
      // so the browser would serve stale data for up to 30 s after a mutation.
      const res = await fetch('/api/bus-ops/routes', { cache: 'no-store' });
      const data = await res.json();
      setRoutes(Array.isArray(data) ? data : []);
    } catch { setError('Failed to load routes'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadRoutes(); }, [loadRoutes]);

  // Load vehicle + driver options lazily the first time the New Route modal
  // opens — no need to pay for these on the initial page render.
  useEffect(() => {
    if (!showNewRoute) return;
    if (vehicles.length > 0 || drivers.length > 0 || existingStops.length > 0) return;
    void (async () => {
      try {
        const [vRes, dRes, sRes] = await Promise.all([
          fetch('/api/vehicles'),
          fetch('/api/bus-ops/drivers'),
          fetch('/api/bus-ops/route-stops'),
        ]);
        const [vData, dData, sData] = await Promise.all([vRes.json(), dRes.json(), sRes.json()]);
        setVehicles(Array.isArray(vData) ? vData : (vData?.vehicles ?? []));
        setDrivers(Array.isArray(dData) ? dData : []);
        setExistingStops(Array.isArray(sData?.stops) ? sData.stops : []);
      } catch {
        // Non-fatal — the modal renders warning banners when lists are empty.
      }
    })();
  }, [showNewRoute, vehicles.length, drivers.length, existingStops.length]);

  // Pick an existing location from a dropdown → route the pre-fill to the
  // right slot (stop draft / origin / destination) based on `target`.
  const pickExistingFor = (target: MapPickerTarget, key: string) => {
    if (!key) return;
    const [name, lat, lng] = key.split('|');
    const match = existingStops.find(s =>
      s.name === name && s.lat.toFixed(5) === lat && s.lng.toFixed(5) === lng,
    );
    if (!match) return;
    const payload = {
      name: match.name,
      gpsLat: match.lat,
      gpsLng: match.lng,
      landmark: match.landmark ?? undefined,
    };
    if (target === 'stop') {
      setNewStopDraft(prev => ({ ...prev,
        stopName: payload.name, gpsLat: payload.gpsLat, gpsLng: payload.gpsLng, landmark: payload.landmark,
      }));
    } else if (target === 'origin') {
      setNewRouteOrigin(payload);
    } else {
      setNewRouteDest(payload);
    }
  };

  // Map picker returned a location — same target routing.
  const handleMapPick = (loc: PickedLocation) => {
    const name = loc.name || loc.address;
    if (mapPickerFor === 'origin') {
      setNewRouteOrigin(prev => ({ ...prev, name: name || prev.name, gpsLat: loc.lat, gpsLng: loc.lng }));
    } else if (mapPickerFor === 'destination') {
      setNewRouteDest(prev => ({ ...prev, name: name || prev.name, gpsLat: loc.lat, gpsLng: loc.lng }));
    } else {
      setNewStopDraft(prev => ({ ...prev,
        stopName: name || prev.stopName, gpsLat: loc.lat, gpsLng: loc.lng,
      }));
    }
    setMapPickerFor(null);
  };

  const openNewRoute = () => {
    setEditingRouteId(null);
    setNewRoute(EMPTY_NEW_ROUTE);
    setNewRouteStops([]);
    setNewStopDraft({ stopName: '', time: '' });
    setNewRouteOrigin({ name: '' });
    setNewRouteDest({ name: '' });
    setMapPickerFor(null);
    setError('');
    setShowNewRoute(true);
  };

  /**
   * Open the modal in EDIT mode — populate every form field from an existing
   * route, plus split its stops back into { origin, intermediates[], destination }
   * so the modal reads the same way it was authored. On save the modal will
   * PATCH this id (see submitNewRoute).
   */
  const openEditRoute = (r: BusRoute) => {
    setEditingRouteId(r.id);
    setNewRoute({
      name: r.name,
      code: r.code ?? '',
      direction: (r.direction as NewRouteForm['direction']) ?? 'INBOUND',
      shiftType: (r.shiftType as NewRouteForm['shiftType']) ?? 'MORNING',
      routeType: (r.routeType as NewRouteForm['routeType']) ?? 'STAFF',
      departureTime: r.departureTime ?? '07:00',
      expectedArrivalTime: r.expectedArrivalTime ?? '',
      capacity: String(r.capacity ?? 40),
      isActive: r.isActive !== false,
      assignedVehicleId: r.assignedVehicleId ?? '',
      assignedDriverId: r.assignedDriverId ?? '',
    });
    // Stops are stored as [origin(seq=1), ...intermediates, destination(seq=N)].
    // Split back into the modal's three buckets. If the route has ≤1 stop, we
    // treat it as an empty-stops edit and fall back to the route.origin/
    // .destination strings for the endpoint names (coords unknown).
    const sortedStops = (r.stops ?? []).slice().sort((a, b) => a.sequence - b.sequence);
    if (sortedStops.length >= 2) {
      const first = sortedStops[0];
      const last = sortedStops[sortedStops.length - 1];
      const middle = sortedStops.slice(1, -1);
      setNewRouteOrigin({
        name: first.stopName || r.origin,
        gpsLat: first.gpsLat, gpsLng: first.gpsLng,
        landmark: first.landmark,
      });
      setNewRouteDest({
        name: last.stopName || r.destination,
        gpsLat: last.gpsLat, gpsLng: last.gpsLng,
        landmark: last.landmark,
      });
      // Convert estimatedArrivalMins offset back to an HH:MM time using the
      // route's departure — inverse of stopOffsetMinutes on save.
      const dep = r.departureTime ?? '07:00';
      const offsetToTime = (offset?: number) => {
        if (offset == null || !dep) return '';
        const [dH, dM] = dep.split(':').map(Number);
        if (!Number.isFinite(dH) || !Number.isFinite(dM)) return '';
        const total = dH * 60 + dM + offset;
        const h = Math.floor((total % (24 * 60)) / 60);
        const m = total % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      };
      setNewRouteStops(middle.map(s => ({
        stopName: s.stopName,
        time: offsetToTime(s.estimatedArrivalMins),
        gpsLat: s.gpsLat, gpsLng: s.gpsLng,
        landmark: s.landmark,
      })));
    } else {
      setNewRouteOrigin({ name: r.origin });
      setNewRouteDest({ name: r.destination });
      setNewRouteStops([]);
    }
    setNewStopDraft({ stopName: '', time: '' });
    setMapPickerFor(null);
    setError('');
    setShowNewRoute(true);
  };

  const addNewRouteStop = () => {
    if (!newStopDraft.stopName.trim()) return;
    setNewRouteStops(prev => [...prev, {
      stopName: newStopDraft.stopName.trim(),
      time: newStopDraft.time,
      gpsLat: newStopDraft.gpsLat,
      gpsLng: newStopDraft.gpsLng,
      landmark: newStopDraft.landmark,
    }]);
    setNewStopDraft({ stopName: '', time: '' });
  };
  const removeNewRouteStop = (idx: number) =>
    setNewRouteStops(prev => prev.filter((_, i) => i !== idx));

  // Convert 'HH:MM' departure + 'HH:MM' stop time → offset minutes for the
  // RouteStop.estimatedArrivalMins column (stops store an offset, not a wall
  // clock). Undefined when either side is missing.
  const stopOffsetMinutes = (departure: string, stopTime: string): number | undefined => {
    if (!departure || !stopTime) return undefined;
    const [dH, dM] = departure.split(':').map(Number);
    const [sH, sM] = stopTime.split(':').map(Number);
    if ([dH, dM, sH, sM].some(n => !Number.isFinite(n))) return undefined;
    let diff = (sH * 60 + sM) - (dH * 60 + dM);
    if (diff < 0) diff += 24 * 60; // stop after midnight
    return diff;
  };

  const submitNewRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoute.name.trim()) { setError('Route Name is required'); return; }
    if (!newRouteOrigin.name.trim()) { setError('Origin is required'); return; }
    if (!newRouteDest.name.trim())   { setError('Destination is required'); return; }
    setCreating(true);
    try {
      // Prepend origin as first stop, append destination as last stop —
      // same shape the Route Planner saves so BusRoute.origin/destination
      // stay in sync with the first/last RouteStop rows.
      const originStop = {
        stopName: newRouteOrigin.name.trim(),
        sequence: 1,
        gpsLat: newRouteOrigin.gpsLat,
        gpsLng: newRouteOrigin.gpsLng,
        landmark: newRouteOrigin.landmark,
      };
      const intermediates = newRouteStops.map((s, i) => ({
        stopName: s.stopName,
        sequence: i + 2,
        estimatedArrivalMins: stopOffsetMinutes(newRoute.departureTime, s.time),
        gpsLat: s.gpsLat,
        gpsLng: s.gpsLng,
        landmark: s.landmark,
      }));
      const destinationStop = {
        stopName: newRouteDest.name.trim(),
        sequence: intermediates.length + 2,
        gpsLat: newRouteDest.gpsLat,
        gpsLng: newRouteDest.gpsLng,
        landmark: newRouteDest.landmark,
      };

      const payload = {
        name: newRoute.name.trim(),
        // Empty code lets the API auto-allocate the next tenant-scoped code.
        code: newRoute.code.trim() || undefined,
        origin: newRouteOrigin.name.trim(),
        destination: newRouteDest.name.trim(),
        routeType: newRoute.routeType,
        direction: newRoute.direction,
        shiftType: newRoute.shiftType,
        departureTime: newRoute.departureTime || null,
        expectedArrivalTime: newRoute.expectedArrivalTime || null,
        capacity: parseInt(newRoute.capacity, 10) || 40,
        isActive: newRoute.isActive,
        assignedVehicleId: newRoute.assignedVehicleId || null,
        assignedDriverId:  newRoute.assignedDriverId  || null,
        stops: [originStop, ...intermediates, destinationStop],
      };
      const res = await fetch(
        editingRouteId ? `/api/bus-ops/routes/${editingRouteId}` : '/api/bus-ops/routes',
        {
          method: editingRouteId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setShowNewRoute(false);
      await loadRoutes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create route');
    } finally {
      setCreating(false);
    }
  };

  const openStops = (r: BusRoute) => { setSelected(r); setStops(r.stops?.map(s=>({...s}))?? []); setShowStops(true); };

  const saveStops = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await fetch(`/api/bus-ops/routes/${selected.id}/stops`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stops: stops.map((s,i)=>({...s,sequence:i+1})) }),
      });
      setShowStops(false);
      loadRoutes();
    } catch { setError('Failed to save stops'); }
    finally { setSaving(false); }
  };

  const addStop = () => {
    if (!newStop.stopName.trim()) return;
    setStops(prev => [...prev, {
      stopName: newStop.stopName,
      sequence: prev.length + 1,
      estimatedArrivalMins: newStop.estimatedArrivalMins ? parseInt(newStop.estimatedArrivalMins) : undefined,
      landmark: newStop.landmark || undefined,
    }]);
    setNewStop({ stopName:'', estimatedArrivalMins:'', landmark:'' });
  };

  const removeStop = (idx: number) => setStops(prev => prev.filter((_,i)=>i!==idx).map((s,i)=>({...s,sequence:i+1})));
  const moveStop = (idx: number, dir: -1|1) => {
    const arr = [...stops];
    const target = idx + dir;
    if (target < 0 || target >= arr.length) return;
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    setStops(arr.map((s,i)=>({...s,sequence:i+1})));
  };

  const toggleActive = async (r: BusRoute) => {
    await fetch(`/api/bus-ops/routes/${r.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({isActive:!r.isActive}) });
    loadRoutes();
  };

  const openDeleteConfirm = (r: BusRoute) => { setError(''); setDeleteConfirm(r); };

  const confirmDelete = async () => {
    const r = deleteConfirm;
    if (!r) return;
    setDeletingId(r.id);
    try {
      const res = await fetch(`/api/bus-ops/routes/${r.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Failed to delete route');
        setDeleteConfirm(null);
        return;
      }
      setError('');
      setDeleteConfirm(null);
      await loadRoutes();
    } finally { setDeletingId(null); }
  };

  // ── Grid config ──────────────────────────────────────────────────────────

  const kpis: KpiTile[] = useMemo(() => {
    const total   = routes.length;
    const active  = routes.filter(r => r.isActive).length;
    const stopsTotal = routes.reduce((n, r) => n + (r.stops?.length ?? 0), 0);
    return [
      { label: 'Total Routes',   value: total,           icon: MapIcon,      accent: 'violet'  },
      { label: 'Active',         value: active,          icon: CheckCircle2, accent: 'emerald' },
      { label: 'Inactive',       value: total - active,  icon: XCircle,      accent: 'slate'   },
      { label: 'Stops (total)',  value: stopsTotal,      icon: MapPin,       accent: 'sky'     },
    ];
  }, [routes]);

  const filterChips: FilterChipDef<BusRoute>[] = useMemo(() => [
    {
      key: 'status',
      label: 'Status',
      options: [
        { value: 'active',   label: 'Active'   },
        { value: 'inactive', label: 'Inactive' },
      ],
      predicate: (r, v) => v === 'active' ? !!r.isActive : !r.isActive,
    },
    {
      key: 'type',
      label: 'Type',
      options: Array.from(new Set(routes.map(r => r.routeType ?? 'STAFF')))
        .sort()
        .map(t => ({ value: t, label: t })),
      predicate: (r, v) => (r.routeType ?? 'STAFF') === v,
      multi: true,
    },
  ], [routes]);

  const columns: DataGridColumn<BusRoute>[] = useMemo(() => [
    {
      key: 'name', header: 'Route',
      accessor: r => r.name,
      render: r => (
        <div className="flex items-center gap-2 flex-wrap">
          {r.code && (
            <span className="px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-violet-500/15 text-violet-300 border border-violet-500/30">
              {r.code}
            </span>
          )}
          <span className="font-medium text-white">{r.name}</span>
        </div>
      ),
      width: '240px',
    },
    {
      key: 'routeType', header: 'Type',
      accessor: r => r.routeType ?? 'STAFF',
      filter: 'select', width: '90px',
    },
    {
      key: 'status', header: 'Status',
      accessor: r => r.isActive ? 'Active' : 'Inactive',
      filter: 'select', width: '100px',
      render: r => r.isActive
        ? <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Active</span>
        : <span className="px-2 py-0.5 rounded-full text-xs bg-slate-500/20 text-slate-400 border border-slate-500/30">Inactive</span>,
    },
    { key: 'origin',      header: 'Origin',      accessor: r => r.origin },
    { key: 'destination', header: 'Destination', accessor: r => r.destination },
    {
      key: 'stops', header: 'Stops',
      accessor: r => r.stops?.length ?? 0,
      align: 'right', width: '80px',
    },
    {
      key: 'distance', header: 'Distance',
      accessor: r => r.totalDistanceKm ?? 0,
      render: r => r.totalDistanceKm ? `${r.totalDistanceKm} km` : '—',
      align: 'right', width: '100px',
    },
    {
      key: 'duration', header: 'Duration',
      accessor: r => r.estimatedDurationMins ?? 0,
      render: r => r.estimatedDurationMins ? `~${r.estimatedDurationMins} min` : '—',
      align: 'right', width: '100px',
    },
    {
      key: 'capacity', header: 'Capacity',
      accessor: r => r.capacity ?? 30,
      align: 'right', width: '90px',
    },
    {
      key: 'actions', header: '', filter: false, sortable: false, width: '60px', align: 'right',
      render: r => {
        const actions: RowAction[] = [
          { label: 'Edit',                                onClick: () => openEditRoute(r) },
          { label: `Stops (${r.stops?.length ?? 0})`,     onClick: () => openStops(r) },
          { label: 'Optimize',                            onClick: () => router.push(`/bus-ops/route-planner?edit=${r.id}&optimize=1`) },
          { label: r.isActive ? 'Deactivate' : 'Activate', onClick: () => toggleActive(r) },
          {
            label: deletingId === r.id ? 'Deleting…' : 'Delete',
            tone: 'danger',
            disabled: deletingId === r.id || !!r.isActive,
            onClick: () => openDeleteConfirm(r),
          },
        ];
        return (
          <div className="flex justify-end">
            <RowActionsMenu actions={actions} label={`Actions for ${r.name}`} />
          </div>
        );
      },
    },
  ], [router, deletingId]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Routes"
        subtitle={`${routes.filter(r=>r.isActive).length} active · ${routes.length} total`}
        icon={MapIcon}
        accent="violet"
        actions={
          <button onClick={openNewRoute} className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            <Plus className="w-4 h-4" /> New Route
          </button>
        }
      />

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm whitespace-pre-line">
          {error}
        </div>
      )}

      <FleetDataGrid
        gridName="RoutesGrid"
        rows={routes}
        columns={columns}
        getRowId={r => r.id}
        loading={loading}
        emptyMessage="No routes configured yet."
        initialSort={{ key: 'name', dir: 'asc' }}
        kpis={kpis}
        filterChips={filterChips}
        toolbar={{ title: 'RoutesGrid', exportName: 'bus-ops-routes', sortSelector: true }}
      />

      {/* New Route modal */}
      {showNewRoute && (
        <>
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={e => {
            // Only close when the backdrop itself is clicked — not when a
            // click on a descendant bubbles up. Fixes the map picker (and
            // any future nested overlay) closing the modal by proxy.
            if (e.target !== e.currentTarget) return;
            if (creating) return;
            setShowNewRoute(false);
          }}
        >
          <div
            className="w-full max-w-3xl max-h-[92vh] overflow-y-auto bg-slate-900/95 border border-white/10 rounded-2xl shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 sticky top-0 bg-slate-900/95 backdrop-blur">
              <h2 className="text-xl font-bold text-white">{editingRouteId ? 'Edit Route' : 'New Route'}</h2>
              <button type="button" onClick={() => setShowNewRoute(false)} disabled={creating}
                className="text-slate-400 hover:text-white p-1 -m-1" aria-label="Close">✕</button>
            </div>

            <form onSubmit={submitNewRoute} className="px-6 py-5 space-y-5">
              {/* Row 1: name + code */}
              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <div className="text-xs uppercase tracking-wider text-slate-400 mb-1.5">Route Name *</div>
                  <input required value={newRoute.name} onChange={e => setNewRoute(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Marina Morning Pickup"
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white placeholder-slate-500 text-sm focus:border-violet-500 focus:outline-none" />
                </label>
                <label className="block">
                  <div className="text-xs uppercase tracking-wider text-slate-400 mb-1.5">Route Code</div>
                  <input value={newRoute.code} onChange={e => setNewRoute(p => ({ ...p, code: e.target.value }))}
                    placeholder="e.g. RTE-001 (auto-allocated when empty)"
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white placeholder-slate-500 text-sm focus:border-violet-500 focus:outline-none" />
                </label>
              </div>

              {/* Row 2: direction + shift + route type */}
              <div className="grid grid-cols-3 gap-4">
                <label className="block">
                  <div className="text-xs uppercase tracking-wider text-slate-400 mb-1.5">Direction</div>
                  <select value={newRoute.direction} onChange={e => setNewRoute(p => ({ ...p, direction: e.target.value as NewRouteForm['direction'] }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white text-sm focus:border-violet-500 focus:outline-none">
                    <option value="INBOUND">Inbound</option>
                    <option value="OUTBOUND">Outbound</option>
                  </select>
                </label>
                <label className="block">
                  <div className="text-xs uppercase tracking-wider text-slate-400 mb-1.5">Shift Type</div>
                  <select value={newRoute.shiftType} onChange={e => setNewRoute(p => ({ ...p, shiftType: e.target.value as NewRouteForm['shiftType'] }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white text-sm focus:border-violet-500 focus:outline-none">
                    <option value="MORNING">Morning</option>
                    <option value="EVENING">Evening</option>
                    <option value="NIGHT">Night</option>
                    <option value="SPLIT">Split</option>
                  </select>
                </label>
                <label className="block">
                  <div className="text-xs uppercase tracking-wider text-slate-400 mb-1.5">Route Type</div>
                  <select value={newRoute.routeType} onChange={e => setNewRoute(p => ({ ...p, routeType: e.target.value as NewRouteForm['routeType'] }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white text-sm focus:border-violet-500 focus:outline-none">
                    <option value="STAFF">Staff</option>
                    <option value="SCHOOL">School</option>
                    <option value="BOTH">Both</option>
                  </select>
                </label>
              </div>

              {/* Row 3: departure + arrival + capacity + status */}
              <div className="grid grid-cols-4 gap-4">
                <label className="block">
                  <div className="text-xs uppercase tracking-wider text-slate-400 mb-1.5">Departure Time</div>
                  <input type="time" value={newRoute.departureTime} onChange={e => setNewRoute(p => ({ ...p, departureTime: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white text-sm focus:border-violet-500 focus:outline-none" />
                </label>
                <label className="block">
                  <div className="text-xs uppercase tracking-wider text-slate-400 mb-1.5">Expected Arrival</div>
                  <input type="time" value={newRoute.expectedArrivalTime} onChange={e => setNewRoute(p => ({ ...p, expectedArrivalTime: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white text-sm focus:border-violet-500 focus:outline-none" />
                </label>
                <label className="block">
                  <div className="text-xs uppercase tracking-wider text-slate-400 mb-1.5">Seat Capacity</div>
                  <input type="number" min={1} value={newRoute.capacity} onChange={e => setNewRoute(p => ({ ...p, capacity: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white text-sm focus:border-violet-500 focus:outline-none" />
                </label>
                <label className="block">
                  <div className="text-xs uppercase tracking-wider text-slate-400 mb-1.5">Status</div>
                  <select value={newRoute.isActive ? 'active' : 'inactive'} onChange={e => setNewRoute(p => ({ ...p, isActive: e.target.value === 'active' }))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white text-sm focus:border-violet-500 focus:outline-none">
                    <option value="active">🟢 Active</option>
                    <option value="inactive">⚪ Inactive</option>
                  </select>
                </label>
              </div>

              {/* Resource Assignment */}
              <fieldset className="rounded-xl border border-white/10 bg-slate-950/40 px-4 py-4">
                <legend className="px-2 text-xs uppercase tracking-wider text-slate-400 font-semibold">Resource Assignment</legend>
                <div className="grid grid-cols-2 gap-4">
                  <label className="block">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="text-xs uppercase tracking-wider text-slate-400">Vehicle</div>
                      {(() => {
                        // Vehicles filtered by seat capacity — count is a helpful
                        // signal that the dropdown was pruned, not empty because
                        // the fleet is empty.
                        const need = parseInt(newRoute.capacity, 10);
                        if (!Number.isFinite(need) || need <= 0) return null;
                        const fits = vehicles.filter(v => v.seatingCapacity != null && v.seatingCapacity >= need).length;
                        return (
                          <span className="text-[10px] text-slate-500">
                            {fits} of {vehicles.length} ≥ {need} seats
                          </span>
                        );
                      })()}
                    </div>
                    <select value={newRoute.assignedVehicleId} onChange={e => setNewRoute(p => ({ ...p, assignedVehicleId: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white text-sm focus:border-violet-500 focus:outline-none">
                      <option value="">— Not assigned —</option>
                      {(() => {
                        // Filter: only vehicles whose seatingCapacity meets the
                        // route's seat requirement. Vehicles with unknown
                        // seatingCapacity are excluded (we can't verify they fit).
                        // The already-selected vehicle is always shown even if it
                        // no longer meets the threshold — marked so the operator
                        // knows to re-pick.
                        const need = parseInt(newRoute.capacity, 10);
                        const threshold = Number.isFinite(need) && need > 0 ? need : 0;
                        return vehicles
                          .filter(v =>
                            v.id === newRoute.assignedVehicleId ||
                            (v.seatingCapacity != null && v.seatingCapacity >= threshold),
                          )
                          .map(v => {
                            const label = v.licensePlate ?? v.id.slice(0, 8);
                            const model = [v.make, v.model].filter(Boolean).join(' ');
                            const seats = v.seatingCapacity != null ? `${v.seatingCapacity} seats` : 'seats unknown';
                            const underCap =
                              threshold > 0 &&
                              v.seatingCapacity != null &&
                              v.seatingCapacity < threshold;
                            return (
                              <option key={v.id} value={v.id}>
                                {label}{model ? ` — ${model}` : ''} · {seats}{underCap ? ' (under capacity)' : ''}
                              </option>
                            );
                          });
                      })()}
                    </select>
                  </label>
                  <label className="block">
                    <div className="text-xs uppercase tracking-wider text-slate-400 mb-1.5">Driver</div>
                    <select value={newRoute.assignedDriverId} onChange={e => setNewRoute(p => ({ ...p, assignedDriverId: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white text-sm focus:border-violet-500 focus:outline-none">
                      <option value="">— Not assigned —</option>
                      {drivers.map(d => (
                        <option key={d.id} value={d.id}>
                          {d.name}{d.licenseType ? ` (${d.licenseType})` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {vehicles.length === 0 && drivers.length === 0 && (
                  <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 inline-flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>No vehicles or drivers found. Add them in Fleet &amp; Driver Management first.</span>
                  </div>
                )}
              </fieldset>

              {/* Origin */}
              <EndpointField
                label="Origin *"
                target="origin"
                value={newRouteOrigin}
                onChange={setNewRouteOrigin}
                existingStops={existingStops}
                onPickExisting={key => pickExistingFor('origin', key)}
                onOpenMap={() => setMapPickerFor('origin')}
              />

              {/* Stop Sequence Engine */}
              <fieldset className="rounded-xl border border-white/10 bg-slate-950/40 px-4 py-4">
                <legend className="px-2 text-xs uppercase tracking-wider text-slate-400 font-semibold">Stop Sequence Engine · Intermediate</legend>

                {/* Added-stops list. Numbered chips + coords indicator so the
                    operator can see at a glance which stops have GPS pins vs
                    just names (name-only stops can still be geocoded later in
                    the Route Planner). */}
                <div className="space-y-2 mb-3">
                  {newRouteStops.length === 0 && (
                    <div className="text-xs text-slate-500 py-2">No stops yet. Pick from existing, plot on the map, or type below.</div>
                  )}
                  {newRouteStops.map((s, i) => (
                    <div key={i} className="flex items-center gap-2 bg-slate-800/50 border border-white/5 rounded-lg px-3 py-2">
                      <span className="w-6 h-6 rounded-full bg-violet-500/20 text-violet-300 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-200 truncate">{s.stopName}</div>
                        {s.landmark && <div className="text-[10px] text-slate-500 truncate">{s.landmark}</div>}
                      </div>
                      {s.gpsLat != null && s.gpsLng != null && (
                        <span title={`${s.gpsLat.toFixed(5)}, ${s.gpsLng.toFixed(5)}`}
                          className="text-[10px] text-emerald-300 inline-flex items-center gap-0.5">
                          <MapPin className="w-3 h-3" /> pinned
                        </span>
                      )}
                      {s.time && <span className="text-xs text-slate-400 inline-flex items-center gap-1"><Clock className="w-3 h-3" />{s.time}</span>}
                      <button type="button" onClick={() => removeNewRouteStop(i)}
                        className="text-rose-400 hover:text-rose-300 text-xs px-1">✕</button>
                    </div>
                  ))}
                </div>

                {/* Pick from existing — de-duplicated across all tenant routes
                    from /api/bus-ops/route-stops. Choosing a stop pre-fills
                    the draft below (name + coords + landmark). Operator still
                    clicks Add so they can set the time first. */}
                {existingStops.length > 0 && (
                  <div className="mb-3">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1">
                      Pick from existing ({existingStops.length})
                    </div>
                    <select
                      value=""
                      onChange={e => { pickExistingFor('stop', e.target.value); e.currentTarget.selectedIndex = 0; }}
                      className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white text-sm focus:border-violet-500 focus:outline-none"
                    >
                      <option value="">— Pick a stop already used on another route —</option>
                      {existingStops.map(s => {
                        const key = `${s.name}|${s.lat.toFixed(5)}|${s.lng.toFixed(5)}`;
                        return (
                          <option key={key} value={key}>
                            {s.name}{s.landmark ? ` — ${s.landmark}` : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                )}

                {/* Draft row: name input · time · 📍 Map · + Add. The draft
                    silently carries gpsLat/gpsLng/landmark if they came from
                    the picker or map — surfaced as a pinned indicator. */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 relative">
                    <input value={newStopDraft.stopName} onChange={e => setNewStopDraft(p => ({ ...p, stopName: e.target.value, gpsLat: undefined, gpsLng: undefined, landmark: undefined }))}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addNewRouteStop(); } }}
                      placeholder="Stop name…"
                      className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white placeholder-slate-500 text-sm focus:border-violet-500 focus:outline-none pr-16" />
                    {newStopDraft.gpsLat != null && newStopDraft.gpsLng != null && (
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-emerald-300 inline-flex items-center gap-0.5 pointer-events-none">
                        <MapPin className="w-3 h-3" /> pinned
                      </span>
                    )}
                  </div>
                  <input type="time" value={newStopDraft.time} onChange={e => setNewStopDraft(p => ({ ...p, time: e.target.value }))}
                    className="w-32 px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white text-sm focus:border-violet-500 focus:outline-none" />
                  <button type="button" onClick={() => setMapPickerFor('stop')}
                    title="Plot this stop on the map"
                    className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700">
                    <MapPin className="w-3.5 h-3.5" /> Map
                  </button>
                  <button type="button" onClick={addNewRouteStop}
                    className="inline-flex items-center gap-1 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-sm text-violet-200 hover:bg-violet-500/20">
                    <Plus className="w-3.5 h-3.5" /> Add
                  </button>
                </div>
              </fieldset>

              {/* Destination */}
              <EndpointField
                label="Destination *"
                target="destination"
                value={newRouteDest}
                onChange={setNewRouteDest}
                existingStops={existingStops}
                onPickExisting={key => pickExistingFor('destination', key)}
                onOpenMap={() => setMapPickerFor('destination')}
              />

              {error && (
                <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
                <button type="button" onClick={() => setShowNewRoute(false)} disabled={creating}
                  className="px-4 py-2 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 text-sm font-medium disabled:opacity-50">
                  Cancel
                </button>
                <button type="submit" disabled={creating || !newRoute.name.trim()}
                  className="px-6 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
                  {creating ? (editingRouteId ? 'Saving…' : 'Creating…') : (editingRouteId ? 'Save Changes' : 'Create Route')}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Google Maps picker — sibling of the New Route overlay (NOT a
            descendant). Its own fixed overlay owns click-outside and z-index;
            nesting inside the New Route overlay caused Google Places'
            autocomplete clicks to bubble up and close both. */}
        {(() => {
          // Route the picker's initial coords + search query based on which
          // slot we're editing. Keeps one modal instance serving all three.
          const src = mapPickerFor === 'origin'
            ? { name: newRouteOrigin.name, lat: newRouteOrigin.gpsLat, lng: newRouteOrigin.gpsLng }
            : mapPickerFor === 'destination'
              ? { name: newRouteDest.name, lat: newRouteDest.gpsLat, lng: newRouteDest.gpsLng }
              : { name: newStopDraft.stopName, lat: newStopDraft.gpsLat, lng: newStopDraft.gpsLng };
          const title = mapPickerFor === 'origin' ? 'Plot origin on map'
            : mapPickerFor === 'destination' ? 'Plot destination on map'
            : 'Plot stop on map';
          return (
            <GoogleMapPickerModal
              open={mapPickerFor !== null}
              title={title}
              initial={src.lat != null && src.lng != null
                ? { lat: src.lat, lng: src.lng, label: src.name || undefined }
                : null}
              initialSearchQuery={src.name || undefined}
              onClose={() => setMapPickerFor(null)}
              onPick={handleMapPick}
            />
          );
        })()}
        </>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => { setDeletingId(null); setDeleteConfirm(null); }}
        >
          <div
            className="w-full max-w-md bg-slate-800/95 border border-rose-500/40 rounded-2xl shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 py-5 border-b border-white/10 flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-500/15 border border-rose-500/40 flex items-center justify-center shrink-0">
                <span className="text-lg" aria-hidden="true">⚠</span>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-bold text-white">Delete route?</h3>
                <p className="text-sm text-slate-400 mt-0.5 truncate">{deleteConfirm.name}</p>
              </div>
              <button type="button" onClick={() => setDeleteConfirm(null)} className="text-slate-400 hover:text-white p-1 -m-1" aria-label="Close">✕</button>
            </div>

            <div className="px-6 py-4 space-y-3 text-sm">
              <p className="text-slate-300">
                This route will be soft-deleted — it disappears from the list and can't be undone from the UI.
              </p>
              {(deleteConfirm.schedules?.length ?? 0) > 0 && (
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-200">
                  ⚠ This route has {deleteConfirm.schedules!.length} scheduled trip{deleteConfirm.schedules!.length === 1 ? '' : 's'}.
                  The server will refuse the delete if any are still live — cancel or reassign them first.
                </div>
              )}
              <div className="rounded-lg bg-slate-900/50 border border-white/5 px-3 py-2 text-xs text-slate-400">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Route</div>
                <div className="font-medium text-slate-200">{deleteConfirm.name}</div>
                <div className="text-slate-400 mt-0.5">{deleteConfirm.origin} → {deleteConfirm.destination}</div>
                {deleteConfirm.stops && deleteConfirm.stops.length > 0 && (
                  <div className="text-slate-500 mt-1">{deleteConfirm.stops.length} stop{deleteConfirm.stops.length === 1 ? '' : 's'}</div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-white/10 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setDeleteConfirm(null)} disabled={deletingId === deleteConfirm.id}
                className="px-4 py-2 rounded-lg border border-white/10 text-slate-300 hover:bg-white/5 text-sm font-medium disabled:opacity-50">
                Cancel
              </button>
              <button type="button" onClick={confirmDelete} disabled={deletingId === deleteConfirm.id}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-1.5">
                {deletingId === deleteConfirm.id ? 'Deleting…' : 'Delete route'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stops Manager Modal */}
      {showStops && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-slate-800/95 border border-white/10 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Stops — {selected.name}</h2>
              <button onClick={()=>setShowStops(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <div className="space-y-2 mb-4">
              {stops.length === 0 && <div className="text-slate-400 text-sm text-center py-4">No stops yet</div>}
              {stops.map((s,i)=>(
                <div key={i} className="flex items-center gap-3 bg-slate-700/50 rounded-xl px-4 py-3">
                  <div className="w-7 h-7 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-bold">{i+1}</div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-white">{s.stopName}</div>
                    {s.landmark && <div className="text-xs text-slate-400">{s.landmark}</div>}
                  </div>
                  {s.estimatedArrivalMins && <span className="text-xs text-slate-400">+{s.estimatedArrivalMins} min</span>}
                  <div className="flex gap-1">
                    <button onClick={()=>moveStop(i,-1)} disabled={i===0} className="text-slate-400 hover:text-white disabled:opacity-30 text-xs px-1">↑</button>
                    <button onClick={()=>moveStop(i,1)} disabled={i===stops.length-1} className="text-slate-400 hover:text-white disabled:opacity-30 text-xs px-1">↓</button>
                    <button onClick={()=>removeStop(i)} className="text-rose-400 hover:text-rose-300 text-xs px-1">✕</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mb-6">
              <input type="text" value={newStop.stopName} onChange={e=>setNewStop(p=>({...p,stopName:e.target.value}))} placeholder="New stop name"
                className="flex-1 px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white text-sm placeholder-slate-500 focus:border-violet-500 focus:outline-none" />
              <input type="text" value={newStop.landmark} onChange={e=>setNewStop(p=>({...p,landmark:e.target.value}))} placeholder="Landmark"
                className="w-28 px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white text-sm placeholder-slate-500 focus:outline-none" />
              <input type="number" value={newStop.estimatedArrivalMins} onChange={e=>setNewStop(p=>({...p,estimatedArrivalMins:e.target.value}))} placeholder="Min"
                className="w-16 px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white text-sm focus:outline-none" />
              <button onClick={addStop} className="px-3 py-2 rounded-lg bg-blue-500/30 text-blue-400 border border-blue-500/30 text-sm hover:bg-blue-500/50">+ Add</button>
            </div>
            <div className="flex gap-4 justify-end">
              <button onClick={()=>setShowStops(false)} className="px-6 py-2 rounded-lg border border-white/10 text-white hover:bg-white/5">Cancel</button>
              <button onClick={saveStops} disabled={saving} className="px-6 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Stops'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── EndpointField ──────────────────────────────────────────────────────────
// Reusable input row for Origin / Destination inside the New Route modal.
// Mirrors the Stop Sequence Engine's UX: existing-stops dropdown (with a
// (N) counter in the label), text input with a 📍 pinned badge when GPS is
// set, and a Map button that opens the shared GoogleMapPickerModal via the
// parent's setMapPickerFor callback.
function EndpointField({
  label, target, value, onChange, existingStops, onPickExisting, onOpenMap,
}: {
  label: string;
  target: MapPickerTarget;                       // 'origin' | 'destination'
  value: NewRouteEndpoint;
  onChange: (next: NewRouteEndpoint) => void;
  existingStops: ExistingStop[];
  onPickExisting: (key: string) => void;
  onOpenMap: () => void;
}) {
  return (
    <fieldset className="rounded-xl border border-white/10 bg-slate-950/40 px-4 py-4">
      <legend className="px-2 text-xs uppercase tracking-wider text-slate-400 font-semibold">{label}</legend>

      {existingStops.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1">
            Pick from existing ({existingStops.length})
          </div>
          <select
            value=""
            onChange={e => { onPickExisting(e.target.value); e.currentTarget.selectedIndex = 0; }}
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white text-sm focus:border-violet-500 focus:outline-none"
          >
            <option value="">— Pick a location already used on another route —</option>
            {existingStops.map(s => {
              const key = `${s.name}|${s.lat.toFixed(5)}|${s.lng.toFixed(5)}`;
              return (
                <option key={key} value={key}>
                  {s.name}{s.landmark ? ` — ${s.landmark}` : ''}
                </option>
              );
            })}
          </select>
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <input
            value={value.name}
            onChange={e => onChange({ ...value, name: e.target.value, gpsLat: undefined, gpsLng: undefined, landmark: undefined })}
            placeholder={target === 'origin' ? 'e.g. AGT HQ' : 'e.g. Sheikh Khalifa Medical City'}
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white placeholder-slate-500 text-sm focus:border-violet-500 focus:outline-none pr-16"
          />
          {value.gpsLat != null && value.gpsLng != null && (
            <span
              title={`${value.gpsLat.toFixed(5)}, ${value.gpsLng.toFixed(5)}`}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-emerald-300 inline-flex items-center gap-0.5 pointer-events-none"
            >
              <MapPin className="w-3 h-3" /> pinned
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onOpenMap}
          title={`Plot the ${target} on the map`}
          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
        >
          <MapPin className="w-3.5 h-3.5" /> Map
        </button>
      </div>

      {value.landmark && (
        <div className="mt-2 text-[11px] text-slate-500">Landmark: {value.landmark}</div>
      )}
    </fieldset>
  );
}
