'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface AuditEntry {
  id: string; created_at: string; module: string; action: string;
  entity_type: string; entity_id: string; entity_ref: string | null;
  performed_by: string; description: string; amount: number | null;
  old_values: unknown; new_values: unknown; metadata: unknown;
}

interface ModuleCount { module: string; count: string; }

const MODULE_ICONS: Record<string,string> = {
  JE: '📒', COA: '🗂️', FIXED_ASSETS: '🏗️', PERIOD: '🔒', CT: '🏛️',
  BANK_RECON: '🏦', EXPENSE: '⛽', INVOICE: '🧾', PDC: '📋', CREDIT_NOTE: '📝',
  COLLECTION: '📞', BUDGET: '📈', GENERAL: '⚙️',
};

const ACTION_COLORS: Record<string,string> = {
  CREATED:  'text-blue-400   bg-blue-900/20   border-blue-500/30',
  POSTED:   'text-emerald-400 bg-emerald-900/20 border-emerald-500/30',
  APPROVED: 'text-emerald-400 bg-emerald-900/20 border-emerald-500/30',
  REJECTED: 'text-red-400    bg-red-900/20    border-red-500/30',
  VOIDED:   'text-red-400    bg-red-900/20    border-red-500/30',
  REVERSED: 'text-amber-400  bg-amber-900/20  border-amber-500/30',
  LOCKED:   'text-purple-400 bg-purple-900/20 border-purple-500/30',
  FILED:    'text-teal-400   bg-teal-900/20   border-teal-500/30',
  DISPOSED: 'text-orange-400 bg-orange-900/20 border-orange-500/30',
  DELETED:  'text-red-400    bg-red-900/20    border-red-500/30',
  UPDATED:  'text-slate-400  bg-slate-700/50  border-slate-500/30',
};

function fmt(n: number) {
  return new Intl.NumberFormat('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
}

/* ── Quick Log Entry Modal ── */
function QuickLogModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ module: 'GENERAL', action: 'CREATED', entityType: '', entityId: '', entityRef: '', performedBy: '', description: '', amount: '' });
  const [saving, setSaving] = useState(false);
  const inp = 'w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500';
  const s = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({...f, [k]: e.target.value}));

  const save = async () => {
    setSaving(true);
    const res = await fetch('/api/finance/audit-log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, amount: form.amount ? parseFloat(form.amount) : null }),
    });
    setSaving(false);
    if (res.ok) { onSaved(); onClose(); } else { const d = await res.json(); alert(d.error ?? 'Failed'); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">Manual Audit Entry</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Module</label>
              <select value={form.module} onChange={s('module')} className={inp}>
                {Object.keys(MODULE_ICONS).map(m => <option key={m} value={m}>{MODULE_ICONS[m]} {m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Action</label>
              <select value={form.action} onChange={s('action')} className={inp}>
                {['CREATED','POSTED','APPROVED','REJECTED','VOIDED','REVERSED','LOCKED','FILED','DISPOSED','DELETED','UPDATED'].map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Entity Type</label>
              <input value={form.entityType} onChange={s('entityType')} placeholder="e.g. JournalEntry" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Entity ID</label>
              <input value={form.entityId} onChange={s('entityId')} placeholder="UUID or ID" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Reference</label>
              <input value={form.entityRef} onChange={s('entityRef')} placeholder="JE-2025-001" className={inp} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Performed By *</label>
              <input value={form.performedBy} onChange={s('performedBy')} placeholder="User name / system" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Amount (AED)</label>
              <input type="number" value={form.amount} onChange={s('amount')} placeholder="Optional" className={inp} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Description *</label>
            <textarea value={form.description} onChange={s('description')} rows={2}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-purple-500" />
          </div>
        </div>
        <div className="flex gap-2 p-5 border-t border-white/10">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-white/10 text-sm text-slate-400 hover:text-white">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex-1 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-sm disabled:opacity-50">
            {saving ? 'Logging…' : 'Log Entry'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Detail Drawer ── */
function DetailDrawer({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50">
      <div className="w-[480px] bg-slate-900 border-l border-white/10 flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div>
            <h2 className="text-base font-bold text-white">{MODULE_ICONS[entry.module]} {entry.module} · {entry.action}</h2>
            <p className="text-xs text-slate-400">{entry.created_at.slice(0,19).replace('T',' ')}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              ['Entity Type',  entry.entity_type],
              ['Entity ID',    entry.entity_id],
              ['Reference',    entry.entity_ref ?? '—'],
              ['Performed By', entry.performed_by],
            ].map(([k,v]) => (
              <div key={k} className="bg-slate-800/60 rounded-xl p-3">
                <p className="text-xs text-slate-400">{k}</p>
                <p className="text-sm text-white mt-0.5 break-all">{v}</p>
              </div>
            ))}
          </div>
          <div className="bg-slate-800/60 rounded-xl p-3">
            <p className="text-xs text-slate-400">Description</p>
            <p className="text-sm text-white mt-0.5">{entry.description}</p>
          </div>
          {entry.amount != null && (
            <div className="bg-slate-800/60 rounded-xl p-3">
              <p className="text-xs text-slate-400">Amount</p>
              <p className="text-base font-bold text-white mt-0.5">AED {fmt(entry.amount)}</p>
            </div>
          )}
          {entry.old_values != null && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase mb-1">Before</p>
              <pre className="bg-slate-800 rounded-xl p-3 text-xs text-slate-300 overflow-x-auto">
                {JSON.stringify(entry.old_values, null, 2)}
              </pre>
            </div>
          )}
          {entry.new_values != null && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase mb-1">After</p>
              <pre className="bg-slate-800 rounded-xl p-3 text-xs text-emerald-300 overflow-x-auto">
                {JSON.stringify(entry.new_values, null, 2)}
              </pre>
            </div>
          )}
          {entry.metadata != null && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase mb-1">Metadata</p>
              <pre className="bg-slate-800 rounded-xl p-3 text-xs text-blue-300 overflow-x-auto">
                {JSON.stringify(entry.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [moduleCounts, setModuleCounts] = useState<ModuleCount[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [filters, setFilters] = useState({
    module: '', action: '', from: '', to: '', search: '', offset: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '100', offset: String(filters.offset) });
    if (filters.module) params.set('module', filters.module);
    if (filters.action) params.set('action', filters.action);
    if (filters.from)   params.set('from', filters.from);
    if (filters.to)     params.set('to', filters.to);
    if (filters.search) params.set('search', filters.search);
    const res = await fetch(`/api/finance/audit-log?${params}`);
    if (res.ok) {
      const d = await res.json();
      setEntries(d.data ?? []);
      setModuleCounts(d.moduleCounts ?? []);
      setTotal(d.total ?? 0);
    }
    setLoading(false);
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const sf = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFilters(f => ({...f, [k]: e.target.value, offset: 0}));

  const inp = 'bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Finance Audit Log</h1>
          <p className="text-slate-400 text-sm mt-0.5">Immutable trail of all financial module actions · {total.toLocaleString()} entries</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-xl text-sm">
          + Manual Entry
        </button>
      </div>

      {/* Module breakdown */}
      {moduleCounts.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setFilters(f => ({...f, module: '', offset: 0}))}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${!filters.module ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
            All ({total})
          </button>
          {moduleCounts.map(mc => (
            <button key={mc.module} onClick={() => setFilters(f => ({...f, module: f.module === mc.module ? '' : mc.module, offset: 0}))}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium ${filters.module === mc.module ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
              {MODULE_ICONS[mc.module] ?? '⚙'} {mc.module} ({mc.count})
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <input value={filters.search} onChange={sf('search')} placeholder="Search description, ref, user…"
          className={`${inp} w-64`} />
        <select value={filters.action} onChange={sf('action')} className={inp}>
          <option value="">All Actions</option>
          {['CREATED','POSTED','APPROVED','REJECTED','VOIDED','REVERSED','LOCKED','FILED','DISPOSED','DELETED','UPDATED'].map(a =>
            <option key={a} value={a}>{a}</option>)}
        </select>
        <input type="date" value={filters.from} onChange={sf('from')} className={inp} />
        <span className="text-slate-500 text-xs">to</span>
        <input type="date" value={filters.to} onChange={sf('to')} className={inp} />
      </div>

      {/* Table */}
      {loading ? <div className="h-64 bg-slate-800/60 rounded-2xl animate-pulse" /> : (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3 w-40">Timestamp</th>
                <th className="text-left px-4 py-3 w-28">Module</th>
                <th className="text-left px-4 py-3 w-28">Action</th>
                <th className="text-left px-4 py-3">Description</th>
                <th className="text-left px-4 py-3 w-28">Reference</th>
                <th className="text-right px-4 py-3 w-32">Amount</th>
                <th className="text-left px-4 py-3 w-28">By</th>
                <th className="px-4 py-3 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => (
                <tr key={entry.id} className="border-b border-white/5 hover:bg-slate-800/40 cursor-pointer" onClick={() => setSelected(entry)}>
                  <td className="px-4 py-2.5 text-xs text-slate-400 font-mono">
                    {entry.created_at.slice(0,19).replace('T',' ')}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs text-slate-300">{MODULE_ICONS[entry.module] ?? '⚙'} {entry.module}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${ACTION_COLORS[entry.action] ?? 'text-slate-400 bg-slate-700/50 border-slate-500/30'}`}>
                      {entry.action}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-sm text-slate-300 max-w-xs truncate">{entry.description}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-purple-400">{entry.entity_ref ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right text-sm text-slate-300">
                    {entry.amount != null ? `AED ${fmt(entry.amount)}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">{entry.performed_by}</td>
                  <td className="px-4 py-2.5">
                    <button className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-xs">→</button>
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                  No audit entries yet. Financial actions will be logged here automatically.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <QuickLogModal onClose={() => setShowCreate(false)} onSaved={load} />}
      {selected && <DetailDrawer entry={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
