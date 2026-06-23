'use client';
import React, { useEffect, useState, useCallback } from 'react';

/* ── Types ───────────────────────────────────────────────────────────────── */
interface Schedule {
  id: string;
  schedule_no: string;
  contract_id: string;
  contract_type: string;
  customer_name: string;
  customer_trn: string | null;
  vehicle_no: string;
  branch: string;
  billing_cycle: string;
  amount: number;
  vat_rate: number;
  vat_amount: number;
  grand_total: number;
  start_date: string;
  end_date: string | null;
  next_invoice_date: string;
  last_invoice_date: string | null;
  invoices_generated: number;
  auto_approve: boolean;
  status: string;
  description: string | null;
  notes: string | null;
}

interface LogEntry {
  id: string;
  schedule_id: string;
  invoice_no: string | null;
  period_start: string;
  period_end: string;
  amount: number;
  vat_amount: number;
  grand_total: number;
  status: string;
  triggered_by: string;
  created_at: string;
}

interface Kpi {
  total: string;
  active_count: string;
  paused_count: string;
  cancelled_count: string;
  due_today: string;
  monthly_value: string;
  total_invoices_generated: string;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
const fmt  = (n: number) => `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2 })}`;
const fmtD = (s: string | null) => s ? new Date(s).toLocaleDateString('en-GB') : '—';

const isDue = (d: string) => new Date(d) <= new Date();

const STATUS_COLOR: Record<string, string> = {
  ACTIVE:    'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  PAUSED:    'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  CANCELLED: 'bg-red-500/20 text-red-300 border border-red-500/30',
};

const CYCLE_BADGE: Record<string, string> = {
  WEEKLY:    'bg-violet-500/20 text-violet-300',
  MONTHLY:   'bg-blue-500/20 text-blue-300',
  QUARTERLY: 'bg-cyan-500/20 text-cyan-300',
  ANNUAL:    'bg-emerald-500/20 text-emerald-300',
};

const TABS = ['ALL', 'ACTIVE', 'PAUSED', 'CANCELLED', 'DUE_TODAY'];

/* ── Modal: New Schedule ─────────────────────────────────────────────────── */
function NewScheduleModal({ onClose, onSave }: { onClose: () => void; onSave: () => void }) {
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    contract_id: '', contract_type: 'LEASE', customer_name: '', customer_trn: '',
    vehicle_no: '', branch: 'Dubai', billing_cycle: 'MONTHLY',
    amount: '', vat_rate: '5',
    start_date: today, end_date: '', next_invoice_date: today,
    auto_approve: false, description: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  const vat    = (Number(form.amount) * Number(form.vat_rate)) / 100;
  const total  = Number(form.amount) + vat;

  async function submit() {
    setSaving(true);
    await fetch('/api/finance/recurring-invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, amount: Number(form.amount), vat_rate: Number(form.vat_rate) }),
    });
    setSaving(false);
    onSave();
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl w-full max-w-2xl border border-white/10 overflow-hidden">
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-4 flex justify-between items-center">
          <h2 className="font-bold text-white text-lg">🔁 New Recurring Schedule</h2>
          <button onClick={onClose} className="text-white/70 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-6 grid grid-cols-2 gap-4 max-h-[70vh] overflow-y-auto">
          {[
            ['Contract ID', 'contract_id', 'text'],
            ['Customer Name', 'customer_name', 'text'],
            ['Customer TRN', 'customer_trn', 'text'],
            ['Vehicle No.', 'vehicle_no', 'text'],
            ['Start Date', 'start_date', 'date'],
            ['End Date', 'end_date', 'date'],
            ['First Invoice Date', 'next_invoice_date', 'date'],
            ['Amount (excl. VAT)', 'amount', 'number'],
          ].map(([label, key, type]) => (
            <div key={key}>
              <label className="text-xs text-slate-400 mb-1 block">{label}</label>
              <input type={type} value={(form as unknown as Record<string, string>)[key]} onChange={e => set(key, e.target.value)}
                className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
            </div>
          ))}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Contract Type</label>
            <select value={form.contract_type} onChange={e => set('contract_type', e.target.value)}
              className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm">
              <option>LEASE</option><option>RENTAL</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Billing Cycle</label>
            <select value={form.billing_cycle} onChange={e => set('billing_cycle', e.target.value)}
              className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm">
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
              <option value="QUARTERLY">Quarterly</option>
              <option value="ANNUAL">Annual</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">VAT Rate (%)</label>
            <select value={form.vat_rate} onChange={e => set('vat_rate', e.target.value)}
              className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm">
              <option value="5">5% (Standard UAE)</option>
              <option value="0">0% (Zero-rated)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Branch</label>
            <select value={form.branch} onChange={e => set('branch', e.target.value)}
              className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm">
              {['Dubai','Abu Dhabi','Sharjah','Ajman','Fujairah','Ras Al Khaimah','Umm Al Quwain'].map(b =>
                <option key={b}>{b}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-xs text-slate-400 mb-1 block">Description</label>
            <input value={form.description} onChange={e => set('description', e.target.value)}
              className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
          </div>
          <div className="col-span-2 bg-slate-900/60 rounded-xl p-4 border border-white/5">
            <div className="grid grid-cols-3 gap-4 text-center mb-3">
              <div><p className="text-xs text-slate-500">Subtotal</p><p className="text-white font-semibold">{fmt(Number(form.amount) || 0)}</p></div>
              <div><p className="text-xs text-slate-500">VAT ({form.vat_rate}%)</p><p className="text-amber-400 font-semibold">{fmt(vat)}</p></div>
              <div><p className="text-xs text-slate-500">Total / Invoice</p><p className="text-emerald-400 font-bold">{fmt(total)}</p></div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.auto_approve} onChange={e => set('auto_approve', e.target.checked)}
                className="w-4 h-4 accent-emerald-500" />
              <span className="text-sm text-slate-300">Auto-approve generated invoices</span>
            </label>
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-700 text-slate-300 text-sm hover:bg-slate-600">Cancel</button>
          <button onClick={submit} disabled={saving || !form.contract_id || !form.customer_name || !form.amount}
            className="px-5 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-medium disabled:opacity-50">
            {saving ? 'Saving…' : 'Create Schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Log Drawer ──────────────────────────────────────────────────────────── */
function LogDrawer({ schedule, onClose }: { schedule: Schedule; onClose: () => void }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/finance/recurring-invoices?schedule_id=${schedule.id}`);
    const d   = await res.json();
    setLogs(d.logs ?? []);
    setLoading(false);
  }, [schedule.id]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  async function generateNow() {
    setGenerating(true);
    const res = await fetch('/api/finance/recurring-invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'generate', schedule_id: schedule.id, triggered_by: 'MANUAL' }),
    });
    if (res.ok) await loadLogs();
    setGenerating(false);
  }

  const INV_STATUS: Record<string, string> = {
    DRAFT:    'bg-slate-500/30 text-slate-300',
    APPROVED: 'bg-emerald-500/20 text-emerald-300',
    PAID:     'bg-blue-500/20 text-blue-300',
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl w-full max-w-2xl border border-white/10 overflow-hidden">
        <div className="bg-gradient-to-r from-slate-700 to-slate-600 px-6 py-4 flex justify-between items-start">
          <div>
            <p className="text-white font-bold">{schedule.schedule_no}</p>
            <p className="text-slate-400 text-sm">{schedule.customer_name} · {schedule.vehicle_no} · {schedule.billing_cycle}</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white text-xl">✕</button>
        </div>

        <div className="px-6 py-3 bg-slate-900/40 border-b border-white/5 flex items-center justify-between">
          <div className="flex gap-6 text-sm">
            <div><span className="text-slate-500">Next due:</span> <span className={`font-medium ${isDue(schedule.next_invoice_date) ? 'text-red-400' : 'text-white'}`}>{fmtD(schedule.next_invoice_date)}</span></div>
            <div><span className="text-slate-500">Generated:</span> <span className="text-white">{schedule.invoices_generated}</span></div>
            <div><span className="text-slate-500">Per invoice:</span> <span className="text-emerald-400 font-semibold">{fmt(schedule.grand_total)}</span></div>
          </div>
          {schedule.status === 'ACTIVE' && (
            <button onClick={generateNow} disabled={generating}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-medium disabled:opacity-50">
              {generating ? 'Generating…' : '⚡ Generate Now'}
            </button>
          )}
        </div>

        <div className="p-6 max-h-[50vh] overflow-y-auto">
          {loading ? (
            <p className="text-slate-500 text-sm text-center py-8">Loading…</p>
          ) : logs.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-8">No invoices generated yet</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left">
                  {['Invoice No.','Period','Amount','VAT','Total','Status','By'].map(h => (
                    <th key={h} className="pb-2 text-xs text-slate-400 font-semibold uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id} className="border-b border-white/5 hover:bg-white/3">
                    <td className="py-2.5 font-mono text-emerald-400 text-xs">{l.invoice_no ?? '—'}</td>
                    <td className="py-2.5 text-slate-300 text-xs">{fmtD(l.period_start)} – {fmtD(l.period_end)}</td>
                    <td className="py-2.5 text-white">{fmt(l.amount)}</td>
                    <td className="py-2.5 text-amber-400">{fmt(l.vat_amount)}</td>
                    <td className="py-2.5 text-emerald-400 font-medium">{fmt(l.grand_total)}</td>
                    <td className="py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${INV_STATUS[l.status] ?? ''}`}>{l.status}</span>
                    </td>
                    <td className="py-2.5 text-slate-500 text-xs">{l.triggered_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────────────────────── */
export default function RecurringInvoicesPage() {
  const [schedules, setSchedules]   = useState<Schedule[]>([]);
  const [kpi, setKpi]               = useState<Kpi | null>(null);
  const [tab, setTab]               = useState('ALL');
  const [search, setSearch]         = useState('');
  const [showNew, setShowNew]       = useState(false);
  const [viewLogs, setViewLogs]     = useState<Schedule | null>(null);
  const [loading, setLoading]       = useState(true);
  const [actionId, setActionId]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams();
    if (tab === 'DUE_TODAY')       p.set('due_today', 'true');
    else if (tab !== 'ALL')        p.set('status', tab);
    if (search)                    p.set('search', search);
    const res  = await fetch(`/api/finance/recurring-invoices?${p}`);
    const data = await res.json();
    setSchedules(data.schedules ?? []);
    setKpi(data.kpi ?? null);
    setLoading(false);
  }, [tab, search]);

  useEffect(() => { load(); }, [load]);

  async function toggleStatus(sch: Schedule, action: 'pause' | 'resume' | 'cancel') {
    setActionId(sch.id);
    await fetch('/api/finance/recurring-invoices', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sch.id, action }),
    });
    await load();
    setActionId(null);
  }

  async function generateNowInline(sch: Schedule) {
    setActionId(sch.id);
    await fetch('/api/finance/recurring-invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'generate', schedule_id: sch.id, triggered_by: 'MANUAL' }),
    });
    await load();
    setActionId(null);
  }

  const kpiCards = kpi ? [
    { label: 'Active Schedules',   value: kpi.active_count,                    icon: '🟢', color: 'from-emerald-600 to-teal-600' },
    { label: 'Monthly Run Rate',   value: fmt(Number(kpi.monthly_value)),       icon: '💰', color: 'from-blue-600 to-indigo-600' },
    { label: 'Due Today',          value: kpi.due_today,                        icon: '⚡', color: Number(kpi.due_today) > 0 ? 'from-amber-600 to-orange-600' : 'from-slate-600 to-slate-700' },
    { label: 'Paused',             value: kpi.paused_count,                     icon: '⏸️', color: 'from-slate-600 to-slate-700' },
    { label: 'Total Generated',    value: kpi.total_invoices_generated,         icon: '🧾', color: 'from-violet-600 to-purple-600' },
  ] : [];

  return (
    <div className="text-white">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Recurring Invoice Engine</h1>
          <p className="text-slate-400 text-sm mt-1">Schedule and auto-generate invoices for all active contracts</p>
        </div>
        <button onClick={() => setShowNew(true)}
          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-semibold hover:from-emerald-500 hover:to-teal-500 transition-all">
          + New Schedule
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-5 gap-4 mb-8">
        {kpiCards.map(c => (
          <div key={c.label} className={`bg-gradient-to-br ${c.color} rounded-2xl p-4`}>
            <p className="text-2xl mb-1">{c.icon}</p>
            <p className="text-xl font-bold text-white">{c.value}</p>
            <p className="text-white/70 text-xs mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Due Today Alert */}
      {kpi && Number(kpi.due_today) > 0 && (
        <div className="mb-6 bg-amber-900/30 border border-amber-500/20 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚡</span>
            <div>
              <p className="text-amber-300 font-semibold text-sm">{kpi.due_today} invoice(s) due for generation today</p>
              <p className="text-slate-400 text-xs mt-0.5">Click Generate Now on each schedule, or use bulk generation.</p>
            </div>
          </div>
          <button onClick={() => setTab('DUE_TODAY')}
            className="px-3 py-1.5 rounded-lg bg-amber-600/40 text-amber-300 text-xs hover:bg-amber-600/60 border border-amber-500/30">
            View Due
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="flex bg-slate-800 rounded-xl p-1 gap-1 flex-wrap">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${tab === t ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              {t === 'DUE_TODAY' ? '⚡ Due Today' : t}
            </button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer, vehicle, schedule no…"
          className="bg-slate-800 border border-white/10 rounded-xl px-4 py-2 text-sm text-white placeholder-slate-500 flex-1 min-w-[200px]" />
      </div>

      {/* Table */}
      <div className="bg-slate-800/60 rounded-2xl border border-white/5 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left">
              {['Schedule No.','Customer','Vehicle','Cycle','Amount (incl. VAT)','Branch','Next Invoice','Invoices','Auto','Status','Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="text-center py-12 text-slate-500">Loading…</td></tr>
            ) : schedules.length === 0 ? (
              <tr><td colSpan={11} className="text-center py-12 text-slate-500">No schedules found</td></tr>
            ) : schedules.map(s => {
              const due      = s.status === 'ACTIVE' && isDue(s.next_invoice_date);
              const busy     = actionId === s.id;
              return (
                <tr key={s.id} className={`border-b border-white/5 hover:bg-white/3 transition-colors ${due ? 'bg-amber-900/10' : ''}`}>
                  <td className="px-4 py-3 font-mono text-emerald-400 text-xs">{s.schedule_no}</td>
                  <td className="px-4 py-3 text-white">{s.customer_name}</td>
                  <td className="px-4 py-3 text-slate-300">{s.vehicle_no}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${CYCLE_BADGE[s.billing_cycle] ?? ''}`}>{s.billing_cycle}</span>
                  </td>
                  <td className="px-4 py-3 text-white font-semibold">{fmt(s.grand_total)}</td>
                  <td className="px-4 py-3 text-slate-400">{s.branch}</td>
                  <td className={`px-4 py-3 font-medium ${due ? 'text-amber-400' : 'text-white'}`}>
                    {due && <span className="mr-1">⚡</span>}{fmtD(s.next_invoice_date)}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{s.invoices_generated}</td>
                  <td className="px-4 py-3 text-center">
                    {s.auto_approve ? <span className="text-emerald-400 text-base">✓</span> : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${STATUS_COLOR[s.status] ?? ''}`}>{s.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      <button onClick={() => setViewLogs(s)} className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300">
                        Log
                      </button>
                      {s.status === 'ACTIVE' && (
                        <>
                          <button onClick={() => generateNowInline(s)} disabled={busy}
                            className="text-xs px-2 py-1 rounded bg-emerald-700/50 hover:bg-emerald-700 text-emerald-300 disabled:opacity-40">
                            {busy ? '…' : '⚡'}
                          </button>
                          <button onClick={() => toggleStatus(s, 'pause')} disabled={busy}
                            className="text-xs px-2 py-1 rounded bg-amber-700/40 hover:bg-amber-700/60 text-amber-300 disabled:opacity-40">
                            ⏸
                          </button>
                        </>
                      )}
                      {s.status === 'PAUSED' && (
                        <button onClick={() => toggleStatus(s, 'resume')} disabled={busy}
                          className="text-xs px-2 py-1 rounded bg-emerald-700/50 hover:bg-emerald-700 text-emerald-300 disabled:opacity-40">
                          ▶
                        </button>
                      )}
                      {s.status !== 'CANCELLED' && (
                        <button onClick={() => toggleStatus(s, 'cancel')} disabled={busy}
                          className="text-xs px-2 py-1 rounded bg-red-700/30 hover:bg-red-700/50 text-red-400 disabled:opacity-40">
                          ✕
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showNew && <NewScheduleModal onClose={() => setShowNew(false)} onSave={() => { setShowNew(false); load(); }} />}
      {viewLogs && <LogDrawer schedule={viewLogs} onClose={() => { setViewLogs(null); load(); }} />}
    </div>
  );
}
