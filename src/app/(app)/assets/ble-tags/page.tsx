'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface BLETag {
  id: string;
  tag_mac: string;
  tag_name?: string;
  assigned_asset_id?: string;
  assigned_asset_type?: string;
  assigned_asset_name?: string;
  battery_pct?: number;
  signal_rssi?: number;
  last_seen?: string;
  location_zone?: string;
  status?: string;
  firmware_version?: string;
  notes?: string;
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  LOW_BATTERY: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  OFFLINE: 'bg-red-500/20 text-red-400 border-red-500/30',
  LOST: 'bg-red-500/20 text-red-400 border-red-500/30',
  REPLACED: 'bg-slate-700 text-slate-400 border-slate-600',
};

function BatteryBar({ pct }: { pct?: number }) {
  if (pct === undefined || pct === null) return <span className="text-slate-500 text-xs">—</span>;
  const color = pct < 20 ? 'bg-red-500' : pct < 50 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-14 h-2 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-medium ${pct < 20 ? 'text-red-400' : pct < 50 ? 'text-amber-400' : 'text-emerald-400'}`}>{pct}%</span>
    </div>
  );
}

const EMPTY_FORM = {
  tag_mac: '', tag_name: '', assigned_asset_id: '', assigned_asset_type: 'ASSET',
  assigned_asset_name: '', firmware_version: '', notes: '',
};

const REPLACE_FORM = { replacement_tag_id: '', replacement_reason: '' };

export default function BLETagsPage() {
  const [tags, setTags] = useState<BLETag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [editTag, setEditTag] = useState<BLETag | null>(null);
  const [replaceTag, setReplaceTag] = useState<BLETag | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [replaceForm, setReplaceForm] = useState({ ...REPLACE_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/assets/ble-tags?tenantId=default');
      const d = await r.json();
      setTags(Array.isArray(d) ? d : d.data ?? []);
    } catch { setError('Failed to load BLE tags'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setEditTag(null); setForm({ ...EMPTY_FORM }); setShowModal(true); };
  const openEdit = (t: BLETag) => {
    setEditTag(t);
    setForm({
      tag_mac: t.tag_mac, tag_name: t.tag_name ?? '', assigned_asset_id: t.assigned_asset_id ?? '',
      assigned_asset_type: t.assigned_asset_type ?? 'ASSET', assigned_asset_name: t.assigned_asset_name ?? '',
      firmware_version: t.firmware_version ?? '', notes: t.notes ?? '',
    });
    setShowModal(true);
  };

  const openReplace = (t: BLETag) => { setReplaceTag(t); setReplaceForm({ ...REPLACE_FORM }); setShowReplaceModal(true); };

  const submit = async () => {
    setSubmitting(true);
    try {
      let res;
      if (editTag) {
        res = await fetch(`/api/assets/ble-tags/${editTag.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, tenantId: 'default' }) });
      } else {
        res = await fetch('/api/assets/ble-tags?tenantId=default', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, tenantId: 'default' }) });
      }
      if (!res.ok) throw new Error();
      showToast(editTag ? 'Tag updated!' : 'Tag created!');
      setShowModal(false); load();
    } catch { showToast('Error saving tag'); }
    setSubmitting(false);
  };

  const submitReplace = async () => {
    if (!replaceTag) return;
    setSubmitting(true);
    try {
      await fetch(`/api/assets/ble-tags/${replaceTag.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...replaceForm, status: 'REPLACED', tenantId: 'default' }),
      });
      showToast('Tag replaced!'); setShowReplaceModal(false); load();
    } catch { showToast('Error replacing tag'); }
    setSubmitting(false);
  };

  function minutesAgo(dt?: string) {
    if (!dt) return null;
    return Math.round((Date.now() - new Date(dt).getTime()) / 60000);
  }

  if (loading) return (
    <div className="p-8 space-y-4">
      <div className="h-8 bg-slate-800 rounded w-48 animate-pulse" />
      {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 bg-slate-800 rounded animate-pulse" />)}
    </div>
  );

  return (
    <div className="p-8 space-y-5">
      {toast && <div className="fixed top-4 right-4 z-50 bg-emerald-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">{toast}</div>}

      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-white">BLE Tags</h1><p className="text-slate-400 text-sm">Bluetooth tracking tag registry</p></div>
        <button onClick={openAdd} className="bg-yellow-400 hover:bg-yellow-300 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm">+ Add Tag</button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">{error}</div>}

      <div className="bg-slate-900 border border-white/8 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/50 border-b border-white/8">
              <tr className="text-slate-400 text-xs uppercase">
                {['Tag MAC', 'Name', 'Assigned To', 'Asset Type', 'Battery', 'Signal', 'Last Seen', 'Zone', 'Status', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {tags.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-slate-500">
                  <div className="text-4xl mb-2">📡</div><p>No BLE tags registered yet.</p>
                </td></tr>
              ) : tags.map(t => {
                const ago = minutesAgo(t.last_seen);
                return (
                  <tr key={t.id} className="hover:bg-white/3 transition-colors">
                    <td className="px-4 py-3 text-yellow-300 font-mono text-xs">{t.tag_mac}</td>
                    <td className="px-4 py-3 text-white font-medium">{t.tag_name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-300">{t.assigned_asset_name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-400">{t.assigned_asset_type ?? '—'}</td>
                    <td className="px-4 py-3"><BatteryBar pct={t.battery_pct} /></td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{t.signal_rssi !== undefined ? `${t.signal_rssi} dBm` : '—'}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{ago !== null ? `${ago}m ago` : '—'}</td>
                    <td className="px-4 py-3 text-slate-400">{t.location_zone ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${STATUS_COLORS[t.status ?? 'ACTIVE'] ?? STATUS_COLORS.ACTIVE}`}>
                        {t.status ?? 'ACTIVE'}
                      </span>
                    </td>
                    <td className="px-4 py-3 flex gap-2">
                      <button onClick={() => openEdit(t)} className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded">Edit</button>
                      <button onClick={() => openReplace(t)} className="text-xs bg-amber-700/40 hover:bg-amber-700/60 text-amber-300 px-2 py-1 rounded">Replace</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-white/8">
              <h2 className="text-white font-semibold">{editTag ? 'Edit BLE Tag' : 'Add BLE Tag'}</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white text-xl">✕</button>
            </div>
            <div className="p-5 space-y-4">
              {[
                { label: 'Tag MAC Address*', key: 'tag_mac' },
                { label: 'Tag Name', key: 'tag_name' },
                { label: 'Assigned Asset ID', key: 'assigned_asset_id' },
                { label: 'Asset Type', key: 'assigned_asset_type' },
                { label: 'Asset Name', key: 'assigned_asset_name' },
                { label: 'Firmware Version', key: 'firmware_version' },
                { label: 'Notes', key: 'notes' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs text-slate-400 mb-1">{f.label}</label>
                  <input value={(form as Record<string, string>)[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
              ))}
            </div>
            <div className="flex gap-3 justify-end p-5 border-t border-white/8">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
              <button onClick={submit} disabled={submitting || !form.tag_mac} className="bg-yellow-400 hover:bg-yellow-300 text-slate-950 font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-50">
                {submitting ? 'Saving...' : editTag ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReplaceModal && replaceTag && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-white/8">
              <h2 className="text-white font-semibold">Replace Tag: {replaceTag.tag_mac}</h2>
              <button onClick={() => setShowReplaceModal(false)} className="text-slate-400 hover:text-white text-xl">✕</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Replacement Tag ID</label>
                <input value={replaceForm.replacement_tag_id} onChange={e => setReplaceForm(p => ({ ...p, replacement_tag_id: e.target.value }))} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Replacement Reason</label>
                <textarea value={replaceForm.replacement_reason} onChange={e => setReplaceForm(p => ({ ...p, replacement_reason: e.target.value }))} rows={3} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
            </div>
            <div className="flex gap-3 justify-end p-5 border-t border-white/8">
              <button onClick={() => setShowReplaceModal(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
              <button onClick={submitReplace} disabled={submitting} className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-50">
                {submitting ? 'Replacing...' : 'Replace Tag'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
