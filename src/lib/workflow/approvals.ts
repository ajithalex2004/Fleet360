/**
 * Module side of the approval workflows (Admin > Workflows).
 *
 *   startApproval        when a record is submitted: starts the company's own
 *                        workflow for it, if it has one, with what is being
 *                        approved read from the record (subjects.ts).
 *   decideApproval       an approve / reject on the level now waiting, by one
 *                        of its approvers or a tenant administrator. Used by
 *                        the Approvals Inbox and by modules' own approve
 *                        buttons (approvalGate).
 *   approvalGate         for a module's approve / reject: while a workflow is
 *                        running for the record, the decision goes to it (and
 *                        the module's own approval is not applied).
 *   approvalInProgress   a 409 for other changes that would settle a record
 *                        a workflow is still deciding.
 *   withApprovalStart    a module's submit response, with the workflow started.
 *   approvalRequired     whether the company has its own workflow for a kind
 *                        of record (a step a module may otherwise skip).
 *   requireApproved      for a step that needs the record approved first
 *                        (when the company has a workflow for it).
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { runAsTenant } from '@/lib/rls-scope';
import { isSuperAdmin } from '@/lib/admin-access';
import { sessionUser } from '@/lib/session-user';
import {
  advanceWorkflow, cancelActiveInstancesForReference, getActiveInstanceForReference, getUserRoleCodes, getWorkflowInstanceWithHistory,
  latestInstanceStatusForReference,
  hasTenantWorkflow, parseEmailList, triggerWorkflow, type AdvanceResult, type WorkflowInstanceStatus,
} from '@/lib/workflow-db';
import { APPROVAL_SUBJECTS } from './subjects';

export type ApprovalStart =
  | { started: false; error?: string }
  | { started: true; instanceId: string; workflowName: string; status: WorkflowInstanceStatus; nextStep?: string };

/** Starts the company's workflow for a submitted record, if it has one for the record's procedure. */
export async function startApproval(args: {
  tenantId: string; referenceType: string; referenceId: string;
  initiator: { email: string; name?: string } | null;
}): Promise<ApprovalStart> {
  const subject = APPROVAL_SUBJECTS[args.referenceType];
  if (!subject) return { started: false };
  const { tenantId } = args;
  return runAsTenant(tenantId, async () => {
    const loaded = await withTenantRls(prisma, tenantId, (tx) => subject.load(tx, tenantId, args.referenceId));
    if (!loaded) return { started: false };
    const procedure = loaded.procedure ?? subject.procedure;
    if (!(await hasTenantWorkflow(tenantId, subject.module, procedure))) return { started: false };
    const result = await triggerWorkflow({
      tenantId, module: subject.module, procedure, tenantOnly: true,
      referenceType: args.referenceType, referenceId: args.referenceId, referenceNumber: loaded.referenceNumber,
      initiatedByEmail: args.initiator?.email ?? 'system', initiatedByName: args.initiator?.name,
      contextData: loaded.context,
    });
    if ('error' in result) {
      console.warn(`[Workflow] ${subject.label} ${loaded.referenceNumber}: ${result.error}`);
      return { started: false, error: result.error };
    }
    return {
      started: true, instanceId: result.instanceId, workflowName: result.workflowName,
      status: result.status, nextStep: result.nextStep,
    };
  });
}

/** Whether the company has an active workflow of its own for `referenceType` records. */
export async function approvalRequired(tenantId: string, referenceType: string): Promise<boolean> {
  const subject = APPROVAL_SUBJECTS[referenceType];
  if (!subject) return false;
  return runAsTenant(tenantId, () => hasTenantWorkflow(tenantId, subject.module, subject.procedure));
}

/**
 * For a step that needs the record approved first, when the company has a
 * workflow for it: null when it may go ahead (no workflow, or approved), a
 * 409 while its approval runs, and otherwise (never sent, e.g. created
 * before the workflow existed) it is sent for approval now and a 409 says so.
 */
export async function requireApproved(args: {
  headers: Headers; tenantId: string; referenceType: string; referenceId: string;
}): Promise<NextResponse | null> {
  const { tenantId, referenceType, referenceId } = args;
  if (!(await approvalRequired(tenantId, referenceType))) return null;
  const busy = await approvalInProgress(tenantId, referenceType, referenceId);
  if (busy) return busy;
  const latest = await runAsTenant(tenantId, () => latestInstanceStatusForReference(tenantId, referenceType, referenceId));
  if (latest === 'APPROVED') return null;
  const me = await sessionUser(args.headers).catch(() => null);
  const start = await startApproval({ tenantId, referenceType, referenceId, initiator: me ? { email: me.email, name: me.name } : null });
  if (start.started && start.status === 'APPROVED') return null;
  return NextResponse.json({
    error: start.started
      ? `This needs approval first: sent through "${start.workflowName}"${start.nextStep ? `, waiting for "${start.nextStep}"` : ''}.`
      : 'This needs approval first, and the approval could not be started.',
    workflow: start.started ? { instanceId: start.instanceId, name: start.workflowName, status: start.status, level: start.nextStep ?? null } : undefined,
  }, { status: 409 });
}

const isTenantAdmin = (headers: Headers) =>
  headers.get('x-user-role') === 'TENANT_ADMIN' || isSuperAdmin(headers);

export type Decision =
  | { ok: true; result: AdvanceResult; workflowName: string; stepName: string; override: boolean }
  | { ok: false; status: number; error: string };

/**
 * Approve or reject the level waiting on an approval. Only the level's
 * approvers (resolved when it opened, its assigned email, an address on a
 * multi-user level, or a holder of a role level's role) or a tenant
 * administrator may decide; on a level requiring all approvers only those
 * it was sent to count, and an administrator's decision settles the level.
 * Recorded under the signed-in user.
 */
export async function decideApproval(args: {
  headers: Headers; tenantId: string; instanceId: string;
  action: 'APPROVE' | 'REJECT'; comments?: string;
}): Promise<Decision> {
  const me = await sessionUser(args.headers);
  if (!me) return { ok: false, status: 401, error: 'Unauthorized' };
  return decideAs({
    ...args,
    actor: { email: me.email, role: args.headers.get('x-user-role'), admin: isTenantAdmin(args.headers) },
  });
}

/**
 * decideApproval for a given approver: the signed-in user, or the approver
 * an email decision link was sent to (decision-link.ts; never an
 * administrator, and only for the level the link was sent for).
 */
export async function decideAs(args: {
  tenantId: string; instanceId: string;
  actor: { email: string; role?: string | null; admin: boolean };
  /** The level the decision is for: refused once another level is waiting. */
  stepInstanceId?: string;
  action: 'APPROVE' | 'REJECT'; comments?: string;
}): Promise<Decision> {
  const { tenantId, actor } = args;
  const me = { email: actor.email };
  return runAsTenant(tenantId, async () => {
    const instance = await getWorkflowInstanceWithHistory(args.instanceId, tenantId);
    if (!instance) return { ok: false, status: 404, error: 'Approval not found' };
    if (instance.status !== 'IN_PROGRESS') return { ok: false, status: 422, error: `This approval is already ${instance.status}` };
    // Always the current level: a level from the request could act on one
    // that is not yet (or no longer) waiting.
    const step = instance.steps.find((s) => s.stepOrder === instance.currentStepOrder && s.status === 'PENDING');
    if (!step) return { ok: false, status: 422, error: 'No level is waiting for a decision' };
    if (args.stepInstanceId && step.id !== args.stepInstanceId) {
      return { ok: false, status: 409, error: 'This level has already been decided' };
    }

    const myEmail = me.email.toLowerCase();
    const resolved = (step.approverEmails ?? []).map((e) => e.toLowerCase());
    const roleCode = step.assigneeType === 'ROLE' ? step.assigneeRoleCode?.trim().toUpperCase() : undefined;
    const listed = resolved.includes(myEmail)
      || (step.assignedToEmail != null && step.assignedToEmail.toLowerCase() === myEmail)
      || (step.assigneeType === 'MULTI_USER' && parseEmailList(step.multiApproverEmails).includes(myEmail));
    const holdsRole = !listed && !!roleCode && ((actor.role ?? '').toUpperCase() === roleCode
      || (await getUserRoleCodes(tenantId, me.email)).some((c) => c.toUpperCase() === roleCode));
    // On an all-approvers level, the approvers are the ones it was sent to.
    const isApprover = step.requireAllApprovers && resolved.length > 0 ? resolved.includes(myEmail) : listed || holdsRole;
    const admin = actor.admin;
    if (!isApprover && !admin) return { ok: false, status: 403, error: 'You are not an approver for this level' };

    const comments = (args.comments ?? '').trim().slice(0, 2000);
    const override = !isApprover && admin;
    const result = await advanceWorkflow(tenantId, args.instanceId, step.stepOrder, args.action, comments, me.email, { override });
    if (result.status === 'NOT_PENDING') return { ok: false, status: 409, error: 'This level has already been decided' };
    if (result.status === 'ALREADY_DECIDED') {
      return { ok: false, status: 409, error: 'You have already decided this level; it is waiting for the other approvers' };
    }
    return { ok: true, result, workflowName: instance.workflowName, stepName: step.stepName, override };
  });
}

/** What a decision did, in words, for the module's response. */
export function decisionMessage(d: Extract<Decision, { ok: true }>, action: 'APPROVE' | 'REJECT'): string {
  const r = d.result;
  if (r.status === 'REJECTED') return `Rejected at "${d.stepName}".`;
  if (r.status === 'APPROVED') return 'Approved: all approval levels are complete.';
  if (r.waitingFor?.length) return `Your approval is recorded. "${d.stepName}" still needs: ${r.waitingFor.join(', ')}.`;
  if (r.nextStep) return `Approved at "${d.stepName}". Now waiting for "${r.nextStep}".`;
  return action === 'APPROVE' ? 'Approval recorded.' : 'Rejection recorded.';
}

/**
 * For a module's approve / reject of a record: when a workflow is deciding
 * it, the decision goes to the workflow's current level and the response
 * says what happened (the record changes only when the workflow
 * completes). Null when no workflow is running: the module decides as before.
 */
export async function approvalGate(args: {
  headers: Headers; tenantId: string; referenceType: string; referenceId: string;
  action: 'APPROVE' | 'REJECT'; comments?: string;
  /** A reason the request doesn't match what the workflow is approving (409), or null. */
  checkContext?: (context: Record<string, unknown>) => string | null;
  /** The record as the module's API returns it (camelCase, …). */
  mapRow?: (row: Record<string, unknown>) => object;
}): Promise<NextResponse | null> {
  const { tenantId } = args;
  const active = await runAsTenant(tenantId, () => getActiveInstanceForReference(tenantId, args.referenceType, args.referenceId));
  if (!active) return null;
  const context = (active.contextJson && typeof active.contextJson === 'object' ? active.contextJson : {}) as Record<string, unknown>;
  const mismatch = args.checkContext?.(context);
  if (mismatch) {
    return NextResponse.json({ error: mismatch, workflow: { instanceId: active.id, name: active.workflowName, level: active.stepName } }, { status: 409 });
  }
  const decision = await decideApproval({ ...args, instanceId: active.id });
  if (!decision.ok) {
    return NextResponse.json(
      { error: decision.error, workflow: { instanceId: active.id, name: active.workflowName, level: active.stepName } },
      { status: decision.status },
    );
  }
  const row = await currentRow(tenantId, args.referenceType, args.referenceId);
  return NextResponse.json({
    ...(row ? (args.mapRow ? args.mapRow(row) : row) : {}),
    ok: true,
    message: decisionMessage(decision, args.action),
    workflow: {
      instanceId: active.id, name: decision.workflowName, status: decision.result.status,
      decidedLevel: decision.stepName, nextLevel: decision.result.nextStep ?? null,
      waitingFor: decision.result.waitingFor ?? [], override: decision.override,
    },
  });
}

/**
 * A 409 when a workflow is still deciding the record, for changes that
 * would settle it outside the workflow (a direct status change, posting).
 */
export async function approvalInProgress(tenantId: string, referenceType: string, referenceId: string): Promise<NextResponse | null> {
  const active = await runAsTenant(tenantId, () => getActiveInstanceForReference(tenantId, referenceType, referenceId));
  if (!active) return null;
  return NextResponse.json({
    error: `This is going through the "${active.workflowName}" approval${active.stepName ? ` (waiting for "${active.stepName}")` : ''}. Approve or reject it from the Approvals Inbox.`,
    workflow: { instanceId: active.id, name: active.workflowName, level: active.stepName },
  }, { status: 409 });
}

async function currentRow(tenantId: string, referenceType: string, referenceId: string) {
  const subject = APPROVAL_SUBJECTS[referenceType];
  if (!subject) return null;
  return runAsTenant(tenantId, () => withTenantRls(prisma, tenantId, (tx) => subject.row(tx, tenantId, referenceId)))
    .catch(() => null);
}

/**
 * A module's response to a submit, once its transaction has committed:
 * starts the company's workflow for the record and adds it to the response
 * (with the record as it is now: an approval whose levels all don't apply
 * is approved at once). Responses that aren't a success pass through.
 */
export async function withApprovalStart(res: NextResponse, args: {
  headers: Headers; tenantId: string; referenceType: string; referenceId: string;
  mapRow?: (row: Record<string, unknown>) => object;
}): Promise<NextResponse> {
  if (!res.ok) return res;
  let start: ApprovalStart;
  try {
    const me = await sessionUser(args.headers);
    start = await startApproval({
      tenantId: args.tenantId, referenceType: args.referenceType, referenceId: args.referenceId,
      initiator: me ? { email: me.email, name: me.name } : null,
    });
  } catch (e) {
    // The submit stands; the record can still be approved in its module.
    console.error(`[Workflow] Could not start the approval for ${args.referenceType} ${args.referenceId}:`, e instanceof Error ? e.message : e);
    return res;
  }
  if (!start.started) return res;
  const body = await res.clone().json().catch(() => null) as Record<string, unknown> | null;
  const row = start.status === 'IN_PROGRESS' ? null : await currentRow(args.tenantId, args.referenceType, args.referenceId);
  return NextResponse.json({
    ...(body ?? {}),
    ...(row ? (args.mapRow ? args.mapRow(row) : row) : {}),
    workflow: { instanceId: start.instanceId, name: start.workflowName, status: start.status, level: start.nextStep ?? null },
  }, { status: res.status });
}

/** Withdraws a record's running approval after its module cancelled the record (best-effort). */
export async function withdrawApproval(tenantId: string, referenceType: string, referenceId: string, reason: string) {
  await runAsTenant(tenantId, () => cancelActiveInstancesForReference(tenantId, referenceType, referenceId, reason))
    .catch((e) => console.warn(`[Workflow] Could not withdraw the approval for ${referenceType} ${referenceId}:`, e instanceof Error ? e.message : e));
}
