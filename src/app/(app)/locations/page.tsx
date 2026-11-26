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
import { MapPin, Plus, Edit, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';
import {
  PLACE_TYPES, PLACE_SHAPES, PLACE_TYPE_LABELS, PLACE_TYPE_GROUPS,
  isPlaceType, type PlaceType, type PlaceShape,
} from '@/lib/places/types';

import { CheckboxField, FormAlert, FormField, FormFooter, FormSection, PrimaryButton, SecondaryButton, SelectInput, TextAreaInput, TextInput } from '@/components/ui/form-kit';
import { FormModal } from '@/components/ui/form-modal';
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
  GARAGE:             'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/40',
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
    <React.Suspense fallback={<div className="text-[var(--text-faint)] text-sm py-10 text-center">Loading…</div>}>
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
            className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 px-4 py-2.5 text-sm text-[var(--text-main)] font-semibold">
            <Plus className="w-4 h-4" /> Add location
          </button>
        }
      />

      {error && <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-300 text-sm">{error}</div>}

      {/* Filters */}
      <div className="rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4 flex flex-wrap items-center gap-3">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or code…"
          className="bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm w-64 focus:border-cyan-500/40 outline-none text-[var(--text-main)]" />
        <select value={typeFilter} onChange={e => setTF(e.target.value as PlaceType | 'ALL')}
          className="bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)]">
          <option value="ALL">All types</option>
          {PLACE_TYPES.map(t => <option key={t} value={t}>{PLACE_TYPE_LABELS[t]}</option>)}
        </select>
        <div className="ml-auto text-xs text-[var(--text-muted)]">{filtered.length} of {places.length}</div>
      </div>

      {loading ? (
        <div className="py-10 text-center text-[var(--text-muted)] text-sm animate-pulse">Loading places…</div>
      ) : places.length === 0 ? (
        <div className="py-16 text-center text-[var(--text-muted)] text-sm">
          No locations yet. Click <strong>Add location</strong> to create your first geofence, depot or stop.
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(g => (
            <section key={g.label}>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-2">{g.label}</h3>
              <div className="rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
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
                      <tr key={p.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]">
                        <td className="px-4 py-2">
                          <div className="text-sm text-[var(--text-main)]">{p.name}</div>
                          {p.code && <div className="text-[10px] text-[var(--text-faint)] font-mono">{p.code}</div>}
                        </td>
                        <td className="px-4 py-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${TYPE_PILL[p.type] ?? 'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/40'}`}>
                            {PLACE_TYPE_LABELS[p.type as PlaceType] ?? p.type}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs text-[var(--text-muted)]">{p.shape}</td>
                        <td className="px-4 py-2 text-xs text-[var(--text-muted)]">{p.address ?? '—'}</td>
                        <td className="px-4 py-2 text-[11px] text-[var(--text-faint)] italic">{p.sourceModule ?? '—'}</td>
                        <td className="px-4 py-2">
                          {p.active
                            ? <span className="text-[10px] text-emerald-300">Active</span>
                            : <span className="text-[10px] text-[var(--text-faint)]">Inactive</span>}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => openEdit(p)} className="text-[var(--text-muted)] hover:text-cyan-300 p-1" title="Edit"><Edit className="w-3.5 h-3.5" /></button>
                            <button onClick={() => remove(p)}   className="text-[var(--text-muted)] hover:text-rose-300 p-1" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
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
        <FormModal
          onClose={() => setEdit(null)}
          title={edit.id ? 'Edit location' : 'Add location'}
          icon={MapPin}
          size="lg"
        >
          <form onSubmit={submit} className="space-y-5">
            <FormSection title="Location details" columns={2}>
              <FormField label="Name" required>
                <TextInput required value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} />
              </FormField>
              <FormField label="Code">
                <TextInput value={edit.code} onChange={e => setEdit({ ...edit, code: e.target.value })} placeholder="GAR-DUB-01" className="font-mono" />
              </FormField>
              <FormField label="Type" required>
                <SelectInput value={edit.type} onChange={e => setEdit({ ...edit, type: e.target.value as PlaceType })}>
                  {PLACE_TYPES.map(t => <option key={t} value={t}>{PLACE_TYPE_LABELS[t]}</option>)}
                </SelectInput>
              </FormField>
              <FormField label="Shape" required>
                <SelectInput value={edit.shape} onChange={e => setEdit({ ...edit, shape: e.target.value as PlaceShape })}>
                  {PLACE_SHAPES.map(s => <option key={s} value={s}>{s}</option>)}
                </SelectInput>
              </FormField>
            </FormSection>

            <FormSection title="Geometry" columns={2}>
              <FormField label="Center latitude">
                <TextInput value={edit.centerLat} onChange={e => setEdit({ ...edit, centerLat: e.target.value })} placeholder="25.276" className="font-mono" />
              </FormField>
              <FormField label="Center longitude">
                <TextInput value={edit.centerLng} onChange={e => setEdit({ ...edit, centerLng: e.target.value })} placeholder="55.296" className="font-mono" />
              </FormField>
              {edit.shape === 'CIRCLE' && (
                <FormField label="Radius" qualifier="(metres)" required span="full">
                  <TextInput value={edit.radiusM} onChange={e => setEdit({ ...edit, radiusM: e.target.value })} placeholder="200" className="font-mono" />
                </FormField>
              )}
              {edit.shape === 'POLYGON' && (
                <div className="md:col-span-full">
                  <FormAlert tone="warning">
                    Polygon geometry can&apos;t be drawn from this form yet — Phase 2 wires the map-drawing tool.
                    Create it via bus-ops geofences for now, or import via the API.
                  </FormAlert>
                </div>
              )}
            </FormSection>

            <FormSection title="Additional details" columns={1}>
              <FormField label="Address">
                <TextInput value={edit.address} onChange={e => setEdit({ ...edit, address: e.target.value })} placeholder="Sheikh Zayed Road, Dubai" />
              </FormField>
              <FormField label="Description">
                <TextAreaInput value={edit.description} onChange={e => setEdit({ ...edit, description: e.target.value })} rows={2} />
              </FormField>
              <CheckboxField label="Active" checked={edit.active} onChange={v => setEdit({ ...edit, active: v })} />
            </FormSection>

            <FormFooter secondary={<SecondaryButton type="button" onClick={() => setEdit(null)}>Cancel</SecondaryButton>}>
              <PrimaryButton type="submit" disabled={saving}>{saving ? 'Saving…' : (edit.id ? 'Save' : 'Create')}</PrimaryButton>
            </FormFooter>
          </form>
        </FormModal>
      )}
    </div>
  );
}
