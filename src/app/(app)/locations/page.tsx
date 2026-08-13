'use client';
/**
 * /locations — Shared geospatial catalogue.
 *
 * Phase 1 of the shared-geospatial capability: one unified view over every
 * Place in the tenant (stops, geofences, depots, garages, warehouses,
 * operational zones, sites). Every module writes to and reads from the
 * same `spatial.places` table, so this is the single place ops can
 * inventory, edit and audit them.
 *
 * Phase 1 scope: list + create + edit + delete via form (name / type /
 * shape / geometry fields). Map drawing (reusing GeofenceMap.tsx) lands
 * in Phase 2 when bus-ops/geofences cuts over to /api/places.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { MapPin, Plus, Edit, Trash2, X } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';
import {
  PLACE_TYPES, PLACE_SHAPES, PLACE_TYPE_LABELS, PLACE_TYPE_GROUPS,
  isPlaceType, type PlaceType, type PlaceShape,
} from '@/lib/places/types';

interface Place {
  id: string;
  name: string;
  code: string | null;
  type: string;
  shape: string;
  description: string | null;
  address: string | null;
  centerLat: number | null;
  centerLng: number | null;
  radiusM: number | null;
  polygon: unknown;
  metadata: unknown;
  sourceModule: string | null;
  active: boolean;
  createdAt: string;
}

interface EditState {
  id: string | null;
  name: string;
  code: string;
  type: PlaceType;
  shape: PlaceShape;
  centerLat: string;   // string in the form; coerced on submit
  centerLng: string;
  radiusM: string;
  address: string;
  description: string;
  active: boolean;
}

const EMPTY_EDIT: EditState = {
  id: null, name: '', code: '', type: 'STOP', shape: 'POINT',
  centerLat: '', centerLng: '', radiusM: '', address: '', description: '', active: true,
};

const TYPE_PILL: Record<string, string> = {
  STOP:               'bg-violet-500/20 text-violet-300 border-violet-500/40',
  GEOFENCE:           'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
  DEPOT:              'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  GARAGE:             'bg-slate-500/20 text-slate-200 border-slate-500/40',
  WAREHOUSE:          'bg-orange-500/20 text-orange-300 border-orange-500/40',
  OPERATIONAL_ZONE:   'bg-teal-500/20 text-teal-300 border-teal-500/40',
  ORIGIN_DESTINATION: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  BASE_CAMP:          'bg-amber-500/20 text-amber-300 border-amber-500/40',
  ACCOMMODATION:      'bg-sky-500/20 text-sky-300 border-sky-500/40',
  PORT:               'bg-blue-500/20 text-blue-300 border-blue-500/40',
  CUSTOMER_SITE:      'bg-pink-500/20 text-pink-300 border-pink-500/40',
};

export default function LocationsPage() {
  // Optional deep-link: /locations?type=DEPOT scopes the initial filter.
  // useSearchParams needs a Suspense boundary in Next 15 — provided by the
  // wrapper at the bottom of the file.
  return (
    <React.Suspense fallback={<div className="text-slate-500 text-sm py-10 text-center">Loading…</div>}>
      <LocationsPageInner />
    </React.Suspense>
  );
}

function LocationsPageInner() {
  const sp = useSearchParams();
  const initialType = (() => {
    const t = sp?.get('type');
    return t && isPlaceType(t) ? t : 'ALL';
  })();

  const [places, setPlaces]     = useState<Place[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [typeFilter, setTF]     = useState<'ALL' | PlaceType>(initialType);
  const [q, setQ]               = useState('');
  const [edit, setEdit]         = useState<EditState | null>(null);
  const [saving, setSaving]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/places', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPlaces(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load places');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return places.filter(p => {
      if (typeFilter !== 'ALL' && p.type !== typeFilter) return false;
      if (needle && !p.name.toLowerCase().includes(needle) && !(p.code ?? '').toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [places, typeFilter, q]);

  // Group results by our PLACE_TYPE_GROUPS taxonomy so the render shows
  // Transport network → Facilities → Sites headings, mirroring the sidebar.
  const grouped = useMemo(() => {
    const byType = new Map<string, Place[]>();
    filtered.forEach(p => {
      const arr = byType.get(p.type) ?? [];
      arr.push(p);
      byType.set(p.type, arr);
    });
    return PLACE_TYPE_GROUPS.map(g => ({
      label: g.label,
      types: g.types.map(t => ({ type: t, rows: byType.get(t) ?? [] })).filter(x => x.rows.length > 0),
    })).filter(g => g.types.length > 0);
  }, [filtered]);

  const openNew  = () => setEdit({ ...EMPTY_EDIT });
  const openEdit = (p: Place) => setEdit({
    id: p.id, name: p.name, code: p.code ?? '',
    type: (p.type as PlaceType), shape: (p.shape as PlaceShape),
    centerLat: p.centerLat != null ? String(p.centerLat) : '',
    centerLng: p.centerLng != null ? String(p.centerLng) : '',
    radiusM:   p.radiusM   != null ? String(p.radiusM)   : '',
    address: p.address ?? '', description: p.description ?? '', active: p.active,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    setSaving(true); setError('');
    try {
      // Coerce the string form values to the shapes the API expects.
      const centerLat = edit.centerLat.trim() ? Number(edit.centerLat) : null;
      const centerLng = edit.centerLng.trim() ? Number(edit.centerLng) : null;
      const radiusM   = edit.radiusM.trim()   ? Number(edit.radiusM)   : null;
      const payload = {
        name: edit.name, code: edit.code || null,
        type: edit.type, shape: edit.shape,
        centerLat, centerLng, radiusM,
        address: edit.address || null,
        description: edit.description || null,
        active: edit.active,
      };
      const url    = edit.id ? `/api/places/${edit.id}` : '/api/places';
      const method = edit.id ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      setEdit(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally { setSaving(false); }
  };

  const remove = async (p: Place) => {
    if (!confirm(`Delete "${p.name}"? This is a soft delete — history is preserved.`)) return;
    setError('');
    try {
      const res = await fetch(`/api/places/${p.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Locations"
        subtitle="Shared geospatial catalogue — stops, geofences, depots, garages, warehouses and operational zones. One record, referenced from every module."
        icon={MapPin}
        accent="cyan"
        actions={
          <button onClick={openNew}
            className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 px-4 py-2.5 text-sm text-white font-semibold">
            <Plus className="w-4 h-4" /> Add location
          </button>
        }
      />

      {error && <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-300 text-sm">{error}</div>}

      {/* Filters */}
      <div className="rounded-2xl bg-slate-800/50 border border-white/10 p-4 flex flex-wrap items-center gap-3">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or code…"
          className="bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm w-64 focus:border-cyan-500/40 outline-none" />
        <select value={typeFilter} onChange={e => setTF(e.target.value as PlaceType | 'ALL')}
          className="bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm">
          <option value="ALL">All types</option>
          {PLACE_TYPES.map(t => <option key={t} value={t}>{PLACE_TYPE_LABELS[t]}</option>)}
        </select>
        <div className="ml-auto text-xs text-slate-400">{filtered.length} of {places.length}</div>
      </div>

      {loading ? (
        <div className="py-10 text-center text-slate-400 text-sm animate-pulse">Loading places…</div>
      ) : places.length === 0 ? (
        <div className="py-16 text-center text-slate-400 text-sm">
          No locations yet. Click <strong>Add location</strong> to create your first geofence, depot or stop.
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(g => (
            <section key={g.label}>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">{g.label}</h3>
              <div className="rounded-2xl bg-slate-800/50 border border-white/10 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/5 text-xs text-slate-400">
                      <th className="px-4 py-2 text-left">Name</th>
                      <th className="px-4 py-2 text-left">Type</th>
                      <th className="px-4 py-2 text-left">Shape</th>
                      <th className="px-4 py-2 text-left">Address</th>
                      <th className="px-4 py-2 text-left">Source</th>
                      <th className="px-4 py-2 text-left">Status</th>
                      <th className="px-4 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.types.flatMap(t => t.rows).map(p => (
                      <tr key={p.id} className="border-b border-white/5 hover:bg-white/5">
                        <td className="px-4 py-2">
                          <div className="text-sm text-white">{p.name}</div>
                          {p.code && <div className="text-[10px] text-slate-500 font-mono">{p.code}</div>}
                        </td>
                        <td className="px-4 py-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${TYPE_PILL[p.type] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/40'}`}>
                            {PLACE_TYPE_LABELS[p.type as PlaceType] ?? p.type}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-400">{p.shape}</td>
                        <td className="px-4 py-2 text-xs text-slate-300">{p.address ?? '—'}</td>
                        <td className="px-4 py-2 text-[11px] text-slate-500 italic">{p.sourceModule ?? '—'}</td>
                        <td className="px-4 py-2">
                          {p.active
                            ? <span className="text-[10px] text-emerald-300">Active</span>
                            : <span className="text-[10px] text-slate-500">Inactive</span>}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => openEdit(p)} className="text-slate-400 hover:text-cyan-300 p-1" title="Edit"><Edit className="w-3.5 h-3.5" /></button>
                            <button onClick={() => remove(p)}   className="text-slate-400 hover:text-rose-300 p-1" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Edit / New modal */}
      {edit && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form onSubmit={submit} className="bg-slate-900 border border-white/10 rounded-2xl p-5 w-full max-w-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">{edit.id ? 'Edit location' : 'Add location'}</h3>
              <button type="button" onClick={() => setEdit(null)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-slate-300">
                Name*
                <input required value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })}
                  className="mt-1 w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-xs text-slate-300">
                Code
                <input value={edit.code} onChange={e => setEdit({ ...edit, code: e.target.value })} placeholder="GAR-DUB-01"
                  className="mt-1 w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono" />
              </label>
              <label className="text-xs text-slate-300">
                Type*
                <select value={edit.type} onChange={e => setEdit({ ...edit, type: e.target.value as PlaceType })}
                  className="mt-1 w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
                  {PLACE_TYPES.map(t => <option key={t} value={t}>{PLACE_TYPE_LABELS[t]}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-300">
                Shape*
                <select value={edit.shape} onChange={e => setEdit({ ...edit, shape: e.target.value as PlaceShape })}
                  className="mt-1 w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
                  {PLACE_SHAPES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-300">
                Center latitude
                <input value={edit.centerLat} onChange={e => setEdit({ ...edit, centerLat: e.target.value })} placeholder="25.276"
                  className="mt-1 w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono" />
              </label>
              <label className="text-xs text-slate-300">
                Center longitude
                <input value={edit.centerLng} onChange={e => setEdit({ ...edit, centerLng: e.target.value })} placeholder="55.296"
                  className="mt-1 w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono" />
              </label>
              {edit.shape === 'CIRCLE' && (
                <label className="text-xs text-slate-300 col-span-2">
                  Radius (metres)*
                  <input value={edit.radiusM} onChange={e => setEdit({ ...edit, radiusM: e.target.value })} placeholder="200"
                    className="mt-1 w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono" />
                </label>
              )}
              <label className="text-xs text-slate-300 col-span-2">
                Address
                <input value={edit.address} onChange={e => setEdit({ ...edit, address: e.target.value })} placeholder="Sheikh Zayed Road, Dubai"
                  className="mt-1 w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-xs text-slate-300 col-span-2">
                Description
                <textarea value={edit.description} onChange={e => setEdit({ ...edit, description: e.target.value })} rows={2}
                  className="mt-1 w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
              </label>
              <label className="text-xs text-slate-300 col-span-2 flex items-center gap-2">
                <input type="checkbox" checked={edit.active} onChange={e => setEdit({ ...edit, active: e.target.checked })} />
                Active
              </label>
            </div>
            {edit.shape === 'POLYGON' && (
              <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2">
                Polygon geometry can&apos;t be drawn from this form yet — Phase 2 wires the map-drawing tool.
                Create it via bus-ops geofences for now, or import via the API.
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setEdit(null)}
                className="px-4 py-2 rounded-lg text-sm text-slate-300 hover:bg-white/5">Cancel</button>
              <button type="submit" disabled={saving}
                className="px-4 py-2 rounded-lg text-sm bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-50">
                {saving ? 'Saving…' : (edit.id ? 'Save' : 'Create')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
