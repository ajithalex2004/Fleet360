'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';

interface PendingApproval {
  stepInstanceId: string;
  workflowInstanceId: string;
  stepName: string;
  assignedToEmail?: string | null;
  assignedToName?: string | null;
  stepStatus?: string;
  dueAt: string | null;
  receivedAt: string;
  referenceType: string;
  referenceId: string;
  referenceNumber: string;
  initiatedByEmail: string;
  initiatedByName: string | null;
  initiatedAt: string;
  workflowName: string;
  module: string;
  procedure: string;
}

interface WorkflowHistory {
  id: string;
  workflowName: string;
  referenceNumber: string;
  referenceType: string;
  status: string;
  currentStepOrder: number;
  initiatedByEmail: string;
  initiatedAt: string;
  completedAt: string | null;
  steps: {
    id: string;
    stepOrder: number;
    stepName: string;
    assignedToEmail: string | null;
    status: string;
    comments: string | null;
    actionedAt: string | null;
    actionedByEmail: string | null;
    dueAt: string | null;
  }[];
}

const MODULE_COLORS: Record<string, string> = {
  LEASING:         'from-blue-500 to-indigo-600',
  RAC:             'from-emerald-500 to-teal-600',
  STAFF_TRANSPORT: 'from-violet-500 to-purple-600',
  SCHOOL_BUS:      'from-amber-500 to-orange-600',
  LOGISTICS:       'from-rose-500 to-pink-600',
  INCIDENT:        'from-red-500 to-rose-700',
  BOOKING:         'from-cyan-500 to-sky-600',
};

const STATUS_STYLES: Record<string, string> = {
  APPROVED:    'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  REJECTED:    'bg-rose-500/20 text-rose-400 border-rose-500/30',
  PENDING:     'bg-amber-500/20 text-amber-400 border-amber-500/30',
  WAITING:     'bg-slate-500/20 text-slate-400 border-slate-500/30',
  IN_PROGRESS: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  CANCELLED:   'bg-slate-500/20 text-slate-400 border-slate-500/30',
};

type ViewMode = 'my' | 'all';

export default function ApprovalsPage() {
  const [viewMode, setViewMode]             = useState<ViewMode>('my');
  const [email, setEmail]                   = useState('');
  const [emailInput, setEmailInput]         = useState('');
  const [approvals, setApprovals]           = useState<PendingApproval[]>([]);
  const [allPending, setAllPending]         = useState<PendingApproval[]>([]);
  const [loading, setLoading]               = useState(false);
  const [allLoading, setAllLoading]         = useState(false);
  const [selectedApproval, setSelectedApproval] = useState<PendingApproval | null>(null);
  const [history, setHistory]               = useState<WorkflowHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [actionComments, setActionComments] = useState('');
  const [actioning, setActioning]           = useState(false);
  const [actionMsg, setActionMsg]           = useState('');
  const [moduleFilter, setModuleFilter]     = useState('ALL');

  const loadMyApprovals = useCallback(async (emailAddr: string) => {
    if (!emailAddr) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/my-approvals?email=${encodeURIComponent(emailAddr)}`);
      const data = await res.json();
      setApprovals(Array.isArray(data) ? data : []);
    } catch { setApprovals([]); }
    finally { setLoading(false); }
  }, []);

  const loadAllPending = useCallback(async () => {
    setAllLoading(true);
    try {
      const res = await fetch('/api/admin/workflow-instances?view=pending');
      const data = await res.json();
      setAllPending(Array.isArray(data) ? data : []);
    } catch { setAllPending([]); }
    finally { setAllLoading(false); }
  }, []);

  const loadHistory = async (instanceId: string) => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/workflow/instances/${instanceId}/action`);
      if (res.ok) setHistory(await res.json());
    } catch {}
    finally { setHistoryLoading(false); }
  };

  useEffect(() => {
    if (email) loadMyApprovals(email);
  }, [email, loadMyApprovals]);

  useEffect(() => {
    if (viewMode === 'all') loadAllPending();
  }, [viewMode, loadAllPending]);

  const handleAction = async (action: 'APPROVE' | 'REJECT') => {
    if (!selectedApproval) return;
    setActioning(true);
    setActionMsg('');
    try {
      const res = await fetch(`/api/workflow/instances/${selectedApproval.workflowInstanceId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          comments: actionComments,
          actionedByEmail: email || 'admin@xlai.com',
          currentStepOrder: null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionMsg(action === 'APPROVE' ? 'Approved successfully!' : 'Rejected.');
        setActionComments('');
        if (viewMode === 'my' && email) await loadMyApprovals(email);
        if (viewMode === 'all') await loadAllPending();
        if (selectedApproval) await loadHistory(selectedApproval.workflowInstanceId);
        setTimeout(() => { setSelectedApproval(null); setActionMsg(''); }, 1800);
      } else {
        setActionMsg(`Error: ${data.error ?? 'Action failed'}`);
      }
    } catch { setActionMsg('Error: Could not connect'); }
    setActioning(false);
  };

  const isOverdue = (dueAt: string | null) => dueAt ? new Date(dueAt) < new Date() : false;
  const fmt = (d: string | null) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const displayList: PendingApproval[] = viewMode === 'all'
    ? (moduleFilter === 'ALL' ? allPending : allPending.filter(a => a.module === moduleFilter))
    : approvals;

  const modules = ['ALL', ...Array.from(new Set(allPending.map(a => a.module)))];

  const ApprovalCard = ({ a }: { a: PendingApproval }) => (
    <div
      onClick={() => { setSelectedApproval(a); loadHistory(a.workflowInstanceId); setActionMsg(''); setActionComments(''); }}
      className={`bg-slate-800/50 border rounded-2xl p-4 cursor-pointer transition-all hover:border-violet-500/30 ${selectedApproval?.stepInstanceId === a.stepInstanceId ? 'border-violet-500/50 bg-violet-500/10' : 'border-white/10'}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className={`px-2 py-0.5 rounded-full text-xs font-bold bg-gradient-to-r ${MODULE_COLORS[a.module] ?? 'from-slate-500 to-slate-600'} text-white flex-shrink-0`}>
          {a.module.replace(/_/g, ' ')}
        </span>
        {isOverdue(a.dueAt) && (
          <span className="px-2 py-0.5 rounded-full text-xs bg-rose-500/20 text-rose-400 border border-rose-500/30 flex-shrink-0">Overdue</span>
        )}
      </div>
      <p className="text-white font-bold text-sm">{a.referenceNumber}</p>
      <p className="text-slate-400 text-xs mt-0.5">{a.stepName}</p>
      {viewMode === 'all' && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-slate-600 flex items-center justify-center text-[9px] text-slate-300 flex-shrink-0">
            {(a.assignedToEmail ?? 'U')[0].toUpperCase()}
          </span>
          <p className="text-xs text-slate-500 truncate">{a.assignedToEmail ?? 'Unassigned'}</p>
        </div>
      )}
      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>By: {a.initiatedByName || a.initiatedByEmail}</span>
        <span>{fmt(a.receivedAt)}</span>
      </div>
      {a.dueAt && (
        <p className={`text-xs mt-1 ${isOverdue(a.dueAt) ? 'text-rose-400' : 'text-slate-500'}`}>
          Due: {fmt(a.dueAt)}
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Approvals Inbox"
        subtitle="Review and action pending workflow approvals"
        icon={ClipboardCheck}
        accent="violet"
        actions={
          <div className="flex items-center gap-1 bg-slate-800/60 border border-white/10 rounded-xl p-1">
            <button
              onClick={() => { setViewMode('my'); setSelectedApproval(null); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'my' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              My approvals
            </button>
            <button
              onClick={() => { setViewMode('all'); setSelectedApproval(null); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'all' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              All pending
              {allPending.length > 0 && viewMode !== 'all' && (
                <span className="ml-2 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                  {allPending.length}
                </span>
              )}
            </button>
          </div>
        }
      />

      {/* MY APPROVALS VIEW */}
      {viewMode === 'my' && (
        <>
          {!email ? (
            <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-8 max-w-md mx-auto mt-12">
              <div className="text-center mb-6">
                <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mx-auto mb-4">
                  <span className="text-3xl font-bold text-violet-400">A</span>
                </div>
                <h2 className="text-white font-bold text-lg">Enter Your Email</h2>
                <p className="text-slate-400 text-sm mt-1">To see approvals assigned to you</p>
              </div>
              <div className="flex gap-2">
                <input type="email" value={emailInput} onChange={e => setEmailInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && emailInput) setEmail(emailInput); }}
                  placeholder="your.email@company.com"
                  className="flex-1 px-3 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500/50" />
                <button onClick={() => { if (emailInput) setEmail(emailInput); }}
                  disabled={!emailInput}
                  className="px-5 py-2.5 rounded-xl bg-violet-600 text-white font-semibold text-sm hover:bg-violet-500 transition-all disabled:opacity-50">
                  View
                </button>
              </div>
              <div className="mt-4 pt-4 border-t border-white/10 text-center">
                <button onClick={() => setViewMode('all')} className="text-violet-400 hover:text-violet-300 text-xs font-medium transition-colors">
                  View All Pending Approvals (Admin)
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between bg-slate-800/40 border border-white/10 rounded-xl px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
                    <span className="text-violet-400 text-xs font-bold">{email[0]?.toUpperCase()}</span>
                  </div>
                  <div>
                    <p className="text-white text-sm font-semibold">{email}</p>
                    <p className="text-slate-500 text-xs">{approvals.length} pending approval{approvals.length !== 1 ? 's' : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => loadMyApprovals(email)}
                    className="text-slate-500 hover:text-slate-300 text-xs transition-colors">Refresh</button>
                  <button onClick={() => { setEmail(''); setEmailInput(''); setApprovals([]); setSelectedApproval(null); }}
                    className="text-slate-500 hover:text-slate-300 text-xs font-medium transition-colors">Switch User</button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <div className="lg:col-span-2 space-y-3">
                  {loading ? (
                    <div className="text-slate-500 text-sm text-center py-8 animate-pulse">Loading...</div>
                  ) : approvals.length === 0 ? (
                    <div className="bg-slate-800/40 border border-dashed border-white/10 rounded-2xl p-10 text-center">
                      <p className="text-4xl mb-3">&#10003;</p>
                      <p className="text-white font-semibold mb-1">All caught up!</p>
                      <p className="text-slate-500 text-sm">No pending approvals for this email.</p>
                      <button onClick={() => setViewMode('all')} className="mt-4 text-violet-400 hover:text-violet-300 text-xs font-medium transition-colors">
                        Check All Pending
                      </button>
                    </div>
                  ) : approvals.map(a => <ApprovalCard key={a.stepInstanceId} a={a} />)}
                </div>
                <div className="lg:col-span-3">
                  <ActionPanel />
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ALL PENDING VIEW */}
      {viewMode === 'all' && (
        <>
          {/* Module filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Module:</span>
            {modules.map(m => (
              <button key={m} onClick={() => setModuleFilter(m)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${moduleFilter === m ? `bg-gradient-to-r ${MODULE_COLORS[m] ?? 'from-slate-600 to-slate-700'} text-white` : 'bg-slate-800/60 text-slate-400 border border-white/5 hover:text-white'}`}>
                {m.replace(/_/g, ' ')}
                {m !== 'ALL' && <span className="ml-1.5 text-slate-300">{allPending.filter(a => a.module === m).length}</span>}
                {m === 'ALL' && <span className="ml-1.5 text-slate-300">{allPending.length}</span>}
              </button>
            ))}
            <button onClick={loadAllPending} className="ml-auto text-slate-500 hover:text-slate-300 text-xs transition-colors px-2 py-1.5">
              Refresh
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-2 space-y-3">
              {allLoading ? (
                <div className="text-slate-500 text-sm text-center py-8 animate-pulse">Loading all pending...</div>
              ) : displayList.length === 0 ? (
                <div className="bg-slate-800/40 border border-dashed border-white/10 rounded-2xl p-10 text-center">
                  <p className="text-4xl mb-3">&#10003;</p>
                  <p className="text-white font-semibold mb-1">No pending approvals</p>
                  <p className="text-slate-500 text-sm">
                    {allPending.length === 0
                      ? 'No workflows have been triggered yet. Submit a record for approval to see it here.'
                      : `No pending approvals in ${moduleFilter} module.`}
                  </p>
                  {allPending.length === 0 && (
                    <div className="mt-4 p-3 bg-slate-700/30 rounded-xl border border-white/10 text-left">
                      <p className="text-xs font-semibold text-slate-400 mb-2">Checklist to see items here:</p>
                      <ol className="text-xs text-slate-500 space-y-1 list-decimal list-inside">
                        <li>Define a workflow in Admin &gt; Workflow Management</li>
                        <li>Set Assignee Type to &quot;Specific User&quot; with a valid email</li>
                        <li>Mark the workflow as Active</li>
                        <li>Submit a Lease Quotation for approval (status: Pending Approval)</li>
                      </ol>
                    </div>
                  )}
                </div>
              ) : displayList.map(a => <ApprovalCard key={a.stepInstanceId} a={a} />)}
            </div>
            <div className="lg:col-span-3">
              <ActionPanel />
            </div>
          </div>
        </>
      )}
    </div>
  );

  function ActionPanel() {
    if (!selectedApproval) {
      return (
        <div className="bg-slate-800/40 border border-dashed border-white/10 rounded-2xl p-12 text-center h-full flex flex-col items-center justify-center min-h-[320px]">
          <div className="w-12 h-12 rounded-2xl bg-slate-700/50 border border-white/10 flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">&#128394;</span>
          </div>
          <p className="text-white font-semibold mb-1">Select an approval</p>
          <p className="text-slate-500 text-sm">Click an item on the left to review and take action</p>
        </div>
      );
    }

    return (
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
        {/* Header */}
        <div className={`p-5 bg-gradient-to-r ${MODULE_COLORS[selectedApproval.module] ?? 'from-slate-700 to-slate-800'} bg-opacity-20`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-white/20 text-white">
              {selectedApproval.module.replace(/_/g, ' ')}
            </span>
            <span className="text-white/70 text-xs">{selectedApproval.procedure.replace(/_/g, ' ')}</span>
          </div>
          <h2 className="text-white font-bold text-xl">{selectedApproval.referenceNumber}</h2>
          <p className="text-white/80 text-sm mt-0.5">{selectedApproval.workflowName}</p>
        </div>

        <div className="p-5 space-y-4">
          {/* Details */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Current Step', value: selectedApproval.stepName },
              { label: 'Reference Type', value: selectedApproval.referenceType },
              { label: 'Submitted By', value: selectedApproval.initiatedByName || selectedApproval.initiatedByEmail },
              { label: 'Submitted At', value: fmt(selectedApproval.initiatedAt) },
              ...(selectedApproval.assignedToEmail ? [{ label: 'Assigned To', value: selectedApproval.assignedToEmail }] : []),
              ...(selectedApproval.dueAt ? [{ label: 'Due By', value: fmt(selectedApproval.dueAt) }] : []),
            ].map(({ label, value }) => (
              <div key={label} className="bg-slate-700/30 border border-white/10 rounded-xl p-3">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">{label}</p>
                <p className="text-sm font-semibold text-white truncate">{value}</p>
              </div>
            ))}
          </div>

          {/* Workflow Timeline */}
          {historyLoading ? (
            <div className="text-slate-500 text-sm animate-pulse py-4 text-center">Loading timeline...</div>
          ) : history && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Approval Timeline</p>
              <div className="space-y-2">
                {history.steps.map(s => (
                  <div key={s.id} className={`flex items-start gap-3 p-3 rounded-xl border ${s.status === 'PENDING' ? 'bg-amber-500/10 border-amber-500/20' : s.status === 'APPROVED' ? 'bg-emerald-500/10 border-emerald-500/20' : s.status === 'REJECTED' ? 'bg-rose-500/10 border-rose-500/20' : 'bg-slate-700/20 border-white/5'}`}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${s.status === 'PENDING' ? 'bg-amber-500/30 text-amber-400' : s.status === 'APPROVED' ? 'bg-emerald-500/30 text-emerald-400' : s.status === 'REJECTED' ? 'bg-rose-500/30 text-rose-400' : 'bg-slate-600/50 text-slate-400'}`}>
                      {s.stepOrder}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className={`text-sm font-semibold truncate ${s.status === 'PENDING' ? 'text-white' : 'text-slate-300'}`}>{s.stepName}</p>
                        <span className={`px-2 py-0.5 rounded-full text-xs border flex-shrink-0 ${STATUS_STYLES[s.status] ?? STATUS_STYLES.WAITING}`}>{s.status}</span>
                      </div>
                      {s.assignedToEmail && <p className="text-xs text-slate-500 mt-0.5">{s.assignedToEmail}</p>}
                      {s.actionedAt && <p className="text-xs text-slate-500 mt-0.5">{fmt(s.actionedAt)} by {s.actionedByEmail}</p>}
                      {s.comments && <p className="text-xs text-slate-400 mt-1 italic">&#34;{s.comments}&#34;</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action */}
          <div className="border-t border-white/10 pt-4 space-y-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Your Decision</p>
            {viewMode === 'my' && !email && (
              <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                Switch to &ldquo;My Approvals&rdquo; and enter your email to take action.
              </p>
            )}
            <textarea value={actionComments} onChange={e => setActionComments(e.target.value)}
              rows={3} placeholder="Add comments (required for rejection, optional for approval)..."
              className="w-full px-3 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500/50 resize-none" />
            {actionMsg && (
              <div className={`px-4 py-2.5 rounded-xl text-sm border ${actionMsg.startsWith('Error') ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
                {actionMsg}
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => handleAction('REJECT')} disabled={actioning}
                className="flex-1 py-3 rounded-xl bg-rose-600/80 text-white font-bold hover:bg-rose-600 transition-all disabled:opacity-50 text-sm border border-rose-500/30">
                {actioning ? '...' : 'Reject'}
              </button>
              <button onClick={() => handleAction('APPROVE')} disabled={actioning}
                className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-500 transition-all disabled:opacity-50 text-sm">
                {actioning ? 'Processing...' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
