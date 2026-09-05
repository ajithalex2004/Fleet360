'use client';
import React, { useState, useEffect } from 'react';
import { X, Workflow as WorkflowIcon } from 'lucide-react';

/**
 * WorkflowModal
 * ----------------------------------------------------------------------------
 * Mounted from inside /leasing/quotations. Functional port of the legacy
 * /leasing/workflow page so users no longer need a top-level menu item.
 *
 * Domain model:
 *   - The Leasing workflow tracks the lifecycle of a quotation / contract
 *     through 9 approval stages: Inquiry → Quotation → Internal Approval →
 *     Sent to Customer → Customer Approval → Credit Approval → PO Prepared →
 *     Contract Generated → Active.
 *
 *   - Pending Actions: items currently blocked on someone (approval queue).
 *   - Approval History: resolved approval steps (audit trail).
 *   - Variance Alerts: pricing / terms anomalies flagged by the system.
 *
 * The current data feed is mock-driven (the legacy page had no real backend);
 * the modal preserves that behavior 1:1. When a real /api/leasing/workflow
 * endpoint is wired up, only the useEffect fetch needs to change.
 *
 * The component takes only `onClose`. It owns all its own state.
 * ------------------------------------------------------------------------- */

interface PendingAction {
  id: string;
  entityType: 'quotation' | 'contract';
  entityNumber: string;
  currentStatus: string;
  actionNeeded: string;
  requestor: string;
  createdDate: string;
  timeElapsed: string;
}

interface ApprovalHistoryItem {
  id: string;
  entityType: string;
  entityId: string;
  stepName: string;
  approver: string;
  status: 'Approved' | 'Rejected' | 'Pending';
  actionDate: string;
  comments: string;
}

interface VarianceAlert {
  id: string;
  reference: string;
  message: string;
  severity: 'WARNING' | 'ERROR';
  status: 'Open' | 'Acknowledged' | 'Resolved';
  created: string;
}

interface WorkflowStep {
  number: number;
  label: string;
  count: number;
}

export default function WorkflowModal({ onClose }: { onClose: () => void }) {
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [approvalHistory, setApprovalHistory] = useState<ApprovalHistoryItem[]>([]);
  const [varianceAlerts, setVarianceAlerts] = useState<VarianceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');

  const workflowSteps: WorkflowStep[] = [
    { number: 1, label: 'Inquiry', count: 8 },
    { number: 2, label: 'Quotation', count: 12 },
    { number: 3, label: 'Internal Approval', count: 5 },
    { number: 4, label: 'Sent to Customer', count: 10 },
    { number: 5, label: 'Customer Approval', count: 3 },
    { number: 6, label: 'Credit Approval', count: 2 },
    { number: 7, label: 'PO Prepared', count: 4 },
    { number: 8, label: 'Contract Generated', count: 6 },
    { number: 9, label: 'Active', count: 24 },
  ];

  useEffect(() => {
    const mockPendingActions: PendingAction[] = [
      {
        id: '1',
        entityType: 'quotation',
        entityNumber: 'QT-2025-001',
        currentStatus: 'Pending Internal Approval',
        actionNeeded: 'Awaiting Internal Approval',
        requestor: 'Ahmed Al-Mansouri',
        createdDate: '2025-04-08',
        timeElapsed: '4 days ago',
      },
      {
        id: '2',
        entityType: 'contract',
        entityNumber: 'LC-V2-005',
        currentStatus: 'Pending Customer Response',
        actionNeeded: 'Awaiting Customer Approval',
        requestor: 'Global Logistics LLC',
        createdDate: '2025-04-06',
        timeElapsed: '6 days ago',
      },
      {
        id: '3',
        entityType: 'quotation',
        entityNumber: 'QT-2025-003',
        currentStatus: 'Pending Credit Check',
        actionNeeded: 'Awaiting Credit Approval',
        requestor: 'Enterprise Corp',
        createdDate: '2025-04-10',
        timeElapsed: '2 days ago',
      },
      {
        id: '4',
        entityType: 'contract',
        entityNumber: 'LC-V2-006',
        currentStatus: 'Pending PO Submission',
        actionNeeded: 'Awaiting PO Preparation',
        requestor: 'Fatima Al-Nakhli',
        createdDate: '2025-04-11',
        timeElapsed: '1 day ago',
      },
    ];

    const mockApprovalHistory: ApprovalHistoryItem[] = [
      {
        id: '1',
        entityType: 'Quotation',
        entityId: 'QT-2025-002',
        stepName: 'Internal Approval',
        approver: 'Hana Al-Mansouri',
        status: 'Approved',
        actionDate: '2025-04-09',
        comments: 'Terms acceptable, approved for customer submission',
      },
      {
        id: '2',
        entityType: 'Contract',
        entityId: 'LC-V2-004',
        stepName: 'Credit Approval',
        approver: 'Mohammed Al-Qasimi',
        status: 'Approved',
        actionDate: '2025-04-07',
        comments: 'Credit check passed, approved for execution',
      },
      {
        id: '3',
        entityType: 'Quotation',
        entityId: 'QT-2025-001',
        stepName: 'Customer Approval',
        approver: 'Customer',
        status: 'Pending',
        actionDate: '2025-04-05',
        comments: 'Awaiting customer response',
      },
      {
        id: '4',
        entityType: 'Contract',
        entityId: 'LC-V2-003',
        stepName: 'Internal Approval',
        approver: 'Layla Al-Nakhli',
        status: 'Rejected',
        actionDate: '2025-04-03',
        comments: 'Mileage cap needs adjustment',
      },
    ];

    const mockVarianceAlerts: VarianceAlert[] = [
      {
        id: '1',
        reference: 'LC-V2-001',
        message: 'Monthly rate exceeds standard rate by 15%',
        severity: 'WARNING',
        status: 'Open',
        created: '2025-04-10',
      },
      {
        id: '2',
        reference: 'QT-2025-002',
        message: 'Master contract variance detected - review pricing structure',
        severity: 'ERROR',
        status: 'Acknowledged',
        created: '2025-04-08',
      },
      {
        id: '3',
        reference: 'LC-V2-002',
        message: 'Security deposit below minimum threshold',
        severity: 'WARNING',
        status: 'Open',
        created: '2025-04-11',
      },
    ];

    setPendingActions(mockPendingActions);
    setApprovalHistory(mockApprovalHistory);
    setVarianceAlerts(mockVarianceAlerts);
    setLoading(false);
  }, []);

  const getStatusBadgeStyle = (status: string) => {
    switch (status) {
      case 'Approved':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'Rejected':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'Pending':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      default:
        return 'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30';
    }
  };

  const getSeverityBadgeStyle = (severity: string) => {
    switch (severity) {
      case 'ERROR':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'WARNING':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      default:
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-7xl max-h-[94vh] flex flex-col bg-[var(--bg-surface)]/95 border border-[var(--border-subtle)] rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/60">
          <div>
            <h2 className="text-xl font-bold text-[var(--text-main)] flex items-center gap-2">
              <WorkflowIcon className="h-5 w-5" /> Workflow Management
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Monitor approval cycles and contract lifecycle progression
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-main)]"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">Loading workflow...</div>
          ) : (
            <>
              {/* Workflow Pipeline */}
              <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
                <div className="flex gap-3 min-w-min pb-4">
                  {workflowSteps.map((step, idx) => (
                    <React.Fragment key={step.number}>
                      <div className="flex flex-col items-center min-w-fit">
                        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-full w-12 h-12 flex items-center justify-center text-white font-bold text-sm mb-3">
                          {step.number}
                        </div>
                        <p className="text-xs font-medium text-[var(--text-muted)] text-center mb-2 whitespace-nowrap">{step.label}</p>
                        <p className="text-lg font-bold text-[var(--text-main)]">{step.count}</p>
                      </div>
                      {idx < workflowSteps.length - 1 && (
                        <div className="flex items-center px-2">
                          <div className="text-2xl text-[var(--text-faint)]">→</div>
                        </div>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {/* Tabs */}
              <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm">
                <div className="flex gap-4 border-b border-[var(--border-subtle)] mb-6">
                  <button
                    onClick={() => setActiveTab('pending')}
                    className={`pb-4 text-sm font-semibold transition-colors ${
                      activeTab === 'pending'
                        ? 'text-blue-400 border-b-2 border-blue-500'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-muted)]'
                    }`}
                  >
                    Pending Actions ({pendingActions.length})
                  </button>
                  <button
                    onClick={() => setActiveTab('history')}
                    className={`pb-4 text-sm font-semibold transition-colors ${
                      activeTab === 'history'
                        ? 'text-blue-400 border-b-2 border-blue-500'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-muted)]'
                    }`}
                  >
                    Approval History
                  </button>
                </div>

                {/* Pending Actions Tab */}
                {activeTab === 'pending' && (
                  <div className="space-y-4">
                    {pendingActions.map((action) => (
                      <div key={action.id} className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-lg p-4 hover:border-[var(--border-strong)] transition-colors">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <span className="text-2xl">
                              {action.entityType === 'quotation' ? '📋' : '📄'}
                            </span>
                            <div>
                              <p className="text-sm font-semibold text-[var(--text-main)]">{action.entityNumber}</p>
                              <p className="text-xs text-[var(--text-muted)]">
                                {action.entityType === 'quotation' ? 'Quotation' : 'Contract'}
                              </p>
                            </div>
                          </div>
                          <span className="px-3 py-1 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            {action.currentStatus}
                          </span>
                        </div>

                        <p className="text-sm text-[var(--text-muted)] mb-3">{action.actionNeeded}</p>

                        <div className="grid grid-cols-3 gap-4 text-xs mb-4">
                          <div>
                            <p className="text-[var(--text-faint)] mb-1">Requestor</p>
                            <p className="text-[var(--text-muted)] font-medium">{action.requestor}</p>
                          </div>
                          <div>
                            <p className="text-[var(--text-faint)] mb-1">Created</p>
                            <p className="text-[var(--text-muted)] font-medium">{action.createdDate}</p>
                          </div>
                          <div>
                            <p className="text-[var(--text-faint)] mb-1">Time Elapsed</p>
                            <p className="text-[var(--text-muted)] font-medium">{action.timeElapsed}</p>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <button className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 text-xs font-medium border border-emerald-500/30 transition-colors">
                            Approve
                          </button>
                          <button className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 text-xs font-medium border border-red-500/30 transition-colors">
                            Reject
                          </button>
                          <button className="px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 text-xs font-medium border border-blue-500/30 transition-colors">
                            View
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Approval History Tab */}
                {activeTab === 'history' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-[var(--bg-surface)]/50">
                        <tr className="border-b border-[var(--border-subtle)]">
                          <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Entity Type</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Entity ID</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Step Name</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Approver</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Status</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Action Date</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Comments</th>
                        </tr>
                      </thead>
                      <tbody>
                        {approvalHistory.map((item) => (
                          <tr key={item.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-colors">
                            <td className="px-4 py-4 text-[var(--text-main)]">{item.entityType}</td>
                            <td className="px-4 py-4 font-medium text-blue-400">{item.entityId}</td>
                            <td className="px-4 py-4 text-[var(--text-main)]">{item.stepName}</td>
                            <td className="px-4 py-4 text-[var(--text-main)]">{item.approver}</td>
                            <td className="px-4 py-4">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusBadgeStyle(item.status)}`}>
                                {item.status}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-[var(--text-main)]">{item.actionDate}</td>
                            <td className="px-4 py-4 text-[var(--text-main)] max-w-xs truncate">{item.comments}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Variance Alert Section */}
              <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm">
                <h3 className="text-xl font-bold text-[var(--text-main)] mb-6">Variance Alerts</h3>
                <div className="space-y-3">
                  {varianceAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`border-l-4 rounded-lg p-4 ${
                        alert.severity === 'ERROR'
                          ? 'border-l-red-500 bg-red-500/5'
                          : 'border-l-amber-500 bg-amber-500/5'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <span className="text-xl">
                            {alert.severity === 'ERROR' ? '⚠️' : '⚡'}
                          </span>
                          <div>
                            <p className="font-semibold text-[var(--text-main)]">{alert.message}</p>
                            <p className="text-xs text-[var(--text-muted)] mt-1">Reference: {alert.reference}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getSeverityBadgeStyle(alert.severity)}`}>
                            {alert.severity}
                          </span>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            alert.status === 'Open'
                              ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                              : alert.status === 'Acknowledged'
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                              : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          }`}>
                            {alert.status}
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-[var(--text-faint)]">Created: {alert.created}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
