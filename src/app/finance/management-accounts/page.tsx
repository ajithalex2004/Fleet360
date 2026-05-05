'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';

// ── Types ──────────────────────────────────────────────────────────────────────

interface RevLine  { label: string; code: string; amount: number }
interface ExpLine  { label: string; code: string; amount: number; subtype: string }
interface Summary  {
  totalRevenue: number; totalCOGS: number; grossProfit: number; grossMarginPct: number;
  totalOPEX: number; ebitda: number; ebitdaMarginPct: number;
  depreciation: number; ebit: number; totalFinanceCosts: number;
  ebt: number; totalTax: number; netProfit: number; netMarginPct: number;
}

interface ISBlock {
  revenues: RevLine[];
  expenses: { cogs: ExpLine[]; opex: ExpLine[]; finance: ExpLine[]; tax: ExpLine[] };
  summary: Summary;
  vat: { outputVat: number; inputVat: number; netVat: number };
}

interface IncomeStatementData extends ISBlock {
  type: 'income_statement';
  period: { from: string; to: string };
  compPeriod: { from: string; to: string } | null;
  source: 'GL' | 'MODULE_DATA';
  comparison: ISBlock | null;
}

interface CashFlowData {
  type: 'cash_flow';
  period: { from: string; to: string };
  source: 'GL' | 'MODULE_DATA';
  operating: { netProfit: number; addDepreciation: number; changeInReceivables: number; changeInPayables: number; netOperatingCashFlow: number };
  investing:  { capitalExpenditures: number; assetDisposals: number; netInvestingCashFlow: number };
  financing:  { newBorrowings: number; loanRepayments: number; dividendsPaid: number; netFinancingCashFlow: number };
  summary: { netCashFlow: number };
}

interface ModuleBreakdownData {
  type: 'module_breakdown';
  period: { from: string; to: string };
  total: number;
  modules: { module: string; label: string; amount: number; pct: number; color: string }[];
}

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.abs(n));
}
function fmtAmt(n: number) {
  return n < 0 ? `(${fmt(n)})` : fmt(n);
}

// ── Quick period presets ───────────────────────────────────────────────────────

function getPresets() {
  const now  = new Date();
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const today = now.toISOString().slice(0, 10);

  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lm_yyyy   = lastMonth.getFullYear();
  const lm_mm     = String(lastMonth.getMonth() + 1).padStart(2, '0');
  const lm_last   = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);

  const q = Math.floor(now.getMonth() / 3);
  const qStart = new Date(yyyy, q * 3, 1).toISOString().slice(0, 10);

  const prevQ      = q === 0 ? 3 : q - 1;
  const prevQYear  = q === 0 ? yyyy - 1 : yyyy;
  const prevQStart = new Date(prevQYear, prevQ * 3, 1).toISOString().slice(0, 10);
  const prevQEnd   = new Date(prevQYear, prevQ * 3 + 3, 0).toISOString().slice(0, 10);

  return [
    { label: 'MTD',          from: `${yyyy}-${mm}-01`,    to: today },
    { label: 'QTD',          from: qStart,                to: today },
    { label: 'YTD',          from: `${yyyy}-01-01`,       to: today },
    { label: 'Last Month',   from: `${lm_yyyy}-${lm_mm}-01`, to: lm_last },
    { label: 'Last Quarter', from: prevQStart,            to: prevQEnd },
    { label: 'Last Year',    from: `${yyyy - 1}-01-01`,   to: `${yyyy - 1}-12-31` },
  ];
}

// ── Income Statement ───────────────────────────────────────────────────────────

function AmtCell({ value, negative = false, className = '' }: { value: number; negative?: boolean; className?: string }) {
  const isNeg = negative || value < 0;
  return (
    <td className={`px-4 py-1.5 text-right text-sm tabular-nums ${isNeg ? 'text-red-400' : 'text-slate-200'} ${className}`}>
      {negative || value < 0 ? `(${fmt(Math.abs(value))})` : fmt(value)}
    </td>
  );
}

function VarCell({ current, comparison }: { current: number; comparison: number }) {
  const diff = current - comparison;
  const pct  = comparison !== 0 ? ((diff / Math.abs(comparison)) * 100) : 0;
  const pos  = diff >= 0;
  return (
    <td className={`px-3 py-1.5 text-right text-xs tabular-nums ${pos ? 'text-emerald-400' : 'text-red-400'}`}>
      <div>{pos ? '+' : ''}{fmtAmt(diff)}</div>
      <div className="text-slate-500">{pos ? '+' : ''}{pct.toFixed(1)}%</div>
    </td>
  );
}

function IncomeStatement({ data }: { data: IncomeStatementData }) {
  const { revenues, expenses, summary, vat, comparison, compPeriod } = data;
  const hasComp = !!comparison && !!compPeriod;

  const SectionHeader = ({ label, color }: { label: string; color: string }) => (
    <tr className="border-t border-white/10 bg-slate-800/20">
      <td className={`px-4 py-2 text-xs font-bold uppercase tracking-wider ${color}`}>{label}</td>
      <td />{hasComp && <><td /><td /></>}<td />
    </tr>
  );

  const TotalRow = ({ label, current, comp, color, size = 'sm', highlight = '' }:
    { label: string; current: number; comp?: number; color: string; size?: string; highlight?: string }) => (
    <tr className={`border-b border-white/20 ${highlight}`}>
      <td className={`px-4 py-2 font-bold text-${size} ${color}`}>{label}</td>
      <td className={`px-4 py-2 text-right font-bold text-${size} tabular-nums ${color}`}>
        {fmtAmt(current)}
      </td>
      {hasComp && (
        <>
          <td className={`px-4 py-2 text-right text-${size} tabular-nums text-slate-400`}>
            {comp !== undefined ? fmtAmt(comp) : '—'}
          </td>
          {comp !== undefined
            ? <VarCell current={current} comparison={comp} />
            : <td />
          }
        </>
      )}
      <td />
    </tr>
  );

  const LineRow = ({ label, current, comp, negative = false }:
    { label: string; current: number; comp?: number; negative?: boolean }) => (
    <tr className="border-b border-white/5 hover:bg-slate-800/20">
      <td className="px-4 py-1 text-sm text-slate-300" style={{ paddingLeft: '36px' }}>{label}</td>
      <AmtCell value={current} negative={negative} />
      {hasComp && (
        <>
          <td className={`px-4 py-1 text-right text-sm tabular-nums text-slate-500`}>
            {comp !== undefined ? (negative || comp < 0 ? `(${fmt(Math.abs(comp))})` : fmt(comp)) : '—'}
          </td>
          {comp !== undefined
            ? <VarCell current={negative ? -current : current} comparison={negative ? -comp : comp} />
            : <td />
          }
        </>
      )}
      <td />
    </tr>
  );

  // Build comparison lookup by code
  const cRevMap = Object.fromEntries((comparison?.revenues ?? []).map(r => [r.code, r.amount]));
  const cExpMap = (type: string) => Object.fromEntries(
    ((comparison?.expenses as Record<string, ExpLine[]> | undefined)?.[type] ?? []).map((e: ExpLine) => [e.code, e.amount])
  );
  const cCogs = cExpMap('cogs');
  const cOpex = cExpMap('opex');
  const cFin  = cExpMap('finance');
  const cTax  = cExpMap('tax');
  const cs    = comparison?.summary;

  return (
    <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10">
            <th className="text-left px-4 py-3 text-slate-400 text-xs uppercase tracking-wider">Line Item</th>
            <th className="text-right px-4 py-3 text-slate-400 text-xs uppercase tracking-wider w-40">
              {data.period.from.slice(0, 7)} – {data.period.to.slice(0, 7)}
            </th>
            {hasComp && (
              <>
                <th className="text-right px-4 py-3 text-slate-500 text-xs uppercase tracking-wider w-36">
                  {compPeriod!.from.slice(0, 7)} – {compPeriod!.to.slice(0, 7)}
                </th>
                <th className="text-right px-3 py-3 text-slate-500 text-xs uppercase tracking-wider w-28">Variance</th>
              </>
            )}
            <th className="text-right px-4 py-3 text-slate-400 text-xs uppercase tracking-wider w-20">Margin</th>
          </tr>
        </thead>
        <tbody>

          {/* Revenue */}
          <SectionHeader label="Revenue" color="text-emerald-400" />
          {revenues.map(r => <LineRow key={r.code} label={r.label} current={r.amount} comp={cRevMap[r.code]} />)}
          <TotalRow label="Total Revenue" current={summary.totalRevenue} comp={cs?.totalRevenue}
            color="text-emerald-300" size="base" highlight="bg-emerald-900/10" />

          {/* COGS */}
          <SectionHeader label="Cost of Sales (COGS)" color="text-red-400" />
          {expenses.cogs.map(e => <LineRow key={e.code} label={e.label} current={e.amount} comp={cCogs[e.code]} negative />)}
          <TotalRow label="Total COGS" current={summary.totalCOGS} comp={cs?.totalCOGS}
            color="text-red-300" highlight="bg-red-900/10" />

          {/* Gross Profit */}
          <tr className="border-b border-white/20 bg-blue-900/10">
            <td className="px-4 py-3 font-bold text-base text-blue-300">Gross Profit</td>
            <td className={`px-4 py-3 text-right font-bold text-base tabular-nums ${summary.grossProfit >= 0 ? 'text-blue-300' : 'text-red-400'}`}>{fmtAmt(summary.grossProfit)}</td>
            {hasComp && <>
              <td className="px-4 py-3 text-right text-slate-400 tabular-nums">{cs ? fmtAmt(cs.grossProfit) : '—'}</td>
              {cs ? <VarCell current={summary.grossProfit} comparison={cs.grossProfit} /> : <td />}
            </>}
            <td className="px-4 py-3 text-right text-sm font-medium text-blue-400">{summary.grossMarginPct}%</td>
          </tr>

          {/* OPEX */}
          {expenses.opex.length > 0 && (
            <>
              <SectionHeader label="Operating Expenses (OPEX)" color="text-amber-400" />
              {expenses.opex.map(e => <LineRow key={e.code} label={e.label} current={e.amount} comp={cOpex[e.code]} negative />)}
              <TotalRow label="Total OPEX" current={summary.totalOPEX} comp={cs?.totalOPEX}
                color="text-amber-300" highlight="bg-amber-900/10" />
            </>
          )}

          {/* EBITDA */}
          <tr className="border-b border-white/20 bg-purple-900/10">
            <td className="px-4 py-3 font-bold text-base text-purple-300">EBITDA</td>
            <td className={`px-4 py-3 text-right font-bold text-base tabular-nums ${summary.ebitda >= 0 ? 'text-purple-300' : 'text-red-400'}`}>{fmtAmt(summary.ebitda)}</td>
            {hasComp && <>
              <td className="px-4 py-3 text-right text-slate-400 tabular-nums">{cs ? fmtAmt(cs.ebitda) : '—'}</td>
              {cs ? <VarCell current={summary.ebitda} comparison={cs.ebitda} /> : <td />}
            </>}
            <td className="px-4 py-3 text-right text-sm font-medium text-purple-400">{summary.ebitdaMarginPct}%</td>
          </tr>

          {/* Depreciation */}
          {summary.depreciation > 0 && (
            <LineRow label="Depreciation & Amortisation" current={summary.depreciation} comp={cs?.depreciation} negative />
          )}

          {/* EBIT */}
          <tr className="border-b border-white/20 bg-slate-800/30">
            <td className="px-4 py-2.5 font-bold text-sm text-slate-200">EBIT (Operating Profit)</td>
            <td className={`px-4 py-2.5 text-right font-bold text-sm tabular-nums ${summary.ebit >= 0 ? 'text-slate-200' : 'text-red-400'}`}>{fmtAmt(summary.ebit)}</td>
            {hasComp && <>
              <td className="px-4 py-2.5 text-right text-slate-400 tabular-nums">{cs ? fmtAmt(cs.ebit) : '—'}</td>
              {cs ? <VarCell current={summary.ebit} comparison={cs.ebit} /> : <td />}
            </>}
            <td />
          </tr>

          {/* Finance Costs */}
          {expenses.finance.length > 0 && (
            <>
              {expenses.finance.map(e => <LineRow key={e.code} label={e.label} current={e.amount} comp={cFin[e.code]} negative />)}
              <tr className="border-b border-white/10">
                <td className="px-4 py-1.5 text-sm text-slate-400" style={{ paddingLeft: '36px' }}>Total Finance Costs</td>
                <AmtCell value={summary.totalFinanceCosts} negative />
                {hasComp && <><td /><td /></>}
                <td />
              </tr>
            </>
          )}

          {/* EBT */}
          <tr className="border-b border-white/20 bg-slate-800/30">
            <td className="px-4 py-2.5 font-bold text-sm text-slate-200">Profit Before Tax (EBT)</td>
            <td className={`px-4 py-2.5 text-right font-bold text-sm tabular-nums ${summary.ebt >= 0 ? 'text-slate-200' : 'text-red-400'}`}>{fmtAmt(summary.ebt)}</td>
            {hasComp && <>
              <td className="px-4 py-2.5 text-right text-slate-400 tabular-nums">{cs ? fmtAmt(cs.ebt) : '—'}</td>
              {cs ? <VarCell current={summary.ebt} comparison={cs.ebt} /> : <td />}
            </>}
            <td />
          </tr>

          {/* Tax */}
          {(expenses.tax.length > 0 || summary.totalTax > 0) && (
            <>
              {expenses.tax.map(e => <LineRow key={e.code} label={e.label} current={e.amount} comp={cTax[e.code]} negative />)}
              {expenses.tax.length === 0 && (
                <LineRow label="UAE Corporate Tax (9%)" current={summary.totalTax} comp={cs?.totalTax} negative />
              )}
            </>
          )}

          {/* Net Profit */}
          <tr className={`border-t-2 border-white/30 ${summary.netProfit >= 0 ? 'bg-emerald-900/20' : 'bg-red-900/20'}`}>
            <td className="px-4 py-4 font-bold text-lg text-white">Net Profit / (Loss)</td>
            <td className={`px-4 py-4 text-right font-bold text-xl tabular-nums ${summary.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              AED {fmtAmt(summary.netProfit)}
            </td>
            {hasComp && <>
              <td className="px-4 py-4 text-right font-semibold text-slate-400 tabular-nums">
                AED {cs ? fmtAmt(cs.netProfit) : '—'}
              </td>
              {cs ? <VarCell current={summary.netProfit} comparison={cs.netProfit} /> : <td />}
            </>}
            <td className={`px-4 py-4 text-right font-bold text-sm ${summary.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {summary.netMarginPct}%
            </td>
          </tr>

          {/* VAT Position */}
          <tr className="border-t border-white/10 bg-slate-800/20">
            <td colSpan={hasComp ? 5 : 3} className="px-4 pt-4 pb-1 text-xs font-bold text-slate-400 uppercase tracking-wider">VAT Position</td>
          </tr>
          {[
            { label: 'Output VAT (5% on revenue)', value: vat.outputVat, neg: false },
            { label: 'Input VAT (recoverable)',    value: vat.inputVat,  neg: true  },
          ].map(row => (
            <tr key={row.label}>
              <td className="px-4 py-1 text-sm text-slate-400" style={{ paddingLeft: '36px' }}>{row.label}</td>
              <AmtCell value={row.value} negative={row.neg} />
              {hasComp && <><td /><td /></>}
              <td />
            </tr>
          ))}
          <tr className="border-b border-white/10">
            <td className="px-4 py-2 font-bold text-sm text-slate-200" style={{ paddingLeft: '36px' }}>Net VAT Payable to FTA</td>
            <td className="px-4 py-2 text-right font-bold text-sm text-amber-400 tabular-nums">AED {fmt(vat.netVat)}</td>
            {hasComp && <><td /><td /></>}
            <td />
          </tr>

        </tbody>
      </table>
    </div>
  );
}

// ── Cash Flow Statement ────────────────────────────────────────────────────────

function CashFlowStatement({ data }: { data: CashFlowData }) {
  const { operating, investing, financing, summary } = data;

  const Section = ({ title, color, lines, total, totalLabel }: {
    title: string; color: string;
    lines: { label: string; value: number }[];
    total: number; totalLabel: string;
  }) => (
    <>
      <tr className="border-t border-white/10 bg-slate-800/20">
        <td className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wider ${color}`}>{title}</td>
        <td />
      </tr>
      {lines.map((line, i) => (
        <tr key={i} className="border-b border-white/5 hover:bg-slate-800/20">
          <td className="px-4 py-1.5 text-sm text-slate-300" style={{ paddingLeft: '36px' }}>{line.label}</td>
          <td className={`px-4 py-1.5 text-right text-sm tabular-nums ${line.value < 0 ? 'text-red-400' : 'text-slate-200'}`}>
            {line.value < 0 ? `(${fmt(Math.abs(line.value))})` : fmt(line.value)}
          </td>
        </tr>
      ))}
      <tr className="border-b border-white/20 bg-slate-800/30">
        <td className="px-4 py-2.5 font-bold text-sm text-slate-200">{totalLabel}</td>
        <td className={`px-4 py-2.5 text-right font-bold text-sm tabular-nums ${total >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {total < 0 ? `(${fmt(Math.abs(total))})` : fmt(total)}
        </td>
      </tr>
    </>
  );

  return (
    <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10">
            <th className="text-left px-4 py-3 text-slate-400 text-xs uppercase tracking-wider">Item (Indirect Method)</th>
            <th className="text-right px-4 py-3 text-slate-400 text-xs uppercase tracking-wider w-48">AED</th>
          </tr>
        </thead>
        <tbody>
          <Section title="A. Operating Activities" color="text-blue-400" total={operating.netOperatingCashFlow} totalLabel="Net Cash from Operating Activities" lines={[
            { label: 'Net Profit / (Loss)',                   value: operating.netProfit },
            { label: 'Add: Depreciation & Amortisation',     value: operating.addDepreciation },
            { label: 'Change in Trade Receivables (AR)',      value: operating.changeInReceivables },
            { label: 'Change in Trade Payables (AP)',         value: operating.changeInPayables },
          ]} />
          <Section title="B. Investing Activities" color="text-purple-400" total={investing.netInvestingCashFlow} totalLabel="Net Cash from Investing Activities" lines={[
            { label: 'Capital Expenditure (Fleet & Equipment)', value: investing.capitalExpenditures },
            { label: 'Proceeds from Asset Disposals',           value: investing.assetDisposals },
          ]} />
          <Section title="C. Financing Activities" color="text-amber-400" total={financing.netFinancingCashFlow} totalLabel="Net Cash from Financing Activities" lines={[
            { label: 'New Lease Borrowings',   value: financing.newBorrowings },
            { label: 'Lease Repayments',       value: financing.loanRepayments },
            { label: 'Dividends Paid',         value: financing.dividendsPaid },
          ]} />
          <tr className={`border-t-2 border-white/30 ${summary.netCashFlow >= 0 ? 'bg-emerald-900/20' : 'bg-red-900/20'}`}>
            <td className="px-4 py-4 font-bold text-lg text-white">Net Change in Cash (A + B + C)</td>
            <td className={`px-4 py-4 text-right font-bold text-xl tabular-nums ${summary.netCashFlow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              AED {summary.netCashFlow < 0 ? `(${fmt(Math.abs(summary.netCashFlow))})` : fmt(summary.netCashFlow)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Module Breakdown Chart ─────────────────────────────────────────────────────

function ModuleBreakdown({ data }: { data: ModuleBreakdownData }) {
  if (!data.modules.length) return null;
  return (
    <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5">
      <h3 className="text-sm font-bold text-slate-300 mb-4">Revenue by Business Line</h3>
      <div className="space-y-3">
        {data.modules.map(m => (
          <div key={m.module} className="flex items-center gap-3">
            <div className="w-28 text-xs text-slate-400 truncate">{m.label}</div>
            <div className="flex-1 h-5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${m.pct}%`, backgroundColor: m.color }}
              />
            </div>
            <div className="w-14 text-right text-xs text-slate-300 tabular-nums">{m.pct}%</div>
            <div className="w-28 text-right text-xs text-slate-400 tabular-nums">AED {fmt(m.amount)}</div>
          </div>
        ))}
        <div className="pt-2 border-t border-white/10 flex justify-between text-xs text-slate-400">
          <span>Total Revenue</span>
          <span className="text-slate-200 font-bold tabular-nums">AED {fmt(data.total)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function ManagementAccountsPage() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') === 'cf' ? 'cash_flow' : 'income_statement';
  const [tab, setTab] = useState<'income_statement' | 'cash_flow'>(initialTab);
  const presets = getPresets();
  const [from, setFrom] = useState(presets[2].from); // YTD default
  const [to,   setTo]   = useState(presets[2].to);

  const [compare, setCompare] = useState(false);
  const [compFrom, setCompFrom] = useState('');
  const [compTo,   setCompTo]   = useState('');

  const [data,      setData]      = useState<IncomeStatementData | CashFlowData | null>(null);
  const [breakdown, setBreakdown] = useState<ModuleBreakdownData | null>(null);
  const [loading,   setLoading]   = useState(false);

  const inp = 'bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500';

  const load = useCallback(async () => {
    setLoading(true);
    const compParams = compare && compFrom && compTo ? `&compFrom=${compFrom}&compTo=${compTo}` : '';
    const [res, bRes] = await Promise.all([
      fetch(`/api/finance/management-accounts?type=${tab}&from=${from}&to=${to}${compParams}`),
      tab === 'income_statement'
        ? fetch(`/api/finance/management-accounts?type=module_breakdown&from=${from}&to=${to}`)
        : Promise.resolve(null),
    ]);
    if (res.ok) setData(await res.json());
    if (bRes?.ok) setBreakdown(await bRes.json());
    else if (!bRes) setBreakdown(null);
    setLoading(false);
  }, [tab, from, to, compare, compFrom, compTo]);

  useEffect(() => { load(); }, [load]);

  // When compare toggled on, prefill comparison with prior year of current period
  const handleCompareToggle = () => {
    if (!compare && !compFrom) {
      const y = new Date(from).getFullYear() - 1;
      setCompFrom(from.replace(`${y + 1}-`, `${y}-`));
      setCompTo(to.replace(`${y + 1}-`, `${y}-`));
    }
    setCompare(c => !c);
  };

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Management Accounts</h1>
          <p className="text-slate-400 text-sm mt-0.5">Income Statement (P&amp;L) · Cash Flow · Business Line Analysis</p>
        </div>
        {data && (
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium border ${
            data.source === 'GL'
              ? 'bg-purple-900/20 border-purple-500/30 text-purple-400'
              : 'bg-amber-900/20 border-amber-500/30 text-amber-400'
          }`}>
            {data.source === 'GL' ? '🔗 GL Data (Posted JEs)' : '📊 Module Data (Operational)'}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="space-y-3">
        {/* Tab + quick presets */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex bg-slate-800/60 border border-white/10 rounded-xl p-1 gap-1">
            {([['income_statement', '📈 Income Statement'], ['cash_flow', '💧 Cash Flow']] as const).map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === key ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {presets.map(p => (
              <button key={p.label}
                onClick={() => { setFrom(p.from); setTo(p.to); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                  from === p.from && to === p.to
                    ? 'bg-purple-600 border-purple-500 text-white'
                    : 'border-white/10 text-slate-400 hover:text-white hover:border-white/20'
                }`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Date row + compare toggle */}
        <div className="flex items-center gap-3 flex-wrap bg-slate-900/60 border border-white/10 rounded-2xl p-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400 w-20">Current period</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inp} />
            <span className="text-slate-500 text-xs">to</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inp} />
          </div>

          <div className="flex items-center gap-2 ml-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <div onClick={handleCompareToggle}
                className={`w-10 h-5 rounded-full transition-colors relative ${compare ? 'bg-purple-600' : 'bg-slate-700'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${compare ? 'left-5' : 'left-0.5'}`} />
              </div>
              <span className="text-xs text-slate-400">Compare</span>
            </label>
          </div>

          {compare && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500 w-28">vs. prior period</label>
              <input type="date" value={compFrom} onChange={e => setCompFrom(e.target.value)} className={`${inp} border-purple-500/40`} />
              <span className="text-slate-500 text-xs">to</span>
              <input type="date" value={compTo}   onChange={e => setCompTo(e.target.value)}   className={`${inp} border-purple-500/40`} />
            </div>
          )}

          <button onClick={load} disabled={loading}
            className="ml-auto px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl text-sm disabled:opacity-50">
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* KPI bar — Income Statement */}
      {data && data.type === 'income_statement' && (
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: 'Revenue',     value: data.summary.totalRevenue, compVal: data.comparison?.summary.totalRevenue, color: 'text-emerald-400' },
            { label: 'Gross Profit',value: data.summary.grossProfit,  compVal: data.comparison?.summary.grossProfit,  color: data.summary.grossProfit >= 0 ? 'text-blue-400' : 'text-red-400', pct: `${data.summary.grossMarginPct}%` },
            { label: 'EBITDA',      value: data.summary.ebitda,       compVal: data.comparison?.summary.ebitda,       color: data.summary.ebitda >= 0 ? 'text-purple-400' : 'text-red-400', pct: `${data.summary.ebitdaMarginPct}%` },
            { label: 'EBIT',        value: data.summary.ebit,         compVal: data.comparison?.summary.ebit,         color: data.summary.ebit >= 0 ? 'text-blue-300' : 'text-red-400' },
            { label: 'Net Profit',  value: data.summary.netProfit,    compVal: data.comparison?.summary.netProfit,    color: data.summary.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400', pct: `${data.summary.netMarginPct}%` },
          ].map(kpi => {
            const delta = kpi.compVal !== undefined ? kpi.value - kpi.compVal : null;
            return (
              <div key={kpi.label} className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
                <p className="text-xs text-slate-400">{kpi.label}</p>
                <p className={`text-base font-bold mt-1 tabular-nums ${kpi.color}`}>
                  AED {kpi.value < 0 ? '(' : ''}{fmt(Math.abs(kpi.value))}{kpi.value < 0 ? ')' : ''}
                </p>
                {kpi.pct && <p className="text-xs text-slate-500 mt-0.5">{kpi.pct} margin</p>}
                {delta !== null && (
                  <p className={`text-xs mt-1 tabular-nums ${delta >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {delta >= 0 ? '▲' : '▼'} AED {fmt(Math.abs(delta))} vs prior
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* KPI bar — Cash Flow */}
      {data && data.type === 'cash_flow' && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Operating Cash Flow',  value: data.operating.netOperatingCashFlow,  color: 'text-blue-400' },
            { label: 'Investing Cash Flow',   value: data.investing.netInvestingCashFlow,  color: 'text-purple-400' },
            { label: 'Financing Cash Flow',   value: data.financing.netFinancingCashFlow,  color: 'text-amber-400' },
            { label: 'Net Cash Flow',         value: data.summary.netCashFlow,             color: data.summary.netCashFlow >= 0 ? 'text-emerald-400' : 'text-red-400' },
          ].map(kpi => (
            <div key={kpi.label} className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
              <p className="text-xs text-slate-400">{kpi.label}</p>
              <p className={`text-base font-bold mt-1 tabular-nums ${kpi.color}`}>
                AED {kpi.value < 0 ? `(${fmt(Math.abs(kpi.value))})` : fmt(kpi.value)}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Period info */}
      {data && (
        <p className="text-xs text-slate-500">
          Period: {data.period.from} → {data.period.to} &nbsp;|&nbsp;
          Source: {data.source === 'GL' ? 'General Ledger (posted journal entries)' : 'Operational module tables (no posted JEs)'}
          {data.type === 'income_statement' && data.compPeriod && (
            <> &nbsp;|&nbsp; Compared with: {data.compPeriod.from} → {data.compPeriod.to}</>
          )}
        </p>
      )}

      {/* Main report */}
      {loading && <div className="h-96 bg-slate-800/60 rounded-2xl animate-pulse" />}
      {!loading && data?.type === 'income_statement' && (
        <div className="grid grid-cols-1 gap-6">
          {breakdown && <ModuleBreakdown data={breakdown} />}
          <IncomeStatement data={data} />
        </div>
      )}
      {!loading && data?.type === 'cash_flow' && <CashFlowStatement data={data} />}

    </div>
  );
}
