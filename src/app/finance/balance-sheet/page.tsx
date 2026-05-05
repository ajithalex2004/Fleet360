'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface BSLine { code: string; label: string; amount: number; subtype?: string | null; }
interface BSData {
  asOf: string;
  source: 'GL' | 'MODULE_DATA';
  assets: {
    current: BSLine[]; fixed: BSLine[]; other: BSLine[];
    totalCurrent: number; totalFixed: number; totalOther: number; totalAssets: number;
  };
  liabilities: {
    current: BSLine[]; nonCurrent: BSLine[];
    totalCurrent: number; totalNC: number; totalLiabilities: number;
  };
  equity: { lines: BSLine[]; totalEquity: number };
  summary: { totalAssets: number; totalLiabEquity: number; isBalanced: boolean; difference: number };
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.abs(n));
}

function BSSection({ title, color, lines, subtotal, subtotalLabel }:
  { title: string; color: string; lines: BSLine[]; subtotal: number; subtotalLabel: string }) {
  if (lines.length === 0) return null;
  return (
    <>
      <tr className="border-t border-white/10">
        <td className={`px-6 py-2 text-xs font-bold uppercase tracking-wider ${color}`} colSpan={2}>{title}</td>
      </tr>
      {lines.map(line => (
        <tr key={line.code} className="border-b border-white/5 hover:bg-slate-800/20">
          <td className="px-6 py-1.5 text-sm text-slate-300" style={{ paddingLeft: '36px' }}>
            <span className="font-mono text-xs text-slate-500 mr-2">{line.code}</span>
            {line.label}
          </td>
          <td className={`px-6 py-1.5 text-right text-sm ${line.amount < 0 ? 'text-red-400' : 'text-slate-300'}`}>
            {line.amount < 0 ? `(${fmt(Math.abs(line.amount))})` : fmt(line.amount)}
          </td>
        </tr>
      ))}
      <tr className="border-b border-white/20 bg-slate-800/20">
        <td className="px-6 py-2 text-sm font-bold text-slate-200" style={{ paddingLeft: '36px' }}>{subtotalLabel}</td>
        <td className={`px-6 py-2 text-right text-sm font-bold ${subtotal >= 0 ? 'text-white' : 'text-red-400'}`}>
          {subtotal < 0 ? `(${fmt(Math.abs(subtotal))})` : fmt(subtotal)}
        </td>
      </tr>
    </>
  );
}

export default function BalanceSheetPage() {
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<BSData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/finance/balance-sheet?asOf=${asOf}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, [asOf]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Balance Sheet</h1>
          <p className="text-slate-400 text-sm mt-0.5">Statement of Financial Position</p>
        </div>
        <div className="flex items-center gap-3">
          {data && (
            <span className={`px-3 py-1.5 rounded-xl text-xs font-medium border ${data.source === 'GL' ? 'bg-purple-900/20 border-purple-500/30 text-purple-400' : 'bg-amber-900/20 border-amber-500/30 text-amber-400'}`}>
              {data.source === 'GL' ? '🔗 GL Data' : '📊 Module Data'}
            </span>
          )}
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400">As of</label>
            <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)}
              className="bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500" />
          </div>
        </div>
      </div>

      {/* Balance check */}
      {data && (
        <div className={`flex items-center gap-3 p-4 rounded-2xl border ${data.summary.isBalanced ? 'bg-emerald-900/20 border-emerald-500/30' : 'bg-red-900/20 border-red-500/30'}`}>
          <span className={`text-2xl ${data.summary.isBalanced ? 'text-emerald-400' : 'text-red-400'}`}>
            {data.summary.isBalanced ? '✓' : '✗'}
          </span>
          <div>
            <p className={`font-bold text-sm ${data.summary.isBalanced ? 'text-emerald-300' : 'text-red-300'}`}>
              {data.summary.isBalanced ? 'Balance Sheet BALANCES — Assets = Liabilities + Equity' : 'Balance Sheet DOES NOT BALANCE'}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              Total Assets: AED {fmt(data.summary.totalAssets)} &nbsp;|&nbsp;
              Total Liabilities + Equity: AED {fmt(data.summary.totalLiabEquity)}
              {!data.summary.isBalanced && <span className="text-red-400 ml-2">Difference: AED {fmt(data.summary.difference)}</span>}
            </p>
          </div>
        </div>
      )}

      {loading && <div className="h-96 bg-slate-800/60 rounded-2xl animate-pulse" />}

      {data && !loading && (
        <div className="grid grid-cols-2 gap-6">
          {/* LEFT: Assets */}
          <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10 bg-blue-900/10">
              <h2 className="text-base font-bold text-blue-300">ASSETS</h2>
              <p className="text-xs text-slate-400 mt-0.5">As of {data.asOf}</p>
            </div>
            <table className="w-full">
              <tbody>
                <BSSection
                  title="Current Assets"
                  color="text-blue-400"
                  lines={data.assets.current}
                  subtotal={data.assets.totalCurrent}
                  subtotalLabel="Total Current Assets"
                />
                <BSSection
                  title="Non-Current / Fixed Assets"
                  color="text-indigo-400"
                  lines={data.assets.fixed}
                  subtotal={data.assets.totalFixed}
                  subtotalLabel="Total Fixed Assets (Net)"
                />
                {data.assets.other.length > 0 && (
                  <BSSection
                    title="Other Assets"
                    color="text-purple-400"
                    lines={data.assets.other}
                    subtotal={data.assets.totalOther}
                    subtotalLabel="Total Other Assets"
                  />
                )}
                <tr className="border-t-2 border-white/30 bg-blue-900/10">
                  <td className="px-6 py-4 font-bold text-base text-blue-200">TOTAL ASSETS</td>
                  <td className="px-6 py-4 text-right font-bold text-xl text-blue-300">
                    AED {fmt(data.assets.totalAssets)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* RIGHT: Liabilities + Equity */}
          <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10 bg-red-900/10">
              <h2 className="text-base font-bold text-red-300">LIABILITIES & EQUITY</h2>
              <p className="text-xs text-slate-400 mt-0.5">As of {data.asOf}</p>
            </div>
            <table className="w-full">
              <tbody>
                <tr className="border-t border-white/10 bg-red-900/5">
                  <td className="px-6 py-2 text-xs font-bold uppercase tracking-wider text-red-400" colSpan={2}>LIABILITIES</td>
                </tr>
                <BSSection
                  title="Current Liabilities"
                  color="text-red-400"
                  lines={data.liabilities.current}
                  subtotal={data.liabilities.totalCurrent}
                  subtotalLabel="Total Current Liabilities"
                />
                {data.liabilities.nonCurrent.length > 0 && (
                  <BSSection
                    title="Non-Current Liabilities"
                    color="text-orange-400"
                    lines={data.liabilities.nonCurrent}
                    subtotal={data.liabilities.totalNC}
                    subtotalLabel="Total Non-Current Liabilities"
                  />
                )}
                <tr className="border-b border-white/20 bg-red-900/10">
                  <td className="px-6 py-2 font-bold text-sm text-red-200">Total Liabilities</td>
                  <td className="px-6 py-2 text-right font-bold text-sm text-red-300">
                    {fmt(data.liabilities.totalLiabilities)}
                  </td>
                </tr>

                {/* Equity */}
                <tr className="border-t border-white/10 bg-purple-900/5">
                  <td className="px-6 py-2 text-xs font-bold uppercase tracking-wider text-purple-400" colSpan={2}>SHAREHOLDERS' EQUITY</td>
                </tr>
                {data.equity.lines.map(line => (
                  <tr key={line.code} className="border-b border-white/5 hover:bg-slate-800/20">
                    <td className="px-6 py-1.5 text-sm text-slate-300" style={{ paddingLeft: '36px' }}>
                      <span className="font-mono text-xs text-slate-500 mr-2">{line.code}</span>
                      {line.label}
                    </td>
                    <td className={`px-6 py-1.5 text-right text-sm ${line.amount < 0 ? 'text-red-400' : 'text-slate-300'}`}>
                      {line.amount < 0 ? `(${fmt(Math.abs(line.amount))})` : fmt(line.amount)}
                    </td>
                  </tr>
                ))}
                <tr className="border-b border-white/20 bg-purple-900/10">
                  <td className="px-6 py-2 font-bold text-sm text-purple-200">Total Shareholders' Equity</td>
                  <td className="px-6 py-2 text-right font-bold text-sm text-purple-300">
                    {fmt(data.equity.totalEquity)}
                  </td>
                </tr>

                {/* Total L + E */}
                <tr className="border-t-2 border-white/30 bg-red-900/10">
                  <td className="px-6 py-4 font-bold text-base text-red-200">TOTAL LIABILITIES & EQUITY</td>
                  <td className="px-6 py-4 text-right font-bold text-xl text-red-300">
                    AED {fmt(data.summary.totalLiabEquity)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Key Ratios */}
      {data && !loading && (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5">
          <h3 className="text-sm font-bold text-white mb-4">Key Financial Ratios</h3>
          <div className="grid grid-cols-4 gap-4">
            {(() => {
              const currentRatio = data.liabilities.totalCurrent > 0
                ? Math.round((data.assets.totalCurrent / data.liabilities.totalCurrent) * 100) / 100 : 0;
              const debtToEquity = data.equity.totalEquity > 0
                ? Math.round((data.liabilities.totalLiabilities / data.equity.totalEquity) * 100) / 100 : 0;
              const equityRatio = data.summary.totalAssets > 0
                ? Math.round((data.equity.totalEquity / data.summary.totalAssets) * 1000) / 10 : 0;
              const debtRatio = data.summary.totalAssets > 0
                ? Math.round((data.liabilities.totalLiabilities / data.summary.totalAssets) * 1000) / 10 : 0;
              return [
                { label: 'Current Ratio', value: `${currentRatio}x`, note: currentRatio >= 2 ? '✓ Healthy (≥2x)' : currentRatio >= 1 ? '⚠ Adequate (≥1x)' : '✗ Below 1x', good: currentRatio >= 2 },
                { label: 'Debt-to-Equity', value: `${debtToEquity}x`, note: debtToEquity <= 1 ? '✓ Conservative' : '⚠ Leveraged', good: debtToEquity <= 1 },
                { label: 'Equity Ratio', value: `${equityRatio}%`, note: equityRatio >= 50 ? '✓ Strong equity base' : '⚠ Debt-heavy', good: equityRatio >= 50 },
                { label: 'Debt Ratio', value: `${debtRatio}%`, note: debtRatio <= 50 ? '✓ Low leverage' : '⚠ High leverage', good: debtRatio <= 50 },
              ].map(r => (
                <div key={r.label} className="bg-slate-800/60 rounded-xl p-3">
                  <p className="text-xs text-slate-400">{r.label}</p>
                  <p className="text-xl font-bold text-white mt-1">{r.value}</p>
                  <p className={`text-xs mt-1 ${r.good ? 'text-emerald-400' : 'text-amber-400'}`}>{r.note}</p>
                </div>
              ));
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
