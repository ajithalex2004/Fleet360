'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { downloadFTAFormat } from '@/lib/exportUtils';

interface BranchVATLine {
  branch_id: string | null;
  branch_name: string;
  emirate: string | null;
  trade_license_no: string | null;
  trade_license_authority: string | null;
  cost_center_code: string | null;
  taxable_supplies: number;
  output_vat: number;
  zero_rated_supplies: number;
  exempt_supplies: number;
  invoice_count: number;
  taxable_purchases: number;
  input_vat: number;
  net_vat_position: number;
}

interface VATData {
  tenant: { id: string; name: string; trn: string | null; code: string | null; contact_email: string | null };
  period: { start: string; end: string; quarter: string | null };
  branch_lines: BranchVATLine[];
  consolidated: {
    taxable_supplies: number;
    output_vat: number;
    zero_rated_supplies: number;
    exempt_supplies: number;
    taxable_purchases: number;
    input_vat: number;
    net_vat_payable: number;
    refund_due: boolean;
    invoice_count: number;
  };
}

const QUARTERS = ['Q1-2026', 'Q4-2025', 'Q3-2025', 'Q2-2025', 'Q1-2025'];
const EMIRATE_FLAGS: Record<string, string> = {
  ABU_DHABI: '🏛️', DUBAI: '🏙️', SHARJAH: '🕌',
  AJMAN: '⛵', UMM_AL_QUWAIN: '🌿', RAS_AL_KHAIMAH: '⛰️', FUJAIRAH: '🌊',
};
const EMIRATE_LABELS: Record<string, string> = {
  ABU_DHABI: 'Abu Dhabi', DUBAI: 'Dubai', SHARJAH: 'Sharjah',
  AJMAN: 'Ajman', UMM_AL_QUWAIN: 'Umm Al Quwain', RAS_AL_KHAIMAH: 'Ras Al Khaimah', FUJAIRAH: 'Fujairah',
};

function fmt(n: number) {
  return `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function VATBranchPage() {
  const [data,     setData]     = useState<VATData | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [tenantId, setTenantId] = useState('');
  const [quarter,  setQuarter]  = useState(QUARTERS[0]);
  const [tenants,  setTenants]  = useState<{ id: string; name: string; trn?: string }[]>([]);

  useEffect(() => {
    fetch('/api/admin/tenants?limit=200')
      .then(r => r.ok ? r.json() : [])
      .then(d => {
        const list = Array.isArray(d) ? d : (d.data ?? []);
        setTenants(list);
        if (list.length > 0 && !tenantId) setTenantId(list[0].id);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/finance/vat-branch?tenantId=${tenantId}&quarter=${quarter}`);
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [tenantId, quarter]);

  useEffect(() => { load(); }, [load]);

  const cons = data?.consolidated;
  const lines = data?.branch_lines ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">VAT Return — Branch Breakdown</h1>
        <p className="text-slate-400 text-sm mt-1">UAE FTA consolidated VAT return with per-emirate branch contribution · Single TRN filing</p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-slate-400 text-xs mb-1.5">Tenant</label>
          <select
            value={tenantId}
            onChange={e => setTenantId(e.target.value)}
            className="bg-slate-800 border border-white/10 rounded-xl px-4 py-2 text-white text-sm focus:outline-none min-w-48"
          >
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-slate-400 text-xs mb-1.5">VAT Period</label>
          <select
            value={quarter}
            onChange={e => setQuarter(e.target.value)}
            className="bg-slate-800 border border-white/10 rounded-xl px-4 py-2 text-white text-sm focus:outline-none"
          >
            {QUARTERS.map(q => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>
        <button onClick={load} className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors">
          Generate Return
        </button>
      </div>

      {/* TRN Banner */}
      {data?.tenant && (
        <div className="bg-gradient-to-r from-emerald-950/60 to-slate-900 border border-emerald-500/20 rounded-2xl p-5">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <span className="text-3xl">🇦🇪</span>
              <div>
                <p className="text-white font-bold text-lg">{data.tenant.name}</p>
                <div className="flex items-center gap-4 mt-1 flex-wrap">
                  <span className="text-emerald-300 text-sm font-mono">TRN: <strong>{data.tenant.trn ?? 'Not set'}</strong></span>
                  <span className="text-slate-500 text-xs">Period: {data.period.start} → {data.period.end}</span>
                  {data.period.quarter && <span className="text-slate-500 text-xs">{data.period.quarter}</span>}
                </div>
              </div>
            </div>
            <div className="text-right">
              <p className="text-slate-400 text-xs">Filing TRN</p>
              <p className="text-white font-mono font-bold">{data.tenant.trn ?? '—'}</p>
              <p className="text-slate-500 text-xs mt-1">Covers {lines.length} branch{lines.length !== 1 ? 'es' : ''}</p>
            </div>
          </div>
        </div>
      )}

      {/* FTA note */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
        <span className="text-xl flex-shrink-0">⚠️</span>
        <p className="text-amber-300/80 text-xs leading-relaxed">
          <strong className="text-amber-300">UAE FTA Filing:</strong> The TRN is a single federal registration number.
          All branches file under one consolidated VAT return. This report shows each branch&apos;s contribution for your internal records,
          but the FTA receives only the <strong>consolidated totals</strong> in the bottom section.
          VAT returns must be filed within 28 days of the quarter end.
        </p>
      </div>

      {/* Per-branch VAT breakdown */}
      {!loading && lines.length > 0 && (
        <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10">
            <h2 className="text-white font-semibold">Per-Branch VAT Contribution</h2>
            <p className="text-slate-500 text-xs mt-0.5">Internal management view — not submitted to FTA separately</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800/50 text-xs text-slate-400">
                  <th className="text-left px-6 py-3">Branch / Emirate</th>
                  <th className="text-left px-4 py-3">Trade License</th>
                  <th className="text-right px-4 py-3">Taxable Supplies</th>
                  <th className="text-right px-4 py-3">Output VAT (5%)</th>
                  <th className="text-right px-4 py-3">Zero Rated</th>
                  <th className="text-right px-4 py-3">Input VAT</th>
                  <th className="text-right px-4 py-3">Net Position</th>
                  <th className="text-right px-4 py-3">Invoices</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {lines.map(line => (
                  <tr key={line.branch_id ?? 'unassigned'} className="hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2.5">
                        <span className="text-lg">{line.emirate ? (EMIRATE_FLAGS[line.emirate] ?? '🏢') : '🌐'}</span>
                        <div>
                          <p className="text-white font-medium">{line.branch_name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {line.emirate && <span className="text-slate-500 text-xs">{EMIRATE_LABELS[line.emirate] ?? line.emirate}</span>}
                            {line.cost_center_code && <span className="font-mono text-slate-600 text-xs">{line.cost_center_code}</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div>
                        <p className="text-slate-300 text-xs font-mono">{line.trade_license_no ?? '—'}</p>
                        {line.trade_license_authority && <p className="text-slate-600 text-xs">{line.trade_license_authority}</p>}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right text-white">{fmt(line.taxable_supplies)}</td>
                    <td className="px-4 py-4 text-right text-emerald-400 font-semibold">{fmt(line.output_vat)}</td>
                    <td className="px-4 py-4 text-right text-slate-400">{fmt(line.zero_rated_supplies)}</td>
                    <td className="px-4 py-4 text-right text-amber-400">{fmt(line.input_vat)}</td>
                    <td className={`px-4 py-4 text-right font-semibold ${line.net_vat_position >= 0 ? 'text-emerald-400' : 'text-blue-400'}`}>
                      {fmt(line.net_vat_position)}
                      {line.net_vat_position < 0 && <span className="text-xs text-blue-500 ml-1">(Refund)</span>}
                    </td>
                    <td className="px-4 py-4 text-right text-slate-400">{line.invoice_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Consolidated FTA Return Box */}
      {cons && (
        <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-emerald-500/20 bg-emerald-500/5 flex items-center justify-between">
            <div>
              <h2 className="text-white font-bold">🇦🇪 FTA VAT Return — Consolidated</h2>
              <p className="text-emerald-400/70 text-xs mt-0.5">Filed under TRN: {data?.tenant.trn ?? '—'} · {data?.period.quarter ?? data?.period.start}</p>
            </div>
            <button
              onClick={() => data && cons && downloadFTAFormat(
                `FTA-VAT-${data.tenant.trn ?? 'return'}-${data.period.quarter ?? 'period'}.csv`,
                {
                  trn:              data.tenant.trn ?? '',
                  period:           data.period.quarter ?? `${data.period.start} – ${data.period.end}`,
                  taxable_supplies: cons.taxable_supplies,
                  output_vat:       cons.output_vat,
                  input_vat:        cons.input_vat,
                  net_vat:          cons.net_vat_payable,
                  branches:         data.branch_lines.map(b => ({
                    branch:  b.branch_name ?? b.emirate ?? String(b.branch_id),
                    taxable: Number(b.taxable_supplies ?? 0),
                    vat:     Number(b.output_vat ?? 0),
                  })),
                }
              )}
              className="text-sm bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl transition-colors">
              ⬇ Export FTA Format
            </button>
          </div>

          <div className="p-6 space-y-0">
            {/* Box 1 — Standard rated supplies */}
            <div className="border border-white/10 rounded-t-xl overflow-hidden">
              <div className="bg-slate-800/60 px-5 py-3 flex items-center justify-between">
                <p className="text-slate-300 text-sm font-medium">Box 1 — Standard-Rated Supplies (5%)</p>
                <p className="text-white font-bold">{fmt(cons.taxable_supplies)}</p>
              </div>
              <div className="px-5 py-3 flex items-center justify-between border-t border-white/5">
                <p className="text-slate-400 text-sm">Output VAT due on Box 1</p>
                <p className="text-emerald-400 font-bold">{fmt(cons.output_vat)}</p>
              </div>
            </div>

            {/* Box 2 — Zero rated */}
            <div className="border-x border-b border-white/10">
              <div className="px-5 py-3 flex items-center justify-between">
                <p className="text-slate-400 text-sm">Box 2 — Zero-Rated Supplies (0%)</p>
                <p className="text-slate-300 font-semibold">{fmt(cons.zero_rated_supplies)}</p>
              </div>
            </div>

            {/* Box 3 — Exempt */}
            <div className="border-x border-b border-white/10">
              <div className="px-5 py-3 flex items-center justify-between">
                <p className="text-slate-400 text-sm">Box 3 — Exempt Supplies</p>
                <p className="text-slate-300 font-semibold">{fmt(cons.exempt_supplies)}</p>
              </div>
            </div>

            {/* Box 9 — Input VAT */}
            <div className="border-x border-b border-white/10">
              <div className="px-5 py-3 flex items-center justify-between">
                <p className="text-slate-400 text-sm">Box 9 — Total Value of Taxable Purchases</p>
                <p className="text-slate-300 font-semibold">{fmt(cons.taxable_purchases)}</p>
              </div>
              <div className="px-5 py-3 flex items-center justify-between border-t border-white/5">
                <p className="text-slate-400 text-sm">Recoverable Input VAT (Box 9)</p>
                <p className="text-amber-400 font-bold">({fmt(cons.input_vat)})</p>
              </div>
            </div>

            {/* Net Payable — highlighted */}
            <div className={`border rounded-b-xl overflow-hidden ${cons.refund_due ? 'border-blue-500/30' : 'border-emerald-500/30'}`}>
              <div className={`px-5 py-4 flex items-center justify-between ${cons.refund_due ? 'bg-blue-500/10' : 'bg-emerald-500/10'}`}>
                <div>
                  <p className={`font-bold text-base ${cons.refund_due ? 'text-blue-300' : 'text-white'}`}>
                    {cons.refund_due ? 'VAT Refund Due from FTA' : 'Net VAT Payable to FTA'}
                  </p>
                  <p className="text-slate-500 text-xs mt-0.5">Output VAT {fmt(cons.output_vat)} − Input VAT {fmt(cons.input_vat)}</p>
                </div>
                <p className={`text-3xl font-black ${cons.refund_due ? 'text-blue-400' : 'text-emerald-400'}`}>
                  {fmt(Math.abs(cons.net_vat_payable))}
                </p>
              </div>
            </div>
          </div>

          {/* Invoice count note */}
          <div className="px-6 py-3 border-t border-white/10 bg-slate-950/40">
            <p className="text-slate-600 text-xs">
              Based on {cons.invoice_count} invoices across {lines.length} branch{lines.length !== 1 ? 'es' : ''} ·
              VAT rate: 5% per UAE Federal Decree-Law No. 8 of 2017 ·
              All amounts in AED
            </p>
          </div>
        </div>
      )}

      {loading && (
        <div className="bg-slate-900 border border-white/10 rounded-2xl p-12 text-center text-slate-500 text-sm">
          Generating VAT return…
        </div>
      )}
    </div>
  );
}
