'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Map as MapIcon, Plus } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';

interface RouteStop { id?: string; stopName: string; sequence: number; estimatedArrivalMins?: number; landmark?: string; gpsLat?: number; gpsLng?: number; }
interface BusRoute  {
  id: string; name: string; origin: string; destination: string; routeType?: string;
  totalDistanceKm?: number; estimatedDurationMins?: number; capacity?: number;
  isActive?: boolean; notes?: string; stops?: RouteStop[];
  schedules?: any[]; createdAt?: string;
}

const ROUTE_TYPES = ['STAFF','SCHOOL','BOTH'];

export default function RoutesPage() {
  const [routes, setRoutes]         = useState<BusRoute[]>([]);
  const [selected, setSelected]     = useState<BusRoute | null>(null);
  const [showModal, setShowModal]   = useState(false);
  const [showStops, setShowStops]   = useState(false);
  const [editRoute, setEditRoute]   = useState<BusRoute | null>(null);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');

  const emptyForm = { name:'', origin:'', destination:'', routeType:'STAFF', totalDistanceKm:'', estimatedDurationMins:'', capacity:'30', notes:'' };
  const [formData, setFormData]     = useState(emptyForm);
  const [stops, setStops]           = useState<RouteStop[]>([]);
  const [newStop, setNewStop]       = useState({ stopName:'', estimatedArrivalMins:'', landmark:'' });

  const loadRoutes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/bus-ops/routes');
      const data = await res.json();
      setRoutes(Array.isArray(data) ? data : []);
    } catch { setError('Failed to load routes'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadRoutes(); }, [loadRoutes]);

  const openNew = () => { setEditRoute(null); setFormData(emptyForm); setStops([]); setShowModal(true); };
  const openEdit = (r: BusRoute) => {
    setEditRoute(r);
    setFormData({ name:r.name, origin:r.origin, destination:r.destination, routeType:r.routeType??'STAFF', totalDistanceKm:String(r.totalDistanceKm??''), estimatedDurationMins:String(r.estimatedDurationMins??''), capacity:String(r.capacity??30), notes:r.notes??'' });
    setStops(r.stops?.map(s=>({...s}))?? []);
    setShowModal(true);
  };
  const openStops = (r: BusRoute) => { setSelected(r); setStops(r.stops?.map(s=>({...s}))?? []); setShowStops(true); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: formData.name, origin: formData.origin, destination: formData.destination,
        routeType: formData.routeType,
        totalDistanceKm: formData.totalDistanceKm ? parseFloat(formData.totalDistanceKm) : null,
        estimatedDurationMins: formData.estimatedDurationMins ? parseInt(formData.estimatedDurationMins) : null,
        capacity: parseInt(formData.capacity) || 30,
        notes: formData.notes || null,
        stops: stops.map((s,i)=>({...s, sequence:i+1})),
      };
      const url    = editRoute ? `/api/bus-ops/routes/${editRoute.id}` : '/api/bus-ops/routes';
      const method = editRoute ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
      if (!res.ok) throw new Error();
      setShowModal(false);
      loadRoutes();
    } catch { setError('Failed to save route'); }
    finally { setSaving(false); }
  };

  const saveStops = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await fetch(`/api/bus-ops/routes/${selected.id}/stops`, {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ stops: stops.map((s,i)=>({...s,sequence:i+1})) }),
      });
      setShowStops(false);
      loadRoutes();
    } catch { setError('Failed to save stops'); }
    finally { setSaving(false); }
  };

  const addStop = () => {
    if (!newStop.stopName.trim()) return;
    setStops(prev => [...prev, { stopName: newStop.stopName, sequence: prev.length+1, estimatedArrivalMins: newStop.estimatedArrivalMins ? parseInt(newStop.estimatedArrivalMins) : undefined, landmark: newStop.landmark || undefined }]);
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

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-slate-400 animate-pulse">Loading routes...</div></div>;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Routes"
        subtitle={`${routes.filter(r=>r.isActive).length} active · ${routes.length} total`}
        icon={MapIcon}
        accent="violet"
        actions={
          <button onClick={openNew} className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            <Plus className="w-4 h-4" /> New Route
          </button>
        }
      />

      {error && <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {routes.length === 0 ? (
          <div className="col-span-3 text-center text-slate-400 py-16 bg-slate-800/30 border border-white/5 rounded-2xl">No routes configured yet.</div>
        ) : routes.map(r => (
          <div key={r.id} className={`bg-slate-800/50 border rounded-2xl p-5 transition-all ${r.isActive ? 'border-white/10' : 'border-white/5 opacity-60'}`}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-semibold text-white">{r.name}</div>
                <div className="text-xs text-slate-400 mt-0.5">{r.routeType ?? 'STAFF'}</div>
              </div>
              {r.isActive
                ? <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Active</span>
                : <span className="px-2 py-0.5 rounded-full text-xs bg-slate-500/20 text-slate-400 border border-slate-500/30">Inactive</span>}
            </div>
            <div className="space-y-1 mb-4">
              <div className="text-sm text-slate-300"><span className="text-slate-500 text-xs mr-1">FROM</span>{r.origin}</div>
              <div className="text-sm text-slate-300"><span className="text-slate-500 text-xs mr-2">TO</span>{r.destination}</div>
            </div>
            <div className="flex gap-4 text-xs text-slate-400 mb-4">
              <span>{r.stops?.length ?? 0} stops</span>
              {r.totalDistanceKm && <span>{r.totalDistanceKm} km</span>}
              {r.estimatedDurationMins && <span>~{r.estimatedDurationMins} min</span>}
              <span>Cap: {r.capacity ?? 30}</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => openEdit(r)} className="text-xs px-2 py-1 rounded bg-violet-500/20 text-violet-400 border border-violet-500/30 hover:bg-violet-500/30">Edit</button>
              <button onClick={() => openStops(r)} className="text-xs px-2 py-1 rounded bg-violet-500/20 text-violet-400 border border-violet-500/30 hover:bg-violet-500/30">Stops ({r.stops?.length ?? 0})</button>
              <button onClick={() => toggleActive(r)} className="text-xs px-2 py-1 rounded bg-slate-700 text-slate-300 border border-white/10 hover:bg-slate-600">
                {r.isActive ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Route Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-800/95 border border-white/10 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">{editRoute ? 'Edit Route' : 'New Route'}</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-slate-300 mb-2">Route Name *</label>
                  <input type="text" value={formData.name} onChange={e=>setFormData(p=>({...p,name:e.target.value}))} required placeholder="e.g., Dubai Marina - Business Bay"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none" />
                </div>
                {[{label:'Origin *',key:'origin',ph:'e.g., Dubai Marina'},{label:'Destination *',key:'destination',ph:'e.g., Business Bay Office'}].map(({label,key,ph})=>(
                  <div key={key}>
                    <label className="block text-sm font-medium text-slate-300 mb-2">{label}</label>
                    <input type="text" value={(formData as any)[key]} onChange={e=>setFormData(p=>({...p,[key]:e.target.value}))} required placeholder={ph}
                      className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none" />
                  </div>
                ))}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Route Type</label>
                  <select value={formData.routeType} onChange={e=>setFormData(p=>({...p,routeType:e.target.value}))}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none">
                    {ROUTE_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                {[{label:'Distance (km)',key:'totalDistanceKm',ph:'25'},{label:'Est. Duration (min)',key:'estimatedDurationMins',ph:'45'},{label:'Capacity (seats)',key:'capacity',ph:'30'}].map(({label,key,ph})=>(
                  <div key={key}>
                    <label className="block text-sm font-medium text-slate-300 mb-2">{label}</label>
                    <input type="number" value={(formData as any)[key]} onChange={e=>setFormData(p=>({...p,[key]:e.target.value}))} placeholder={ph} min="0"
                      className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none" />
                  </div>
                ))}
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-slate-300 mb-2">Notes</label>
                  <textarea value={formData.notes} onChange={e=>setFormData(p=>({...p,notes:e.target.value}))} rows={2} placeholder="Additional notes..."
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none" />
                </div>
              </div>

              {/* Inline stop builder */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-slate-300">Stops ({stops.length})</label>
                </div>
                <div className="space-y-2 mb-2">
                  {stops.map((s,i)=>(
                    <div key={i} className="flex items-center gap-2 bg-slate-700/50 rounded-lg px-3 py-2">
                      <span className="text-slate-500 text-xs w-5">{i+1}</span>
                      <span className="text-sm text-white flex-1">{s.stopName}</span>
                      {s.estimatedArrivalMins && <span className="text-xs text-slate-400">+{s.estimatedArrivalMins}m</span>}
                      <button type="button" onClick={()=>moveStop(i,-1)} disabled={i===0} className="text-slate-400 hover:text-white disabled:opacity-30 text-xs">↑</button>
                      <button type="button" onClick={()=>moveStop(i,1)} disabled={i===stops.length-1} className="text-slate-400 hover:text-white disabled:opacity-30 text-xs">↓</button>
                      <button type="button" onClick={()=>removeStop(i)} className="text-rose-400 hover:text-rose-300 text-xs">✕</button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input type="text" value={newStop.stopName} onChange={e=>setNewStop(p=>({...p,stopName:e.target.value}))} placeholder="Stop name"
                    className="flex-1 px-3 py-1.5 rounded-lg bg-slate-700 border border-white/10 text-white text-sm placeholder-slate-500 focus:border-violet-500 focus:outline-none" />
                  <input type="number" value={newStop.estimatedArrivalMins} onChange={e=>setNewStop(p=>({...p,estimatedArrivalMins:e.target.value}))} placeholder="Min"
                    className="w-16 px-3 py-1.5 rounded-lg bg-slate-700 border border-white/10 text-white text-sm placeholder-slate-500 focus:outline-none" />
                  <button type="button" onClick={addStop}
                    className="px-3 py-1.5 rounded-lg bg-blue-500/30 text-blue-400 border border-blue-500/30 text-sm hover:bg-blue-500/50">+ Add</button>
                </div>
              </div>

              <div className="flex gap-4 justify-end pt-4">
                <button type="button" onClick={()=>setShowModal(false)} className="px-6 py-2 rounded-lg border border-white/10 text-white hover:bg-white/5">Cancel</button>
                <button type="submit" disabled={saving} className="px-6 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-50">
                  {saving ? 'Saving...' : editRoute ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
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
