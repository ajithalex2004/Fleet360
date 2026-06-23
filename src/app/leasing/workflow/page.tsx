'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Eye,
  Filter,
  ShieldCheck,
  TimerReset,
  XCircle,
} from 'lucide-react';

type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED' | string;
type EntityType = 'QUOTATION' | 'CONTRACT' | 'PRE_BILLING' | 'INVOICE' | string;
type SlaTone = 'on_track' | 'due_soon' | 'overdue' | 'escalated';

interface ApprovalStep {
  id: string;
  entityType: EntityType;
  entityId: string;
  stepName: string;
  stepOrder: number;
  approverRole?: string | null;
  approverName?: string | null;
  status?: ApprovalStatus | null;
  actionAt?: string | null;
  comments?: string | null;
  createdAt?: string | null;
  assignedToEmail?: string | null;
  delegatedFromRole?: string | null;
  dueAt?: string | null;
  escalationAt?: string | null;
  serviceTypeKey?: string | null;
  runtimeActionId?: string | null;
}

interface ActionStepSummary {
  id: string;
  stepName: string;
  stepOrder: number;
  status: ApprovalStatus;
  approverRole: string | null;
  approverName: string | null;
  assignedToEmail: string | null;
  delegatedFromRole: string | null;
  dueAt: string | null;
  escalationAt: string | null;
  actionAt: string | null;
  comments: string | null;
}

interface RuntimeApprovalAction {
  id: string;
  runtimeActionId: string | null;
  entityType: EntityType;
  entityId: string;
  serviceTypeKey: string | null;
  title: string;
  entityLabel: string;
  href: string;
  createdAt: string | null;
  currentStep: ActionStepSummary | null;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  steps: ActionStepSummary[];
  slaTone: SlaTone;
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-AE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function elapsedLabel(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const diffHours = Math.max(0, Math.floor((Date.now() - date.getTime()) / 3600000));
  if (diffHours < 1) return 'Less than 1h';
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ${diffHours % 24}h`;
}

function statusBadge(status?: ApprovalStatus | null) {
  switch ((status ?? 'PENDING').toUpperCase()) {
    case 'APPROVED':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25';
    case 'REJECTED':
      return 'bg-rose-500/15 text-rose-300 border-rose-500/25';
    case 'SKIPPED':
      return 'bg-slate-500/15 text-slate-300 border-slate-500/25';
    default:
      return 'bg-amber-500/15 text-amber-300 border-amber-500/25';
  }
}

function slaBadge(tone: SlaTone) {
  switch (tone) {
    case 'overdue':
      return 'bg-rose-500/15 text-rose-300 border-rose-500/25';
    case 'escalated':
      return 'bg-orange-500/15 text-orange-300 border-orange-500/25';
    case 'due_soon':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/25';
    default:
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25';
  }
}

function labelize(value?: string | null) {
  if (!value) return 'Unspecified';
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function entityPrefix(entityType: EntityType) {
  switch (entityType) {
    case 'QUOTATION': return 'QUO';
    case 'CONTRACT': return 'CNT';
    case 'PRE_BILLING': return 'PBS';
    case 'INVOICE': return 'INV';
    default: return entityType.slice(0, 3).toUpperCase();
  }
}

function entityHref(entityType: EntityType, entityId: string) {
  switch (entityType) {
    case 'QUOTATION': return `/leasing/quotations/${entityId}`;
    case 'CONTRACT': return `/leasing/contracts-v2/${entityId}`;
    case 'PRE_BILLING': return '/leasing/pre-billing';
    case 'INVOICE': return '/finance/leasing-billing';
    default: return '/leasing/workflow';
  }
}

function inferSlaTone(step: ApprovalStep | ActionStepSummary | null): SlaTone {
  if (!step) return 'on_track';
  const now = Date.now();
  const escalationAt = step.escalationAt ? new Date(step.escalationAt).getTime() : null;
  const dueAt = step.dueAt ? new Date(step.dueAt).getTime() : null;
  if (escalationAt && now >= escalationAt) return 'escalated';
  if (dueAt && now >= dueAt) return 'overdue';
  if (dueAt && dueAt - now <= 4 * 3600000) return 'due_soon';
  return 'on_track';
}

function buildActionId(step: ApprovalStep) {
  return step.runtimeActionId ?? `${step.entityType}:${step.entityId}:${step.serviceTypeKey ?? 'GENERAL'}`;
}

function buildActionTitle(serviceTypeKey: string | null, currentStep: ApprovalStep | ActionStepSummary | null) {
  if (serviceTypeKey) return labelize(serviceTypeKey.replace(/^LEASING_/, ''));
  return currentStep?.stepName ?? 'Approval Action';
}

function buildEntityLabel(step: ApprovalStep) {
  return `${entityPrefix(step.entityType)}-${step.entityId.slice(0, 8)}`;
}

export default function WorkflowPage() {
  const [steps, setSteps] = useState<ApprovalStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'inbox' | 'history' | 'sla'>('inbox');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [comments, setComments] = useState('');
  const [serviceFilter, setServiceFilter] = useState('ALL');
  const [slaFilter, setSlaFilter] = useState<'ALL' | SlaTone>('ALL');

  const loadSteps = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/leasing/approval-steps');
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(data.error ?? 'Failed to load approval steps');
      setSteps(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workflow');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSteps();
  }, [loadSteps]);

  const actions = useMemo<RuntimeApprovalAction[]>(() => {
    const grouped = new Map<string, ApprovalStep[]>();
    steps.forEach(step => {
      const key = buildActionId(step);
      const list = grouped.get(key) ?? [];
      list.push(step);
      grouped.set(key, list);
    });

    return Array.from(grouped.entries())
      .map(([id, group]) => {
        const sorted = [...group].sort((a, b) => (a.stepOrder ?? 0) - (b.stepOrder ?? 0));
        const currentStep = sorted.find(step => (step.status ?? 'PENDING') === 'PENDING') ?? sorted[sorted.length - 1] ?? null;
        const pendingCount = sorted.filter(step => (step.status ?? 'PENDING') === 'PENDING').length;
        const approvedCount = sorted.filter(step => (step.status ?? '').toUpperCase() === 'APPROVED').length;
        const rejectedCount = sorted.filter(step => (step.status ?? '').toUpperCase() === 'REJECTED').length;
        const summarySteps: ActionStepSummary[] = sorted.map(step => ({
          id: step.id,
          stepName: step.stepName,
          stepOrder: step.stepOrder,
          status: step.status ?? 'PENDING',
          approverRole: step.approverRole ?? null,
          approverName: step.approverName ?? null,
          assignedToEmail: step.assignedToEmail ?? null,
          delegatedFromRole: step.delegatedFromRole ?? null,
          dueAt: step.dueAt ?? null,
          escalationAt: step.escalationAt ?? null,
          actionAt: step.actionAt ?? null,
          comments: step.comments ?? null,
        }));

        return {
          id,
          runtimeActionId: currentStep?.runtimeActionId ?? null,
          entityType: currentStep?.entityType ?? 'QUOTATION',
          entityId: currentStep?.entityId ?? '',
          serviceTypeKey: currentStep?.serviceTypeKey ?? null,
          title: buildActionTitle(currentStep?.serviceTypeKey ?? null, currentStep ?? null),
          entityLabel: currentStep ? buildEntityLabel(currentStep) : '-',
          href: currentStep ? entityHref(currentStep.entityType, currentStep.entityId) : '/leasing/workflow',
          createdAt: sorted[0]?.createdAt ?? null,
          currentStep: currentStep ? {
            id: currentStep.id,
            stepName: currentStep.stepName,
            stepOrder: currentStep.stepOrder,
            status: currentStep.status ?? 'PENDING',
            approverRole: currentStep.approverRole ?? null,
            approverName: currentStep.approverName ?? null,
            assignedToEmail: currentStep.assignedToEmail ?? null,
            delegatedFromRole: currentStep.delegatedFromRole ?? null,
            dueAt: currentStep.dueAt ?? null,
            escalationAt: currentStep.escalationAt ?? null,
            actionAt: currentStep.actionAt ?? null,
            comments: currentStep.comments ?? null,
          } : null,
          pendingCount,
          approvedCount,
          rejectedCount,
          steps: summarySteps,
          slaTone: inferSlaTone(currentStep),
        };
      })
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      });
  }, [steps]);

  const selectedAction = useMemo(
    () => actions.find(action => action.id === selectedActionId) ?? actions[0] ?? null,
    [actions, selectedActionId],
  );

  useEffect(() => {
    if (!selectedActionId && actions[0]) setSelectedActionId(actions[0].id);
    if (selectedActionId && !actions.find(action => action.id === selectedActionId)) {
      setSelectedActionId(actions[0]?.id ?? null);
    }
  }, [actions, selectedActionId]);

  const serviceOptions = useMemo(
    () => ['ALL', ...Array.from(new Set(actions.map(action => action.serviceTypeKey ?? 'GENERAL')))],
    [actions],
  );

  const filteredInbox = useMemo(() => actions.filter(action => {
    const serviceMatch = serviceFilter === 'ALL' || (action.serviceTypeKey ?? 'GENERAL') === serviceFilter;
    const pendingMatch = action.pendingCount > 0;
    const slaMatch = slaFilter === 'ALL' || action.slaTone === slaFilter;
    return serviceMatch && pendingMatch && slaMatch;
  }), [actions, serviceFilter, slaFilter]);

  const historyItems = useMemo(() => actions.filter(action => action.pendingCount === 0), [actions]);
  const overdueActions = useMemo(
    () => actions.filter(action => action.pendingCount > 0 && (action.slaTone === 'overdue' || action.slaTone === 'escalated')),
    [actions],
  );

  const metrics = useMemo(() => {
    const pending = actions.filter(action => action.pendingCount > 0);
    return {
      inbox: pending.length,
      onTrack: pending.filter(action => action.slaTone === 'on_track').length,
      dueSoon: pending.filter(action => action.slaTone === 'due_soon').length,
      overdue: pending.filter(action => action.slaTone === 'overdue').length,
      escalated: pending.filter(action => action.slaTone === 'escalated').length,
    };
  }, [actions]);

  const handleAction = async (stepId: string, decision: 'APPROVE' | 'REJECT') => {
    setBusyId(stepId);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/leasing/approval-steps', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: stepId,
          action: decision,
          approverName: 'Workflow Manager',
          comments: comments.trim() || (decision === 'APPROVE' ? 'Approved from Leasing approval inbox' : 'Rejected from Leasing approval inbox'),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? `Failed to ${decision.toLowerCase()} step`);
      setComments('');
      setMessage(decision === 'APPROVE' ? 'Approval step approved.' : 'Approval step rejected.');
      await loadSteps();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${decision.toLowerCase()} step`);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading workflow & approvals...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Workflow & Approvals</h1>
          <p className="text-slate-400">Leasing runtime approval inbox, SLA health, and overdue escalation dashboard.</p>
        </div>
        <button
          onClick={() => void loadSteps()}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700"
        >
          <TimerReset className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
      {message && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{message}</div>}

      <div className="grid gap-4 md:grid-cols-5">
        <MetricCard title="Approval Inbox" value={metrics.inbox} tone="blue" icon={<ShieldCheck className="w-4 h-4" />} />
        <MetricCard title="On Track" value={metrics.onTrack} tone="emerald" icon={<CheckCircle2 className="w-4 h-4" />} />
        <MetricCard title="Due Soon" value={metrics.dueSoon} tone="amber" icon={<Clock3 className="w-4 h-4" />} />
        <MetricCard title="Overdue" value={metrics.overdue} tone="rose" icon={<AlertTriangle className="w-4 h-4" />} />
        <MetricCard title="Escalated" value={metrics.escalated} tone="orange" icon={<ArrowRight className="w-4 h-4" />} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ViewButton active={view === 'inbox'} onClick={() => setView('inbox')} label={`Approval Inbox (${metrics.inbox})`} />
        <ViewButton active={view === 'sla'} onClick={() => setView('sla')} label={`SLA Dashboard (${metrics.overdue + metrics.escalated})`} />
        <ViewButton active={view === 'history'} onClick={() => setView('history')} label={`Completed (${historyItems.length})`} />
      </div>

      {view !== 'history' && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/50 p-4">
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <Filter className="w-3.5 h-3.5" />
            Filters
          </div>
          <select
            value={serviceFilter}
            onChange={event => setServiceFilter(event.target.value)}
            className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
          >
            {serviceOptions.map(option => (
              <option key={option} value={option}>{labelize(option === 'GENERAL' ? 'General' : option.replace(/^LEASING_/, ''))}</option>
            ))}
          </select>
          <select
            value={slaFilter}
            onChange={event => setSlaFilter(event.target.value as 'ALL' | SlaTone)}
            className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
          >
            <option value="ALL">All SLA states</option>
            <option value="on_track">On Track</option>
            <option value="due_soon">Due Soon</option>
            <option value="overdue">Overdue</option>
            <option value="escalated">Escalated</option>
          </select>
        </div>
      )}

      {view === 'history' ? (
        <CompletedTable actions={historyItems} />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
          <div className="rounded-2xl border border-white/10 bg-slate-900/55 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">
                  {view === 'sla' ? 'Overdue & escalated approvals' : 'Runtime approval inbox'}
                </p>
                <p className="text-xs text-slate-500">
                  {view === 'sla'
                    ? 'Items that need intervention before they block Leasing operations.'
                    : 'Grouped by live Leasing runtime action, not just loose step rows.'}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {(view === 'sla' ? overdueActions : filteredInbox).map(action => (
                <button
                  key={action.id}
                  onClick={() => setSelectedActionId(action.id)}
                  className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                    selectedAction?.id === action.id
                      ? 'border-violet-500/40 bg-violet-500/10'
                      : 'border-white/10 bg-slate-950/50 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[11px] font-semibold text-blue-200">
                          {labelize((action.serviceTypeKey ?? 'GENERAL').replace(/^LEASING_/, ''))}
                        </span>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${slaBadge(action.slaTone)}`}>
                          {labelize(action.slaTone)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-white">{action.title}</p>
                      <p className="text-xs text-slate-400">{action.entityLabel} · {labelize(action.entityType)}</p>
                    </div>
                    <div className="text-right text-xs text-slate-400">
                      <div>{action.approvedCount}/{action.steps.length} complete</div>
                      <div className="mt-1">{elapsedLabel(action.createdAt)}</div>
                    </div>
                  </div>

                  <div className="mt-3 rounded-xl border border-white/5 bg-black/20 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs text-slate-500">Current step</p>
                        <p className="text-sm text-slate-200">{action.currentStep?.stepName ?? 'Closed'}</p>
                      </div>
                      <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${statusBadge(action.currentStep?.status ?? 'PENDING')}`}>
                        {labelize(action.currentStep?.status ?? 'PENDING')}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-400">
                      <div>Assignee: <span className="text-slate-200">{action.currentStep?.assignedToEmail ?? action.currentStep?.approverRole ?? 'Unassigned'}</span></div>
                      <div>Due: <span className="text-slate-200">{formatDateTime(action.currentStep?.dueAt)}</span></div>
                    </div>
                  </div>
                </button>
              ))}

              {(view === 'sla' ? overdueActions : filteredInbox).length === 0 && (
                <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/30 px-5 py-10 text-center text-sm text-slate-500">
                  {view === 'sla'
                    ? 'No overdue or escalated Leasing runtime approvals right now.'
                    : 'No pending Leasing runtime approvals in this view.'}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/55 p-5">
            {selectedAction ? (
              <ActionDetailPanel
                action={selectedAction}
                comments={comments}
                busyId={busyId}
                onCommentsChange={setComments}
                onApprove={() => selectedAction.currentStep && void handleAction(selectedAction.currentStep.id, 'APPROVE')}
                onReject={() => selectedAction.currentStep && void handleAction(selectedAction.currentStep.id, 'REJECT')}
              />
            ) : (
              <div className="flex min-h-[440px] items-center justify-center text-slate-500">
                Select a Leasing approval item to review details.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ title, value, tone, icon }: { title: string; value: number; tone: 'blue' | 'emerald' | 'amber' | 'rose' | 'orange'; icon: React.ReactNode }) {
  const tones: Record<typeof tone, string> = {
    blue: 'from-blue-600/25 to-indigo-600/15 border-blue-500/20 text-blue-200',
    emerald: 'from-emerald-600/25 to-teal-600/15 border-emerald-500/20 text-emerald-200',
    amber: 'from-amber-600/25 to-orange-600/15 border-amber-500/20 text-amber-200',
    rose: 'from-rose-600/25 to-red-600/15 border-rose-500/20 text-rose-200',
    orange: 'from-orange-600/25 to-amber-600/15 border-orange-500/20 text-orange-200',
  };

  return (
    <div className={`rounded-2xl border bg-gradient-to-br p-4 ${tones[tone]}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-white/80">{title}</p>
        <div className="rounded-xl bg-white/10 p-2 text-white/90">{icon}</div>
      </div>
      <div className="mt-4 text-3xl font-bold text-white">{value}</div>
    </div>
  );
}

function ViewButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? 'border-violet-500/40 bg-violet-500/15 text-white'
          : 'border-white/10 bg-slate-900/50 text-slate-300 hover:bg-slate-800'
      }`}
    >
      {label}
    </button>
  );
}

function ActionDetailPanel({
  action,
  comments,
  busyId,
  onCommentsChange,
  onApprove,
  onReject,
}: {
  action: RuntimeApprovalAction;
  comments: string;
  busyId: string | null;
  onCommentsChange: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const currentStep = action.currentStep;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[11px] font-semibold text-blue-200">
              {labelize((action.serviceTypeKey ?? 'GENERAL').replace(/^LEASING_/, ''))}
            </span>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${slaBadge(action.slaTone)}`}>
              {labelize(action.slaTone)}
            </span>
          </div>
          <h2 className="mt-2 text-2xl font-bold text-white">{action.title}</h2>
          <p className="mt-1 text-sm text-slate-400">{action.entityLabel} · {labelize(action.entityType)}</p>
        </div>
        <Link
          href={action.href}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700"
        >
          <Eye className="w-4 h-4" />
          Open Record
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <InfoCard label="Current step" value={currentStep?.stepName ?? 'Closed'} />
        <InfoCard label="Assigned to" value={currentStep?.assignedToEmail ?? currentStep?.approverRole ?? 'Unassigned'} />
        <InfoCard label="Due by" value={formatDateTime(currentStep?.dueAt)} />
        <InfoCard label="Escalation" value={formatDateTime(currentStep?.escalationAt)} />
      </div>

      {currentStep?.delegatedFromRole && (
        <div className="rounded-xl border border-orange-500/20 bg-orange-500/10 px-4 py-3 text-sm text-orange-100">
          This step was delegated from <strong>{labelize(currentStep.delegatedFromRole)}</strong> because no direct assignee was available or escalation routing was applied.
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Approval sequence</h3>
          <div className="text-xs text-slate-500">{action.approvedCount}/{action.steps.length} completed</div>
        </div>
        <div className="space-y-3">
          {action.steps.map(step => (
            <div key={step.id} className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-white">
                    {step.stepOrder}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{step.stepName}</p>
                    <p className="text-xs text-slate-500">
                      {step.assignedToEmail ?? step.approverRole ?? 'Unassigned'}
                      {step.delegatedFromRole ? ` · delegated from ${labelize(step.delegatedFromRole)}` : ''}
                    </p>
                  </div>
                </div>
                <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${statusBadge(step.status)}`}>
                  {labelize(step.status)}
                </span>
              </div>
              <div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-3">
                <div>Due: <span className="text-slate-200">{formatDateTime(step.dueAt)}</span></div>
                <div>Escalation: <span className="text-slate-200">{formatDateTime(step.escalationAt)}</span></div>
                <div>Actioned: <span className="text-slate-200">{formatDateTime(step.actionAt)}</span></div>
              </div>
              {step.comments && (
                <div className="mt-3 rounded-xl border border-white/5 bg-black/20 px-3 py-2 text-xs italic text-slate-300">
                  "{step.comments}"
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {currentStep && currentStep.status === 'PENDING' ? (
        <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
          <h3 className="text-sm font-semibold text-white">Decision</h3>
          <p className="mt-1 text-xs text-slate-500">Add context for the runtime approval decision. Rejection comments are strongly recommended.</p>
          <textarea
            value={comments}
            onChange={event => onCommentsChange(event.target.value)}
            rows={4}
            placeholder="Why is this approval being accepted or rejected?"
            className="mt-3 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-3 text-sm text-white placeholder:text-slate-500 focus:border-violet-500/40 focus:outline-none"
          />
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={onApprove}
              disabled={busyId === currentStep.id}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              {busyId === currentStep.id ? 'Working...' : 'Approve'}
            </button>
            <button
              onClick={onReject}
              disabled={busyId === currentStep.id}
              className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-50"
            >
              <XCircle className="w-4 h-4" />
              Reject
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          This runtime approval action is no longer pending. Review the step timeline above for the full decision trail.
        </div>
      )}
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-medium text-white">{value}</p>
    </div>
  );
}

function CompletedTable({ actions }: { actions: RuntimeApprovalAction[] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/55 overflow-hidden">
      <div className="border-b border-white/10 px-5 py-4">
        <h3 className="text-sm font-semibold text-white">Completed approval actions</h3>
        <p className="text-xs text-slate-500">Closed Leasing approval chains with their final status and step history.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-950/50 text-slate-400">
            <tr>
              <th className="px-5 py-3 text-left">Service</th>
              <th className="px-5 py-3 text-left">Entity</th>
              <th className="px-5 py-3 text-left">Final Step</th>
              <th className="px-5 py-3 text-left">Completed</th>
              <th className="px-5 py-3 text-left">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {actions.map(action => (
              <tr key={action.id} className="border-t border-white/5">
                <td className="px-5 py-4 text-white">{labelize((action.serviceTypeKey ?? 'GENERAL').replace(/^LEASING_/, ''))}</td>
                <td className="px-5 py-4">
                  <Link href={action.href} className="font-medium text-blue-300 hover:text-blue-200">
                    {action.entityLabel}
                  </Link>
                  <div className="text-xs text-slate-500">{labelize(action.entityType)}</div>
                </td>
                <td className="px-5 py-4 text-slate-200">{action.currentStep?.stepName ?? '-'}</td>
                <td className="px-5 py-4 text-slate-400">{formatDateTime(action.steps[action.steps.length - 1]?.actionAt ?? action.createdAt)}</td>
                <td className="px-5 py-4">
                  <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${statusBadge(action.currentStep?.status ?? 'SKIPPED')}`}>
                    {labelize(action.currentStep?.status ?? 'SKIPPED')}
                  </span>
                </td>
              </tr>
            ))}
            {actions.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-slate-500">No completed Leasing approval chains yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
