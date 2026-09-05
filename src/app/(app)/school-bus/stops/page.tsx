'use client';
/**
 * School Bus — Stop Management
 * First-class geospatial stop registry with Emirate → City → Area hierarchy.
 * Stops are linked to routes and used for student pickup/dropoff assignments.
 */
import { useState, useEffect, useCallback } from 'react';

interface Stop {
  id: string;
  stop_code: string;
  stop_name: string;
  emirate: string;
  city?: string;
  area?: string;
  neighbourhood?: string;
  landmark?: string;
  lat?: number;
  lng?: number;
  geofence_radius_m: number;
  is_active: boolean;
  notes?: string;
  created_at: string;
}

const EMIRATES = ['Abu Dhabi','Dubai','Sharjah','Ajman','Umm Al Quwain','Ras Al Khaimah','Fujairah'];

const CITIES_BY_EMIRATE: Record<string, string[]> = {
  'Dubai':       ['Dubai City','Jebel Ali','Dubai South','Hatta'],
  'Abu Dhabi':   ['Abu Dhabi City','Al Ain','Al Dhafra','Zayed City'],
  'Sharjah':     ['Sharjah City','Khor Fakkan','Kalba','Dhaid'],
  'Ajman':       ['Ajman City','Manama'],
  'Ras Al Khaimah': ['RAK City','Al Hamra','Julfar'],
  'Umm Al Quwain': ['UAQ City'],
  'Fujairah':    ['Fujairah City','Dibba','Kalba'],
};

const AREAS_BY_CITY: Record<string, string[]> = {
  'Dubai City': ['Downtown','Dubai Marina','JBR','JLT','DIFC','Business Bay','Deira','Bur Dubai','Al Quoz','Jumeirah','Mirdif','Al Barsha','Silicon Oasis','International City','Motor City','Sports City','IMPZ','JVC','JVT','Discovery Gardens','Remraam','Mudon','Arabian Ranches','Emirates Hills','Palm Jumeirah','The Springs','The Meadows','The Lakes','The Greens','Al Furjan','Town Square','Dubai Hills','Damac Hills','Tilal Al Ghaf'],
  'Abu Dhabi City': ['Al Khalidiyah','Al Reem Island','Al Raha','Yas Island','Saadiyat Island','Al Bateen','Khalifa City','Masdar City','Al Mushrif','Al Nahyan','Electra'],
  'Al Ain': ['Al Ain City','Al Jimi','Al Hili','Al Maqam','Zakher','Al Khabisi'],
};

/* ─── Modal ─────────────────────────────────────────────────── */
function StopModal({ stop, onClose, onSaved }: {
  stop?: Stop | null; onClose: () => void; onSaved: () => void;
}) {
  const isEdit = !!stop;
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const [form, setForm] = useState({
    stopName:         stop?.stop_name         ?? '',
    emirate:          stop?.emirate           ?? 'Dubai',
    city:             stop?.city              ?? '',
    area:             stop?.area              ?? '',
    neighbourhood:    stop?.neighbourhood     ?? '',
    landmark:         stop?.landmark          ?? '',
    lat:              stop?.lat               ?? '',
    lng:              stop?.lng               ?? '',
    geofenceRadiusM:  stop?.geofence_radius_m ?? 100,
    notes:            stop?.notes             ?? '',
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));

  const cities = CITIES_BY_EMIRATE[form.emirate] ?? [];
  const areas  = AREAS_BY_CITY[form.city] ?? [];

  async function save() {
    if (!form.stopName.trim()) { setError('Stop name is required'); return; }
    setSaving(true); setError('');
    try {
      const url    = isEdit ? `/api/school-bus/stops/${stop!.id}` : '/api/school-bus/stops';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          lat: form.lat !== '' ? Number(form.lat) : null,
          lng: form.lng !== '' ? Number(form.lng) : null,
          geofenceRadiusM: Number(form.geofenceRadiusM),
        }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Save failed'); return; }
      onSaved();
    } catch { setError('Network error'); }
    finally { setSaving(false); }
  }

  const field = (label: string, k: keyof typeof form, type = 'text', placeholder = '') => (
    <div className="space-y-1">
      <label className="text-xs text-[var(--text-muted)]">{label}</label>
      <input type={type} value={String(form[k])} onChange={set(k)} placeholder={placeholder}
        className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-yellow-500/50" />
    </div>
  );

  const select = (label: string, k: keyof typeof form, opts: string[], placeholder = '') => (
    <div className="space-y-1">
      <label className="text-xs text-[var(--text-muted)]">{label}</label>
      <select value={String(form[k])} onChange={set(k)}
        className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-yellow-500/50">
        {placeholder && <option value="">{placeholder}</option>}
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <h2 className="text-[var(--text-main)] font-bold">{isEdit ? 'Edit Stop' : 'Add New Stop'}</h2>
          {isEdit && (
            <span className="text-xs font-mono text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded">
              {stop!.stop_code}
            </span>
          )}
          <button onClick={onClose} className="text-[var(--text-faint)] hover:text-[var(--text-main)] text-xl">×</button>
        </div>

        <div className="p-6 space-y-5">
          {/* Stop Name */}
          {field('Stop Name *', 'stopName', 'text', 'e.g. Marina Gate Bus Stop')}

          {/* Location Hierarchy */}
          <div className="grid grid-cols-2 gap-4">
            {select('Emirate *', 'emirate', EMIRATES)}
            {select('City', 'city', cities, '— Select City —')}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {areas.length > 0
              ? select('Area / Community', 'area', areas, '— Select Area —')
              : field('Area / Community', 'area', 'text', 'e.g. Al Barsha 1')
            }
            {field('Neighbourhood / Sub-area', 'neighbourhood', 'text', 'e.g. Block 7')}
          </div>
          {field('Nearest Landmark', 'landmark', 'text', 'e.g. Opposite LuLu Hypermarket')}

          {/* GPS */}
          <div className="rounded-xl bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] p-4 space-y-3">
            <p className="text-xs text-[var(--text-muted)] font-semibold uppercase tracking-wider">GPS Coordinates</p>
            <div className="grid grid-cols-2 gap-4">
              {field('Latitude', 'lat', 'number', '25.2048')}
              {field('Longitude', 'lng', 'number', '55.2708')}
            </div>
            <div className="grid grid-cols-2 gap-4">
              {field('Geofence Radius (metres)', 'geofenceRadiusM', 'number', '100')}
              <div className="flex items-end">
                <p className="text-xs text-[var(--text-faint)]">
                  Geofence triggers boarding/alighting events when students' devices enter this radius around the stop.
                </p>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label className="text-xs text-[var(--text-muted)]">Notes</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} placeholder="Any special instructions..."
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-yellow-500/50 resize-none" />
          </div>

          {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-muted)] text-sm font-semibold hover:bg-[var(--bg-surface-hover)] transition-all">
              Cancel
            </button>
            <button onClick={save} disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-yellow-500 text-white text-sm font-bold hover:bg-yellow-400 transition-all disabled:opacity-50">
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Stop'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────────── */
export default function StopsPage() {
  const [stops,    setStops]    = useState<Stop[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState<'new' | Stop | null>(null);
  const [search,   setSearch]   = useState('');
  const [emirate,  setEmirate]  = useState('');
  const [toast,    setToast]    = useState<{ msg: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ active: 'false' });
      if (search)  params.set('search',  search);
      if (emirate) params.set('emirate', emirate);
      const res = await fetch(`/api/school-bus/stops?${params}`);
      if (res.ok) { const d = await res.json(); setStops(d.data ?? []); }
    } finally { setLoading(false); }
  }, [search, emirate]);

  useEffect(() => { load(); }, [load]);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  async function handleDeactivate(stop: Stop) {
    if (!confirm(`${stop.is_active ? 'Deactivate' : 'Reactivate'} "${stop.stop_name}"?`)) return;
    await fetch(`/api/school-bus/stops/${stop.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !stop.is_active }),
    });
    showToast(`Stop ${stop.is_active ? 'deactivated' : 'reactivated'}`, true);
    load();
  }

  const activeCount   = stops.filter(s => s.is_active).length;
  const inactiveCount = stops.filter(s => !s.is_active).length;

  return (
    <div className="space-y-6 max-w-full">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-xl border text-sm font-semibold shadow-xl ${
          toast.ok ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300' : 'bg-red-500/20 border-red-500/30 text-red-300'
        }`}>{toast.ok ? '✅' : '❌'} {toast.msg}</div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">📍 Stop Management</h1>
          <p className="text-[var(--text-muted)] text-xs mt-0.5">
            Geospatial stop registry · {activeCount} active · {inactiveCount} inactive
          </p>
        </div>
        <button onClick={() => setModal('new')}
          className="px-5 py-2.5 rounded-xl bg-yellow-500 text-white font-bold text-sm hover:bg-yellow-400 transition-all">
          + Add Stop
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Stops',   value: stops.length,   color: 'text-[var(--text-main)]',         icon: '📍' },
          { label: 'Active',        value: activeCount,    color: 'text-emerald-400',   icon: '✅' },
          { label: 'Inactive',      value: inactiveCount,  color: 'text-[var(--text-muted)]',     icon: '⏸️' },
          { label: 'Emirates',      value: [...new Set(stops.map(s => s.emirate))].length, color: 'text-blue-400', icon: '🗺️' },
        ].map(k => (
          <div key={k.label} className="rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4">
            <div className="flex items-center justify-between">
              <span className="text-xl">{k.icon}</span>
              <span className={`text-2xl font-bold ${k.color}`}>{loading ? '…' : k.value}</span>
            </div>
            <p className="text-[var(--text-faint)] text-xs mt-1">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, code, landmark…"
          className="flex-1 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-yellow-500/50" />
        <select value={emirate} onChange={e => setEmirate(e.target.value)}
          className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-sm text-[var(--text-main)] focus:outline-none focus:border-yellow-500/50">
          <option value="">All Emirates</option>
          {EMIRATES.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
      </div>

      {/* Stops table */}
      <div className="rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-[var(--text-faint)] text-sm">Loading stops…</div>
        ) : stops.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <span className="text-5xl">📍</span>
            <p className="text-[var(--text-muted)] font-medium">No stops found</p>
            <p className="text-[var(--text-faint)] text-xs">Add stops to build your school bus network</p>
            <button onClick={() => setModal('new')}
              className="mt-2 px-5 py-2.5 rounded-xl bg-yellow-500 text-white font-bold text-sm hover:bg-yellow-400 transition-all">
              + Add First Stop
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-[var(--text-faint)] text-xs">
                <th className="px-5 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-left">Stop Name</th>
                <th className="px-4 py-3 text-left">Location</th>
                <th className="px-4 py-3 text-left">GPS</th>
                <th className="px-4 py-3 text-left">Geofence</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {stops.map(s => (
                <tr key={s.id} className={`hover:bg-[var(--bg-surface-hover)] transition-colors ${!s.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-5 py-3">
                    <span className="font-mono text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded">
                      {s.stop_code}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-[var(--text-main)] font-medium text-sm">{s.stop_name}</p>
                    {s.landmark && <p className="text-[var(--text-faint)] text-xs mt-0.5">📌 {s.landmark}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--text-muted)] space-y-0.5">
                    <p className="font-medium text-[var(--text-muted)]">{s.emirate}</p>
                    {s.city && <p>{s.city}{s.area ? ` · ${s.area}` : ''}</p>}
                    {s.neighbourhood && <p className="text-[var(--text-faint)]">{s.neighbourhood}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono">
                    {s.lat && s.lng ? (
                      <div className="text-[var(--text-muted)] space-y-0.5">
                        <p>{Number(s.lat).toFixed(6)}</p>
                        <p>{Number(s.lng).toFixed(6)}</p>
                      </div>
                    ) : <span className="text-[var(--text-faint)]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                    {s.geofence_radius_m}m
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                      s.is_active
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'
                    }`}>{s.is_active ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setModal(s)}
                        className="px-2.5 py-1 rounded-lg bg-[var(--bg-surface)] text-[var(--text-muted)] text-xs hover:bg-[var(--bg-surface-hover)] transition-all">
                        Edit
                      </button>
                      <button onClick={() => handleDeactivate(s)}
                        className="px-2.5 py-1 rounded-lg text-xs transition-all bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]">
                        {s.is_active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <StopModal
          stop={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); showToast('Stop saved successfully', true); load(); }}
        />
      )}
    </div>
  );
}
