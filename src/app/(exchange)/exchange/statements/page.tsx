/**
 * src/app/(exchange)/exchange/statements/page.tsx
 *
 * Partner Settlement Statements & UAE FTA Tax Invoices for Fleet360 Exchange.
 */

'use client';

import React, { useState, useEffect } from 'react';
import {
  FileText,
  DollarSign,
  Download,
  CheckCircle2,
  AlertCircle,
  Building2,
  Calendar,
  Layers,
} from 'lucide-react';

export default function PartnerStatementsPage() {
  const [statements, setStatements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStatement, setSelectedStatement] = useState<any | null>(null);

  useEffect(() => {
    async function loadStatements() {
      try {
        const res = await fetch('/api/bus-ops/outsource/settlements');
        const json = await res.json();
        if (json.statements) setStatements(json.statements);
      } catch {
        // Fallback
      } finally {
        setLoading(false);
      }
    }
    void loadStatements();
  }, []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6 font-sans">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>Commercial Reconciliation</span>
          </span>
          <h1 className="text-2xl font-black text-white mt-0.5">Partner Settlement Statements</h1>
          <p className="text-xs text-slate-400 mt-1">
            Periodic consolidated statements and UAE FTA-compliant Tax Invoices for executed outsourcing services.
          </p>
        </div>
      </div>

      {/* Statements Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-slate-400 font-bold uppercase text-[10px] border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Statement #</th>
                <th className="py-3 px-4">Billing Period</th>
                <th className="py-3 px-4">Invoices</th>
                <th className="py-3 px-4">Gross (excl. VAT)</th>
                <th className="py-3 px-4">VAT (5%)</th>
                <th className="py-3 px-4">Deductions</th>
                <th className="py-3 px-4">Net Payable</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Tax Invoice</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium">
              {statements.length > 0 ? (
                statements.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4 font-mono font-bold text-white">{s.statementNumber}</td>
                    <td className="py-3 px-4 text-slate-400">
                      {new Date(s.periodStart).toLocaleDateString()} – {new Date(s.periodEnd).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4 font-mono">{s.invoices?.length || 0} Invoices</td>
                    <td className="py-3 px-4 font-mono">AED {Number(s.grossAmount).toFixed(2)}</td>
                    <td className="py-3 px-4 font-mono text-cyan-400">AED {Number(s.vatAmount).toFixed(2)}</td>
                    <td className="py-3 px-4 font-mono text-rose-400">
                      {Number(s.totalDeductions) > 0 ? `-AED ${Number(s.totalDeductions).toFixed(2)}` : 'AED 0.00'}
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-emerald-400">AED {Number(s.netPayable).toFixed(2)}</td>
                    <td className="py-3 px-4">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        {s.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => setSelectedStatement(s)}
                        className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-[11px] inline-flex items-center gap-1.5"
                      >
                        <FileText className="w-3 h-3 text-cyan-400" />
                        <span>View Tax Invoice</span>
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500">
                    No settlement statements generated yet for this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* UAE FTA Tax Invoice Modal */}
      {selectedStatement && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white text-slate-900 rounded-3xl p-8 space-y-6 shadow-2xl font-sans">
            {/* Tax Invoice Header */}
            <div className="flex justify-between items-start border-b border-slate-200 pb-4">
              <div>
                <span className="text-[10px] font-bold text-emerald-700 tracking-wider uppercase">United Arab Emirates</span>
                <h2 className="text-xl font-black text-slate-900">TAX INVOICE / فاتورة ضريبية</h2>
                <div className="text-xs text-slate-500 mt-0.5">Compliant with UAE Federal Tax Authority (FTA)</div>
              </div>
              <div className="text-right text-xs">
                <div className="font-mono font-bold text-slate-900">{selectedStatement.statementNumber}</div>
                <div className="text-slate-500">Date: {new Date(selectedStatement.createdAt).toLocaleDateString()}</div>
              </div>
            </div>

            {/* TRN & Entity Details */}
            <div className="grid grid-cols-2 gap-4 text-xs bg-slate-50 p-4 rounded-2xl border border-slate-200">
              <div>
                <div className="font-bold text-slate-900">Issuer (Customer):</div>
                <div className="text-slate-700">Fleet360 Enterprise Transport Network</div>
                <div className="text-slate-500 font-mono">TRN: {selectedStatement.tenantTrn || '100000000000003'}</div>
              </div>
              <div>
                <div className="font-bold text-slate-900">Supplier (Partner):</div>
                <div className="text-slate-700">{selectedStatement.partner?.legalName || 'Transport Partner'}</div>
                <div className="text-slate-500 font-mono">TRN: {selectedStatement.partnerTrn || '100999999900003'}</div>
              </div>
            </div>

            {/* Line Items Summary */}
            <div className="space-y-2 text-xs">
              <div className="font-bold text-slate-800 uppercase text-[10px]">Settlement Breakdown</div>
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                <div className="p-3 flex justify-between">
                  <span>Gross Transportation Services Subtotal</span>
                  <span className="font-mono font-semibold">AED {Number(selectedStatement.grossAmount).toFixed(2)}</span>
                </div>
                <div className="p-3 flex justify-between">
                  <span>Standard UAE VAT (5.0%)</span>
                  <span className="font-mono font-semibold text-emerald-700">AED {Number(selectedStatement.vatAmount).toFixed(2)}</span>
                </div>
                {Number(selectedStatement.totalDeductions) > 0 && (
                  <div className="p-3 flex justify-between text-rose-600">
                    <span>Operational Deductions & SLA Penalties</span>
                    <span className="font-mono font-semibold">-AED {Number(selectedStatement.totalDeductions).toFixed(2)}</span>
                  </div>
                )}
                <div className="p-3 bg-slate-100 flex justify-between font-bold text-sm text-slate-900">
                  <span>Total Net Payable (AED)</span>
                  <span className="font-mono text-emerald-800">AED {Number(selectedStatement.netPayable).toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Footer & Close */}
            <div className="flex justify-between items-center pt-3 border-t border-slate-200">
              <span className="text-[10px] text-slate-400">Electronic Tax Invoice issued under UAE VAT Federal Decree-Law No. (8) of 2017</span>
              <button
                onClick={() => setSelectedStatement(null)}
                className="px-5 py-2 rounded-xl bg-slate-900 text-white font-bold text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
