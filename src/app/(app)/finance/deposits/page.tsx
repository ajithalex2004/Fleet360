'use client';
import React, { useEffect, useState, useCallback } from 'react';

/* ── Types ───────────────────────────────────────────────────────────────── */
interface Deduction {
  id: string;
  description: string;
  amount: number;
  date: string;
  category: string;
}

interface Deposit {
  id: string;
  deposit_no: string;
  contract_id: string;
  contract_type: string;
  customer_name: string;
  customer_trn: string | null;
  vehicle_no: string;
  branch: string;
  collected_amount: number;
  collection_date: string;
  collection_method: string;
  cheque_no: string | null;
  bank_name: string | null;
  status: string;
  deductions: Deduction[];
  total_deducted: number;
  refund_amount: number | null;
  refund_date: string | null;
  refund_method: string | null;
  held_days: number;
  forfeiture_reason: string | null;
  notes: string | null;
}

interface Kpi {
  total: string;
  held_count: string;
  refunded_count: string;
  forfeited_count: string;
  total_held_amount: string;
  total_forfeited: string;
  total_refunded: string;
  overdue_count: string;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
const fmt  = (n: number) => `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2 })}`;
const fmtD = (s: string | null) => s ? new Date(s).toLocaleDateString('en-GB') : '—';

const STATUS_COLOR: Record<string, string> = {
  HELD:                'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  PARTIALLY_REFUNDED:  'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  FULLY_REFUNDED:      'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  FORFEITED:           'bg-red-500/20 text-red-300 border border-red-500/30',
};

const AGING_COLOR = (days: number) =>
  days > 730 ? 'text-red-400 font-bold' :
  days > 365 ? 'text-amber-400 font-semibold' :
  days > 180 ? 'text-yellow-400' : 'text-slate-300';

const TABS = ['ALL', 'HELD', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED', 'FORFEITED'];

/* ── Modal: New Deposit ──────────────────────────────────────────────────── */
function NewDepositModal({ onClose, onSave }: { onClose: () => void; onSave: () => void }) {
  const [form, setForm] = useState({
    contract_id: '', contract_type: 'LEASE', customer_name: '', customer_trn: '',
    vehicle_no: '', branch: 'Dubai', collected_amount: '', collection_date: new Date().toISOString().split('T')[0],
    collection_method: 'BANK_TRANSFER', cheque_no: '', bank_name: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  async function submit() {
    setSaving(true);
    await fetch('/api/finance/deposits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, collected_amount: Number(form.collected_amount) }),
    });
    setSaving(false);
    onSave();
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl w-full max-w-2xl border border-white/10 overflow-hidden">
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-4 flex justify-between items-center">
          <h2 className="font-bold text-white text-lg">🔒 New Security Deposit</h2>
          <button onClick={onClose} className="text-white/70 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-6 grid grid-cols-2 gap-4 max-h-[70vh] overflow-y-auto">
          {[
            ['Contract ID', 'contract_id', 'text'],
            ['Customer Name', 'customer_name', 'text'],
            ['Customer TRN', 'customer_trn', 'text'],
            ['Vehicle No.', 'vehicle_no', 'text'],
            ['Collection Date', 'collection_date', 'date'],
            ['Amount (AED)', 'collected_amount', 'number'],
            ['Cheque No.', 'cheque_no', 'text'],
            ['Bank Name', 'bank_name', 'text'],
          ].map(([label, key, type]) => (
            <div key={key}>
              <label className="text-xs text-slate-400 mb-1 block">{label}</label>
              <input type={type} value={(form as Record<string, string>)[key]} onChange={e => set(key, e.target.value)}
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
            <label className="text-xs text-slate-400 mb-1 block">Branch</label>
            <select value={form.branch} onChange={e => set('branch', e.target.value)}
              className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm">
              {['Dubai','Abu Dhabi','Sharjah','Ajman','Fujairah','Ras Al Khaimah','Umm Al Quwain'].map(b =>
                <option key={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Collection Method</label>
            <select value={form.collection_method} onChange={e => set('collection_method', e.target.value)}
              className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm">
              <option value="BANK_TRANSFER">Bank Transfer</option>
              <option value="CHEQUE">Cheque</option>
              <option value="CASH">Cash</option>
              <option value="CARD">Card</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-xs text-slate-400 mb-1 block">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm resize-none" />
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-700 text-slate-300 text-sm hover:bg-slate-600">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="px-5 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-medium disabled:opacity-50">
            {saving ? 'Saving…' : 'Create Deposit'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Modal: Deposit Detail ───────────────────────────────────────────────── */
function DepositDetailModal({ deposit, onClose, onRefresh }: { deposit: Deposit; onClose: () => void; onRefresh: () => void }) {
  const [tab, setTab] = useState<'overview' | 'deductions' | 'refund' | 'forfeit'>('overview');
  const [saving, setSaving] = useState(false);

  const [deduction, setDeduction] = useState({ description: '', amount: '', category: 'DAMAGE', date: new Date().toISOString().split('T')[0] });
  const [refund, setRefund] = useState({
    refund_amount: String(Math.max(0, deposit.collected_amount - deposit.total_deducted)),
    refund_date: new Date().toISOString().split('T')[0],
    refund_method: 'BANK_TRANSFER',
    refund_reference: '',
  });
  const [forfeitReason, setForfeitReason] = useState('');

  async function addDeduction() {
    setSaving(true);
    await fetch('/api/finance/deposits', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: deposit.id, action: 'add_deduction', ...deduction, amount: Number(deduction.amount) }),
    });
    setSaving(false);
    onRefresh();
    setDeduction({ description: '', amount: '', category: 'DAMAGE', date: new Date().toISOString().split('T')[0] });
  }

  async function processRefund() {
    setSaving(true);
    await fetch('/api/finance/deposits', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: deposit.id, action: 'refund', ...refund, refund_amount: Number(refund.refund_amount) }),
    });
    setSaving(false);
    onRefresh();
    onClose();
  }

  async function forfeit() {
    setSaving(true);
    await fetch('/api/finance/deposits', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: deposit.id, action: 'forfeit', forfeiture_reason: forfeitReason }),
    });
    setSaving(false);
    onRefresh();
    onClose();
  }

  const net = deposit.collected_amount - deposit.total_deducted;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl w-full max-w-2xl border border-white/10 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-700 to-teal-700 px-6 py-4 flex justify-between items-start">
          <div>
            <p className="text-white font-bold text-lg">{deposit.deposit_no}</p>
            <p className="text-emerald-200 text-sm">{deposit.customer_name} · {deposit.vehicle_no}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_COLOR[deposit.status] ?? ''}`}>{deposit.status}</span>
            <button onClick={onClose} className="text-white/70 hover:text-white text-xl">✕</button>
          </div>
        </div>

        {/* Amount strip */}
        <div className="bg-slate-900/60 px-6 py-3 grid grid-cols-3 gap-4 text-center border-b border-white/5">
          <div><p className="text-xs text-slate-500">Collected</p><p className="text-white font-semibold">{fmt(deposit.collected_amount)}</p></div>
          <div><p className="text-xs text-slate-500">Deducted</p><p className="text-red-400 font-semibold">{fmt(deposit.total_deducted)}</p></div>
          <div><p className="text-xs text-slate-500">Net Refundable</p><p className="text-emerald-400 font-semibold">{fmt(net)}</p></div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10 px-6 pt-2 gap-1">
          {(['overview','deductions','refund','forfeit'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-2 text-sm capitalize rounded-t-lg border-b-2 transition-colors ${tab === t ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-white'}`}>
              {t === 'deductions' ? `Deductions (${deposit.deductions.length})` : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div className="p-6 min-h-[220px] overflow-y-auto max-h-[360px]">
          {/* Overview */}
          {tab === 'overview' && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                ['Contract ID', deposit.contract_id], ['Contract Type', deposit.contract_type],
                ['Branch', deposit.branch], ['Collection Date', fmtD(deposit.collection_date)],
                ['Method', deposit.collection_method], ['Cheque No.', deposit.cheque_no ?? '—'],
                ['Bank', deposit.bank_name ?? '—'], ['Days Held', <span key="d" className={AGING_COLOR(deposit.held_days)}>{deposit.held_days} days</span>],
                ['Refund Date', fmtD(deposit.refund_date)], ['Refund Method', deposit.refund_method ?? '—'],
              ].map(([label, value]) => (
                <div key={String(label)} className="bg-slate-700/40 rounded-lg p-3">
                  <p className="text-slate-500 text-xs mb-1">{label}</p>
                  <p className="text-white">{value}</p>
                </div>
              ))}
              {deposit.notes && (
                <div className="col-span-2 bg-slate-700/40 rounded-lg p-3">
                  <p className="text-slate-500 text-xs mb-1">Notes</p>
                  <p className="text-white">{deposit.notes}</p>
                </div>
              )}
            </div>
          )}

          {/* Deductions */}
          {tab === 'deductions' && (
            <div className="space-y-3">
              {deposit.deductions.length === 0 && (
                <p className="text-slate-500 text-sm text-center py-4">No deductions yet</p>
              )}
              {deposit.deductions.map(d => (
                <div key={d.id} className="flex justify-between items-center bg-slate-700/40 rounded-lg p-3">
                  <div>
                    <p className="text-white text-sm">{d.description}</p>
                    <p className="text-slate-400 text-xs">{d.category} · {fmtD(d.date)}</p>
                  </div>
                  <p className="text-red-400 font-semibold text-sm">{fmt(d.amount)}</p>
                </div>
              ))}
              {deposit.status === 'HELD' || deposit.status === 'PARTIALLY_REFUNDED' ? (
                <div className="mt-4 bg-slate-900/60 rounded-xl p-4 space-y-3 border border-white/5">
                  <p className="text-slate-300 text-sm font-semibold">Add Deduction</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <input placeholder="Description" value={deduction.description} onChange={e => setDeduction(d => ({ ...d, description: e.target.value }))}
                        className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
                    </div>
                    <input type="number" placeholder="Amount (AED)" value={deduction.amount} onChange={e => setDeduction(d => ({ ...d, amount: e.target.value }))}
                      className="bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
                    <input type="date" value={deduction.date} onChange={e => setDeduction(d => ({ ...d, date: e.target.value }))}
                      className="bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
                    <select value={deduction.category} onChange={e => setDeduction(d => ({ ...d, category: e.target.value }))}
                      className="col-span-2 bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm">
                      <option value="DAMAGE">Damage</option>
                      <option value="CLEANING">Cleaning</option>
                      <option value="TRAFFIC_FINE">Traffic Fine</option>
                      <option value="OUTSTANDING_INVOICE">Outstanding Invoice</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>
                  <button onClick={addDeduction} disabled={saving || !deduction.description || !deduction.amount}
                    className="w-full py-2 rounded-lg bg-red-600/80 hover:bg-red-600 text-white text-sm font-medium disabled:opacity-40">
                    {saving ? 'Saving…' : 'Add Deduction'}
                  </button>
                </div>
              ) : null}
            </div>
          )}

          {/* Refund */}
          {tab === 'refund' && (
            <div className="space-y-3">
              {['FULLY_REFUNDED','FORFEITED'].includes(deposit.status) ? (
                <p className="text-slate-400 text-sm text-center py-6">This deposit has already been closed.</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">Refund Amount (AED)</label>
                      <input type="number" value={refund.refund_amount} onChange={e => setRefund(r => ({ ...r, refund_amount: e.target.value }))}
                        className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">Refund Date</label>
                      <input type="date" value={refund.refund_date} onChange={e => setRefund(r => ({ ...r, refund_date: e.target.value }))}
                        className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">Refund Method</label>
                      <select value={refund.refund_method} onChange={e => setRefund(r => ({ ...r, refund_method: e.target.value }))}
                        className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm">
                        <option value="BANK_TRANSFER">Bank Transfer</option>
                        <option value="CHEQUE">Cheque</option>
                        <option value="CASH">Cash</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">Reference / Cheque No.</label>
                      <input value={refund.refund_reference} onChange={e => setRefund(r => ({ ...r, refund_reference: e.target.value }))}
                        className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
                    </div>
                  </div>
                  <div className="bg-emerald-900/30 border border-emerald-500/20 rounded-lg p-3 text-sm text-emerald-300">
                    Net refundable: <strong>{fmt(net)}</strong> · Refunding: <strong>{fmt(Number(refund.refund_amount) || 0)}</strong>
                  </div>
                  <button onClick={processRefund} disabled={saving}
                    className="w-full py-2.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-medium disabled:opacity-40">
                    {saving ? 'Processing…' : 'Process Refund'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Forfeit */}
          {tab === 'forfeit' && (
            <div className="space-y-4">
              {deposit.status === 'FORFEITED' ? (
                <div className="bg-red-900/30 border border-red-500/20 rounded-lg p-4">
                  <p className="text-red-300 text-sm font-medium">Deposit Forfeited</p>
                  <p className="text-slate-400 text-sm mt-1">{deposit.forfeiture_reason ?? '—'}</p>
                </div>
              ) : (
                <>
                  <div className="bg-red-900/20 border border-red-500/20 rounded-lg p-3 text-sm text-red-300">
                    ⚠️ Forfeiting will retain the full deposit (<strong>{fmt(deposit.collected_amount)}</strong>) as income. This action cannot be undone.
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Forfeiture Reason *</label>
                    <textarea value={forfeitReason} onChange={e => setForfeitReason(e.target.value)} rows={3} placeholder="e.g. Contract default, vehicle damage beyond deposit..."
                      className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm resize-none" />
                  </div>
                  <button onClick={forfeit} disabled={saving || !forfeitReason.trim()}
                    className="w-full py-2.5 rounded-lg bg-red-700 hover:bg-red-600 text-white font-medium disabled:opacity-40">
                    {saving ? 'Forfeiting…' : 'Forfeit Deposit'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────────────────────── */
export default function DepositsPage() {
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [kpi, setKpi]           = useState<Kpi | null>(null);
  const [tab, setTab]           = useState('ALL');
  const [search, setSearch]     = useState('');
  const [showNew, setShowNew]   = useState(false);
  const [selected, setSelected] = useState<Deposit | null>(null);
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams();
    if (tab !== 'ALL') p.set('status', tab);
    if (search)        p.set('search', search);
    const res  = await fetch(`/api/finance/deposits?${p}`);
    const data = await res.json();
    setDeposits(data.deposits ?? []);
    setKpi(data.kpi ?? null);
    setLoading(false);
  }, [tab, search]);

  useEffect(() => { load(); }, [load]);

  const kpiCards = kpi ? [
    { label: 'Total Held',        value: fmt(Number(kpi.total_held_amount)), icon: '🔒', color: 'from-blue-600 to-indigo-600' },
    { label: 'Active Deposits',   value: kpi.held_count,                     icon: '📋', color: 'from-slate-600 to-slate-700' },
    { label: 'Total Refunded',    value: fmt(Number(kpi.total_refunded)),     icon: '↩️', color: 'from-emerald-600 to-teal-600' },
    { label: 'Forfeited',         value: fmt(Number(kpi.total_forfeited)),    icon: '⛔', color: 'from-red-600 to-rose-600' },
    { label: 'Overdue (>365d)',   value: kpi.overdue_count,                   icon: '⏰', color: 'from-amber-600 to-orange-600' },
  ] : [];

  return (
    <div className="text-white">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Security Deposit Management</h1>
          <p className="text-slate-400 text-sm mt-1">Track, deduct & refund security deposits across all contracts</p>
        </div>
        <button onClick={() => setShowNew(true)}
          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-semibold hover:from-emerald-500 hover:to-teal-500 transition-all">
          + New Deposit
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

      {/* Aging Alert */}
      {kpi && Number(kpi.overdue_count) > 0 && (
        <div className="mb-6 bg-amber-900/30 border border-amber-500/20 rounded-xl p-4 flex items-center gap-3">
          <span className="text-2xl">⏰</span>
          <div>
            <p className="text-amber-300 font-semibold text-sm">{kpi.overdue_count} deposit(s) held over 365 days</p>
            <p className="text-slate-400 text-xs mt-0.5">Review and process refunds or forfeiture for aging deposits.</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="flex bg-slate-800 rounded-xl p-1 gap-1 flex-wrap">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${tab === t ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              {t.replace('_', ' ')}
            </button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer, vehicle, ref…"
          className="bg-slate-800 border border-white/10 rounded-xl px-4 py-2 text-sm text-white placeholder-slate-500 flex-1 min-w-[200px]" />
      </div>

      {/* Table */}
      <div className="bg-slate-800/60 rounded-2xl border border-white/5 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left">
              {['Deposit No.','Customer','Vehicle','Contract','Branch','Collected','Deducted','Net','Held Days','Status',''].map(h => (
                <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="text-center py-12 text-slate-500">Loading…</td></tr>
            ) : deposits.length === 0 ? (
              <tr><td colSpan={11} className="text-center py-12 text-slate-500">No deposits found</td></tr>
            ) : deposits.map(d => (
              <tr key={d.id} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                <td className="px-4 py-3 font-mono text-emerald-400 text-xs">{d.deposit_no}</td>
                <td className="px-4 py-3 text-white">{d.customer_name}</td>
                <td className="px-4 py-3 text-slate-300">{d.vehicle_no}</td>
                <td className="px-4 py-3 text-slate-400 text-xs">{d.contract_id} <span className="bg-slate-700 px-1.5 py-0.5 rounded text-slate-500">{d.contract_type}</span></td>
                <td className="px-4 py-3 text-slate-400">{d.branch}</td>
                <td className="px-4 py-3 text-white">{fmt(d.collected_amount)}</td>
                <td className="px-4 py-3 text-red-400">{d.total_deducted > 0 ? fmt(d.total_deducted) : '—'}</td>
                <td className="px-4 py-3 text-emerald-400">{fmt(d.collected_amount - d.total_deducted)}</td>
                <td className={`px-4 py-3 ${AGING_COLOR(d.held_days)}`}>{d.held_days}d</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-1 rounded-full ${STATUS_COLOR[d.status] ?? ''}`}>{d.status.replace('_', ' ')}</span>
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => setSelected(d)} className="text-xs text-emerald-400 hover:text-emerald-300 underline">Open</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showNew && <NewDepositModal onClose={() => setShowNew(false)} onSave={() => { setShowNew(false); load(); }} />}
      {selected && (
        <DepositDetailModal
          deposit={selected}
          onClose={() => setSelected(null)}
          onRefresh={async () => {
            await load();
            // Refresh selected deposit from updated list
            const res = await fetch(`/api/finance/deposits?search=${selected.deposit_no}`);
            const data = await res.json();
            setSelected(data.deposits?.[0] ?? null);
          }}
        />
      )}
    </div>
  );
}
