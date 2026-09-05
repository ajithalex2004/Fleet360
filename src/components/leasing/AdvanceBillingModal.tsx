'use client';
import React, { useState, useCallback, useEffect } from 'react';
import { X } from 'lucide-react';

/**
 * AdvanceBillingModal
 * ----------------------------------------------------------------------------
 * Mounted from inside /leasing/invoices. Functional port of the legacy
 * /leasing/pre-billing page so users no longer need a top-level menu item.
 *
 * Domain model:
 *   - PreBillingStatement: a draft monthly billing statement sent to the
 *     lessee BEFORE the formal invoice. Status pipeline:
 *
 *         DRAFT  ->  SENT  ->  CONFIRMED  ->  FINALIZED
 *                            \->  DISPUTED  (will be revised; sends back
 *                                            into SENT via Aggregate endpoint)
 *
 *   - On FINALIZED, the statement is the basis from which the formal
 *     Invoice is issued (the Invoices page already exposes those records).
 *
 * Charges:
 *   Base rent + Fuel + Fines + Maintenance + Overage + Other
 *   -> VAT 5% (UAE federal rate)
 *   -> Grand total (auto-calculated live in the form)
 *
 * PDF:
 *   Bilingual PDF (English + Arabic layouts) is generated server-side at
 *   /api/leasing/pre-billing/[id]/pdf?lang=... — every row exposes it.
 *
 * The component takes only `onClose`. It owns all its own state and
 * hits the existing backend; nothing here talks to Invoices' state.
 * ------------------------------------------------------------------------- */

export interface PreBillingStatement {
  id: string;
  statementNo: string;
  contractId: string;
  lesseeName: string;
  billingPeriod: string;
  dueDate: string;
  baseRent: number;
  fuelCharges: number;
  fineCharges: number;
  maintenanceCharges: number;
  overageCharges: number;
  otherCharges: number;
  vat: number;
  total: number;
  status: string;
}

interface FormData {
  contractId: string;
  billingPeriod: string;
  dueDate: string;
  baseRent: number;
  fuelCharges: number;
  fineCharges: number;
  maintenanceCharges: number;
  overageCharges: number;
  otherCharges: number;
}

const EMPTY_FORM: FormData = {
  contractId: '',
  billingPeriod: '',
  dueDate: '',
  baseRent: 0,
  fuelCharges: 0,
  fineCharges: 0,
  maintenanceCharges: 0,
  overageCharges: 0,
  otherCharges: 0,
};

const STATUS_PIPELINE = ['DRAFT', 'SENT', 'CONFIRMED', 'DISPUTED', 'FINALIZED'];

const getStatusColor = (status: string) => {
  switch (status) {
    case 'DRAFT': return 'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30';
    case 'SENT': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    case 'CONFIRMED': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    case 'DISPUTED': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    case 'FINALIZED': return 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30';
    default: return 'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30';
  }
};

export default function AdvanceBillingModal({ onClose }: { onClose: () => void }) {
  const [statements, setStatements] = useState<PreBillingStatement[]>([]);
  const [statusFilter, setStatusFilter] = useState('All');
  const [showGenerate, setShowGenerate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState<FormData>(EMPTY_FORM);
  const [calculatedVAT, setCalculatedVAT] = useState(0);
  const [calculatedTotal, setCalculatedTotal] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchStatements = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await fetch('/api/leasing/pre-billing');
      if (res.ok) {
        const data: PreBillingStatement[] = await res.json();
        setStatements(Array.isArray(data) ? data : []);
      } else {
        setErrorMsg(`Server returned HTTP ${res.status}`);
      }
    } catch (e) {
      setErrorMsg('Could not reach the pre-billing endpoint.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatements(); }, [fetchStatements]);

  const filtered = statusFilter === 'All'
    ? statements
    : statements.filter(s => s.status === statusFilter);

  const calculateTotals = (data: FormData) => {
    const subtotal =
      data.baseRent + data.fuelCharges + data.fineCharges +
      data.maintenanceCharges + data.overageCharges + data.otherCharges;
    const vat = subtotal * 0.05;
    setCalculatedVAT(vat);
    setCalculatedTotal(subtotal + vat);
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    const text = ['contractId', 'billingPeriod', 'dueDate'].includes(name);
    const next: FormData = {
      ...formData,
      [name]: text ? value : parseFloat(value) || 0,
    };
    setFormData(next);
    calculateTotals(next);
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/leasing/pre-billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, vat: calculatedVAT, total: calculatedTotal }),
      });
      if (res.ok) {
        setFormData(EMPTY_FORM);
        setCalculatedVAT(0);
        setCalculatedTotal(0);
        setShowGenerate(false);
        await fetchStatements();
      } else {
        const body = await res.json().catch(() => ({}));
        setErrorMsg(body?.error || `Failed to generate (HTTP ${res.status})`);
      }
    } catch {
      setErrorMsg('Network error — could not POST.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/leasing/pre-billing/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) await fetchStatements();
      else setErrorMsg(`Status update failed (HTTP ${res.status})`);
    } catch {
      setErrorMsg('Network error — could not PATCH status.');
    }
  };

  const statusCounts = STATUS_PIPELINE.reduce<Record<string, number>>((acc, s) => {
    acc[s] = statements.filter(x => x.status === s).length;
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-7xl max-h-[94vh] flex flex-col bg-[var(--bg-surface)]/95 border border-[var(--border-subtle)] rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--border-subtle)] shrink-0">
          <div>
            <h2 className="text-2xl font-bold text-[var(--text-main)]">Advance Billing</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Generate monthly billing statements, send to lessee for review, then finalize to release the formal invoice.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowGenerate(true)}
              className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:opacity-90 transition-all"
            >
              + Generate Statement
            </button>
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all"
              title="Close Advance Billing"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="mx-6 mt-4 px-4 py-2 rounded-lg text-sm bg-rose-500/10 text-rose-300 border border-rose-500/30">
            {errorMsg}
          </div>
        )}

        {/* Status Pipeline */}
        <div className="grid grid-cols-5 gap-3 p-6 pb-3 shrink-0">
          {STATUS_PIPELINE.map(s => (
            <div key={s} className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-xl p-4 text-center">
              <div className={`text-2xl font-bold ${s === 'DRAFT' ? 'text-[var(--text-muted)]' : ''}`}>{statusCounts[s] || 0}</div>
              <div className="text-xs text-[var(--text-muted)] mt-1">{s}</div>
            </div>
          ))}
        </div>

        {/* Filter */}
        <div className="px-6 pb-3 flex gap-2 flex-wrap shrink-0">
          {['All', ...STATUS_PIPELINE].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                statusFilter === s
                  ? 'bg-blue-600 text-[var(--text-main)]'
                  : 'bg-[var(--bg-surface-hover)]/60 text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]/60'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="flex-1 min-h-0 overflow-auto px-6 pb-6">
          {loading ? (
            <div className="flex items-center justify-center h-64 text-[var(--text-muted)]">Loading advance billing…</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-[var(--text-faint)]">
              <p className="text-sm">No statements match this filter.</p>
              <button
                onClick={() => setShowGenerate(true)}
                className="mt-4 rounded-lg bg-blue-600/20 text-blue-300 border border-blue-500/30 px-4 py-2 text-sm hover:bg-blue-600/30 transition-all"
              >
                + Generate your first statement
              </button>
            </div>
          ) : (
            <div className="bg-[var(--bg-surface)]/40 border border-[var(--border-subtle)] rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/60">
                    {['Statement', 'Contract', 'Lessee', 'Period', 'Due', 'Base Rent', 'Fuel', 'Fines', 'Overage', 'Other', 'VAT', 'Total', 'Status', 'Actions'].map(h => (
                      <th key={h} className="px-3 py-2 text-left font-semibold text-[var(--text-muted)] whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(s => (
                    <tr key={s.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]">
                      <td className="px-3 py-2 font-medium text-[var(--text-main)] whitespace-nowrap">{s.statementNo}</td>
                      <td className="px-3 py-2 text-[var(--text-main)] whitespace-nowrap">{s.contractId}</td>
                      <td className="px-3 py-2 text-[var(--text-main)]">{s.lesseeName}</td>
                      <td className="px-3 py-2 text-[var(--text-main)]">{s.billingPeriod}</td>
                      <td className="px-3 py-2 text-[var(--text-main)]">{s.dueDate}</td>
                      <td className="px-3 py-2 text-[var(--text-main)] whitespace-nowrap">{s.baseRent.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-[var(--text-main)] whitespace-nowrap">{s.fuelCharges.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-[var(--text-main)] whitespace-nowrap">{s.fineCharges.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-[var(--text-main)] whitespace-nowrap">{s.overageCharges.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-[var(--text-main)] whitespace-nowrap">{s.otherCharges.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-[var(--text-main)] whitespace-nowrap">{s.vat.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 font-bold text-[var(--text-main)] whitespace-nowrap">{s.total.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(s.status)}`}>
                          {s.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <a href={`/api/leasing/pre-billing/${s.id}/pdf?lang=en&download=1`}
                             className="text-emerald-400 hover:text-emerald-300" title="English PDF">
                            PDF·EN
                          </a>
                          <a href={`/api/leasing/pre-billing/${s.id}/pdf?lang=ar&download=1`}
                             className="text-emerald-400 hover:text-emerald-300" title="Arabic PDF">
                            PDF·AR
                          </a>
                          {s.status === 'DRAFT' && (
                            <button onClick={() => handleStatusChange(s.id, 'SENT')}
                                    className="text-blue-400 hover:text-blue-300">
                              Send
                            </button>
                          )}
                          {s.status === 'SENT' && (
                            <>
                              <button onClick={() => handleStatusChange(s.id, 'CONFIRMED')}
                                      className="text-emerald-400 hover:text-emerald-300">
                                Confirm
                              </button>
                              <button onClick={() => handleStatusChange(s.id, 'DISPUTED')}
                                      className="text-amber-400 hover:text-amber-300">
                                Dispute
                              </button>
                            </>
                          )}
                          {s.status === 'CONFIRMED' && (
                            <button onClick={() => handleStatusChange(s.id, 'FINALIZED')}
                                    className="text-indigo-400 hover:text-indigo-300">
                              Finalize
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Generate Statement sub-modal */}
      {showGenerate && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto bg-[var(--bg-surface)]/95 border border-[var(--border-subtle)] rounded-2xl p-8 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold text-[var(--text-main)]">Generate Advance Billing Statement</h3>
              <button onClick={() => setShowGenerate(false)}
                      className="w-8 h-8 flex items-center justify-center rounded-full bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)]">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleGenerate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Contract ID</label>
                  <input type="text" name="contractId" value={formData.contractId}
                         onChange={handleInputChange} required placeholder="LC-001"
                         className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Billing Period (YYYY-MM)</label>
                  <input type="text" name="billingPeriod" value={formData.billingPeriod}
                         onChange={handleInputChange} required placeholder="2026-04"
                         className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Due Date</label>
                  <input type="date" name="dueDate" value={formData.dueDate}
                         onChange={handleInputChange} required
                         className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Base Rent</label>
                  <input type="number" name="baseRent" value={formData.baseRent}
                         onChange={handleInputChange} required placeholder="6500"
                         className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Fuel Charges</label>
                  <input type="number" name="fuelCharges" value={formData.fuelCharges}
                         onChange={handleInputChange} placeholder="0"
                         className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Fine Charges</label>
                  <input type="number" name="fineCharges" value={formData.fineCharges}
                         onChange={handleInputChange} placeholder="0"
                         className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Maintenance Charges</label>
                  <input type="number" name="maintenanceCharges" value={formData.maintenanceCharges}
                         onChange={handleInputChange} placeholder="0"
                         className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Overage Charges</label>
                  <input type="number" name="overageCharges" value={formData.overageCharges}
                         onChange={handleInputChange} placeholder="0"
                         className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Other Charges</label>
                  <input type="number" name="otherCharges" value={formData.otherCharges}
                         onChange={handleInputChange} placeholder="0"
                         className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">VAT (5%)</label>
                  <div className="px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm font-medium">
                    AED {calculatedVAT.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Total</label>
                  <div className="px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-bold">
                    AED {calculatedTotal.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button type="submit" disabled={submitting}
                        className="flex-1 rounded-lg bg-blue-600 text-[var(--text-main)] font-medium py-2 hover:bg-blue-700 transition-colors disabled:opacity-50">
                  {submitting ? 'Generating…' : 'Generate Statement'}
                </button>
                <button type="button" onClick={() => setShowGenerate(false)}
                        className="flex-1 rounded-lg bg-[var(--bg-surface-hover)] text-[var(--text-main)] font-medium py-2 hover:bg-[var(--bg-surface-hover)] transition-colors">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
