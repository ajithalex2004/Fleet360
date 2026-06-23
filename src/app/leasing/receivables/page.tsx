'use client';
import React, { useState, useCallback, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Wallet, AlertOctagon, TrendingUp } from 'lucide-react';
import { LeasingBillingMigrationNotice } from '@/components/LeasingBillingMigrationNotice';
import { usePermissions } from '@/contexts/PermissionContext';
import RowActionMenu from '@/components/ui/RowActionMenu';
import { KpiCard, KpiGrid } from '@/components/ui/page-theme';

interface Receivable {
  lesseeId: string;
  lesseeName: string;
  current: number;
  overdue1_30: number;
  overdue31_60: number;
  overdue61_90: number;
  overdue90plus: number;
  totalOutstanding: number;
  payments: Array<{ id: string; contractNumber: string; dueDate: string; amount: number; status: string; periodMonth?: number; periodYear?: number }>;
}

interface DunningLog {
  contractId: string;
  activityType: string;
  daysOverdue: number;
  outstandingAmount: number;
  performedBy: string;
  response: string;
  nextActionDate: string;
  nextActionType: string;
  notes: string;
}

interface SweepResult {
  dryRun: boolean;
  scanned: number;
  sent: { reminder_30: number; notice_60: number; final_90: number };
  markedOverdue: number;
  skipped: number;
  errors: { invoiceId: string; message: string }[];
  aging: { current: number; d1to30: number; d31to60: number; d61to90: number; d90plus: number; total: number };
}

export default function ReceivablesPage() {
  const pathname = usePathname();
  const { can } = usePermissions();
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [showDunningModal, setShowDunningModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sweepBusy, setSweepBusy] = useState(false);
  const [sweepResult, setSweepResult] = useState<SweepResult | null>(null);
  const [sweepError, setSweepError] = useState<string | null>(null);
  const [formData, setFormData] = useState<DunningLog>({
    contractId: '',
    activityType: 'EMAIL',
    daysOverdue: 0,
    outstandingAmount: 0,
    performedBy: '',
    response: '',
    nextActionDate: '',
    nextActionType: 'EMAIL',
    notes: '',
  });

  const canManageDunning =
    can('finance', 'edit', 'leasing_billing') ||
    can('finance', 'approve', 'leasing_billing') ||
    can('leasing', 'create', 'dunning');
  const isLegacyPath = pathname.startsWith('/leasing/');
  const apiBase = isLegacyPath ? '/api/leasing' : '/api/finance/leasing-billing';

  const fetchReceivables = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`${apiBase}/receivables`);
      if (response.ok) {
        const data = await response.json();
        setReceivables(Array.isArray(data) ? data : data.agingBuckets ?? []);
      }
    } catch (error) {
      console.error('Failed to fetch receivables:', error);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchReceivables();
  }, [fetchReceivables]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'daysOverdue' || name === 'outstandingAmount' ? parseFloat(value) : value,
    }));
  };

  const handleDunningSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch(`${apiBase}/receivables/dunning`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (response.ok) {
        setFormData({
          contractId: '',
          activityType: 'EMAIL',
          daysOverdue: 0,
          outstandingAmount: 0,
          performedBy: '',
          response: '',
          nextActionDate: '',
          nextActionType: 'EMAIL',
          notes: '',
        });
        setShowDunningModal(false);
        fetchReceivables();
      }
    } catch (error) {
      console.error('Failed to log dunning activity:', error);
    }
  };

  const toggleExpandedRow = (contractId: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(contractId)) {
      newExpanded.delete(contractId);
    } else {
      newExpanded.add(contractId);
    }
    setExpandedRows(newExpanded);
  };

  const handleRunSweep = async (dryRun: boolean) => {
    setSweepBusy(true);
    setSweepError(null);
    setSweepResult(null);
    try {
      const res = await fetch(
        `${apiBase}/receivables/dunning/sweep${dryRun ? '?dryRun=1' : ''}`,
        { method: 'POST' },
      );
      const json = await res.json();
      if (!res.ok) {
        setSweepError(json.error ?? `Server returned ${res.status}`);
        return;
      }
      setSweepResult(json as SweepResult);
      // Refresh the receivables view (status changes may have happened).
      fetchReceivables();
    } catch (err) {
      setSweepError(err instanceof Error ? err.message : 'Sweep failed');
    } finally {
      setSweepBusy(false);
    }
  };

  const totalAR = receivables.reduce((sum, r) => sum + r.totalOutstanding, 0);
  const totalOverdue = receivables.reduce((sum, r) => sum + r.overdue1_30 + r.overdue31_60 + r.overdue61_90 + r.overdue90plus, 0);
  const collectionRate = totalAR > 0 ? (((totalAR - totalOverdue) / totalAR) * 100).toFixed(2) : '0.00';

  const getAgeColor = (days: number) => {
    if (days === 0) return 'text-white';
    if (days <= 30) return 'text-amber-400';
    if (days <= 60) return 'text-orange-400';
    if (days <= 90) return 'text-red-400';
    return 'text-rose-600';
  };

  const getAgeBgColor = (days: number) => {
    if (days === 0) return 'bg-white/5';
    if (days <= 30) return 'bg-amber-500/10';
    if (days <= 60) return 'bg-orange-500/10';
    if (days <= 90) return 'bg-red-500/10';
    return 'bg-rose-500/10';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  if (isLegacyPath) {
    return (
      <LeasingBillingMigrationNotice
        title="Leasing receivables"
        financeHref="/finance/leasing-billing/receivables"
        description="Accounts receivable, dunning, and collections are now operated from Finance & Billing."
      />
    );
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Accounts Receivable</h1>
          <p className="text-slate-400">Monitor outstanding payments and aging</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => handleRunSweep(true)}
            disabled={sweepBusy || !canManageDunning}
            className="rounded-xl bg-slate-700 border border-white/10 px-4 py-3 text-sm font-medium text-slate-200 hover:bg-slate-600 disabled:opacity-50 transition-all"
            title="Preview without sending emails or writing activities"
          >
            {sweepBusy ? '…' : 'Preview Dunning'}
          </button>
          <button
            onClick={() => handleRunSweep(false)}
            disabled={sweepBusy || !canManageDunning}
            className="rounded-xl bg-amber-700/40 border border-amber-500/40 px-4 py-3 text-sm font-medium text-amber-100 hover:bg-amber-600/40 disabled:opacity-50 transition-all"
            title="Send 30/60/90-day reminders to all overdue lessees"
          >
            {sweepBusy ? 'Sweeping…' : 'Run Dunning Sweep'}
          </button>
          <button
            onClick={() => setShowDunningModal(true)}
            disabled={!canManageDunning}
            className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90 transition-all"
          >
            + Log Manual Activity
          </button>
        </div>
      </div>

      {sweepError && (
        <div className="rounded-xl bg-rose-900/30 border border-rose-700 p-4 text-rose-200 text-sm">
          {sweepError}
        </div>
      )}

      {sweepResult && (
        <div className={`rounded-xl border p-5 ${sweepResult.dryRun ? 'bg-slate-800/40 border-slate-700' : 'bg-emerald-900/20 border-emerald-700'}`}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className={`text-xs font-semibold uppercase tracking-wider ${sweepResult.dryRun ? 'text-slate-400' : 'text-emerald-300'}`}>
                {sweepResult.dryRun ? 'Dunning Preview (no emails sent)' : 'Dunning Sweep Complete'}
              </span>
              <div className="text-sm text-slate-300 mt-1">
                Scanned <strong className="text-white">{sweepResult.scanned}</strong> invoice{sweepResult.scanned === 1 ? '' : 's'} · skipped {sweepResult.skipped}
                {sweepResult.errors.length > 0 && <> · <span className="text-rose-300">{sweepResult.errors.length} error{sweepResult.errors.length === 1 ? '' : 's'}</span></>}
              </div>
            </div>
            <button onClick={() => setSweepResult(null)} className="text-slate-500 hover:text-white text-xs">
              Dismiss
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
            <SweepStat label="30-day reminders" value={sweepResult.sent.reminder_30} tone="amber" />
            <SweepStat label="60-day notices" value={sweepResult.sent.notice_60} tone="orange" />
            <SweepStat label="90-day final" value={sweepResult.sent.final_90} tone="rose" />
            <SweepStat label="Marked OVERDUE" value={sweepResult.markedOverdue} tone="slate" />
            <SweepStat
              label="Aging total"
              value={`AED ${(sweepResult.aging.total ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
              tone="slate"
            />
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <KpiGrid>
        <KpiCard
          label="Total AR"
          value={`AED ${totalAR.toLocaleString()}`}
          sub="Open receivables"
          accent="blue"
          icon={Wallet}
        />
        <KpiCard
          label="Total Overdue"
          value={`AED ${totalOverdue.toLocaleString()}`}
          sub="Collections at risk"
          accent="rose"
          icon={AlertOctagon}
        />
        <KpiCard
          label="Collection Rate"
          value={`${collectionRate}%`}
          sub="Recovered on time"
          accent="emerald"
          icon={TrendingUp}
        />
      </KpiGrid>

      {/* AR Aging Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-800/50">
            <tr className="border-b border-white/5">
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Lessee</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Current</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">1-30 Days</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">31-60 Days</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">61-90 Days</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">90+ Days</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Total Outstanding</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Actions</th>
            </tr>
          </thead>
          <tbody>
            {receivables.map((receivable) => (
              <React.Fragment key={receivable.lesseeId}>
                <tr className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="px-6 py-4 text-sm font-medium text-white">{receivable.lesseeName}</td>
                  <td className="px-6 py-4 text-sm">
                    <span className="bg-white/5 px-3 py-1 rounded-lg text-white">
                      AED {receivable.current.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`${getAgeBgColor(30)} ${getAgeColor(receivable.overdue1_30 > 0 ? 30 : 0)} px-3 py-1 rounded-lg`}>
                      AED {receivable.overdue1_30.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`${getAgeBgColor(60)} ${getAgeColor(receivable.overdue31_60 > 0 ? 60 : 0)} px-3 py-1 rounded-lg`}>
                      AED {receivable.overdue31_60.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`${getAgeBgColor(90)} ${getAgeColor(receivable.overdue61_90 > 0 ? 90 : 0)} px-3 py-1 rounded-lg`}>
                      AED {receivable.overdue61_90.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`${getAgeBgColor(91)} ${getAgeColor(receivable.overdue90plus > 0 ? 91 : 0)} px-3 py-1 rounded-lg`}>
                      AED {receivable.overdue90plus.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-white">
                    AED {receivable.totalOutstanding.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <RowActionMenu
                      actions={[
                        {
                          label: expandedRows.has(receivable.lesseeId) ? 'Hide details' : 'Show details',
                          onSelect: () => toggleExpandedRow(receivable.lesseeId),
                        },
                      ]}
                    />
                  </td>
                </tr>
                {expandedRows.has(receivable.lesseeId) && (
                  <tr className="border-b border-white/5 bg-slate-900/30">
                    <td colSpan={8} className="px-6 py-4">
                      <div className="bg-slate-900/50 border border-white/5 rounded-lg p-4">
                        <h4 className="text-white font-medium mb-3">Overdue Payments</h4>
                        <div className="space-y-2 text-sm text-white">
                          {receivable.overdue1_30 > 0 && (
                            <div className="flex justify-between">
                              <span>1-30 Days Overdue:</span>
                              <span className="text-amber-400">AED {receivable.overdue1_30.toLocaleString()}</span>
                            </div>
                          )}
                          {receivable.overdue31_60 > 0 && (
                            <div className="flex justify-between">
                              <span>31-60 Days Overdue:</span>
                              <span className="text-orange-400">AED {receivable.overdue31_60.toLocaleString()}</span>
                            </div>
                          )}
                          {receivable.overdue61_90 > 0 && (
                            <div className="flex justify-between">
                              <span>61-90 Days Overdue:</span>
                              <span className="text-red-400">AED {receivable.overdue61_90.toLocaleString()}</span>
                            </div>
                          )}
                          {receivable.overdue90plus > 0 && (
                            <div className="flex justify-between">
                              <span>90+ Days Overdue:</span>
                              <span className="text-rose-600">AED {receivable.overdue90plus.toLocaleString()}</span>
                            </div>
                          )}
                          {receivable.payments.length > 0 && (
                            <div className="mt-4 border-t border-white/10 pt-3">
                              <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Payment evidence</div>
                              {receivable.payments.map(payment => (
                                <div key={payment.id} className="flex justify-between gap-4 text-xs text-slate-300">
                                  <span>{payment.contractNumber} &middot; {payment.status}</span>
                                  <span>AED {Number(payment.amount ?? 0).toLocaleString()}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Dunning Activity Modal */}
      {showDunningModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-800/95 border border-white/10 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Log Dunning Activity</h2>
              <button
                onClick={() => setShowDunningModal(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                X
              </button>
            </div>

            <form onSubmit={handleDunningSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Contract ID</label>
                  <input
                    type="text"
                    name="contractId"
                    value={formData.contractId}
                    onChange={handleInputChange}
                    required
                    placeholder="LC-001"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Activity Type</label>
                  <select
                    name="activityType"
                    value={formData.activityType}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option>EMAIL</option>
                    <option>CALL</option>
                    <option>LETTER</option>
                    <option>LEGAL</option>
                    <option>SMS</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Days Overdue</label>
                  <input
                    type="number"
                    name="daysOverdue"
                    value={formData.daysOverdue}
                    onChange={handleInputChange}
                    required
                    placeholder="30"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Outstanding Amount</label>
                  <input
                    type="number"
                    name="outstandingAmount"
                    value={formData.outstandingAmount}
                    onChange={handleInputChange}
                    required
                    placeholder="5000"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Performed By</label>
                  <input
                    type="text"
                    name="performedBy"
                    value={formData.performedBy}
                    onChange={handleInputChange}
                    required
                    placeholder="John Doe"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Response</label>
                  <input
                    type="text"
                    name="response"
                    value={formData.response}
                    onChange={handleInputChange}
                    placeholder="Promise to pay"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Next Action Date</label>
                  <input
                    type="date"
                    name="nextActionDate"
                    value={formData.nextActionDate}
                    onChange={handleInputChange}
                    required
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Next Action Type</label>
                  <select
                    name="nextActionType"
                    value={formData.nextActionType}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option>EMAIL</option>
                    <option>CALL</option>
                    <option>LETTER</option>
                    <option>LEGAL</option>
                    <option>SMS</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Notes</label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleInputChange}
                  placeholder="Additional notes..."
                  rows={3}
                  className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-blue-600 text-white font-medium py-2 hover:bg-blue-700 transition-colors"
                >
                  Log Activity
                </button>
                <button
                  type="button"
                  onClick={() => setShowDunningModal(false)}
                  className="flex-1 rounded-lg bg-slate-700 text-white font-medium py-2 hover:bg-slate-600 transition-colors"
                >
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

/* ── small inline helper for the sweep summary ──────────────────────────── */

function SweepStat({ label, value, tone }: { label: string; value: number | string; tone: 'amber' | 'orange' | 'rose' | 'slate' }) {
  const toneClasses = {
    amber: 'bg-amber-500/10 border-amber-500/30 text-amber-200',
    orange: 'bg-orange-500/10 border-orange-500/30 text-orange-200',
    rose: 'bg-rose-500/10 border-rose-500/30 text-rose-200',
    slate: 'bg-slate-700/50 border-slate-600 text-slate-200',
  }[tone];
  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClasses}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-75">{label}</div>
      <div className="text-base font-bold mt-0.5">{value}</div>
    </div>
  );
}
