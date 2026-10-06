'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';

type SlaState = 'ESCALATED' | 'OVERDUE' | 'DUE_SOON' | 'ON_TRACK' | 'NO_SLA';

interface PendingApproval {
  stepInstanceId: string;
  workflowInstanceId: string;
  stepName: string;
  assignedToEmail?: string | null;
  assignedToName?: string | null;
  stepStatus?: string;
  dueAt: string | null;
  receivedAt: string;
  openedAt?: string | null;
  escalatedAt?: string | null;
  referenceType: string;
  referenceId: string;
  referenceNumber: string;
  initiatedByEmail: string;
  initiatedByName: string | null;
  initiatedAt: string;
  workflowName: string;
  module: string;
  procedure: string;
  sla?: { state: SlaState; hoursLeft: number | null; escalatesAt: string | null };
  highlights?: Array<{ label: string; value: string }>;
}

interface InboxSummary { total: number; dueSoon: number; overdue: number; escalated: number; escalatedToMe: number }

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
    approverEmails?: string[] | null;
    approvals?: Array<{ email: string; action: 'APPROVE' | 'REJECT'; at?: string; override?: boolean }> | null;
    requireAllApprovers?: boolean | null;
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
  FINANCE:         'from-lime-500 to-green-600',
  FLEET:           'from-sky-500 to-blue-600',
  MAINTENANCE:     'from-orange-500 to-amber-600',
};

const STATUS_STYLES: Record<string, string> = {
  APPROVED:    'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  REJECTED:    'bg-rose-500/20 text-rose-400 border-rose-500/30',
  PENDING:     'bg-amber-500/20 text-amber-400 border-amber-500/30',
  WAITING:     'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30',
  IN_PROGRESS: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  CANCELLED:   'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30',
  SKIPPED:     'bg-slate-500/10 text-[var(--text-faint)] border-slate-500/20',
};

const SLA_STYLES: Record<SlaState, { label: string; cls: string }> = {
  ESCALATED: { label: 'Escalated', cls: 'bg-rose-600/20 text-rose-300 border-rose-500/40' },
  OVERDUE:   { label: 'Overdue',   cls: 'bg-rose-500/20 text-rose-400 border-rose-500/30' },
  DUE_SOON:  { label: 'Due soon',  cls: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  ON_TRACK:  { label: 'On track',  cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  NO_SLA:    { label: 'No SLA',    cls: 'bg-slate-500/10 text-[var(--text-faint)] border-slate-500/20' },
};

type ViewMode = 'my' | 'escalated' | 'all';
type SlaFilter = 'ALL' | 'OVERDUE' | 'DUE_SOON' | 'ESCALATED';

const words = (v: string) => v.replace(/_/g, ' ');

function hoursText(h: number) {
  const abs = Math.abs(h);
  const t = abs >= 48 ? `${Math.round(abs / 24)}d` : abs >= 1 ? `${Math.round(abs)}h` : `${Math.max(1, Math.round(abs * 60))}m`;
  return h < 0 ? `${t} overdue` : `${t} left`;
}

export default function ApprovalsPage() {
  const [viewMode, setViewMode]             = useState<ViewMode>('my');
  // The signed-in user, as reported by /api/my-approvals.
  const [email, setEmail]                   = useState('');
  const [approvals, setApprovals]           = useState<PendingApproval[]>([]);
  const [escalated, setEscalated]           = useState<PendingApproval[]>([]);
  const [summary, setSummary]               = useState<InboxSummary | null>(null);
  const [allPending, setAllPending]         = useState<PendingApproval[]>([]);
  const [loading, setLoading]               = useState(false);
  const [loaded, setLoaded]                 = useState(false);
  const [allLoading, setAllLoading]         = useState(false);
  const [selectedApproval, setSelectedApproval] = useState<PendingApproval | null>(null);
  const [history, setHistory]               = useState<WorkflowHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [actionComments, setActionComments] = useState('');
  const [actioning, setActioning]           = useState(false);
  const [actionMsg, setActionMsg]           = useState('');
  const [moduleFilter, setModuleFilter]     = useState('ALL');
  const [slaFilter, setSlaFilter]           = useState<SlaFilter>('ALL');
  const [search, setSearch]                 = useState('');
  // Bulk approve (My approvals): selected approval (workflow instance) ids.
  const [checked, setChecked]               = useState<Set<string>>(new Set());
  const [bulkComments, setBulkComments]     = useState('');
  const [bulkBusy, setBulkBusy]             = useState(false);
  const [bulkResult, setBulkResult]         = useState<{ approved: number; failed: Array<{ ref: string; error: string }> } | null>(null);

  const loadMyApprovals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/my-approvals');
      const data = await res.json();
      setEmail(typeof data?.email === 'string' ? data.email : '');
      const list: PendingApproval[] = Array.isArray(data?.approvals) ? data.approvals : [];
      setApprovals(list);
      setEscalated(Array.isArray(data?.escalated) ? data.escalated : []);
      setSummary(data?.summary ?? null);
      // Keep only selections still waiting.
      setChecked((prev) => new Set([...prev].filter((id) => list.some((a) => a.workflowInstanceId === id))));
    } catch { setApprovals([]); setEscalated([]); setSummary(null); }
    finally { setLoading(false); setLoaded(true); }
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
    loadMyApprovals();
  }, [loadMyApprovals]);

  useEffect(() => {
    if (viewMode === 'all') loadAllPending();
  }, [viewMode, loadAllPending]);

  const switchView = (v: ViewMode) => {
    setViewMode(v); setSelectedApproval(null); setModuleFilter('ALL'); setSlaFilter('ALL'); setBulkResult(null);
  };

  const handleAction = async (action: 'APPROVE' | 'REJECT') => {
    if (!selectedApproval) return;
    if (action === 'REJECT' && actionComments.trim().length < 3) {
      setActionMsg('Error: Give a reason for the rejection');
      return;
    }
    setActioning(true);
    setActionMsg('');
    try {
      const res = await fetch(`/api/workflow/instances/${selectedApproval.workflowInstanceId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          comments: actionComments,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        // Where the approval stands now: the next level, who an all-approvers
        // level still waits for, or the final outcome.
        setActionMsg(data.message ?? (action === 'APPROVE' ? 'Approved successfully!' : 'Rejected.'));
        setActionComments('');
        await loadMyApprovals();
        if (viewMode === 'all') await loadAllPending();
        if (selectedApproval) await loadHistory(selectedApproval.workflowInstanceId);
        setTimeout(() => { setSelectedApproval(null); setActionMsg(''); }, 3500);
      } else {
        setActionMsg(`Error: ${data.error ?? 'Action failed'}`);
      }
    } catch { setActionMsg('Error: Could not connect'); }
    setActioning(false);
  };

  const bulkApprove = async () => {
    const ids = [...checked];
    if (!ids.length) return;
    if (!confirm(`Approve ${ids.length} selected approval${ids.length !== 1 ? 's' : ''}?`)) return;
    setBulkBusy(true);
    setBulkResult(null);
    try {
      const res = await fetch('/api/my-approvals/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceIds: ids, comments: bulkComments }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBulkResult({ approved: 0, failed: [{ ref: 'All', error: data.error ?? 'Bulk approve failed' }] });
      } else {
        const refOf = (id: string) => approvals.find((a) => a.workflowInstanceId === id)?.referenceNumber ?? id.slice(0, 8);
        const results: Array<{ instanceId: string; ok: boolean; error?: string }> = Array.isArray(data.results) ? data.results : [];
        setBulkResult({
          approved: Number(data.approved ?? 0),
          failed: results.filter((r) => !r.ok).map((r) => ({ ref: refOf(r.instanceId), error: r.error ?? 'Not approved' })),
        });
        setChecked(new Set());
        setBulkComments('');
        setSelectedApproval(null);
      }
      await loadMyApprovals();
    } catch {
      setBulkResult({ approved: 0, failed: [{ ref: 'All', error: 'Could not connect' }] });
    }
    setBulkBusy(false);
  };

  const fmt = (d: string | null | undefined) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const source: PendingApproval[] = viewMode === 'all' ? allPending : viewMode === 'escalated' ? escalated : approvals;
  const modules = ['ALL', ...Array.from(new Set(source.map(a => a.module)))];
  const q = search.trim().toLowerCase();
  const displayList = useMemo(() => source.filter((a) =>
    (moduleFilter === 'ALL' || a.module === moduleFilter)
    && (slaFilter === 'ALL' || a.sla?.state === slaFilter)
    && (!q || [a.referenceNumber, a.workflowName, a.stepName, a.initiatedByName, a.initiatedByEmail, a.procedure]
      .some((v) => (v ?? '').toLowerCase().includes(q)))),
  [source, moduleFilter, slaFilter, q]);

  const visibleIds = displayList.map((a) => a.workflowInstanceId);
  const allVisibleChecked = visibleIds.length > 0 && visibleIds.every((id) => checked.has(id));
  const toggle = (id: string) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAllVisible = () => setChecked((prev) => {
    const next = new Set(prev);
    if (allVisibleChecked) visibleIds.forEach((id) => next.delete(id));
    else visibleIds.slice(0, 50).forEach((id) => next.add(id));
    return next;
  });

  const SlaBadge = ({ a }: { a: PendingApproval }) => {
    const s = a.sla;
    if (!s || s.state === 'NO_SLA') return null;
    const style = SLA_STYLES[s.state];
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs border flex-shrink-0 ${style.cls}`}>
        {style.label}{s.hoursLeft != null && s.state !== 'ESCALATED' && s.state !== 'ON_TRACK' ? ` · ${hoursText(s.hoursLeft)}` : ''}
      </span>
    );
  };

  const ApprovalCard = ({ a }: { a: PendingApproval }) => (
    <div
      onClick={() => { setSelectedApproval(a); loadHistory(a.workflowInstanceId); setActionMsg(''); setActionComments(''); }}
      className={`bg-[var(--bg-surface)] border rounded-2xl p-4 cursor-pointer transition-all hover:border-violet-500/30 ${selectedApproval?.stepInstanceId === a.stepInstanceId ? 'border-violet-500/50 bg-violet-500/10' : a.sla?.state === 'OVERDUE' || a.sla?.state === 'ESCALATED' ? 'border-rose-500/30' : 'border-[var(--border-subtle)]'}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {viewMode === 'my' && (
            <input
              type="checkbox"
              aria-label={`Select ${a.referenceNumber}`}
              checked={checked.has(a.workflowInstanceId)}
              onClick={(e) => e.stopPropagation()}
              onChange={() => toggle(a.workflowInstanceId)}
              className="w-4 h-4 accent-violet-500 flex-shrink-0"
            />
          )}
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold bg-gradient-to-r ${MODULE_COLORS[a.module] ?? 'from-slate-500 to-slate-600'} text-white flex-shrink-0`}>
            {words(a.module)}
          </span>
        </div>
        <SlaBadge a={a} />
      </div>
      <p className="text-[var(--text-main)] font-bold text-sm">{a.referenceNumber}</p>
      <p className="text-[var(--text-muted)] text-xs mt-0.5">{a.workflowName} · {a.stepName}</p>
      {a.highlights && a.highlights.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
          {a.highlights.map((h) => (
            <span key={h.label} className="text-xs text-[var(--text-muted)]">
              <span className="text-[var(--text-faint)]">{h.label}:</span> {h.value}
            </span>
          ))}
        </div>
      )}
      {viewMode !== 'my' && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-[var(--bg-surface-hover)] flex items-center justify-center text-[9px] text-[var(--text-muted)] flex-shrink-0">
            {(a.assignedToEmail ?? 'U')[0].toUpperCase()}
          </span>
          <p className="text-xs text-[var(--text-faint)] truncate">{a.assignedToEmail ?? 'Waiting with its approvers'}</p>
        </div>
      )}
      <div className="mt-2 flex items-center justify-between text-xs text-[var(--text-faint)]">
        <span className="truncate">By: {a.initiatedByName || a.initiatedByEmail}</span>
        <span className="flex-shrink-0">{fmt(a.receivedAt)}</span>
      </div>
      {a.dueAt && (
        <p className={`text-xs mt-1 ${a.sla?.state === 'OVERDUE' || a.sla?.state === 'ESCALATED' ? 'text-rose-400' : a.sla?.state === 'DUE_SOON' ? 'text-amber-400' : 'text-[var(--text-faint)]'}`}>
          Due: {fmt(a.dueAt)}
        </p>
      )}
      {a.sla?.state === 'ESCALATED' && a.escalatedAt && (
        <p className="text-xs mt-0.5 text-rose-400">Escalated {fmt(a.escalatedAt)}</p>
      )}
      {a.sla?.escalatesAt && (
        <p className="text-xs mt-0.5 text-[var(--text-faint)]">Escalates {fmt(a.sla.escalatesAt)}</p>
      )}
    </div>
  );

  const tiles: Array<{ key: SlaFilter | 'ESCALATED_TO_ME'; label: string; value: number; cls: string }> = [
    { key: 'ALL', label: 'Waiting for me', value: summary?.total ?? approvals.length, cls: 'text-violet-400' },
    { key: 'DUE_SOON', label: 'Due soon', value: summary?.dueSoon ?? 0, cls: 'text-amber-400' },
    { key: 'OVERDUE', label: 'Overdue', value: summary?.overdue ?? 0, cls: 'text-rose-400' },
    { key: 'ESCALATED', label: 'Escalated', value: summary?.escalated ?? 0, cls: 'text-rose-300' },
    { key: 'ESCALATED_TO_ME', label: 'Escalated to me', value: summary?.escalatedToMe ?? escalated.length, cls: 'text-orange-400' },
  ];

  const tabBtn = (v: ViewMode, label: string, badge?: number) => (
    <button
      onClick={() => switchView(v)}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === v ? 'bg-violet-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}>
      {label}
      {!!badge && viewMode !== v && (
        <span className="ml-2 px-1.5 py-0.5 rounded-full bg-amber-500 text-slate-900 text-[10px] font-bold">{badge}</span>
      )}
    </button>
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Approvals Inbox"
        subtitle="Everything waiting for your decision, across every module"
        icon={ClipboardCheck}
        accent="violet"
        actions={
          <div className="flex items-center gap-1 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-1 flex-wrap">
            {tabBtn('my', 'My approvals', approvals.length)}
            {tabBtn('escalated', 'Escalated to me', escalated.length)}
            {tabBtn('all', 'All pending')}
          </div>
        }
      />

      {loaded && !email && !loading ? (
        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-8 max-w-md mx-auto mt-12 text-center">
          <p className="text-[var(--text-main)] font-semibold">Could not load your approvals</p>
          <button onClick={() => loadMyApprovals()}
            className="mt-4 px-5 py-2.5 rounded-xl bg-violet-600 text-white font-semibold text-sm hover:bg-violet-500 transition-all">
            Try again
          </button>
        </div>
      ) : (
        <>
          {/* SLA summary */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {tiles.map((t) => {
              const active = t.key === 'ESCALATED_TO_ME' ? viewMode === 'escalated' : viewMode === 'my' && slaFilter === t.key;
              return (
                <button key={t.key}
                  onClick={() => {
                    if (t.key === 'ESCALATED_TO_ME') { switchView('escalated'); return; }
                    if (viewMode !== 'my') switchView('my');
                    setSlaFilter(t.key);
                  }}
                  className={`text-left bg-[var(--bg-surface)] border rounded-xl px-4 py-3 transition-all ${active ? 'border-violet-500/50' : 'border-[var(--border-subtle)] hover:border-violet-500/30'}`}>
                  <p className={`text-2xl font-bold ${t.cls}`}>{t.value}</p>
                  <p className="text-xs text-[var(--text-faint)]">{t.label}</p>
                </button>
              );
            })}
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search reference, workflow, submitter…"
              className="px-3 py-1.5 rounded-xl text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-violet-500/50 w-full sm:w-72" />
            {modules.length > 2 && modules.map(m => (
              <button key={m} onClick={() => setModuleFilter(m)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${moduleFilter === m ? `bg-gradient-to-r ${MODULE_COLORS[m] ?? 'from-slate-600 to-slate-700'} text-white` : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border-subtle)] hover:text-[var(--text-main)]'}`}>
                {words(m)}
                <span className="ml-1.5 opacity-70">{m === 'ALL' ? source.length : source.filter(a => a.module === m).length}</span>
              </button>
            ))}
            {slaFilter !== 'ALL' && (
              <button onClick={() => setSlaFilter('ALL')}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-violet-600/20 text-violet-300 border border-violet-500/30">
                {SLA_STYLES[slaFilter as SlaState]?.label ?? slaFilter} ✕
              </button>
            )}
            <button onClick={() => { void loadMyApprovals(); if (viewMode === 'all') void loadAllPending(); }}
              className="ml-auto text-[var(--text-faint)] hover:text-[var(--text-muted)] text-xs transition-colors px-2 py-1.5">
              Refresh
            </button>
          </div>

          {/* Bulk approve */}
          {viewMode === 'my' && displayList.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-4 py-3">
              <label className="flex items-center gap-2 text-sm text-[var(--text-muted)] cursor-pointer flex-shrink-0">
                <input type="checkbox" checked={allVisibleChecked} onChange={toggleAllVisible} className="w-4 h-4 accent-violet-500" />
                Select all{displayList.length > 50 ? ' (first 50)' : ''}
              </label>
              <span className="text-xs text-[var(--text-faint)] flex-shrink-0">{checked.size} selected</span>
              <input value={bulkComments} onChange={(e) => setBulkComments(e.target.value)} placeholder="Comment for all (optional)"
                className="flex-1 min-w-0 px-3 py-1.5 rounded-lg text-sm bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-violet-500/50" />
              <button onClick={bulkApprove} disabled={bulkBusy || checked.size === 0}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 disabled:opacity-40 flex-shrink-0">
                {bulkBusy ? 'Approving…' : `Approve selected${checked.size ? ` (${checked.size})` : ''}`}
              </button>
            </div>
          )}
          {bulkResult && (
            <div className={`px-4 py-3 rounded-xl text-sm border ${bulkResult.failed.length ? 'bg-amber-500/10 text-amber-300 border-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
              <p>{bulkResult.approved} approved{bulkResult.failed.length ? `, ${bulkResult.failed.length} not approved:` : '.'}</p>
              {bulkResult.failed.length > 0 && (
                <ul className="mt-1 text-xs space-y-0.5">
                  {bulkResult.failed.map((f, i) => <li key={i}><span className="font-semibold">{f.ref}</span>: {f.error}</li>)}
                </ul>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-2 space-y-3">
              {(viewMode === 'all' ? allLoading : loading && !loaded) ? (
                <div className="text-[var(--text-faint)] text-sm text-center py-8 animate-pulse">Loading...</div>
              ) : displayList.length === 0 ? (
                <div className="bg-[var(--bg-surface)] border border-dashed border-[var(--border-subtle)] rounded-2xl p-10 text-center">
                  <p className="text-4xl mb-3">&#10003;</p>
                  <p className="text-[var(--text-main)] font-semibold mb-1">
                    {source.length ? 'Nothing matches these filters' : viewMode === 'my' ? 'All caught up!' : viewMode === 'escalated' ? 'Nothing escalated to you' : 'No pending approvals'}
                  </p>
                  <p className="text-[var(--text-faint)] text-sm">
                    {source.length ? 'Clear the filters to see everything.'
                      : viewMode === 'my' ? 'No approvals are waiting for you.'
                      : viewMode === 'escalated' ? 'Approvals that wait past their escalation time, where you are the escalation contact, show here.'
                      : 'No workflows are waiting. Set them up in Admin › Workflows.'}
                  </p>
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
        <div className="bg-[var(--bg-surface)] border border-dashed border-[var(--border-subtle)] rounded-2xl p-12 text-center h-full flex flex-col items-center justify-center min-h-[320px]">
          <div className="w-12 h-12 rounded-2xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">&#128394;</span>
          </div>
          <p className="text-[var(--text-main)] font-semibold mb-1">Select an approval</p>
          <p className="text-[var(--text-faint)] text-sm">Click an item to review it and decide</p>
        </div>
      );
    }
    const canDecideHere = viewMode !== 'escalated' || approvals.some((a) => a.workflowInstanceId === selectedApproval.workflowInstanceId);

    return (
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
        {/* Header */}
        <div className={`p-5 bg-gradient-to-r ${MODULE_COLORS[selectedApproval.module] ?? 'from-slate-700 to-slate-800'} bg-opacity-20`}>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-white/20 text-white">
              {words(selectedApproval.module)}
            </span>
            <span className="text-white/70 text-xs">{words(selectedApproval.procedure)}</span>
            {selectedApproval.sla && selectedApproval.sla.state !== 'NO_SLA' && (
              <span className="ml-auto px-2 py-0.5 rounded-full text-xs font-semibold bg-white/20 text-white">
                {SLA_STYLES[selectedApproval.sla.state].label}
                {selectedApproval.sla.hoursLeft != null && selectedApproval.sla.state !== 'ESCALATED' ? ` · ${hoursText(selectedApproval.sla.hoursLeft)}` : ''}
              </span>
            )}
          </div>
          <h2 className="text-white font-bold text-xl">{selectedApproval.referenceNumber}</h2>
          <p className="text-white/80 text-sm mt-0.5">{selectedApproval.workflowName}</p>
        </div>

        <div className="p-5 space-y-4">
          {/* Details */}
          <div className="grid grid-cols-2 gap-3">
            {[
              ...(selectedApproval.highlights ?? []),
              { label: 'Current Step', value: selectedApproval.stepName },
              { label: 'Submitted By', value: selectedApproval.initiatedByName || selectedApproval.initiatedByEmail },
              { label: 'Submitted At', value: fmt(selectedApproval.initiatedAt) },
              ...(selectedApproval.assignedToEmail ? [{ label: 'Assigned To', value: selectedApproval.assignedToEmail }] : []),
              ...(selectedApproval.dueAt ? [{ label: 'Due By', value: fmt(selectedApproval.dueAt) }] : []),
              ...(selectedApproval.escalatedAt ? [{ label: 'Escalated', value: fmt(selectedApproval.escalatedAt) }] : []),
              ...(selectedApproval.sla?.escalatesAt ? [{ label: 'Escalates', value: fmt(selectedApproval.sla.escalatesAt) }] : []),
            ].map(({ label, value }) => (
              <div key={label} className="bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl p-3">
                <p className="text-xs text-[var(--text-faint)] uppercase tracking-wider mb-1">{label}</p>
                <p className="text-sm font-semibold text-[var(--text-main)] truncate">{value}</p>
              </div>
            ))}
          </div>

          {/* Workflow Timeline */}
          {historyLoading ? (
            <div className="text-[var(--text-faint)] text-sm animate-pulse py-4 text-center">Loading timeline...</div>
          ) : history && (
            <div>
              <p className="text-xs font-semibold text-[var(--text-faint)] uppercase tracking-wider mb-3">Approval Timeline</p>
              <div className="space-y-2">
                {history.steps.map(s => (
                  <div key={s.id} className={`flex items-start gap-3 p-3 rounded-xl border ${s.status === 'PENDING' ? 'bg-amber-500/10 border-amber-500/20' : s.status === 'APPROVED' ? 'bg-emerald-500/10 border-emerald-500/20' : s.status === 'REJECTED' ? 'bg-rose-500/10 border-rose-500/20' : 'bg-[var(--bg-surface-hover)] border-[var(--border-subtle)]'}`}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${s.status === 'PENDING' ? 'bg-amber-500/30 text-amber-400' : s.status === 'APPROVED' ? 'bg-emerald-500/30 text-emerald-400' : s.status === 'REJECTED' ? 'bg-rose-500/30 text-rose-400' : 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'}`}>
                      {s.stepOrder}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className={`text-sm font-semibold truncate ${s.status === 'PENDING' ? 'text-[var(--text-main)]' : 'text-[var(--text-muted)]'}`}>{s.stepName}</p>
                        <span className={`px-2 py-0.5 rounded-full text-xs border flex-shrink-0 ${STATUS_STYLES[s.status] ?? STATUS_STYLES.WAITING}`}>{s.status}</span>
                      </div>
                      {s.approverEmails && s.approverEmails.length > 1 ? (
                        // Each approver of the level, ticked once they have decided.
                        <p className="text-xs text-[var(--text-faint)] mt-0.5">
                          {s.requireAllApprovers ? 'All of: ' : 'Any of: '}
                          {s.approverEmails.map((e, i) => {
                            const d = s.approvals?.find(a => a.email.toLowerCase() === e.toLowerCase());
                            return <span key={e}>{i > 0 && ', '}{e}{d ? (d.action === 'APPROVE' ? ' ✓' : ' ✗') : ''}</span>;
                          })}
                        </p>
                      ) : s.assignedToEmail && <p className="text-xs text-[var(--text-faint)] mt-0.5">{s.assignedToEmail}</p>}
                      {s.actionedAt && <p className="text-xs text-[var(--text-faint)] mt-0.5">{fmt(s.actionedAt)} by {s.actionedByEmail}</p>}
                      {s.comments && <p className="text-xs text-[var(--text-muted)] mt-1 italic">&#34;{s.comments}&#34;</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action */}
          <div className="border-t border-[var(--border-subtle)] pt-4 space-y-3">
            <p className="text-xs font-semibold text-[var(--text-faint)] uppercase tracking-wider">Your Decision</p>
            {!canDecideHere ? (
              <p className="text-sm text-[var(--text-muted)]">
                This was escalated to you as the escalation contact. Follow it up with its approvers; a tenant administrator can also decide it from All pending.
              </p>
            ) : (
              <>
                {viewMode === 'all' && (
                  <p className="text-xs text-[var(--text-faint)]">
                    Only this step&apos;s approver or a tenant administrator can approve or reject it.
                  </p>
                )}
                <textarea value={actionComments} onChange={e => setActionComments(e.target.value)}
                  rows={3} placeholder="Add comments (required for rejection, optional for approval)..."
                  className="w-full px-3 py-2.5 bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-main)] placeholder-[var(--text-faint)] text-sm focus:outline-none focus:border-violet-500/50 resize-none" />
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
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
}
