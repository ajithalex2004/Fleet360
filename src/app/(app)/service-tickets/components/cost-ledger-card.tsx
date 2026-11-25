'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Receipt,
  DollarSign,
  Plus,
  TrendingUp,
  ShieldAlert,
  CheckCircle,
  AlertCircle,
  Clock,
  Building,
  UserCheck,
  FileSpreadsheet,
  X,
} from 'lucide-react';
import type {
  CaseCostLine,
  CaseCostSummary,
  CostType,
  PayerType,
  CustomerRechargeStatus,
} from '@/lib/service-tickets/cost-ledger';

interface CostLedgerCardProps {
  ticketId: string;
  onCostUpdated?: () => void;
}

const COST_TYPE_LABELS: Record<CostType, { label: string; color: string }> = {
  TOWING: { label: 'Towing & Recovery', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  PARTS: { label: 'Replacement Parts', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  LABOUR: { label: 'Workshop Labour', color: 'bg-violet-500/20 text-violet-300 border-violet-500/30' },
  STORAGE: { label: 'Impound & Storage', color: 'bg-rose-500/20 text-rose-300 border-rose-500/30' },
  REPLACEMENT: { label: 'Substitute Fleet', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  OTHER: { label: 'Sundry / Other', color: 'bg-slate-500/20 text-slate-300 border-slate-500/30' },
};

const PAYER_LABELS: Record<PayerType, { label: string; icon: string }> = {
  TENANT: { label: 'Fleet Operating Expense', icon: '🏢' },
  CUSTOMER: { label: 'Customer Recharge Liability', icon: '👤' },
  INSURANCE: { label: 'Insurance Claim Recovery', icon: '🛡️' },
  WARRANTY: { label: 'OEM Warranty Claim', icon: '⚙️' },
};

export function CostLedgerCard({ ticketId, onCostUpdated }: CostLedgerCardProps) {
  const [loading, setLoading] = useState(false);
  const [costs, setCosts] = useState<CaseCostLine[]>([]);
  const [summary, setSummary] = useState<CaseCostSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [formCostType, setFormCostType] = useState<CostType>('PARTS');
  const [formPayerType, setFormPayerType] = useState<PayerType>('TENANT');
  const [formEstimated, setFormEstimated] = useState<string>('');
  const [formApproved, setFormApproved] = useState<string>('');
  const [formActual, setFormActual] = useState<string>('');
  const [formVendor, setFormVendor] = useState<string>('');
  const [formInvoiceRef, setFormInvoiceRef] = useState<string>('');
  const [formNotes, setFormNotes] = useState<string>('');
  const [formRechargeStatus, setFormRechargeStatus] = useState<CustomerRechargeStatus>('PENDING');

  const fetchCosts = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/service-tickets/${ticketId}/costs`);
      if (!res.ok) throw new Error('Failed to load case cost ledger');
      const data = await res.json();
      setCosts(data.costs || []);
      setSummary(data.summary || null);
    } catch (e: any) {
      setError(e.message || 'Error fetching costs');
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    fetchCosts();
  }, [fetchCosts]);

  const handleAddCost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketId) return;
    setSubmitting(true);
    setError(null);

    try {
      const payload = {
        costType: formCostType,
        payerType: formPayerType,
        estimatedAmount: formEstimated ? parseFloat(formEstimated) : 0,
        approvedAmount: formApproved ? parseFloat(formApproved) : 0,
        actualAmount: formActual ? parseFloat(formActual) : 0,
        vendorName: formVendor || undefined,
        invoiceReference: formInvoiceRef || undefined,
        customerRechargeStatus: formPayerType === 'CUSTOMER' ? formRechargeStatus : 'NOT_APPLICABLE',
        notes: formNotes || undefined,
      };

      const res = await fetch(`/api/service-tickets/${ticketId}/costs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || 'Failed to record cost');
      }

      setShowAddModal(false);
      // Reset form
      setFormEstimated('');
      setFormApproved('');
      setFormActual('');
      setFormVendor('');
      setFormInvoiceRef('');
      setFormNotes('');
      await fetchCosts();
      onCostUpdated?.();
    } catch (e: any) {
      setError(e.message || 'Error submitting cost item');
    } finally {
      setSubmitting(false);
    }
  };

  const currency = summary?.currency || 'AED';

  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/10 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2.5">
        <div className="flex items-center gap-2 text-emerald-400 font-semibold">
          <Receipt className="w-4 h-4" />
          <span>Case Cost Ledger & Financial Control</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            Pillar 3 Active
          </span>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[10px] flex items-center gap-1 transition-colors"
          >
            <Plus className="w-3 h-3" />
            <span>Add Cost Line</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-[11px] flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* KPI 3-Column Banner */}
      <div className="grid grid-cols-3 gap-2">
        <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
          <div className="text-[10px] text-slate-400 uppercase font-semibold">Estimated</div>
          <div className="text-sm font-bold text-slate-200 mt-0.5">
            {currency} {(summary?.totalEstimated ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[9px] text-slate-500 mt-0.5">Budget allowance</div>
        </div>

        <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
          <div className="text-[10px] text-amber-400 uppercase font-semibold">Approved</div>
          <div className="text-sm font-bold text-amber-300 mt-0.5">
            {currency} {(summary?.totalApproved ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[9px] text-slate-500 mt-0.5">Authorized ceiling</div>
        </div>

        <div className="p-2.5 rounded-xl bg-slate-900/80 border border-emerald-500/30">
          <div className="text-[10px] text-emerald-400 uppercase font-semibold">Actual Invoiced</div>
          <div className="text-sm font-bold text-emerald-300 mt-0.5">
            {currency} {(summary?.totalActual ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[9px] text-emerald-500/80 mt-0.5">Realized expense</div>
        </div>
      </div>

      {/* Customer Recharge Highlight */}
      {summary && summary.customerRechargePending > 0 && (
        <div className="p-2.5 rounded-xl bg-amber-950/30 border border-amber-500/40 flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-2 text-amber-300">
            <ShieldAlert className="w-4 h-4 shrink-0 text-amber-400" />
            <span>
              <strong>Customer Recharge Liability:</strong> {currency}{' '}
              {summary.customerRechargePending.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
            Pending Recharge
          </span>
        </div>
      )}

      {/* Multi-Payer Breakdown */}
      {summary && (
        <div className="space-y-1.5 pt-1">
          <div className="text-[11px] font-semibold text-slate-300 flex items-center justify-between">
            <span>Payer Allocation</span>
            <span className="text-[10px] text-slate-500">{costs.length} line item(s)</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
              <span className="text-slate-400">Fleet (Tenant):</span>
              <span className="font-semibold text-slate-200">
                {currency} {summary.breakdownByPayer.TENANT.actual.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
              <span className="text-slate-400">Customer Recharge:</span>
              <span className="font-semibold text-amber-400">
                {currency} {summary.breakdownByPayer.CUSTOMER.actual.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
              <span className="text-slate-400">Warranty Claim:</span>
              <span className="font-semibold text-violet-400">
                {currency} {summary.breakdownByPayer.WARRANTY.actual.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
              <span className="text-slate-400">Insurance Claim:</span>
              <span className="font-semibold text-blue-400">
                {currency} {summary.breakdownByPayer.INSURANCE.actual.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Itemized Cost Ledger Table */}
      <div className="space-y-2 pt-2 border-t border-emerald-500/20">
        <div className="text-[11px] font-semibold text-slate-300 flex items-center justify-between">
          <span>Cost Lines Breakdown</span>
        </div>

        {costs.length === 0 ? (
          <div className="p-3 text-center text-slate-500 text-[11px] bg-slate-950/60 rounded-xl border border-dashed border-slate-800">
            No cost line items recorded yet. Click &quot;Add Cost Line&quot; to log estimates or vendor invoices.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {costs.map((line) => {
              const typeCfg = COST_TYPE_LABELS[line.costType] || COST_TYPE_LABELS.OTHER;
              const displayAmount = line.actualAmount > 0 ? line.actualAmount : line.approvedAmount > 0 ? line.approvedAmount : line.estimatedAmount;
              const amountLabel = line.actualAmount > 0 ? 'Actual' : line.approvedAmount > 0 ? 'Approved' : 'Est';

              return (
                <div
                  key={line.id}
                  className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between text-[11px] hover:border-slate-700 transition-colors"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 font-medium text-slate-200">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${typeCfg.color}`}>
                        {typeCfg.label}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="text-[10px] text-slate-400">{PAYER_LABELS[line.payerType]?.label}</span>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {line.vendorName ? `Vendor: ${line.vendorName}` : 'Internal'}
                      {line.invoiceReference && ` · Inv: #${line.invoiceReference}`}
                      {line.notes && ` · ${line.notes}`}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="font-bold text-slate-200">
                      {line.currency} {displayAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </div>
                    <div className="text-[9px] text-slate-500 uppercase tracking-wide">
                      {amountLabel}
                      {line.payerType === 'CUSTOMER' && (
                        <span className={`ml-1 font-bold ${line.customerRechargeStatus === 'PENDING' ? 'text-amber-400' : 'text-emerald-400'}`}>
                          ({line.customerRechargeStatus})
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Cost Line Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-white font-semibold text-sm">
                <Receipt className="w-4 h-4 text-emerald-400" />
                <span>Add Cost Line Item</span>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddCost} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-300 font-medium">Cost Type</label>
                  <select
                    value={formCostType}
                    onChange={(e) => setFormCostType(e.target.value as CostType)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="TOWING">Towing & Recovery</option>
                    <option value="PARTS">Replacement Parts</option>
                    <option value="LABOUR">Workshop Labour</option>
                    <option value="STORAGE">Impound / Storage</option>
                    <option value="REPLACEMENT">Substitute Fleet</option>
                    <option value="OTHER">Other / Sundry</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-slate-300 font-medium">Payer Attribution</label>
                  <select
                    value={formPayerType}
                    onChange={(e) => setFormPayerType(e.target.value as PayerType)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="TENANT">Fleet Operating Expense (Tenant)</option>
                    <option value="CUSTOMER">Customer Recharge Liability</option>
                    <option value="WARRANTY">OEM Warranty Claim</option>
                    <option value="INSURANCE">Insurance Claim Recovery</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <label className="text-slate-300 font-medium">Estimated ({currency})</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={formEstimated}
                    onChange={(e) => setFormEstimated(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-300 font-medium">Approved ({currency})</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={formApproved}
                    onChange={(e) => setFormApproved(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-300 font-medium">Actual ({currency})</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={formActual}
                    onChange={(e) => setFormActual(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-300 font-medium">Vendor Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Al Quoz Recovery"
                    value={formVendor}
                    onChange={(e) => setFormVendor(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-300 font-medium">Invoice Reference #</label>
                  <input
                    type="text"
                    placeholder="e.g. INV-2026-0901"
                    value={formInvoiceRef}
                    onChange={(e) => setFormInvoiceRef(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              {formPayerType === 'CUSTOMER' && (
                <div className="space-y-1">
                  <label className="text-slate-300 font-medium">Customer Recharge Status</label>
                  <select
                    value={formRechargeStatus}
                    onChange={(e) => setFormRechargeStatus(e.target.value as CustomerRechargeStatus)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="PENDING">Pending Invoicing</option>
                    <option value="INVOICED">Invoiced to Customer</option>
                    <option value="PAID">Paid / Collected</option>
                    <option value="WAIVED">Waived (Goodwill)</option>
                  </select>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-slate-300 font-medium">Description / Notes</label>
                <textarea
                  rows={2}
                  placeholder="Additional line details or authorization notes..."
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold transition-colors"
                >
                  {submitting ? 'Saving...' : 'Add Cost Line'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
