'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock3, Eye, GitCompare, PlayCircle, RefreshCw, Save, ShieldCheck, SlidersHorizontal, X, XCircle } from 'lucide-react';
import { emitAdminNotificationRefresh } from '@/components/admin/admin-notification-realtime';

type ApprovalRisk = 'low' | 'medium' | 'high' | 'critical';
type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

interface ApprovalGovernance {
  risk: ApprovalRisk;
  template: string;
  templateLabel?: string;
  impact: string[];
  payloadKeys: string[];
  payloadPreview: string | null;
  beforeAfter?: { before: unknown | null; after: unknown | null; summary: string[] };
  quorum?: { requiredApprovals: number; conflictChecks: string[] };
  conflicts?: Array<{ code: string; message: string; severity: 'info' | 'warning' | 'blocker' }>;
  sla?: { dueHours: number; escalationHours: number; dueAt: string; escalationAt: string; status: 'on_track' | 'due_soon' | 'overdue' | 'escalated' };
}

interface ApprovalRow {
  id: string;
  tenant_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  summary: string | null;
  status: ApprovalStatus;
  required_approvals: number;
  requested_by: string;
  requested_by_email: string | null;
  requested_role: string | null;
  approvals: number;
  rejections: number;
  actor_decision?: 'APPROVE' | 'REJECT' | null;
  is_requester?: boolean;
  execution_status?: string | null;
  executed_at?: string | null;
  governance?: ApprovalGovernance;
}

interface ApprovalTemplate {
  id: string;
  label: string;
  matchActions: string[];
  risk: ApprovalRisk;
  requiredApprovals: number;
  dueHours: number;
  escalationHours: number;
  notificationChannels: string[];
  isEnabled: boolean;
}

function isExecutableApproval(row: ApprovalRow): boolean {
  if (row.execution_status === 'EXECUTED') return false;
  return row.action.startsWith('leasing.')
    || row.action === 'workflow.create'
    || row.action === 'workflow.delete'
    || row.action === 'service_config.category.create'
    || row.action === 'service_config.type.create';
}

export default function AdminApprovalsPage() {
  const [tab, setTab] = useState<'queue' | 'templates'>('queue');
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [templates, setTemplates] = useState<ApprovalTemplate[]>([]);
  const [status, setStatus] = useState('PENDING');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [selected, setSelected] = useState<ApprovalRow | null>(null);

  const syncRow = useCallback((updater: (row: ApprovalRow) => ApprovalRow) => {
    setRows(prev => prev.map(row => updater(row)));
    setSelected(prev => prev ? updater(prev) : prev);
  }, []);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    try {
      if (tab === 'templates') {
        const res = await fetch('/api/admin/approvals/templates');
        const data = await res.json();
        setTemplates(Array.isArray(data.templates) ? data.templates : []);
      } else {
        const qs = status ? `?status=${status}` : '';
        const res = await fetch(`/api/admin/approvals${qs}`);
        const data = await res.json();
        const nextRows = Array.isArray(data.approvals) ? data.approvals as ApprovalRow[] : [];
        setRows(nextRows);
        setSelected(prev => prev ? nextRows.find(row => row.id === prev.id) ?? prev : prev);
      }
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [status, tab]);

  useEffect(() => { void load(); }, [load]);

  const vote = async (id: string, decision: 'APPROVE' | 'REJECT') => {
    setBusy(id); setMsg('');
    try {
      const res = await fetch(`/api/admin/approvals/${id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json().catch(() => ({}));
      const fallback = res.ok
        ? `Request ${String(data.status ?? '').toLowerCase()}.`
        : `Vote failed (${res.status})`;
      setMsg(String(data.message ?? data.error ?? fallback));
      if (res.ok) {
        const actorDecision = (data.actorDecision ?? decision) as 'APPROVE' | 'REJECT';
        if (data.execution?.ok) {
          emitAdminNotificationRefresh(`approval-executed:${String(data.execution.action ?? id)}`);
        } else if (String(data.status ?? '') === 'APPROVED' || String(data.status ?? '') === 'REJECTED') {
          emitAdminNotificationRefresh(`approval-status:${id}`);
        }
        setRows(prev => {
          const nextRows = prev.map(row => {
            if (row.id !== id) return row;
            const nextStatus = String(data.status ?? row.status).toUpperCase() as ApprovalStatus;
            return {
              ...row,
              status: nextStatus,
              approvals: typeof data.approvals === 'number' ? data.approvals : row.approvals,
              rejections: typeof data.rejections === 'number' ? data.rejections : row.rejections,
              required_approvals: typeof data.requiredApprovals === 'number' ? data.requiredApprovals : row.required_approvals,
              actor_decision: actorDecision,
              execution_status: typeof data.execution?.ok === 'boolean' && data.execution.ok ? 'EXECUTED' : row.execution_status,
              executed_at: typeof data.execution?.ok === 'boolean' && data.execution.ok ? new Date().toISOString() : row.executed_at,
            };
          });
          setSelected(prevSelected => {
            if (!prevSelected || prevSelected.id !== id) return prevSelected;
            const updated = nextRows.find(row => row.id === id);
            return updated ?? prevSelected;
          });
          if (status === 'PENDING') {
            return nextRows.filter(row => row.status === 'PENDING');
          }
          return nextRows;
        });
        void load({ silent: true });
      }
    } catch (error) {
      setMsg(error instanceof Error ? error.message : 'Vote failed');
    } finally {
      setBusy(null);
    }
  };

  const execute = async (id: string) => {
    setBusy(id); setMsg('');
    try {
      const res = await fetch(`/api/admin/approvals/${id}/execute`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      const alreadyExecuted = res.status === 409 && String(data.error ?? '').toLowerCase().includes('already executed');
      setMsg(
        res.ok
          ? `Executed ${data.action ?? 'approved action'} for ${data.entityType ?? 'entity'} ${data.entityId ?? ''}`.trim()
          : alreadyExecuted
            ? 'This approval was already executed. The queue has been refreshed.'
            : data.error ?? 'Execution failed',
      );
      if (res.ok || alreadyExecuted) {
        emitAdminNotificationRefresh(`approval-manual-execute:${id}`);
        const executedAt = new Date().toISOString();
        syncRow(row => row.id === id
          ? { ...row, execution_status: 'EXECUTED', executed_at: executedAt }
          : row);
        void load({ silent: true });
      }
    } finally {
      setBusy(null);
    }
  };

  const updateTemplate = (id: string, patch: Partial<ApprovalTemplate>) => {
    setTemplates(prev => prev.map(template => template.id === id ? { ...template, ...patch } : template));
  };

  const saveTemplate = async (template: ApprovalTemplate) => {
    setBusy(template.id); setMsg('');
    try {
      const res = await fetch('/api/admin/approvals/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(template),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error ?? 'Template save failed');
        return;
      }
      setTemplates(prev => prev.map(item => item.id === template.id ? data.template : item));
      setMsg(`Saved ${data.template?.label ?? template.label}.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Admin Approvals</h1>
          <p className="text-sm text-slate-400 mt-1">Multi-actor queue, policy templates, SLA escalation, and dangerous-change review.</p>
        </div>
        <button onClick={() => void load()} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm text-white">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <TabButton active={tab === 'queue'} onClick={() => setTab('queue')} icon={<ShieldCheck className="w-4 h-4" />} label="Approval Queue" />
        <TabButton active={tab === 'templates'} onClick={() => setTab('templates')} icon={<SlidersHorizontal className="w-4 h-4" />} label="Policy Templates" />
      </div>

      {tab === 'queue' && (
        <div className="flex items-center gap-2">
          {['PENDING', 'APPROVED', 'REJECTED', ''].map(option => (
            <button key={option || 'ALL'} onClick={() => setStatus(option)}
              className={`px-4 py-2 rounded-xl text-sm border ${status === option ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-900 border-white/10 text-slate-300 hover:bg-slate-800'}`}>
              {option || 'ALL'}
            </button>
          ))}
        </div>
      )}

      {msg && <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-200">{msg}</div>}

      {tab === 'templates' ? (
        <TemplateGrid templates={templates} busy={busy} onChange={updateTemplate} onSave={saveTemplate} loading={loading} />
      ) : (
        <ApprovalQueue rows={rows} busy={busy} loading={loading} onView={setSelected} onVote={vote} onExecute={execute} />
      )}
      {selected && <ApprovalDetailDrawer row={selected} busy={busy} onClose={() => setSelected(null)} onVote={vote} onExecute={execute} />}
    </div>
  );
}

function ApprovalQueue({ rows, busy, loading, onView, onVote, onExecute }: {
  rows: ApprovalRow[];
  busy: string | null;
  loading: boolean;
  onView: (row: ApprovalRow) => void;
  onVote: (id: string, decision: 'APPROVE' | 'REJECT') => void;
  onExecute: (id: string) => void;
}) {
  return (
    <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-950/70 text-slate-400">
            <tr>
              <th className="text-left px-5 py-3">Action</th>
              <th className="text-left px-5 py-3">Risk / Impact</th>
              <th className="text-left px-5 py-3">Requested By</th>
              <th className="text-left px-5 py-3">Target</th>
              <th className="text-left px-5 py-3">Votes</th>
              <th className="text-left px-5 py-3">Status</th>
              <th className="text-right px-5 py-3">Decision</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
                <tr key={row.id} className="border-t border-white/5 align-top">
                  <td className="px-5 py-4">
                    <button onClick={() => onView(row)} className="font-semibold text-white text-left hover:text-blue-200">{row.action}</button>
                    <div className="text-xs text-slate-400 mt-1 max-w-xl">{row.summary ?? '-'}</div>
                    <div className="font-mono text-[11px] text-slate-600 mt-2">{row.id}</div>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs border ${riskClass(row.governance?.risk ?? 'low')}`}>{(row.governance?.risk ?? 'low').toUpperCase()}</span>
                    <div className="mt-2 text-xs text-slate-400">{row.governance?.templateLabel ?? formatTemplate(row.governance?.template)}</div>
                    <div className="mt-2 flex flex-wrap gap-1 max-w-xs">
                      {(row.governance?.impact ?? []).map(label => <span key={label} className="px-2 py-0.5 rounded-full bg-slate-800 text-[11px] text-slate-300 border border-white/10">{label}</span>)}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="text-slate-300">{row.requested_by_email ?? row.requested_by}</div>
                    <div className="text-xs text-slate-500">{row.requested_role ?? '-'}</div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="text-slate-300">{row.target_type ?? '-'}</div>
                    <div className="font-mono text-xs text-slate-500">{row.target_id ?? row.tenant_id ?? '-'}</div>
                  </td>
                  <td className="px-5 py-4 text-slate-300">
                    <div>{row.approvals}/{row.required_approvals}</div>
                    <div className="mt-1 text-xs text-slate-500">{formatSla(row.governance?.sla)}</div>
                    {row.rejections > 0 && <span className="ml-2 text-rose-300">{row.rejections} rejected</span>}
                    {row.actor_decision && <div className="mt-1 text-xs text-blue-300">Your vote: {row.actor_decision.toLowerCase()}</div>}
                  </td>
                  <td className="px-5 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs border ${statusClass(row.status)}`}>{row.status}</span>
                    {row.execution_status && <div className="mt-2 text-xs text-emerald-300">{row.execution_status} {formatDateTime(row.executed_at)}</div>}
                  </td>
                  <td className="px-5 py-4">
                    <div className="space-y-2">
                      <div className="flex justify-end">
                        <button onClick={() => onView(row)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/10 bg-slate-800 hover:bg-slate-700 text-white">
                          <Eye className="w-4 h-4" /> View
                        </button>
                      </div>
                    {row.status === 'PENDING' ? (
                      <div className="space-y-2">
                        {row.is_requester && (
                          <div className="text-right text-xs text-amber-300 max-w-xs">
                            You requested this change. Another approver must decide it.
                          </div>
                        )}
                        <div className="flex justify-end gap-2">
                          <button disabled={busy === row.id} onClick={() => onVote(row.id, 'APPROVE')} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white">
                            <CheckCircle2 className="w-4 h-4" /> Approve
                          </button>
                          <button disabled={busy === row.id} onClick={() => onVote(row.id, 'REJECT')} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white">
                            <XCircle className="w-4 h-4" /> Reject
                          </button>
                        </div>
                      </div>
                    ) : row.status === 'APPROVED' && isExecutableApproval(row) ? (
                      <div className="flex justify-end">
                        <button disabled={busy === row.id} onClick={() => onExecute(row.id)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white">
                          <PlayCircle className="w-4 h-4" /> Execute
                        </button>
                      </div>
                    ) : (
                      <div className={`text-right ${row.execution_status === 'EXECUTED' ? 'text-emerald-300' : 'text-slate-500'}`}>
                        {row.execution_status === 'EXECUTED' ? 'Executed' : 'Closed'}
                      </div>
                    )}
                    </div>
                  </td>
                </tr>
            ))}
            {!loading && rows.length === 0 && <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-500">No approval requests in this view.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ApprovalDetailDrawer({ row, busy, onClose, onVote, onExecute }: {
  row: ApprovalRow;
  busy: string | null;
  onClose: () => void;
  onVote: (id: string, decision: 'APPROVE' | 'REJECT') => void;
  onExecute: (id: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-5xl flex-col border-l border-white/10 bg-slate-900 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-white">Approval Review</h2>
              <span className={`px-2 py-1 rounded-full text-xs border ${statusClass(row.status)}`}>{row.status}</span>
              <span className={`px-2 py-1 rounded-full text-xs border ${riskClass(row.governance?.risk ?? 'low')}`}>{(row.governance?.risk ?? 'low').toUpperCase()}</span>
            </div>
            <div className="mt-1 text-sm text-slate-300">{row.summary ?? row.action}</div>
            <div className="mt-1 font-mono text-xs text-slate-500">{row.id}</div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_1fr]">
            <div className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-slate-950/50 p-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500">
                  <ShieldCheck className="w-3.5 h-3.5" /> Request Summary
                </div>
                <div className="mt-3 space-y-3 text-sm">
                  <MetaRow label="Action" value={row.action} mono />
                  <MetaRow label="Requested by" value={row.requested_by_email ?? row.requested_by} />
                  <MetaRow label="Role" value={row.requested_role ?? '-'} />
                  <MetaRow label="Target type" value={row.target_type ?? '-'} />
                  <MetaRow label="Target id" value={row.target_id ?? row.tenant_id ?? '-'} mono />
                  <MetaRow label="Your vote" value={row.actor_decision?.toLowerCase() ?? 'Not voted'} />
                  <MetaRow label="Votes" value={`${row.approvals}/${row.required_approvals}${row.rejections ? `, ${row.rejections} rejected` : ''}`} />
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/50 p-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500">
                  <Clock3 className="w-3.5 h-3.5" /> Policy & SLA
                </div>
                <ul className="mt-3 space-y-1 text-xs text-slate-300">
                  <li>{row.governance?.templateLabel ?? formatTemplate(row.governance?.template)}.</li>
                  <li>{row.governance?.quorum?.requiredApprovals ?? row.required_approvals} distinct non-requester approvals required.</li>
                  <li>Tenant boundary: {row.tenant_id ? 'tenant scoped' : 'platform scoped'}.</li>
                  {(row.governance?.quorum?.conflictChecks ?? []).map(check => <li key={check}>{formatCheck(check)}.</li>)}
                </ul>
                <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
                  <div>Status: <span className={slaTextClass(row.governance?.sla?.status)}>{formatSlaStatus(row.governance?.sla?.status)}</span></div>
                  <div className="mt-1">Escalates: {formatDateTime(row.governance?.sla?.escalationAt)}</div>
                  <div>Due: {formatDateTime(row.governance?.sla?.dueAt)}</div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {(row.governance?.impact ?? []).map(label => <span key={label} className="px-2 py-0.5 rounded-full bg-slate-800 text-[11px] text-slate-300 border border-white/10">{label}</span>)}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/50 p-4">
                <div className="text-xs uppercase tracking-wider text-slate-500">Decision</div>
                {row.is_requester && (
                  <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    You requested this change. Another approver must decide it.
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {row.status === 'PENDING' && (
                    <>
                      <button disabled={busy === row.id} onClick={() => onVote(row.id, 'APPROVE')} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white">
                        <CheckCircle2 className="w-4 h-4" /> Approve
                      </button>
                      <button disabled={busy === row.id} onClick={() => onVote(row.id, 'REJECT')} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white">
                        <XCircle className="w-4 h-4" /> Reject
                      </button>
                    </>
                  )}
                  {row.status === 'APPROVED' && isExecutableApproval(row) && (
                    <button disabled={busy === row.id} onClick={() => onExecute(row.id)} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white">
                      <PlayCircle className="w-4 h-4" /> Execute
                    </button>
                  )}
                  {row.execution_status === 'EXECUTED' && (
                    <div className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-200">
                      <CheckCircle2 className="w-4 h-4" /> Executed
                    </div>
                  )}
                  <button onClick={onClose} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-white/10 bg-slate-800 hover:bg-slate-700 text-white">
                    Close
                  </button>
                </div>
              </div>
            </div>
            <div className="space-y-4 min-w-0">
              <div className="rounded-xl border border-white/10 bg-slate-950/50 p-4 min-w-0">
                <div className="flex items-center gap-2 mb-3">
                  <GitCompare className="w-4 h-4 text-slate-500" />
                  <div className="text-xs uppercase tracking-wider text-slate-500">Dangerous-change review</div>
                  {(row.governance?.payloadKeys ?? []).map(k => <span key={k} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">{k}</span>)}
                </div>
                {(row.governance?.beforeAfter?.summary?.length ?? 0) > 0 && (
                  <Notice tone="amber" title="Detected before/after impact" items={row.governance?.beforeAfter?.summary ?? []} />
                )}
                {(row.governance?.conflicts?.length ?? 0) > 0 && (
                  <Notice tone="orange" title="Conflict and reviewer warnings" items={(row.governance?.conflicts ?? []).map(item => item.message)} />
                )}
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  <JsonPanel title="Before" value={row.governance?.beforeAfter?.before} />
                  <JsonPanel title="After" value={row.governance?.beforeAfter?.after} />
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/50 p-4">
                <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Payload Preview</div>
                <pre className="max-h-[26rem] overflow-auto rounded-lg bg-black/40 p-3 text-[11px] text-slate-300 whitespace-pre-wrap">
                  {row.governance?.payloadPreview ?? 'No payload was captured for this approval.'}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="border-b border-white/5 pb-2">
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-slate-200 ${mono ? 'font-mono text-xs break-all' : 'text-sm'}`}>{value}</div>
    </div>
  );
}

function TemplateGrid({ templates, busy, loading, onChange, onSave }: {
  templates: ApprovalTemplate[];
  busy: string | null;
  loading: boolean;
  onChange: (id: string, patch: Partial<ApprovalTemplate>) => void;
  onSave: (template: ApprovalTemplate) => void;
}) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {templates.map(template => (
        <div key={template.id} className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-white">{template.label}</div>
              <div className="mt-1 font-mono text-[11px] text-slate-500">{template.id}</div>
            </div>
            <span className={`px-2 py-1 rounded-full text-xs border ${riskClass(template.risk)}`}>{template.risk.toUpperCase()}</span>
          </div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <TextField label="Label" value={template.label} onChange={value => onChange(template.id, { label: value })} />
            <SelectField label="Risk" value={template.risk} options={['low', 'medium', 'high', 'critical']} onChange={value => onChange(template.id, { risk: value as ApprovalRisk })} />
            <NumberField label="Approvals" value={template.requiredApprovals} min={1} max={10} onChange={value => onChange(template.id, { requiredApprovals: value })} />
            <NumberField label="SLA hours" value={template.dueHours} min={1} max={720} onChange={value => onChange(template.id, { dueHours: value })} />
            <NumberField label="Escalation hours" value={template.escalationHours} min={1} max={720} onChange={value => onChange(template.id, { escalationHours: value })} />
            <TextField label="Action matches" value={template.matchActions.join(', ')} onChange={value => onChange(template.id, { matchActions: splitCsv(value) })} />
            <div className="md:col-span-2">
              <TextField label="Notification channels" value={template.notificationChannels.join(', ')} onChange={value => onChange(template.id, { notificationChannels: splitCsv(value) })} />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <label className="inline-flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={template.isEnabled} onChange={event => onChange(template.id, { isEnabled: event.target.checked })} />
              Enabled
            </label>
            <button disabled={busy === template.id} onClick={() => onSave(template)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm text-white">
              <Save className="w-4 h-4" /> Save
            </button>
          </div>
        </div>
      ))}
      {!loading && templates.length === 0 && <div className="rounded-2xl border border-white/10 bg-slate-900/60 px-5 py-10 text-center text-slate-500">No approval templates found.</div>}
    </div>
  );
}

function TabButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm border ${active ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-900 border-white/10 text-slate-300 hover:bg-slate-800'}`}>
      {icon} {label}
    </button>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1 block">
      <span className="text-xs uppercase tracking-wider text-slate-500">{label}</span>
      <input value={value} onChange={event => onChange(event.target.value)} className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" />
    </label>
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="space-y-1 block">
      <span className="text-xs uppercase tracking-wider text-slate-500">{label}</span>
      <input type="number" min={min} max={max} value={value} onChange={event => onChange(Number(event.target.value))} className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" />
    </label>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1 block">
      <span className="text-xs uppercase tracking-wider text-slate-500">{label}</span>
      <select value={value} onChange={event => onChange(event.target.value)} className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white">
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function Notice({ tone, title, items }: { tone: 'amber' | 'orange'; title: string; items: string[] }) {
  const styles = tone === 'amber'
    ? 'border-amber-500/20 bg-amber-500/10 text-amber-50/80'
    : 'border-orange-500/20 bg-orange-500/10 text-orange-50/80';
  return (
    <div className={`mb-3 rounded-lg border p-3 ${styles}`}>
      <div className="text-xs font-semibold">{title}</div>
      <ul className="mt-1 space-y-1 text-xs">
        {items.map(item => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

function JsonPanel({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/25 p-3 min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{title}</div>
      <pre className="mt-2 max-h-44 overflow-auto text-[11px] text-slate-300 whitespace-pre-wrap">
        {value == null ? 'Not captured' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function splitCsv(value: string) {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function riskClass(risk: ApprovalRisk) {
  if (risk === 'critical') return 'bg-rose-500/20 text-rose-200 border-rose-500/30';
  if (risk === 'high') return 'bg-orange-500/20 text-orange-200 border-orange-500/30';
  if (risk === 'medium') return 'bg-amber-500/20 text-amber-200 border-amber-500/30';
  return 'bg-blue-500/20 text-blue-200 border-blue-500/30';
}

function statusClass(status: ApprovalStatus) {
  if (status === 'APPROVED') return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
  if (status === 'REJECTED') return 'bg-rose-500/20 text-rose-300 border-rose-500/30';
  if (status === 'PENDING') return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
  return 'bg-slate-700 text-slate-300 border-slate-600';
}

function formatTemplate(template?: string) {
  if (!template) return 'Standard admin change';
  return template.split('-').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function formatCheck(check: string) {
  return check.split('_').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function formatSla(sla?: ApprovalGovernance['sla']) {
  if (!sla) return 'SLA unavailable';
  return `${formatSlaStatus(sla.status)} - due ${formatDateTime(sla.dueAt)}`;
}

type ApprovalSlaStatus = NonNullable<ApprovalGovernance['sla']>['status'];

function formatSlaStatus(status?: ApprovalSlaStatus) {
  if (!status) return 'Unknown';
  return status.split('_').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function slaTextClass(status?: ApprovalSlaStatus) {
  if (status === 'overdue') return 'text-rose-300';
  if (status === 'escalated') return 'text-orange-300';
  if (status === 'due_soon') return 'text-amber-300';
  return 'text-emerald-300';
}
