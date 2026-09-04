'use client';
/**
 * /bus-ops/geofences — Geofence Management
 *
 * Split-pane page: geofence list on the left (filter by type, create / edit /
 * delete), Google Map on the right. Drawing tools (Circle / Polygon) live in
 * the map toolbar above the map. On draw-complete the operator names/types
 * the zone in the same edit modal used for editing existing ones.
 *
 * The map is dynamic-imported with ssr:false because loadGoogleMaps() touches
 * `window`.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { MapPin, Plus, Trash2, Circle as CircleIcon, Hexagon, X } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';
import type { GeofenceRecord, GeofenceType, DrawResult } from '@/components/bus-ops/GeofenceMap';

const GeofenceMap = dynamic(() => import('@/components/bus-ops/GeofenceMap'), { ssr: false });

const TYPES: { value: GeofenceType; label: string; color: string }[] = [
  { value: 'STOP',               label: 'Stop',                color: 'bg-violet-500/20 text-violet-300 border-violet-500/40' },
  { value: 'GARAGE',             label: 'Garage',              color: 'bg-slate-500/20 text-[var(--text-main)] border-slate-500/40' },
  { value: 'ORIGIN_DESTINATION', label: 'Origin / Destination', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
  { value: 'BASE_CAMP',          label: 'Base Camp',           color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  { value: 'ACCOMMODATION',      label: 'Accommodation',        color: 'bg-sky-500/20 text-sky-300 border-sky-500/40' },
];
const TYPE_LABEL = Object.fromEntries(TYPES.map(t => [t.value, t.label]));
const TYPE_PILL  = Object.fromEntries(TYPES.map(t => [t.value, t.color]));

interface EditState {
  id: string | null; // null = new
  name: string;
  type: GeofenceType;
  shape: 'CIRCLE' | 'POLYGON';
  centerLat: number | null;
  centerLng: number | null;
  radiusM: number | null;
  polygon: Array<{ lat: number; lng: number }> | null;
  address: string;
  notes: string;
  active: boolean;
}

const EMPTY_EDIT: EditState = {
  id: null, name: '', type: 'STOP', shape: 'CIRCLE',
  centerLat: null, centerLng: null, radiusM: null, polygon: null,
  address: '', notes: '', active: true,
};

export default function GeofencesPage() {
  const [geofences, setGeofences]   = useState<GeofenceRecord[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | GeofenceType>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawMode, setDrawMode]     = useState<'CIRCLE' | 'POLYGON' | null>(null);
  const [edit, setEdit]             = useState<EditState | null>(null);
  const [saving, setSaving]         = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/bus-ops/geofences', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGeofences(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load geofences');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(
    () => typeFilter === 'ALL' ? geofences : geofences.filter(g => g.type === typeFilter),
    [geofences, typeFilter],
  );

  const beginNew = (shape: 'CIRCLE' | 'POLYGON') => {
    // Enable the drawing tool; the modal opens on draw-complete via handleDraw.
    setSelectedId(null);
    setDrawMode(shape);
  };

  const handleDraw = useCallback((r: DrawResult) => {
    setDrawMode(null);
    if (r.shape === 'CIRCLE') {
      setEdit({
        ...EMPTY_EDIT,
        shape: 'CIRCLE',
        centerLat: r.centerLat, centerLng: r.centerLng, radiusM: r.radiusM,
      });
    } else {
      setEdit({
        ...EMPTY_EDIT,
        shape: 'POLYGON',
        polygon: r.polygon,
      });
    }
  }, []);

  const openEditor = (id: string) => {
    const g = geofences.find(x => x.id === id);
    if (!g) return;
    setSelectedId(id);
    setEdit({
      id: g.id, name: g.name, type: g.type, shape: g.shape,
      centerLat: g.centerLat, centerLng: g.centerLng, radiusM: g.radiusM,
      polygon: g.polygon, address: '', notes: '', active: g.active,
    });
  };

  const closeEditor = () => setEdit(null);

  const save = async () => {
    if (!edit) return;
    if (!edit.name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      const body = {
        name: edit.name.trim(),
        type: edit.type,
        shape: edit.shape,
        centerLat: edit.shape === 'CIRCLE' ? edit.centerLat : null,
        centerLng: edit.shape === 'CIRCLE' ? edit.centerLng : null,
        radiusM:   edit.shape === 'CIRCLE' ? edit.radiusM : null,
        polygon:   edit.shape === 'POLYGON' ? edit.polygon : null,
        address: edit.address, notes: edit.notes, active: edit.active,
      };
      const res = edit.id
        ? await fetch(`/api/bus-ops/geofences/${edit.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch(`/api/bus-ops/geofences`,             { method: 'POST',  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      const saved = await res.json();
      setEdit(null);
      setSelectedId(saved.id ?? null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this geofence? (soft delete — history preserved)')) return;
    try {
      const res = await fetch(`/api/bus-ops/geofences/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (selectedId === id) setSelectedId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Geofences"
        subtitle={`${geofences.length} defined · draw circle or polygon on the map, then name and classify`}
        icon={MapPin}
        accent="violet"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => beginNew('CIRCLE')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold border transition-colors ${
                drawMode === 'CIRCLE'
                  ? 'bg-violet-600 border-violet-500 text-[var(--text-main)]'
                  : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-main)] hover:border-violet-500/40 hover:text-[var(--text-main)]'
              }`}>
              <CircleIcon className="w-4 h-4" /> Draw Circle
            </button>
            <button
              onClick={() => beginNew('POLYGON')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold border transition-colors ${
                drawMode === 'POLYGON'
                  ? 'bg-violet-600 border-violet-500 text-[var(--text-main)]'
                  : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-main)] hover:border-violet-500/40 hover:text-[var(--text-main)]'
              }`}>
              <Hexagon className="w-4 h-4" /> Draw Polygon
            </button>
            {drawMode && (
              <button onClick={() => setDrawMode(null)}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-[var(--text-muted)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-hover)]">
                <X className="w-4 h-4" /> Cancel
              </button>
            )}
          </div>
        }
      />

      {error && <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-300 text-sm">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: list + filter */}
        <div className="lg:col-span-1 space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setTypeFilter('ALL')}
              className={`text-xs px-2.5 py-1 rounded-full border ${typeFilter === 'ALL' ? 'bg-violet-600 border-violet-500 text-[var(--text-main)]' : 'bg-[var(--bg-surface)]/50 border-[var(--border-subtle)] text-[var(--text-muted)]'}`}>
              All ({geofences.length})
            </button>
            {TYPES.map(t => {
              const count = geofences.filter(g => g.type === t.value).length;
              return (
                <button key={t.value} onClick={() => setTypeFilter(t.value)}
                  className={`text-xs px-2.5 py-1 rounded-full border ${typeFilter === t.value ? 'bg-violet-600 border-violet-500 text-[var(--text-main)]' : `${t.color}`}`}>
                  {t.label} ({count})
                </button>
              );
            })}
          </div>

          <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-[var(--text-muted)] text-sm animate-pulse">Loading…</div>
            ) : visible.length === 0 ? (
              <div className="p-8 text-center text-[var(--text-muted)] text-sm">
                {geofences.length === 0
                  ? <>No geofences yet. Click <strong className="text-violet-300">Draw Circle</strong> or <strong className="text-violet-300">Draw Polygon</strong> to start.</>
                  : 'No geofences match this filter.'}
              </div>
            ) : (
              <ul className="divide-y divide-white/5 max-h-[62vh] overflow-y-auto">
                {visible.map(g => (
                  <li key={g.id}
                    onClick={() => { setSelectedId(g.id); }}
                    className={`px-4 py-3 cursor-pointer transition-colors ${selectedId === g.id ? 'bg-violet-500/10' : 'hover:bg-[var(--bg-surface-hover)]'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[var(--text-main)] truncate">{g.name}</div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${TYPE_PILL[g.type]}`}>{TYPE_LABEL[g.type]}</span>
                          <span className="text-[10px] text-[var(--text-muted)]">
                            {g.shape === 'CIRCLE' ? `● ${g.radiusM ?? '?'} m` : `⬡ ${g.polygon?.length ?? 0} vertices`}
                          </span>
                          {!g.active && <span className="text-[10px] text-[var(--text-faint)] italic">inactive</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={e => { e.stopPropagation(); openEditor(g.id); }}
                          className="text-xs px-2 py-1 rounded border border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-violet-500/40 hover:text-[var(--text-main)]">
                          Edit
                        </button>
                        <button onClick={e => { e.stopPropagation(); remove(g.id); }}
                          className="p-1 rounded border border-[var(--border-subtle)] text-rose-400 hover:border-rose-500/40 hover:bg-rose-500/10">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right: map */}
        <div className="lg:col-span-2">
          <GeofenceMap
            geofences={visible}
            selectedId={selectedId}
            drawMode={drawMode}
            onDraw={handleDraw}
            onSelect={setSelectedId}
            className="h-[65vh] min-h-[420px]"
          />
          {drawMode && (
            <div className="mt-2 text-xs text-violet-300">
              {drawMode === 'CIRCLE'
                ? 'Click and drag on the map to draw a circle.'
                : 'Click each vertex on the map, then click the first vertex to close the polygon.'}
            </div>
          )}
        </div>
      </div>

      {/* Editor modal — used for both new-after-draw and edit-existing. */}
      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-[var(--bg-surface)]/95 border border-[var(--border-subtle)] rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-[var(--text-main)]">{edit.id ? 'Edit Geofence' : 'New Geofence'}</h2>
              <button onClick={closeEditor} className="text-[var(--text-muted)] hover:text-[var(--text-main)]"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">Name *</label>
                <input type="text" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })}
                  placeholder="e.g. Musaffah Bus Stop 3, ICAD Base Camp"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-violet-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">Type *</label>
                <select value={edit.type} onChange={e => setEdit({ ...edit, type: e.target.value as GeofenceType })}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-violet-500 focus:outline-none">
                  {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>

              <div className="text-xs text-[var(--text-muted)] bg-[var(--bg-surface)]/40 rounded-lg px-3 py-2 border border-[var(--border-subtle)]">
                {edit.shape === 'CIRCLE' ? (
                  <>Circle · centre {edit.centerLat?.toFixed(5)}, {edit.centerLng?.toFixed(5)} · radius {edit.radiusM} m</>
                ) : (
                  <>Polygon · {edit.polygon?.length ?? 0} vertices</>
                )}
                <span className="ml-2 text-[var(--text-faint)]">(re-draw on the map to change shape)</span>
              </div>

              {edit.shape === 'CIRCLE' && (
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">Radius (metres)</label>
                  <input type="number" min={10} step={10} value={edit.radiusM ?? 0}
                    onChange={e => setEdit({ ...edit, radiusM: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-violet-500 focus:outline-none" />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">Notes</label>
                <textarea value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })} rows={2}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-violet-500 focus:outline-none" />
              </div>

              <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                <input type="checkbox" checked={edit.active} onChange={e => setEdit({ ...edit, active: e.target.checked })}
                  className="w-4 h-4 accent-violet-500" />
                Active (unchecked = paused — hidden from downstream lookups)
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={closeEditor}
                  className="px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]">Cancel</button>
                <button onClick={save} disabled={saving}
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-50">
                  {saving ? 'Saving…' : edit.id ? 'Save' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
