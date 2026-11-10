'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { downloadXLSX } from '@/lib/exportUtils';

interface ProfitCentreMaster {
  id?: string;
  code: string;
  name: string;
  description?: string | null;
  parent_code?: string | null;
  module?: string | null;
  branch?: string | null;
  manager_name?: string | null;
  is_active?: boolean;
  budget?: string | number | null;
  budget_target?: string | number | null;
  revenue?: string | number;
  direct_costs?: string | number;
  gross_profit?: string | number;
  margin_pct?: string | number;
  invoice_count?: string | number;
  payable_count?: string | number;
}

interface PlSummaryRow {
  profitCentre: string;
  totalIncome: number;
  totalExpense: number;
  grossProfit: number;
}

interface PlDetailRow {
  profit_centre: string;
  account_type: string;
  account_subtype?: string | null;
  account_code: string;
  account_name: string;
  total_debit: string | number;
  total_credit: string | number;
  balance: string | number;
}

const MODULES = ['RENTAL', 'LEASING', 'LOGISTICS', 'BUS_OPERATIONS', 'SCHOOL_BUS', 'MAINTENANCE', 'GENERAL'];
const BRANCHES = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Fujairah', 'Ras Al Khaimah', 'Umm Al Quwain'];

const fmtAED = (n: number) =>
  `AED ${Number(n || 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function CreateProfitCentreModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    code: '',
    name: '',
    description: '',
    module: 'LEASING',
    branch: 'Dubai',
    managerName: '',
    budgetTarget: '',
  });
  const [saving, setSaving] = useState(false);

  const s = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      alert('Code and Name are required.');
      return;
    }
    setSaving(true);
    const budgetVal = form.budgetTarget ? parseFloat(form.budgetTarget) : null;
    const res = await fetch('/api/finance/profit-centres', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        description: form.description || `${form.branch} — ${form.managerName || form.module}`,
        module: form.module,
        branch: form.branch,
        managerName: form.managerName || null,
        budget: budgetVal,
        budgetTarget: budgetVal,
        isActive: true,
      }),
    });
    setSaving(false);
    if (res.ok) {
      onSaved();
      onClose();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error ?? 'Failed to create profit centre');
    }
  };

  const inp = 'w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-emerald-500';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
          <h2 className="text-lg font-bold text-[var(--text-main)]">New Profit Centre</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-xl">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Code *</label>
              <input value={form.code} onChange={s('code')} placeholder="PC-DXB-LEASE" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Name *</label>
              <input value={form.name} onChange={s('name')} placeholder="Dubai Corporate Leasing" className={inp} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Business Unit / Module</label>
              <select value={form.module} onChange={s('module')} className={inp}>
                {MODULES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Branch</label>
              <select value={form.branch} onChange={s('branch')} className={inp}>
                {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Manager Name</label>
              <input value={form.managerName} onChange={s('managerName')} placeholder="Unit Manager" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Annual Budget Target (AED)</label>
              <input type="number" value={form.budgetTarget} onChange={s('budgetTarget')} placeholder="500000" className={inp} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Description</label>
            <input value={form.description} onChange={s('description')} placeholder="Profit centre scope & KPI notes…" className={inp} />
          </div>
        </div>
        <div className="flex gap-2 p-5 border-t border-[var(--border-subtle)]">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-[var(--border-subtle)] text-sm text-[var(--text-muted)] hover:text-[var(--text-main)]">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm disabled:opacity-50">
            {saving ? 'Saving…' : '✓ Create Profit Centre'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProfitCentresPage() {
  const [masters, setMasters]       = useState<ProfitCentreMaster[]>([]);
  const [plSummary, setPlSummary]   = useState<PlSummaryRow[]>([]);
  const [plDetails, setPlDetails]   = useState<PlDetailRow[]>([]);
  const [from, setFrom]             = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo]                 = useState(new Date().toISOString().slice(0, 10));
  const [selectedCode, setSelected] = useState<string>('');
  const [loading, setLoading]       = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const listParams = new URLSearchParams({ from, to });
    const plParams = new URLSearchParams({ type: 'pl', from, to });
    if (selectedCode) plParams.set('code', selectedCode);

    const [listRes, plRes] = await Promise.all([
      fetch(`/api/finance/profit-centres?${listParams}`, { cache: 'no-store' }),
      fetch(`/api/finance/profit-centres?${plParams}`, { cache: 'no-store' }),
    ]);

    if (listRes.ok) {
      const d = await listRes.json();
      setMasters(d.profitCentres ?? d.data ?? []);
    }
    if (plRes.ok) {
      const p = await plRes.json();
      setPlSummary(p.summary ?? []);
      setPlDetails(p.rows ?? []);
    }
    setLoading(false);
  }, [from, to, selectedCode]);

  useEffect(() => { load(); }, [load]);

  const summaryMap = new Map(plSummary.map(s => [s.profitCentre, s]));

  const enriched = masters.map(m => {
    const pl = summaryMap.get(m.code);
    const revenue = Number(m.revenue ?? pl?.totalIncome ?? 0);
    const directCosts = Number(m.direct_costs ?? pl?.totalExpense ?? 0);
    const grossProfit = Number(m.gross_profit ?? (revenue - directCosts));
    const marginPct = Number(
      m.margin_pct ?? (revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0)
    );
    const budget = Number(m.budget ?? m.budget_target ?? 0);
    const invoiceCount = Number(m.invoice_count ?? 0);
    const payableCount = Number(m.payable_count ?? 0);
    return {
      ...m,
      revenue,
      direct_costs: directCosts,
      gross_profit: grossProfit,
      margin_pct: marginPct,
      budget,
      invoice_count: invoiceCount,
      payable_count: payableCount,
    };
  });

  const totalRevenue = enriched.reduce((s, r) => s + r.revenue, 0);
  const totalCosts   = enriched.reduce((s, r) => s + r.direct_costs, 0);
  const totalProfit  = totalRevenue - totalCosts;
  const totalMargin  = totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 1000) / 10 : 0;

  const exportReport = () => {
    downloadXLSX(
      `Profit-Centres-${from}-to-${to}.xls`,
      enriched.map(r => ({
        'Code': r.code,
        'Profit Centre': r.name,
        'Module': r.module ?? 'GENERAL',
        'Revenue (AED)': r.revenue,
        'Direct Costs (AED)': r.direct_costs,
        'Gross Profit (AED)': r.gross_profit,
        'Margin %': r.margin_pct,
        'Budget Target (AED)': r.budget,
        'Invoices': r.invoice_count,
        'Payables': r.payable_count,
      }))
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">Profit Centres</h1>
          <p className="text-[var(--text-muted)] text-xs mt-0.5">
            Business-unit P&amp;L performance, direct cost attribution &amp; margin tracking
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportReport}
            className="px-4 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)]"
          >
            ⬇ Export XLSX
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold"
          >
            + New Profit Centre
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-4">
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">From Date</label>
          <input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-sm text-[var(--text-main)]"
          />
        </div>
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">To Date</label>
          <input
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-sm text-[var(--text-main)]"
          />
        </div>
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">Filter Profit Centre</label>
          <select
            value={selectedCode}
            onChange={e => setSelected(e.target.value)}
            className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-sm text-[var(--text-main)]"
          >
            <option value="">All Profit Centres</option>
            {masters.map(m => (
              <option key={m.code} value={m.code}>{m.code} — {m.name}</option>
            ))}
          </select>
        </div>
        <button
          onClick={load}
          className="px-4 py-2 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 text-sm font-medium hover:bg-emerald-600/30"
        >
          Refresh P&amp;L
        </button>
      </div>

      {/* Consolidated KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Revenue', value: fmtAED(totalRevenue), color: 'text-emerald-400', sub: `${enriched.length} active units` },
          { label: 'Direct Costs',  value: fmtAED(totalCosts),   color: 'text-amber-400',   sub: 'Allocated GL + AP expenses' },
          { label: 'Gross Profit',  value: fmtAED(totalProfit),  color: totalProfit >= 0 ? 'text-teal-400' : 'text-red-400', sub: `Period ${from} → ${to}` },
          { label: 'Net Margin %',  value: `${totalMargin.toFixed(1)}%`, color: totalMargin >= 20 ? 'text-emerald-400' : 'text-amber-400', sub: 'Consolidated margin' },
        ].map(k => (
          <div key={k.label} className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-4">
            <p className="text-xs text-[var(--text-faint)]">{k.label}</p>
            <p className={`text-2xl font-bold mt-1 ${k.color}`}>{k.value}</p>
            <p className="text-xs text-[var(--text-faint)] mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Profit Centre Cards + Table */}
      {loading ? (
        <div className="h-64 bg-[var(--bg-surface)]/60 rounded-2xl animate-pulse" />
      ) : enriched.length === 0 ? (
        <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-12 text-center">
          <p className="text-[var(--text-muted)]">No profit centres configured yet.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {enriched.map(pc => (
              <div
                key={pc.code}
                onClick={() => setSelected(selectedCode === pc.code ? '' : pc.code)}
                className={`cursor-pointer bg-[var(--bg-surface)]/60 border rounded-2xl p-5 transition-all hover:bg-[var(--bg-surface)] ${
                  selectedCode === pc.code ? 'border-emerald-500 ring-1 ring-emerald-500/30' : 'border-[var(--border-subtle)]'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                      {pc.code}
                    </span>
                    <h3 className="text-base font-bold text-[var(--text-main)] mt-2">{pc.name}</h3>
                    <p className="text-xs text-[var(--text-faint)]">{pc.module ?? 'GENERAL'} {pc.description ? `· ${pc.description}` : ''}</p>
                  </div>
                  <span className={`text-sm font-bold ${pc.margin_pct >= 20 ? 'text-emerald-400' : pc.margin_pct >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
                    {pc.margin_pct.toFixed(1)}%
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-[var(--border-subtle)] text-xs">
                  <div>
                    <p className="text-[var(--text-faint)]">Revenue</p>
                    <p className="text-[var(--text-main)] font-semibold mt-0.5">{fmtAED(pc.revenue)}</p>
                  </div>
                  <div>
                    <p className="text-[var(--text-faint)]">Direct Costs</p>
                    <p className="text-amber-400 font-semibold mt-0.5">{fmtAED(pc.direct_costs)}</p>
                  </div>
                  <div>
                    <p className="text-[var(--text-faint)]">Gross Profit</p>
                    <p className={`font-bold mt-0.5 ${pc.gross_profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {fmtAED(pc.gross_profit)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Summary Table */}
          <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <h2 className="text-sm font-bold text-[var(--text-main)]">Profit Centre P&amp;L Matrix</h2>
              <span className="text-xs text-[var(--text-faint)]">{from} to {to}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)] text-xs uppercase">
                    <th className="text-left px-5 py-3">Code</th>
                    <th className="text-left px-5 py-3">Name</th>
                    <th className="text-left px-5 py-3">Module</th>
                    <th className="text-right px-5 py-3">Revenue</th>
                    <th className="text-right px-5 py-3">Direct Costs</th>
                    <th className="text-right px-5 py-3">Gross Profit</th>
                    <th className="text-right px-5 py-3">Margin %</th>
                    <th className="text-right px-5 py-3">Budget</th>
                  </tr>
                </thead>
                <tbody>
                  {enriched.map(pc => (
                    <tr key={pc.code} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-surface-hover)]">
                      <td className="px-5 py-3 font-mono text-xs text-emerald-400 font-semibold">{pc.code}</td>
                      <td className="px-5 py-3 text-[var(--text-main)] font-medium">{pc.name}</td>
                      <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{pc.module ?? 'GENERAL'}</td>
                      <td className="px-5 py-3 text-right text-[var(--text-main)] font-medium">{fmtAED(pc.revenue)}</td>
                      <td className="px-5 py-3 text-right text-amber-400">{fmtAED(pc.direct_costs)}</td>
                      <td className={`px-5 py-3 text-right font-bold ${pc.gross_profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {fmtAED(pc.gross_profit)}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold text-[var(--text-main)]">{pc.margin_pct.toFixed(1)}%</td>
                      <td className="px-5 py-3 text-right text-[var(--text-muted)] text-xs">
                        {pc.budget > 0 ? fmtAED(pc.budget) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* GL Account Breakdown when rows exist */}
          {plDetails.length > 0 && (
            <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[var(--border-subtle)]">
                <h2 className="text-sm font-bold text-[var(--text-main)]">
                  Posted Journal Line Breakdown {selectedCode ? `— ${selectedCode}` : ''}
                </h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)] text-xs uppercase">
                    <th className="text-left px-5 py-3">Profit Centre</th>
                    <th className="text-left px-5 py-3">Account</th>
                    <th className="text-left px-5 py-3">Type</th>
                    <th className="text-right px-5 py-3">Debits</th>
                    <th className="text-right px-5 py-3">Credits</th>
                    <th className="text-right px-5 py-3">Net Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {plDetails.map((r, i) => (
                    <tr key={i} className="border-b border-[var(--border-subtle)] last:border-0">
                      <td className="px-5 py-2.5 font-mono text-xs text-emerald-400">{r.profit_centre}</td>
                      <td className="px-5 py-2.5 text-xs text-[var(--text-main)]">{r.account_code} — {r.account_name}</td>
                      <td className="px-5 py-2.5 text-xs text-[var(--text-muted)]">{r.account_type}</td>
                      <td className="px-5 py-2.5 text-right text-xs text-[var(--text-muted)]">{fmtAED(Number(r.total_debit))}</td>
                      <td className="px-5 py-2.5 text-right text-xs text-[var(--text-muted)]">{fmtAED(Number(r.total_credit))}</td>
                      <td className="px-5 py-2.5 text-right text-xs font-semibold text-[var(--text-main)]">{fmtAED(Number(r.balance))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {showCreate && (
        <CreateProfitCentreModal
          onClose={() => setShowCreate(false)}
          onSaved={load}
        />
      )}
    </div>
  );
}
