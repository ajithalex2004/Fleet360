'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface PendingAction {
  id: string;
  entityType: 'quotation' | 'contract';
  entityId: string;
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

export default function WorkflowPage() {
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [approvalHistory, setApprovalHistory] = useState<ApprovalHistoryItem[]>([]);
  const [varianceAlerts, setVarianceAlerts] = useState<VarianceAlert[]>([]);
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');

  const fetchWorkflow = async () => {
    try {
      const [workflowRes, alertsRes] = await Promise.all([
        fetch('/api/leasing/workflow'),
        fetch('/api/leasing/alerts'),
      ]);

      if (workflowRes.ok) {
        const data = await workflowRes.json();
        setWorkflowSteps(data.workflowSteps ?? []);
        setPendingActions(data.pendingActions ?? []);
        setApprovalHistory(data.approvalHistory ?? []);
      }

      if (alertsRes.ok) {
        const alerts = await alertsRes.json();
        setVarianceAlerts(alerts.slice(0, 20).map((a: any) => ({
          id: a.id,
          reference: a.contract?.contractNumber ?? a.quotationId ?? '—',
          message: a.message,
          severity: a.severity ?? 'WARNING',
          status: a.status === 'OPEN' ? 'Open' : a.status === 'ACKNOWLEDGED' ? 'Acknowledged' : 'Resolved',
          created: a.createdAt,
        })));
      }
    } catch (error) {
      console.error('Error fetching workflow data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkflow();
  }, []);

  const handleApprovalAction = async (action: PendingAction, decision: 'APPROVE' | 'REJECT') => {
    let comments: string | undefined;
    if (decision === 'REJECT') {
      const reason = window.prompt('Reason for rejection (optional):') ?? '';
      comments = reason || undefined;
    }

    setActingOn(action.id);
    try {
      const res = await fetch(`/api/leasing/quotations/${action.entityId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: decision, comments }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      await fetchWorkflow();
    } catch (error) {
      console.error('Failed to record approval decision:', error);
      alert('Failed to record decision. Please try again.');
    } finally {
      setActingOn(null);
    }
  };

  const getStatusBadgeStyle = (status: string) => {
    switch (status) {
      case 'Approved':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'Rejected':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'Pending':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      default:
        return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading workflow...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Workflow Management</h1>
        <p className="text-slate-400">Monitor approval cycles and contract lifecycle progression</p>
      </div>

      {/* Workflow Pipeline */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        <div className="flex gap-3 min-w-min pb-4">
          {workflowSteps.map((step, idx) => (
            <React.Fragment key={step.number}>
              <div className="flex flex-col items-center min-w-fit">
                <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-full w-12 h-12 flex items-center justify-center text-white font-bold text-sm mb-3">
                  {step.number}
                </div>
                <p className="text-xs font-medium text-slate-300 text-center mb-2 whitespace-nowrap">{step.label}</p>
                <p className="text-lg font-bold text-white">{step.count}</p>
              </div>
              {idx < workflowSteps.length - 1 && (
                <div className="flex items-center px-2">
                  <div className="text-2xl text-slate-600">→</div>
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm">
        <div className="flex gap-4 border-b border-white/10 mb-6">
          <button
            onClick={() => setActiveTab('pending')}
            className={`pb-4 text-sm font-semibold transition-colors ${
              activeTab === 'pending'
                ? 'text-blue-400 border-b-2 border-blue-500'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            Pending Actions ({pendingActions.length})
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`pb-4 text-sm font-semibold transition-colors ${
              activeTab === 'history'
                ? 'text-blue-400 border-b-2 border-blue-500'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            Approval History
          </button>
        </div>

        {/* Pending Actions Tab */}
        {activeTab === 'pending' && (
          <div className="space-y-4">
            {pendingActions.map((action) => (
              <div key={action.id} className="bg-slate-900/50 border border-white/10 rounded-lg p-4 hover:border-white/20 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">
                      {action.entityType === 'quotation' ? '📋' : '📄'}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-white">{action.entityNumber}</p>
                      <p className="text-xs text-slate-400">
                        {action.entityType === 'quotation' ? 'Quotation' : 'Contract'}
                      </p>
                    </div>
                  </div>
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    {action.currentStatus}
                  </span>
                </div>

                <p className="text-sm text-slate-300 mb-3">{action.actionNeeded}</p>

                <div className="grid grid-cols-3 gap-4 text-xs mb-4">
                  <div>
                    <p className="text-slate-500 mb-1">Requestor</p>
                    <p className="text-slate-300 font-medium">{action.requestor}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 mb-1">Created</p>
                    <p className="text-slate-300 font-medium">{action.createdDate}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 mb-1">Time Elapsed</p>
                    <p className="text-slate-300 font-medium">{action.timeElapsed}</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  {action.entityType === 'quotation' ? (
                    <>
                      <button
                        onClick={() => handleApprovalAction(action, 'APPROVE')}
                        disabled={actingOn === action.id}
                        className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 text-xs font-medium border border-emerald-500/30 transition-colors disabled:opacity-50"
                      >
                        {actingOn === action.id ? 'Working...' : 'Approve'}
                      </button>
                      <button
                        onClick={() => handleApprovalAction(action, 'REJECT')}
                        disabled={actingOn === action.id}
                        className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 text-xs font-medium border border-red-500/30 transition-colors disabled:opacity-50"
                      >
                        Reject
                      </button>
                      <Link
                        href={`/leasing/quotations/${action.entityId}`}
                        className="px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 text-xs font-medium border border-blue-500/30 transition-colors"
                      >
                        View
                      </Link>
                    </>
                  ) : (
                    <Link
                      href="/leasing/contracts-v2"
                      className="px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 text-xs font-medium border border-blue-500/30 transition-colors"
                    >
                      View Contract
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Approval History Tab */}
        {activeTab === 'history' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/50">
                <tr className="border-b border-white/5">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Entity Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Entity ID</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Step Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Approver</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Action Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Comments</th>
                </tr>
              </thead>
              <tbody>
                {approvalHistory.map((item) => (
                  <tr key={item.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-4 py-4 text-white">{item.entityType}</td>
                    <td className="px-4 py-4 font-medium text-blue-400">{item.entityId}</td>
                    <td className="px-4 py-4 text-white">{item.stepName}</td>
                    <td className="px-4 py-4 text-white">{item.approver}</td>
                    <td className="px-4 py-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusBadgeStyle(item.status)}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-slate-200">{item.actionDate}</td>
                    <td className="px-4 py-4 text-slate-200 max-w-xs truncate">{item.comments}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Variance Alert Section */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm">
        <h2 className="text-xl font-bold text-white mb-6">Variance Alerts</h2>
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
                    <p className="font-semibold text-white">{alert.message}</p>
                    <p className="text-xs text-slate-400 mt-1">Reference: {alert.reference}</p>
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
              <p className="text-xs text-slate-500">Created: {alert.created}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
