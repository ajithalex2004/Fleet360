'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Map as MapIcon, Plus, CheckCircle2, XCircle, MapPin,
  Sparkles, Trash2, Power, Edit as EditIcon, ListOrdered,
} from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';
import SmartDataGrid, { type SmartDataGridColumn, type KpiTile, type FilterChipDef, type BulkAction } from '@/components/ui/SmartDataGrid';
import RowActionsMenu, { type RowAction } from '@/components/ui/RowActionsMenu';

interface RouteStop { id?: string; stopName: string; sequence: number; estimatedArrivalMins?: number; landmark?: string; gpsLat?: number; gpsLng?: number; }
interface BusRoute  {
  id: string; name: string; code?: string | null; origin: string; destination: string; routeType?: string;
  totalDistanceKm?: number; estimatedDurationMins?: number; capacity?: number;
  isActive?: boolean; notes?: string; stops?: RouteStop[];
  schedules?: any[]; createdAt?: string;
}

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

  // ── Bulk helpers ─────────────────────────────────────────────────────────
  // Fire per-row PATCH/DELETE in parallel and swallow individual errors so the
  // whole bulk doesn't abort on the first bad row. The final refresh reflects
  // whatever succeeded; failures surface in the console for debugging.
  const bulkPatchActive = async (rs: BusRoute[], isActive: boolean) => {
    await Promise.allSettled(
      rs.map(r => fetch(`/api/bus-ops/routes/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      })),
    );
  };

  const bulkDelete = async (rs: BusRoute[]) => {
    // Server refuses delete for active routes with live schedules — collect
    // failures so we can surface them after the batch.
    const results = await Promise.allSettled(
      rs.map(async r => {
        const res = await fetch(`/api/bus-ops/routes/${r.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(`${r.name}: ${body.error ?? `HTTP ${res.status}`}`);
        }
      }),
    );
    const failures = results
      .map((r, i) => r.status === 'rejected' ? `${rs[i].name}: ${(r.reason as Error).message}` : null)
      .filter((s): s is string => s !== null);
    if (failures.length > 0) setError(`${failures.length} delete(s) failed:\n${failures.join('\n')}`);
  };

  // ── Grid config ──────────────────────────────────────────────────────────

  const kpis: KpiTile[] = useMemo(() => {
    const total   = routes.length;
    const active  = routes.filter(r => r.isActive).length;
    const stopsTotal = routes.reduce((n, r) => n + (r.stops?.length ?? 0), 0);
    return [
      { label: 'Total Routes',   value: total,           icon: MapIcon,     accent: 'violet'  },
      { label: 'Active',         value: active,          icon: CheckCircle2, accent: 'emerald' },
      { label: 'Inactive',       value: total - active,  icon: XCircle,     accent: 'slate'   },
      { label: 'Stops (total)',  value: stopsTotal,      icon: MapPin,      accent: 'sky'     },
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

  const columns: SmartDataGridColumn<BusRoute>[] = useMemo(() => [
    {
      key: 'name', header: 'Route',
      accessor: r => r.name,
      render: r => (
        <div>
          <div className="font-medium text-white">{r.name}</div>
          {r.code && <div className="text-[10px] text-slate-500 font-mono">{r.code}</div>}
        </div>
      ),
      width: '220px',
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
          { key: 'edit',     label: 'Edit',                                 icon: EditIcon,    onClick: () => router.push(`/bus-ops/route-planner?edit=${r.id}`) },
          { key: 'stops',    label: `Stops (${r.stops?.length ?? 0})`,      icon: ListOrdered, onClick: () => openStops(r) },
          { key: 'optimize', label: 'Optimize',                             icon: Sparkles,    onClick: () => router.push(`/bus-ops/route-planner?edit=${r.id}&optimize=1`) },
          { key: 'toggle',   label: r.isActive ? 'Deactivate' : 'Activate', icon: Power,       onClick: () => toggleActive(r) },
          {
            key: 'delete',
            label: deletingId === r.id ? 'Deleting…' : 'Delete',
            icon: Trash2, variant: 'destructive',
            disabled: deletingId === r.id || !!r.isActive,
            disabledReason: r.isActive ? 'Deactivate the route first' : 'Delete in progress',
            onClick: () => openDeleteConfirm(r),
          },
        ];
        return (
          <div className="flex justify-end">
            <RowActionsMenu actions={actions} triggerLabel={`Actions for ${r.name}`} />
          </div>
        );
      },
    },
  ], [router, deletingId]);

  const bulkActions: BulkAction<BusRoute>[] = useMemo(() => [
    {
      key: 'activate', label: 'Activate', icon: Power,
      run: async (rs) => { await bulkPatchActive(rs, true); await loadRoutes(); },
    },
    {
      key: 'deactivate', label: 'Deactivate', icon: Power,
      run: async (rs) => { await bulkPatchActive(rs, false); await loadRoutes(); },
    },
    {
      key: 'delete', label: 'Delete', icon: Trash2, variant: 'destructive',
      confirm: (rs) => `Soft-delete ${rs.length} route${rs.length === 1 ? '' : 's'}? Active routes with live schedules will be refused.`,
      run: async (rs) => { await bulkDelete(rs); await loadRoutes(); },
    },
  ], [loadRoutes]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Routes"
        subtitle={`${routes.filter(r=>r.isActive).length} active · ${routes.length} total`}
        icon={MapIcon}
        accent="violet"
        actions={
          <button onClick={() => router.push('/bus-ops/route-planner')} className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            <Plus className="w-4 h-4" /> New Route
          </button>
        }
      />

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm whitespace-pre-line">
          {error}
        </div>
      )}

      <SmartDataGrid<BusRoute>
        rows={routes}
        columns={columns}
        getRowId={r => r.id}
        loading={loading}
        emptyMessage="No routes configured yet."
        initialSort={{ key: 'name', dir: 'asc' }}
        kpis={kpis}
        filterChips={filterChips}
        bulkActions={bulkActions}
        onBulkComplete={loadRoutes}
        toolbar={{ title: 'Routes', exportName: 'bus-ops-routes' }}
      />

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
