'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Calendar, Plus, Recycle } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';
import MergeTripsDialog, { type ScheduleForMerge } from '@/components/bus-ops/MergeTripsDialog';
import FleetDataGrid, { type DataGridColumn } from '@/components/ui/FleetDataGrid';
import RowActionsMenu from '@/components/ui/RowActionsMenu';
import { usePollingRefresh } from '@/hooks/usePollingRefresh';
import { useRealtimeChannel } from '@/hooks/useRealtimeChannel';

interface Schedule {
  id: string; tripNumber?: string; routeId: string; route?: { name: string; origin: string; destination: string };
  vehicleId?: string; driverId?: string; departureTime: string; arrivalTime?: string;
  frequency?: string; shiftType?: string; direction?: string; capacity?: number;
  confirmedCount?: number; status?: string; notes?: string;
  passengers?: any[]; tripLogs?: any[];
}
interface Route { id: string; name: string; isActive?: boolean; estimatedDurationMins?: number | null }
interface Vehicle { id: string; licensePlate?: string | null; make?: string | null; model?: string | null; vehicleUsage?: string | null }
interface Driver { id: string; name: string; licenseType?: string | null }

const STATUS_COLORS: Record<string,string> = {
  SCHEDULED:  'bg-blue-500/20 text-blue-400 border-blue-500/30',
  DEPARTED:   'bg-amber-500/20 text-amber-400 border-amber-500/30',
  IN_TRANSIT: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  COMPLETED:  'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  CANCELLED:  'bg-rose-500/20 text-rose-400 border-rose-500/30',
  MERGED:     'bg-violet-500/20 text-violet-400 border-violet-500/30',
};
const SHIFT_TYPES  = ['MORNING','EVENING','NIGHT','SPLIT'];
const DIRECTIONS   = ['INBOUND','OUTBOUND'];
const FREQUENCIES  = ['DAILY','WEEKLY','ONCE'];

export default function SchedulesPage() {
  const [schedules, setSchedules]   = useState<Schedule[]>([]);
  const [routes, setRoutes]         = useState<Route[]>([]);
  const [vehicles, setVehicles]     = useState<Vehicle[]>([]);
  const [drivers, setDrivers]       = useState<Driver[]>([]);
  const [statusFilter, setStatus]   = useState('All');
  // Default date filter to today (local time). Lazy init runs once — first paint
  // shows today's date and the load below hits the API with ?date=<today> so the
  // grid opens focused on the operator's current day.
  const [dateFilter, setDate]       = useState<string>(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
  const [showModal, setShowModal]   = useState(false);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [actionLoading, setActing]  = useState<string | null>(null);
  const [error, setError]           = useState('');
  // Only SCHEDULED trips are mergeable (backend guard MERGE_SOURCE_NOT_SCHEDULED).
  // Selection is scoped to this page's current list so filters affect
  // which trips are eligible to merge together.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showMergeDialog, setShowMergeDialog] = useState(false);

  const emptyForm = { routeId:'', vehicleId:'', driverId:'', departureTime:'', arrivalTime:'', frequency:'DAILY', shiftType:'MORNING', direction:'INBOUND', capacity:'30', notes:'' };
  const [formData, setFormData] = useState(emptyForm);
  // Track whether the operator has manually edited Expected Arrival so the
  // auto-calculator (Departure + Route.estimatedDurationMins) doesn't stomp it.
  const [arrivalTouched, setArrivalTouched] = useState(false);

  const loadData = useCallback(async (opts?: { silent?: boolean }) => {
    if (opts?.silent) {
      /* quiet background refresh — no full-page spinner */
    } else {
      setLoading(true);
    }
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'All') params.set('status', statusFilter);
      if (dateFilter) params.set('date', dateFilter);
      // Fetch ALL routes (active + inactive) — new routes are created with
      // isActive: false pending review, so `?active=true` was hiding them
      // from the scheduling dropdown. We now show every non-deleted route
      // and tag inactive ones so the operator knows before selecting.
      // Cache-busted so newly-created routes show up immediately without
      // waiting on the 30s server-cache TTL.
      const [sRes, rRes, vRes, dRes] = await Promise.all([
        fetch(`/api/bus-ops/schedules?${params}`),
        fetch('/api/bus-ops/routes', { cache: 'no-store' }),
        fetch('/api/vehicles'),
        fetch('/api/bus-ops/drivers'),
      ]);
      const [sData, rData, vData, dData] = await Promise.all([sRes.json(), rRes.json(), vRes.json(), dRes.json()]);
      setSchedules(Array.isArray(sData) ? sData : []);
      setRoutes(Array.isArray(rData) ? rData : []);
      setVehicles(Array.isArray(vData) ? vData : (vData?.vehicles ?? []));
      setDrivers(Array.isArray(dData) ? dData : []);
    } catch { setError('Failed to load'); }
    finally { setLoading(false); }
  }, [statusFilter, dateFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  usePollingRefresh(loadData, {
    intervalMs: 20_000,
    pause: showModal || showMergeDialog,
  });
  // Push updates (SSE default; WebSocket if NEXT_PUBLIC_REALTIME_WS_URL is set)
  useRealtimeChannel(
    ['bus-ops:schedules'],
    () => { void loadData({ silent: true }); },
    { enabled: !(showModal || showMergeDialog) },
  );


  // Auto-calc Expected Arrival = Departure + Route.estimatedDurationMins.
  // Skipped once the operator has manually touched the field.
  useEffect(() => {
    if (arrivalTouched) return;
    if (!formData.routeId || !formData.departureTime) return;
    const route = routes.find(r => r.id === formData.routeId);
    const dur = route?.estimatedDurationMins;
    if (!dur || dur <= 0) return;
    const dep = new Date(formData.departureTime);
    if (isNaN(dep.getTime())) return;
    const arr = new Date(dep.getTime() + dur * 60000);
    const p2 = (n: number) => String(n).padStart(2, '0');
    const formatted = `${arr.getFullYear()}-${p2(arr.getMonth()+1)}-${p2(arr.getDate())}T${p2(arr.getHours())}:${p2(arr.getMinutes())}`;
    if (formData.arrivalTime !== formatted) {
      setFormData(p => ({ ...p, arrivalTime: formatted }));
    }
  }, [formData.routeId, formData.departureTime, routes, arrivalTouched, formData.arrivalTime]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...formData,
        departureTime: new Date(formData.departureTime).toISOString(),
        arrivalTime:   formData.arrivalTime ? new Date(formData.arrivalTime).toISOString() : null,
        capacity: parseInt(formData.capacity) || 30,
        vehicleId: formData.vehicleId || null,
        driverId:  formData.driverId  || null,
        notes:     formData.notes     || null,
      };
      const res = await fetch('/api/bus-ops/schedules', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
      if (!res.ok) throw new Error();
      setShowModal(false);
      setFormData(emptyForm);
      setArrivalTouched(false);
      loadData();
    } catch { setError('Failed to create schedule'); }
    finally { setSaving(false); }
  };

  const handleAction = async (id: string, action: string, body?: object) => {
    setActing(id + action);
    try {
      const res = await fetch(`/api/bus-ops/schedules/${id}/${action}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body ?? {}) });
      if (!res.ok) { const d = await res.json(); alert(d.error ?? 'Action failed'); return; }
      loadData();
    } catch { alert('Action failed'); }
    finally { setActing(null); }
  };

  const counts = {
    SCHEDULED: schedules.filter(s=>s.status==='SCHEDULED').length,
    DEPARTED:  schedules.filter(s=>s.status==='DEPARTED').length,
    COMPLETED: schedules.filter(s=>s.status==='COMPLETED').length,
  };

  // Only SCHEDULED trips visible in the current filter can be selected
  // for merging. The set is trimmed whenever the visible list changes
  // so a filter switch never leaves a stale selection referring to a
  // now-hidden trip.
  const visibleScheduledIds = useMemo(() =>
    new Set(schedules.filter(s => (s.status ?? 'SCHEDULED') === 'SCHEDULED').map(s => s.id)),
    [schedules],
  );
  useEffect(() => {
    setSelectedIds(prev => {
      const next = new Set<string>();
      for (const id of prev) if (visibleScheduledIds.has(id)) next.add(id);
      return next;
    });
  }, [visibleScheduledIds]);

  const selectedSources: ScheduleForMerge[] = useMemo(
    () => schedules
      .filter(s => selectedIds.has(s.id))
      .map(s => ({
        id: s.id,
        tripNumber: s.tripNumber,
        routeId: s.routeId,
        route: s.route ? { name: s.route.name } : undefined,
        departureTime: s.departureTime,
        arrivalTime: s.arrivalTime,
        confirmedCount: s.confirmedCount,
        capacity: s.capacity,
      })),
    [schedules, selectedIds],
  );

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());


  const scheduleColumns: DataGridColumn<Schedule>[] = useMemo(() => [
    {
      key: 'select',
      header: '',
      sortable: false,
      filter: false,
      width: '44px',
      render: (s) => {
        const status = s.status ?? 'SCHEDULED';
        const canSelect = status === 'SCHEDULED';
        return (
          <input
            type="checkbox"
            disabled={!canSelect}
            checked={selectedIds.has(s.id)}
            onChange={() => canSelect && toggleSelected(s.id)}
            onClick={(e) => e.stopPropagation()}
            title={canSelect ? 'Select for merge' : `Only SCHEDULED can be merged (${status})`}
            className="accent-violet-500 disabled:opacity-30"
          />
        );
      },
    },
    {
      key: 'trip',
      header: 'Trip No.',
      accessor: (s) => s.tripNumber ?? s.id.slice(0, 8),
    },
    {
      key: 'route',
      header: 'Route',
      accessor: (s) => s.route?.name ?? '—',
      render: (s) => (
        <div>
          <div className="font-medium text-white">{s.route?.name ?? '—'}</div>
          <div className="text-xs text-slate-500">{s.route?.origin} → {s.route?.destination}</div>
        </div>
      ),
    },
    { key: 'shift', header: 'Shift', accessor: (s) => s.shiftType ?? '—', filter: 'select' },
    { key: 'direction', header: 'Direction', accessor: (s) => s.direction ?? '—', filter: 'select' },
    {
      key: 'departure',
      header: 'Departure',
      accessor: (s) => s.departureTime,
      render: (s) => new Date(s.departureTime).toLocaleString(),
    },
    {
      key: 'pax',
      header: 'Pax',
      accessor: (s) => s.confirmedCount ?? 0,
      align: 'right',
      render: (s) => `${s.confirmedCount ?? 0}/${s.capacity ?? 30}`,
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (s) => s.status ?? 'SCHEDULED',
      filter: 'select',
      render: (s) => {
        const status = s.status ?? 'SCHEDULED';
        return (
          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[status] ?? STATUS_COLORS.SCHEDULED}`}>
            {status.replace(/_/g, ' ')}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      sortable: false,
      filter: false,
      render: (s) => {
        const status = s.status ?? 'SCHEDULED';
        const busy = !!actionLoading;
        const actions: { label: string; onClick: () => void; tone?: 'default' | 'danger'; disabled?: boolean }[] = [];
        if (status === 'SCHEDULED') {
          actions.push({ label: 'Start', disabled: busy, onClick: () => handleAction(s.id, 'depart') });
        }
        if (['DEPARTED', 'IN_TRANSIT', 'STARTED', 'EN_ROUTE', 'SCHEDULED'].includes(status) && status !== 'COMPLETED') {
          if (status !== 'SCHEDULED') {
            actions.push({ label: 'Complete', disabled: busy, onClick: () => handleAction(s.id, 'complete') });
          }
        }
        if (!['COMPLETED', 'CANCELLED', 'MERGED'].includes(status)) {
          actions.push({
            label: 'Cancel',
            tone: 'danger',
            disabled: busy,
            onClick: () => {
              if (confirm('Cancel this trip?')) handleAction(s.id, 'cancel', { reason: 'User requested' });
            },
          });
        }
        if (!actions.length) return <span className="text-slate-600 text-xs">—</span>;
        return <RowActionsMenu actions={actions} />;
      },
    },
  ], [selectedIds, actionLoading]);

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-slate-400 animate-pulse">Loading schedules...</div></div>;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Trip Schedules"
        subtitle={`${schedules.length} trips · ${counts.SCHEDULED} scheduled · ${counts.DEPARTED} departed · ${counts.COMPLETED} completed`}
        icon={Calendar}
        accent="violet"
        actions={
          <div className="flex items-center gap-2">
            {selectedIds.size >= 2 && (
              <button
                onClick={() => setShowMergeDialog(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-violet-500 bg-violet-500/20 px-4 py-2 text-sm font-semibold text-violet-200 hover:bg-violet-500/30"
              >
                <Recycle className="w-4 h-4" /> Merge {selectedIds.size} selected
              </button>
            )}
            {selectedIds.size > 0 && (
              <button onClick={clearSelection} className="text-sm text-slate-400 hover:text-white">Clear</button>
            )}
            <button onClick={()=>setShowModal(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
              <Plus className="w-4 h-4" /> New Trip Schedule
            </button>
          </div>
        }
      />

      {error && <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">{error}</div>}

      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <select value={statusFilter} onChange={e=>setStatus(e.target.value)}
          className="px-4 py-2 rounded-lg bg-slate-800/50 border border-white/10 text-white focus:border-violet-500 focus:outline-none">
          <option value="All">All Status</option>
          {['SCHEDULED','DEPARTED','IN_TRANSIT','COMPLETED','CANCELLED'].map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        <input type="date" value={dateFilter} onChange={e=>setDate(e.target.value)}
          className="px-4 py-2 rounded-lg bg-slate-800/50 border border-white/10 text-white focus:border-violet-500 focus:outline-none" />
        {dateFilter && <button onClick={()=>setDate('')} className="text-sm text-slate-400 hover:text-white">Clear date</button>}
      </div>

      {/* SchedulesGrid.
          Not wiring the grid's generic `selectable` here: this page's own
          `select` column (above, in scheduleColumns) already does multi-row
          selection, but with a business rule the generic primitive can't
          express yet — only SCHEDULED trips are mergeable, so its checkbox
          is disabled per-row. Turning on `selectable` too would either
          duplicate the checkbox column or (if the hand-rolled one were
          removed) silently drop that eligibility guard. `numbered` has no
          such conflict — it's purely additive. */}
      <FleetDataGrid
        gridName="Schedules"
        rows={schedules}
        getRowId={(r) => r.id}
        loading={false}
        emptyMessage="No trips found"
        columns={scheduleColumns}
        numbered
        toolbar={{ exportName: 'schedules', title: 'Schedules' }}
      />

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-800/95 border border-white/10 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">New Trip Schedule</h2>
              <button onClick={()=>setShowModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-slate-300 mb-2">Route *</label>
                  <select value={formData.routeId} onChange={e=>setFormData(p=>({...p,routeId:e.target.value}))} required
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none">
                    <option value="">Select route</option>
                    {/* Sort active routes to the top, then inactive. Tag
                        inactive ones so the operator sees clearly which
                        need to be Activated on the Routes page before the
                        schedule can actually run. */}
                    {[...routes]
                      .sort((a, b) => (a.isActive === b.isActive ? 0 : a.isActive ? -1 : 1))
                      .map(r => (
                        <option key={r.id} value={r.id}>
                          {r.name}{r.isActive === false ? ' — Inactive' : ''}
                        </option>
                      ))}
                  </select>
                  {formData.routeId && routes.find(r => r.id === formData.routeId)?.isActive === false && (
                    <p className="mt-1 text-[11px] text-amber-300">
                      ⚠ This route is currently Inactive. Schedules can be created but the route must be Activated on the Routes page before trips will dispatch.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Departure Time *</label>
                  <input type="datetime-local" value={formData.departureTime} required
                    onChange={e=>setFormData(p=>({...p,departureTime:e.target.value}))}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Expected Arrival
                    {!arrivalTouched && formData.arrivalTime && (
                      <span className="ml-2 text-[10px] font-normal text-violet-300">auto</span>
                    )}
                  </label>
                  <input type="datetime-local" value={formData.arrivalTime}
                    onChange={e=>{ setArrivalTouched(true); setFormData(p=>({...p,arrivalTime:e.target.value})); }}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Shift Type</label>
                  <select value={formData.shiftType} onChange={e=>setFormData(p=>({...p,shiftType:e.target.value}))}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none">
                    {SHIFT_TYPES.map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Direction</label>
                  <select value={formData.direction} onChange={e=>setFormData(p=>({...p,direction:e.target.value}))}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none">
                    {DIRECTIONS.map(d=><option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Frequency</label>
                  <select value={formData.frequency} onChange={e=>setFormData(p=>({...p,frequency:e.target.value}))}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none">
                    {FREQUENCIES.map(f=><option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Capacity</label>
                  <input type="number" value={formData.capacity} onChange={e=>setFormData(p=>({...p,capacity:e.target.value}))} min="1" placeholder="30"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Assign Vehicle</label>
                  <select value={formData.vehicleId} onChange={e=>setFormData(p=>({...p,vehicleId:e.target.value}))}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none">
                    <option value="">Unassigned</option>
                    {vehicles.map(v => {
                      const label = [v.licensePlate, [v.make, v.model].filter(Boolean).join(' ')].filter(Boolean).join(' — ') || v.id.slice(0,8);
                      return <option key={v.id} value={v.id}>{label}</option>;
                    })}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Assign Driver</label>
                  <select value={formData.driverId} onChange={e=>setFormData(p=>({...p,driverId:e.target.value}))}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none">
                    <option value="">Unassigned</option>
                    {drivers.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.name}{d.licenseType ? ` (${d.licenseType})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-slate-300 mb-2">Notes</label>
                  <textarea value={formData.notes} onChange={e=>setFormData(p=>({...p,notes:e.target.value}))} rows={2} placeholder="Additional notes..."
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none" />
                </div>
              </div>
              <div className="flex gap-4 justify-end pt-4">
                <button type="button" onClick={()=>setShowModal(false)} className="px-6 py-2 rounded-lg border border-white/10 text-white hover:bg-white/5">Cancel</button>
                <button type="submit" disabled={saving} className="px-6 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-50">
                  {saving ? 'Creating...' : 'Create Trip Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showMergeDialog && selectedSources.length >= 2 && (
        <MergeTripsDialog
          sources={selectedSources}
          vehicles={vehicles}
          drivers={drivers}
          onClose={() => setShowMergeDialog(false)}
          onApplied={async () => {
            setShowMergeDialog(false);
            clearSelection();
            await loadData();
          }}
        />
      )}
    </div>
  );
}
