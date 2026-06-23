'use client';

/**
 * Tab — Workflow (Phase 2C — Workflow merge).
 *
 * Brings the per-service approval-chain editor into Service Configuration so
 * admins don't need to bounce between /admin/workflows and /admin/service-
 * config. Workflows are filtered by `procedure === serviceType.key` (and
 * `module === category.key` for the create form), which is the convention
 * Phase 2C establishes — until WorkflowDefinition gets its own serviceTypeId
 * column in Phase 2 of the merge plan.
 *
 * What this tab handles inline:
 *   • List the workflows attached to this service (matches by procedure)
 *   • Create / rename / activate / delete a workflow
 *   • View + add / edit / reorder / delete steps with the essential fields
 *     (name, type, assignee — via NotifyPicker — and SLA hours)
 *
 * What it links out for ("Open advanced editor →"):
 *   • Conditional JSON, email subject/body templates, multi-approver lists,
 *     escalation tweaks beyond hours+email — kept on /admin/workflows since
 *     that's an existing 1.2k-line editor and re-implementing it inline
 *     would bloat this tab without a clear win.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, Trash2, ChevronDown, ChevronRight, Save, ExternalLink,
  Workflow as WorkflowIcon, AlertCircle, CheckCircle2, Power,
} from 'lucide-react';
import { emitAdminNotificationRefresh, subscribeAdminNotificationRefresh } from '@/components/admin/admin-notification-realtime';
import type { RuleTabProps } from './shared';
import { Field, NumberInput, TextInput, Section } from './shared';
import { NotifyPicker } from './notify-picker';
import { getPreferredWorkflowProcedure, getWorkflowProcedureCandidates } from '@/lib/service-config/workflow-procedure';

function approvalMessage(body: any): string {
  return `Queued for approval: ${body?.approvalRequest?.id ?? 'pending request'}. Approve it, then retry this change.`;
}

// ── API shapes (mirror /api/admin/workflows responses) ─────────────────────
interface WorkflowDef {
  id: string; name: string; module: string; procedure: string;
  description: string | null; isActive: boolean;
  // Phase 2 columns — present on workflows created post-migration. Legacy
  // rows (created before the merge) have these as null.
  serviceTypeId?: string | null;
  tenantId?:      string | null;
  scopeId?:       string | null;
  stepCount?: number; activeInstances?: number;
}

// Module-level cache for /api/auth/me — same pattern used by NotifyPicker
// and the admin layout. Avoids refetching tenantId on every tab mount.
let _mePromise: Promise<{ tenantId: string } | null> | null = null;
async function loadMe(): Promise<{ tenantId: string } | null> {
  if (!_mePromise) {
    _mePromise = fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null);
  }
  return _mePromise;
}
interface WorkflowStep {
  id: string;
  workflowId: string;
  stepOrder: number;
  stepName: string;
  /** APPROVAL | NOTIFICATION | AUTO_APPROVE */
  stepType: string;
  /** SPECIFIC_USER | ROLE | DIRECT_MANAGER | DEPARTMENT_HEAD | MULTI_USER */
  assigneeType: string;
  assigneeEmail: string | null;
  assigneeRoleCode: string | null;
  multiApproverEmails: string | null;
  requireAllApprovers: boolean;
  emailSubject: string | null;
  emailBody: string | null;
  slaHours: number;
  escalationEmail: string | null;
  escalationHours: number;
  conditionJson: string | null;
  isOptional: boolean;
}

const STEP_TYPES = [
  { value: 'APPROVAL',     label: 'Approval',     hint: 'Requires manual approval before advancing' },
  { value: 'NOTIFICATION', label: 'Notification', hint: 'Sends email and auto-advances' },
  { value: 'AUTO_APPROVE', label: 'Auto-approve', hint: 'Skipped automatically' },
] as const;

// ── Helpers ────────────────────────────────────────────────────────────────
/**
 * Encode the step's assignee fields into the same string format used by
 * NotifyPicker on the SLA / Ticketing tabs:
 *   role:CODE                  → assigneeType=ROLE
 *   email:a@x,b@y              → assigneeType=MULTI_USER (or SPECIFIC_USER if 1)
 *   raw email                  → assigneeType=SPECIFIC_USER
 *   anything else              → assigneeType=SPECIFIC_USER, kept as email
 */
function stepToNotifyValue(s: WorkflowStep): string {
  if (s.assigneeType === 'ROLE' && s.assigneeRoleCode)
    return `role:${s.assigneeRoleCode}`;
  if (s.assigneeType === 'MULTI_USER' && s.multiApproverEmails)
    return `email:${s.multiApproverEmails}`;
  if (s.assigneeType === 'SPECIFIC_USER' && s.assigneeEmail)
    return s.assigneeEmail;
  return '';
}
function notifyValueToStepPatch(value: string): Partial<WorkflowStep> {
  const v = (value ?? '').trim();
  if (v.startsWith('role:')) {
    return {
      assigneeType: 'ROLE',
      assigneeRoleCode: v.slice(5).trim() || null,
      assigneeEmail: null,
      multiApproverEmails: null,
    };
  }
  if (v.startsWith('email:')) {
    const list = v.slice(6).split(',').map(s => s.trim()).filter(Boolean);
    if (list.length > 1) {
      return {
        assigneeType: 'MULTI_USER',
        assigneeRoleCode: null,
        assigneeEmail: null,
        multiApproverEmails: list.join(','),
      };
    }
    return {
      assigneeType: 'SPECIFIC_USER',
      assigneeRoleCode: null,
      assigneeEmail: list[0] ?? null,
      multiApproverEmails: null,
    };
  }
  return {
    assigneeType: 'SPECIFIC_USER',
    assigneeRoleCode: null,
    assigneeEmail: v || null,
    multiApproverEmails: null,
  };
}

// ── Tab ────────────────────────────────────────────────────────────────────
export function WorkflowTab({ typeId, typeKey, typeName, categoryKey }: RuleTabProps) {
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [tenantId, setTenantId]   = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [showNew, setShowNew]     = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!typeKey) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const procedureCandidates = getWorkflowProcedureCandidates(typeKey, typeName);
      const me = await loadMe();
      const tenant = me?.tenantId ?? null;
      setTenantId(tenant);
      const qs = new URLSearchParams({ serviceTypeId: typeId });
      qs.set('lite', '1');
      if (tenant) qs.set('tenantId', tenant);
      const res = await fetch(`/api/admin/workflows?${qs.toString()}`);
      if (!res.ok) throw new Error(`Failed to load workflows (${res.status})`);
      const all: WorkflowDef[] = await res.json();

      // Phase 2 hybrid filter:
      //   • New workflows (post-migration) match by serviceTypeId — exact ID.
      //   • Legacy workflows (serviceTypeId NULL) match by procedure key —
      //     same convention Phase 1 used. They're the global rows that
      //     pre-date the per-tenant scoping; admins can rename / migrate
      //     them via the advanced editor at /admin/workflows.
      setWorkflows(all.filter(w =>
        (w.serviceTypeId && w.serviceTypeId === typeId)
        || (!w.serviceTypeId && procedureCandidates.includes(String(w.procedure ?? '').trim().toUpperCase()))
      ));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [typeId, typeKey, typeName]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    return subscribeAdminNotificationRefresh((detail) => {
      const reason = String(detail?.reason ?? '');
      if (
        reason.startsWith('approval-')
        || reason.startsWith('workflow-')
      ) {
        void load();
      }
    });
  }, [load]);

  if (!typeKey) {
    return (
      <div className="text-sm text-amber-300/80 inline-flex items-center gap-2">
        <AlertCircle className="w-4 h-4" />
        Service type context not available.
      </div>
    );
  }

  if (loading) return <div className="text-sm text-slate-500">Loading workflows…</div>;

  return (
    <div className="space-y-5 max-w-4xl">
      <Section
        title={`Workflows for ${typeName ?? typeKey}`}
        hint="Each workflow is a sequenced approval / notification chain that runs when this service's gating event fires (e.g. ticket submitted, request raised). Filtered by procedure code.">
        {error && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5" /> {error}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-100 px-3 py-1.5 text-xs text-violet-900 shadow-sm transition hover:bg-violet-200">
            <Plus className="w-3.5 h-3.5" /> Create workflow
          </button>
          <a
            href="/admin/workflows"
            target="_blank" rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-violet-700">
            <ExternalLink className="w-3 h-3" /> Open advanced editor
          </a>
        </div>

        {showNew && (
          <NewWorkflowForm
            typeId={typeId}
            typeKey={typeKey}
            typeName={typeName ?? typeKey}
            categoryKey={categoryKey ?? 'CUSTOM'}
            tenantId={tenantId}
            onCancel={() => setShowNew(false)}
            onCreated={() => { setShowNew(false); void load(); }} />
        )}

        {workflows.length === 0 && !showNew && (
          <div className="text-center py-8 text-slate-500 text-sm border border-dashed border-white/10 rounded-xl">
            <WorkflowIcon className="w-7 h-7 mx-auto mb-2 text-slate-600" />
            <p>No workflows attached to this service yet.</p>
            <p className="text-[11px] text-slate-600 mt-1">
              Create one above to define the approval / notification chain that fires on this service's gating event.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {workflows.map(w => (
            <WorkflowRow
              key={w.id}
              workflow={w}
              expanded={expandedId === w.id}
              onToggle={() => setExpandedId(prev => prev === w.id ? null : w.id)}
              onChanged={load} />
          ))}
        </div>
      </Section>

      <p className="text-[11px] text-slate-500 leading-relaxed">
        <strong className="text-slate-400">Phase 2C scope.</strong>{' '}
        Inline editor handles step name, type, assignee, and SLA — the most
        common fields. Conditional rules, email templates, and multi-approver
        nuances live in the advanced editor (now hidden from the sidebar but
        still accessible at <span className="font-mono">/admin/workflows</span>).
      </p>
    </div>
  );
}

// ── New-workflow form ──────────────────────────────────────────────────────
function NewWorkflowForm({
  typeId, typeKey, typeName, categoryKey, tenantId, onCancel, onCreated,
}: {
  typeId: string;
  typeKey: string; typeName: string; categoryKey: string;
  tenantId: string | null;
  onCancel: () => void; onCreated: () => void;
}) {
  const [name, setName]               = useState(`${typeName} — Approval`);
  const [description, setDescription] = useState('');
  const [busy, setBusy]               = useState(false);
  const [err, setErr]                 = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) { setErr('Name is required'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/admin/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          // Legacy keys kept for backward-compat callers (Phase 3 will
          // deprecate them). The canonical link is serviceTypeId/tenantId.
          module: categoryKey,
          procedure: getPreferredWorkflowProcedure(typeKey, typeName),
          description: description.trim() || undefined,
          serviceTypeId: typeId,
          tenantId,                  // null when /api/auth/me is unavailable
          // scopeId stays null = "applies tenant-wide" until a per-scope
          // override is explicitly created.
        }),
      });
      const d = await res.json();
      if (res.status === 428) { emitAdminNotificationRefresh('workflow-create-approval'); setErr(approvalMessage(d)); return; }
      if (!res.ok) { setErr(d?.error ?? 'Create failed'); return; }
      emitAdminNotificationRefresh('workflow-created');
      onCreated();
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2 rounded-xl border border-violet-300 bg-violet-50 p-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Field label="Name" required>
          <TextInput value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Maintenance Request — Approval" />
        </Field>
        <Field label="Procedure / Module" hint="Auto-derived from this service type">
          <div className="text-[11px] text-slate-400 font-mono px-3 py-2 bg-slate-900 rounded-lg border border-white/5">
            {categoryKey} / {typeKey}
          </div>
        </Field>
      </div>
      <Field label="Description (optional)">
        <TextInput value={description} onChange={e => setDescription(e.target.value)} placeholder="What does this workflow do?" />
      </Field>
      {err && <div className="text-[11px] text-rose-300 inline-flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {err}</div>}
      <div className="flex items-center gap-2">
        <button onClick={submit} disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold disabled:opacity-50">
          <Plus className="w-3.5 h-3.5" /> {busy ? 'Creating…' : 'Create'}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 text-slate-400 hover:text-white text-xs">Cancel</button>
      </div>
    </div>
  );
}

// ── Workflow row (collapsible, with steps editor) ──────────────────────────
function WorkflowRow({ workflow, expanded, onToggle, onChanged }: {
  workflow: WorkflowDef;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName]         = useState(workflow.name);
  const [busy, setBusy]         = useState(false);
  const [msg, setMsg]           = useState<string | null>(null);

  // Keep local name in sync if the prop refreshes after a save elsewhere.
  useEffect(() => { setName(workflow.name); }, [workflow.name]);

  const update = async (patch: Partial<WorkflowDef>) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/workflows/${workflow.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 428) { emitAdminNotificationRefresh('workflow-update-approval'); setMsg(approvalMessage(d)); return; }
      if (!res.ok) { setMsg(d?.error ?? 'Update failed'); return; }
      emitAdminNotificationRefresh('workflow-updated');
      onChanged();
    } finally { setBusy(false); }
  };

  const saveName = async () => {
    if (!name.trim() || name === workflow.name) { setRenaming(false); return; }
    await update({ name: name.trim() });
    setRenaming(false);
  };

  const remove = async () => {
    if (workflow.activeInstances && workflow.activeInstances > 0) {
      if (!window.confirm(`This workflow has ${workflow.activeInstances} active instance(s). Delete anyway?`)) return;
    } else if (!window.confirm(`Delete "${workflow.name}"?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/workflows/${workflow.id}`, {
        method: 'DELETE',
        headers: { 'x-admin-confirm-action': 'workflow.delete' },
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 428) { emitAdminNotificationRefresh('workflow-delete-approval'); setMsg(approvalMessage(d)); return; }
      if (!res.ok) { setMsg(d?.error ?? 'Delete failed'); return; }
      emitAdminNotificationRefresh('workflow-deleted');
      onChanged();
    } finally { setBusy(false); }
  };

  return (
    <div className={`bg-slate-800/40 border rounded-xl overflow-hidden transition-colors ${
      expanded ? 'border-violet-300 shadow-sm' : 'border-white/10'
    }`}>
      <div className="flex items-center gap-2 p-3">
        <button type="button" onClick={onToggle}
          className="text-slate-400 hover:text-white p-1 rounded">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        {renaming ? (
          <input
            value={name}
            autoFocus
            onChange={e => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setName(workflow.name); setRenaming(false); } }}
            className="flex-1 rounded border border-violet-300 bg-white px-2 py-1 text-sm text-slate-900 focus:outline-none" />
        ) : (
          <button type="button" onClick={() => setRenaming(true)}
            className="flex-1 truncate text-left text-sm text-slate-900 hover:text-violet-700">
            {workflow.name}
          </button>
        )}

        <span className="text-[10px] font-mono text-slate-500">
          {workflow.module}/{workflow.procedure}
        </span>

        {typeof workflow.stepCount === 'number' && (
          <span className="text-[10px] text-slate-400 px-1.5 py-0.5 rounded bg-slate-900/60 border border-white/5">
            {workflow.stepCount} step{workflow.stepCount === 1 ? '' : 's'}
          </span>
        )}

        <button
          type="button"
          onClick={() => update({ isActive: !workflow.isActive })}
          disabled={busy}
          title={workflow.isActive ? 'Active — click to deactivate' : 'Inactive — click to activate'}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold border ${
            workflow.isActive
              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
              : 'bg-slate-700/40 text-slate-400 border-white/10'
          }`}>
          <Power className="w-3 h-3" /> {workflow.isActive ? 'Active' : 'Inactive'}
        </button>

        <button type="button" onClick={remove} disabled={busy}
          className="p-1.5 text-rose-300 hover:bg-rose-500/10 rounded">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {expanded && <StepsEditor workflowId={workflow.id} onChanged={onChanged} />}
      {msg && <div className="px-3 pb-3 text-[11px] text-blue-700">{msg}</div>}
    </div>
  );
}

// ── Steps editor (inline) ──────────────────────────────────────────────────
function StepsEditor({ workflowId, onChanged }: { workflowId: string; onChanged: () => void }) {
  const [steps, setSteps]     = useState<WorkflowStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [msg, setMsg]         = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/admin/workflows/${workflowId}/steps`);
      if (!res.ok) throw new Error(`Failed to load steps (${res.status})`);
      const data: WorkflowStep[] = await res.json();
      setSteps(data.sort((a, b) => a.stepOrder - b.stepOrder));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => { void load(); }, [load]);

  const addStep = async () => {
    setError(null); setMsg(null);
    const stepOrder = (steps.at(-1)?.stepOrder ?? 0) + 1;
    const res = await fetch(`/api/admin/workflows/${workflowId}/steps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stepOrder,
        stepName: `Step ${stepOrder}`,
        stepType: 'APPROVAL',
        assigneeType: 'SPECIFIC_USER',
        slaHours: 24,
        escalationHours: 48,
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.status === 428) { setMsg(approvalMessage(d)); return; }
    if (!res.ok) { setError(d?.error ?? 'Create failed'); return; }
    if (res.ok) {
      await load();
      onChanged(); // refresh stepCount on parent
    }
  };

  const updateStep = async (s: WorkflowStep, patch: Partial<WorkflowStep>) => {
    setSavingId(s.id);
    setError(null); setMsg(null);
    // Optimistic local update so the form feels responsive.
    setSteps(prev => prev.map(x => x.id === s.id ? { ...x, ...patch } : x));
    try {
      const res = await fetch(`/api/admin/workflows/${workflowId}/steps/${s.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 428) { setMsg(approvalMessage(d)); return; }
      if (!res.ok) { setError(d?.error ?? 'Update failed'); await load(); }
    } finally { setSavingId(null); }
  };

  const deleteStep = async (s: WorkflowStep) => {
    if (!window.confirm(`Delete step "${s.stepName}"?`)) return;
    setError(null); setMsg(null);
    const res = await fetch(`/api/admin/workflows/${workflowId}/steps/${s.id}`, {
      method: 'DELETE',
      headers: { 'x-admin-confirm-action': 'workflow.step.delete' },
    });
    const d = await res.json().catch(() => ({}));
    if (res.status === 428) { setMsg(approvalMessage(d)); return; }
    if (!res.ok) { setError(d?.error ?? 'Delete failed'); return; }
    await load();
    onChanged();
  };

  const move = async (s: WorkflowStep, direction: -1 | 1) => {
    setError(null); setMsg(null);
    const idx = steps.findIndex(x => x.id === s.id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= steps.length) return;
    const other = steps[swapIdx];
    const first = await fetch(`/api/admin/workflows/${workflowId}/steps/${s.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepOrder: other.stepOrder }),
      });
    const firstBody = await first.json().catch(() => ({}));
    if (first.status === 428) { setMsg(approvalMessage(firstBody)); return; }
    if (!first.ok) { setError(firstBody?.error ?? 'Move failed'); return; }

    const second = await fetch(`/api/admin/workflows/${workflowId}/steps/${other.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepOrder: s.stepOrder }),
      });
    const secondBody = await second.json().catch(() => ({}));
    if (second.status === 428) { setMsg(approvalMessage(secondBody)); return; }
    if (!second.ok) { setError(secondBody?.error ?? 'Move failed'); return; }
    await load();
  };

  return (
    <div className="border-t border-white/5 bg-slate-950/40 p-4 space-y-3">
      {loading ? (
        <div className="text-xs text-slate-500">Loading steps…</div>
      ) : error ? (
        <div className="text-xs text-rose-300">{error}</div>
      ) : (
        <>
          {msg && <div className="text-[11px] text-blue-700">{msg}</div>}
          {steps.length === 0 && (
            <p className="text-[11px] text-slate-500">No steps yet — add one to define the chain.</p>
          )}

          {steps.map((s, i) => (
            <div key={s.id} className="bg-slate-900/60 border border-white/10 rounded-lg p-3 space-y-2.5">
              {/* Top row: order controls + name + delete */}
              <div className="flex items-center gap-2">
                <div className="flex flex-col">
                  <button type="button" onClick={() => void move(s, -1)} disabled={i === 0}
                    className="p-0.5 text-slate-500 hover:text-white disabled:opacity-30 leading-none text-[10px]">▲</button>
                  <button type="button" onClick={() => void move(s, +1)} disabled={i === steps.length - 1}
                    className="p-0.5 text-slate-500 hover:text-white disabled:opacity-30 leading-none text-[10px]">▼</button>
                </div>
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-violet-300 bg-violet-100 text-[10px] font-mono text-violet-900 shadow-sm">
                  {s.stepOrder}
                </span>
                <input
                  value={s.stepName}
                  onChange={e => setSteps(prev => prev.map(x => x.id === s.id ? { ...x, stepName: e.target.value } : x))}
                  onBlur={e => { if (e.target.value !== s.stepName) void updateStep(s, { stepName: e.target.value }); }}
                  className="flex-1 bg-slate-800 border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500" />
                {savingId === s.id && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-violet-700">
                    <Save className="w-3 h-3" /> saving
                  </span>
                )}
                <button type="button" onClick={() => void deleteStep(s)}
                  className="p-1.5 text-rose-300 hover:bg-rose-500/10 rounded">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Field grid */}
              <div className="grid grid-cols-1 md:grid-cols-[180px_1fr_120px_120px] gap-2">
                <Field label="Type">
                  <select
                    value={s.stepType}
                    onChange={e => void updateStep(s, { stepType: e.target.value })}
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-2 py-2 text-white text-xs">
                    {STEP_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Assignee">
                  <NotifyPicker
                    value={stepToNotifyValue(s)}
                    onChange={v => void updateStep(s, notifyValueToStepPatch(v))}
                    placeholder="role:CODE, email, or pick users" />
                </Field>
                <Field label="SLA (h)" hint="Approve within">
                  <NumberInput
                    value={s.slaHours}
                    min={0}
                    onChange={v => void updateStep(s, { slaHours: v ?? 0 })} />
                </Field>
                <Field label="Escalate (h)" hint="If overdue">
                  <NumberInput
                    value={s.escalationHours}
                    min={0}
                    onChange={v => void updateStep(s, { escalationHours: v ?? 0 })} />
                </Field>
              </div>

              {/* Type description below for clarity */}
              <p className="text-[10px] text-slate-500">
                {STEP_TYPES.find(t => t.value === s.stepType)?.hint}
              </p>
            </div>
          ))}

          <button type="button" onClick={addStep}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-100 px-3 py-1.5 text-xs text-violet-900 shadow-sm transition hover:bg-violet-200">
            <Plus className="w-3.5 h-3.5" /> Add step
          </button>

          <p className="text-[10px] text-slate-500 inline-flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            Changes save automatically on blur. Reorder with the arrows.
            For email templates, conditional rules, or multi-approver lists,
            use the <a href="/admin/workflows" target="_blank" rel="noreferrer" className="underline hover:text-violet-700">advanced editor</a>.
          </p>
        </>
      )}
    </div>
  );
}
