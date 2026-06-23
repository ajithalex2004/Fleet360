import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { loadServiceConfig } from '@/lib/service-config/load';
import type { OperationalContext } from '@/lib/cross-module-governance';
import { recordOperationalChange } from '@/lib/cross-module-governance';

type LeasingEntityType = 'QUOTATION' | 'CONTRACT' | 'PRE_BILLING' | 'INVOICE';
type RuntimeActionStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'CANCELLED';

interface RuntimeActionRow {
  id: string;
  tenant_id: string;
  service_type_key: string;
  entity_type: LeasingEntityType;
  entity_id: string;
  action_key: string;
  reference_number: string | null;
  requested_by: string;
  status: RuntimeActionStatus;
  required_approvals: number;
  approved_approvals: number;
  amount: number | null;
  currency: string | null;
  payload_json: unknown;
  requested_at: string;
  executed_at: string | null;
  execution_error: string | null;
}

interface ApprovalStepDef {
  stepOrder: number;
  stepName: string;
  approverRole: string | null;
  assignedEmail: string | null;
  dueAt: Date | null;
  escalationAt: Date | null;
  delegatedFromRole: string | null;
}

interface RuntimeApprovalOptions {
  serviceTypeKey: string;
  entityType: LeasingEntityType;
  entityId: string;
  actionKey: string;
  referenceNumber?: string | null;
  amount?: number | null;
  currency?: string | null;
  summary: string;
  payload: unknown;
  contractId?: string | null;
  quotationId?: string | null;
}

interface PendingStepRow {
  id: string;
  step_order: number;
  step_name: string;
  approver_role: string | null;
  assigned_to_email: string | null;
  delegated_from_role: string | null;
  status: string | null;
  due_at: string | null;
  escalation_at: string | null;
}

const ROLE_DELEGATION_FALLBACKS: Record<string, string[]> = {
  DIRECT_MANAGER: ['DEPARTMENT_HEAD', 'TENANT_ADMIN'],
  DEPARTMENT_HEAD: ['TENANT_ADMIN'],
  LEASING_OPERATOR: ['LEASING_MANAGER', 'TENANT_ADMIN'],
  LEASING_MANAGER: ['TENANT_ADMIN'],
  FINANCE_MANAGER: ['TENANT_ADMIN'],
  OPERATIONS_MANAGER: ['TENANT_ADMIN'],
  FLEET_MANAGER: ['TENANT_ADMIN'],
  TENANT_ADMIN: [],
};

let ensured = false;

function numberValue(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function addHours(base: Date, hours: number | null | undefined) {
  if (!hours || !Number.isFinite(hours)) return null;
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

function compareMetric(value: number, operator: string, threshold: number) {
  switch (operator) {
    case 'gt': return value > threshold;
    case 'gte': return value >= threshold;
    case 'lt': return value < threshold;
    case 'lte': return value <= threshold;
    case 'eq': return value === threshold;
    default: return false;
  }
}

function severityRank(value: string | null | undefined) {
  switch ((value ?? '').toUpperCase()) {
    case 'ERROR': return 3;
    case 'WARNING': return 2;
    case 'INFO': return 1;
    default: return 0;
  }
}

function alertEntityWhere(args: { entityType: LeasingEntityType; entityId: string; contractId?: string | null; quotationId?: string | null }) {
  if (args.contractId) return { contractId: args.contractId };
  if (args.quotationId) return { quotationId: args.quotationId };
  if (args.entityType === 'CONTRACT') return { contractId: args.entityId };
  if (args.entityType === 'QUOTATION') return { quotationId: args.entityId };
  return {};
}

export async function ensureLeasingRuntimeApprovalTables() {
  if (ensured) return;

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS lease_runtime_actions (
      id UUID PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      service_type_key TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action_key TEXT NOT NULL,
      reference_number TEXT,
      requested_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
      required_approvals INTEGER NOT NULL DEFAULT 1,
      approved_approvals INTEGER NOT NULL DEFAULT 0,
      amount NUMERIC,
      currency TEXT,
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      executed_at TIMESTAMPTZ,
      execution_error TEXT
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_lease_runtime_actions_entity ON lease_runtime_actions (tenant_id, entity_type, entity_id, action_key, status)`);

  await prisma.$executeRawUnsafe(`ALTER TABLE lease_approval_steps ADD COLUMN IF NOT EXISTS tenant_id TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE lease_approval_steps ADD COLUMN IF NOT EXISTS runtime_action_id UUID`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE lease_approval_steps ADD COLUMN IF NOT EXISTS service_type_key TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE lease_approval_steps ADD COLUMN IF NOT EXISTS assigned_to_email TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE lease_approval_steps ADD COLUMN IF NOT EXISTS delegated_from_role TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE lease_approval_steps ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE lease_approval_steps ADD COLUMN IF NOT EXISTS escalation_at TIMESTAMPTZ`).catch(() => {});
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_lease_approval_steps_runtime ON lease_approval_steps (runtime_action_id, status, step_order)`).catch(() => {});

  await prisma.$executeRawUnsafe(`ALTER TABLE lease_pre_billing_statements ADD COLUMN IF NOT EXISTS authorized_po_amount NUMERIC`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE lease_pre_billing_statements ADD COLUMN IF NOT EXISTS actual_cost_amount NUMERIC`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE lease_pre_billing_statements ADD COLUMN IF NOT EXISTS variance_amount NUMERIC`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE lease_pre_billing_statements ADD COLUMN IF NOT EXISTS variance_pct NUMERIC`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE lease_pre_billing_statements ADD COLUMN IF NOT EXISTS variance_status TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE lease_pre_billing_statements ADD COLUMN IF NOT EXISTS variance_notes TEXT`).catch(() => {});

  ensured = true;
}

async function loadRuntimeAction(tenantId: string, entityType: LeasingEntityType, entityId: string, actionKey: string) {
  await ensureLeasingRuntimeApprovalTables();
  const rows = await prisma.$queryRawUnsafe<RuntimeActionRow[]>(
    `SELECT id::text, tenant_id, service_type_key, entity_type, entity_id, action_key, reference_number,
            requested_by, status, required_approvals, approved_approvals, amount::float8 AS amount,
            currency, payload_json, requested_at::text, executed_at::text, execution_error
       FROM lease_runtime_actions
      WHERE tenant_id = $1
        AND entity_type = $2
        AND entity_id = $3
        AND action_key = $4
        AND status IN ('PENDING_APPROVAL', 'APPROVED')
      ORDER BY requested_at DESC
      LIMIT 1`,
    tenantId,
    entityType,
    entityId,
    actionKey,
  ).catch(() => []);
  return rows[0] ?? null;
}

async function getUsersForRole(tenantId: string, roleCode: string) {
  return prisma.$queryRawUnsafe<Array<{ user_id: string; email: string; display_name: string }>>(
    `SELECT u.id::text AS user_id,
            LOWER(u.email) AS email,
            TRIM(CONCAT(COALESCE(u."firstName", ''), ' ', COALESCE(u."lastName", ''))) AS display_name
       FROM user_tenants ut
       JOIN roles r ON r.id = ut.role_id
       JOIN "User" u ON u.id = ut.user_id
      WHERE ut.tenant_id = $1
        AND COALESCE(ut.is_active, true) = true
        AND COALESCE(u.is_active, true) = true
        AND r.code = $2
      ORDER BY u."createdAt" ASC`,
    tenantId,
    roleCode,
  ).catch(() => []);
}

async function resolveRoleAssignment(tenantId: string, requestedRole: string | null) {
  if (!requestedRole) return { role: null, assignedEmail: null, delegatedFromRole: null };
  const rolesToTry = [requestedRole, ...(ROLE_DELEGATION_FALLBACKS[requestedRole] ?? [])];
  for (const role of rolesToTry) {
    const candidates = await getUsersForRole(tenantId, role);
    if (candidates.length > 0) {
      return {
        role,
        assignedEmail: candidates[0].email,
        delegatedFromRole: role === requestedRole ? null : requestedRole,
      };
    }
  }
  return { role: requestedRole, assignedEmail: null, delegatedFromRole: null };
}

async function escalatePendingApprovalStep(tenantId: string, step: PendingStepRow) {
  const currentRole = stringValue(step.approver_role);
  if (!currentRole) return null;
  const fallbacks = ROLE_DELEGATION_FALLBACKS[currentRole] ?? [];
  for (const fallbackRole of fallbacks) {
    const candidates = await getUsersForRole(tenantId, fallbackRole);
    if (candidates.length === 0) continue;
    const delegatedFromRole = stringValue(step.delegated_from_role) ?? currentRole;
    const now = new Date();
    const nextDueAt = addHours(now, 24);
    const nextEscalationAt = addHours(now, 12);
    await prisma.$executeRawUnsafe(
      `UPDATE lease_approval_steps
          SET approver_role = $2,
              assigned_to_email = $3,
              delegated_from_role = $4,
              due_at = $5::timestamptz,
              escalation_at = $6::timestamptz
        WHERE id = $1::uuid`,
      step.id,
      fallbackRole,
      candidates[0].email,
      delegatedFromRole,
      nextDueAt?.toISOString() ?? null,
      nextEscalationAt?.toISOString() ?? null,
    ).catch(() => {});
    return {
      approverRole: fallbackRole,
      assignedToEmail: candidates[0].email,
      delegatedFromRole,
      dueAt: nextDueAt?.toISOString() ?? null,
      escalationAt: nextEscalationAt?.toISOString() ?? null,
      escalated: true,
    };
  }
  return null;
}

async function buildApprovalSteps(tenantId: string, serviceTypeKey: string, workflowId: string | null, rules: { approvalLevels: number; approverRoles: string[] }, createdAt: Date) {
  const defs: ApprovalStepDef[] = [];
  let slaHours = 24;
  let escalationHours = 12;

  if (workflowId) {
    const steps = await prisma.$queryRawUnsafe<Array<{
      step_order: number;
      step_name: string;
      step_type: string;
      assignee_role_code: string | null;
      assignee_email: string | null;
      sla_hours: number | null;
      escalation_hours: number | null;
    }>>(
      `SELECT "stepOrder" AS step_order,
              "stepName" AS step_name,
              "stepType" AS step_type,
              "assigneeRoleCode" AS assignee_role_code,
              "assigneeEmail" AS assignee_email,
              "slaHours" AS sla_hours,
              "escalationHours" AS escalation_hours
         FROM "WorkflowStep"
        WHERE "workflowId" = $1
        ORDER BY "stepOrder" ASC`,
      workflowId,
    ).catch(() => []);

    const approvalSteps = steps.filter(step => String(step.step_type).toUpperCase() === 'APPROVAL');
    if (approvalSteps.length > 0) {
      for (const step of approvalSteps) {
        const resolved = step.assignee_email
          ? { role: stringValue(step.assignee_role_code), assignedEmail: stringValue(step.assignee_email), delegatedFromRole: null }
          : await resolveRoleAssignment(tenantId, stringValue(step.assignee_role_code));
        const localSla = Number.isFinite(Number(step.sla_hours)) ? Number(step.sla_hours) : slaHours;
        const localEscalation = Number.isFinite(Number(step.escalation_hours)) ? Number(step.escalation_hours) : escalationHours;
        defs.push({
          stepOrder: defs.length + 1,
          stepName: stringValue(step.step_name) ?? `Approval ${defs.length + 1}`,
          approverRole: resolved.role,
          assignedEmail: resolved.assignedEmail,
          delegatedFromRole: resolved.delegatedFromRole,
          dueAt: addHours(createdAt, localSla),
          escalationAt: addHours(createdAt, localEscalation),
        });
      }
      return defs;
    }
  }

  const levels = Math.max(1, Math.min(Number(rules.approvalLevels || 1), 5));
  for (let index = 0; index < levels; index += 1) {
    const requestedRole = rules.approverRoles[index] ?? rules.approverRoles[rules.approverRoles.length - 1] ?? 'TENANT_ADMIN';
    const resolved = await resolveRoleAssignment(tenantId, requestedRole);
    defs.push({
      stepOrder: index + 1,
      stepName: levels === 1 ? 'Approval' : `Approval ${index + 1}`,
      approverRole: resolved.role,
      assignedEmail: resolved.assignedEmail,
      delegatedFromRole: resolved.delegatedFromRole,
      dueAt: addHours(createdAt, slaHours),
      escalationAt: addHours(createdAt, escalationHours),
    });
  }
  return defs;
}

async function createApprovalSteps(actionId: string, tenantId: string, serviceTypeKey: string, entityType: LeasingEntityType, entityId: string, defs: ApprovalStepDef[]) {
  for (const def of defs) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO lease_approval_steps
         (id, created_at, tenant_id, runtime_action_id, service_type_key, entity_type, entity_id,
          step_name, step_order, approver_role, approver_name, assigned_to_email, delegated_from_role,
          status, due_at, escalation_at)
       VALUES
         ($1::uuid, NOW(), $2, $3::uuid, $4, $5, $6, $7, $8, $9, NULL, $10, $11, 'PENDING', $12::timestamptz, $13::timestamptz)`,
      randomUUID(),
      tenantId,
      actionId,
      serviceTypeKey,
      entityType,
      entityId,
      def.stepName,
      def.stepOrder,
      def.approverRole,
      def.assignedEmail,
      def.delegatedFromRole,
      def.dueAt?.toISOString() ?? null,
      def.escalationAt?.toISOString() ?? null,
    );
  }
}

async function syncRuntimeActionCounts(actionId: string) {
  await ensureLeasingRuntimeApprovalTables();
  const stats = await prisma.$queryRawUnsafe<Array<{ approved: number; pending: number; rejected: number }>>(
    `SELECT
        SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END)::int AS approved,
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END)::int AS pending,
        SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END)::int AS rejected
       FROM lease_approval_steps
      WHERE runtime_action_id = $1::uuid`,
    actionId,
  ).catch(() => []);
  const summary = stats[0] ?? { approved: 0, pending: 0, rejected: 0 };
  const nextStatus: RuntimeActionStatus =
    summary.rejected > 0 ? 'REJECTED' :
    summary.pending > 0 ? 'PENDING_APPROVAL' :
    'APPROVED';
  await prisma.$executeRawUnsafe(
    `UPDATE lease_runtime_actions
        SET approved_approvals = $2,
            status = $3
      WHERE id = $1::uuid`,
    actionId,
    summary.approved,
    nextStatus,
  );
  return { ...summary, status: nextStatus };
}

export async function resolveServiceAlertRule(
  tenantId: string,
  serviceTypeKey: string,
  metrics: Record<string, number | null | undefined>,
) {
  const cfg = await loadServiceConfig(tenantId, serviceTypeKey).catch(() => null);
  const automationRules = (cfg?.rules?.automation ?? null) as unknown as Record<string, unknown> | null;
  const rules = Array.isArray(automationRules?.alertRules)
    ? (automationRules.alertRules as Array<Record<string, unknown>>)
    : [];

  let best: {
    key: string;
    severity: 'INFO' | 'WARNING' | 'ERROR';
    title: string;
    message: string | null;
    blockAction: boolean;
  } | null = null;

  for (const rule of rules) {
    const metric = stringValue(rule.metric);
    const operator = stringValue(rule.operator) ?? 'gte';
    const threshold = numberValue(rule.threshold);
    if (!metric || threshold == null) continue;
    const value = numberValue(metrics[metric]);
    if (value == null || !compareMetric(value, operator, threshold)) continue;
    const candidate = {
      key: stringValue(rule.key) ?? metric,
      severity: ((stringValue(rule.severity) ?? 'WARNING').toUpperCase() as 'INFO' | 'WARNING' | 'ERROR'),
      title: stringValue(rule.title) ?? `${serviceTypeKey} alert`,
      message: stringValue(rule.message),
      blockAction: Boolean(rule.blockAction),
    };
    if (!best || severityRank(candidate.severity) > severityRank(best.severity)) {
      best = candidate;
    }
  }

  return best;
}

export async function createLeasingAlert(args: {
  tenantId: string;
  entityType: LeasingEntityType;
  entityId: string;
  contractId?: string | null;
  quotationId?: string | null;
  alertType: string;
  severity: 'INFO' | 'WARNING' | 'ERROR';
  title: string;
  message: string;
}) {
  const where = alertEntityWhere(args);
  const existing = await prisma.leaseAlert.findFirst({
    where: {
      ...where,
      alertType: args.alertType,
      title: args.title,
      status: 'OPEN',
    },
  }).catch(() => null);

  if (existing) {
    return prisma.leaseAlert.update({
      where: { id: existing.id },
      data: { message: args.message, severity: args.severity },
    }).catch(() => existing);
  }

  return prisma.leaseAlert.create({
    data: {
      ...where,
      alertType: args.alertType,
      severity: args.severity,
      title: args.title,
      message: args.message,
      status: 'OPEN',
    },
  }).catch(() => null);
}

function approvalRequiredForAmount(amount: number | null, threshold: number | null, autoApproveBelowThreshold: boolean) {
  if (amount == null || threshold == null) return true;
  if (!autoApproveBelowThreshold) return true;
  return amount >= threshold;
}

export async function requireLeasingRuntimeApproval(
  req: NextRequest,
  ctx: OperationalContext,
  options: RuntimeApprovalOptions,
) {
  await ensureLeasingRuntimeApprovalTables();
  const cfg = await loadServiceConfig(ctx.tenantId, options.serviceTypeKey);
  const approvalRules = cfg?.rules.approval;
  const approvalEngineEnabled = Boolean(cfg?.mapping?.approvalEngineEnabled);
  const workflowId = stringValue(approvalRules?.workflowId);
  const approvalRequired = Boolean(approvalRules?.approvalRequired || approvalEngineEnabled);
  const threshold = numberValue(approvalRules?.financialThresholdAed);

  if (!approvalRequired) return { ok: true as const, actionId: null as string | null };
  if (!approvalRequiredForAmount(options.amount ?? null, threshold, Boolean(approvalRules?.autoApproveBelowThreshold))) {
    return { ok: true as const, actionId: null as string | null };
  }

  let action = await loadRuntimeAction(ctx.tenantId, options.entityType, options.entityId, options.actionKey);
  if (!action) {
    const createdAt = new Date();
    const defs = await buildApprovalSteps(
      ctx.tenantId,
      options.serviceTypeKey,
      workflowId,
      {
        approvalLevels: Math.max(1, Number(approvalRules?.approvalLevels ?? 1)),
        approverRoles: approvalRules?.approverRoles ?? [],
      },
      createdAt,
    );

    const unresolved = defs.filter(def => !def.assignedEmail && !def.approverRole);
    if (defs.length === 0 || unresolved.length > 0) {
      await createLeasingAlert({
        tenantId: ctx.tenantId,
        entityType: options.entityType,
        entityId: options.entityId,
        contractId: options.contractId,
        quotationId: options.quotationId,
        alertType: 'APPROVAL_PENDING',
        severity: 'ERROR',
        title: `${options.serviceTypeKey} approval routing failed`,
        message: `No approver matrix could be resolved for ${options.summary}. Configure approver roles or workflow steps for ${options.serviceTypeKey}.`,
      });
      return {
        ok: false as const,
        response: NextResponse.json({
          error: 'Approval routing is not configured for this Leasing action.',
          code: 'LEASING_APPROVER_MATRIX_MISSING',
          serviceTypeKey: options.serviceTypeKey,
        }, { status: 409 }),
      };
    }

    const actionId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO lease_runtime_actions
         (id, tenant_id, service_type_key, entity_type, entity_id, action_key, reference_number,
          requested_by, status, required_approvals, approved_approvals, amount, currency, payload_json, requested_at)
       VALUES
         ($1::uuid, $2, $3, $4, $5, $6, $7, $8, 'PENDING_APPROVAL', $9, 0, $10, $11, $12::jsonb, NOW())`,
      actionId,
      ctx.tenantId,
      options.serviceTypeKey,
      options.entityType,
      options.entityId,
      options.actionKey,
      options.referenceNumber ?? null,
      ctx.userId,
      defs.length,
      options.amount ?? null,
      options.currency ?? null,
      JSON.stringify(options.payload ?? {}),
    );
    await createApprovalSteps(actionId, ctx.tenantId, options.serviceTypeKey, options.entityType, options.entityId, defs);
    action = await loadRuntimeAction(ctx.tenantId, options.entityType, options.entityId, options.actionKey);
  }

  const steps = await prisma.$queryRawUnsafe<PendingStepRow[]>(
    `SELECT id::text, step_order, step_name, approver_role, assigned_to_email, delegated_from_role,
            status, due_at::text, escalation_at::text
       FROM lease_approval_steps
      WHERE runtime_action_id = $1::uuid
      ORDER BY step_order ASC`,
    action!.id,
  ).catch(() => []);

  const rejected = steps.find(step => step.status === 'REJECTED');
  if (rejected) {
    return {
      ok: false as const,
      response: NextResponse.json({
        error: `This action was rejected at step ${rejected.step_order}: ${rejected.step_name}.`,
        code: 'LEASING_RUNTIME_ACTION_REJECTED',
        runtimeActionId: action!.id,
      }, { status: 409 }),
    };
  }

  const pending = steps.filter(step => step.status === 'PENDING');
  if (pending.length > 0) {
    let firstPending = pending[0];
    const now = new Date();
    const escalated = firstPending.escalation_at && now >= new Date(firstPending.escalation_at)
      ? await escalatePendingApprovalStep(ctx.tenantId, firstPending)
      : null;
    if (escalated) {
      firstPending = {
        ...firstPending,
        approver_role: escalated.approverRole,
        assigned_to_email: escalated.assignedToEmail,
        delegated_from_role: escalated.delegatedFromRole,
        due_at: escalated.dueAt,
        escalation_at: escalated.escalationAt,
      };
    }
    const dueAt = firstPending.due_at ? new Date(firstPending.due_at) : null;
    const escalationAt = firstPending.escalation_at ? new Date(firstPending.escalation_at) : null;
    const severity =
      escalationAt && now >= escalationAt ? 'ERROR' :
      dueAt && now >= dueAt ? 'WARNING' :
      'INFO';
    if (severity !== 'INFO') {
      await createLeasingAlert({
        tenantId: ctx.tenantId,
        entityType: options.entityType,
        entityId: options.entityId,
        contractId: options.contractId,
        quotationId: options.quotationId,
        alertType: 'APPROVAL_PENDING',
        severity,
        title: `${options.serviceTypeKey} approval pending`,
        message: `${options.summary} is waiting on ${firstPending.approver_role ?? firstPending.assigned_to_email ?? 'an approver'} at step ${firstPending.step_order}.${escalated ? ' Escalation routing was applied.' : ''}`,
      });
    }
    return {
      ok: false as const,
      response: NextResponse.json({
        error: 'Approval required before this Leasing action can execute.',
        code: 'LEASING_RUNTIME_APPROVAL_REQUIRED',
        runtimeAction: {
          id: action!.id,
          status: action!.status,
          serviceTypeKey: action!.service_type_key,
          requiredApprovals: action!.required_approvals,
          approvedApprovals: action!.approved_approvals,
          pendingSteps: pending.map(step => ({
            id: step.id,
            stepOrder: step.step_order,
            stepName: step.step_name,
            approverRole: step.approver_role,
            assignedToEmail: step.assigned_to_email,
            delegatedFromRole: step.delegated_from_role,
            dueAt: step.due_at,
            escalationAt: step.escalation_at,
          })),
        },
      }, { status: 428 }),
    };
  }

  return { ok: true as const, actionId: action!.id };
}

export async function markLeasingRuntimeActionExecuted(actionId: string | null | undefined) {
  if (!actionId) return;
  await ensureLeasingRuntimeApprovalTables();
  await prisma.$executeRawUnsafe(
    `UPDATE lease_runtime_actions
        SET status = 'EXECUTED',
            executed_at = NOW(),
            execution_error = NULL
      WHERE id = $1::uuid`,
    actionId,
  ).catch(() => {});
}

export async function syncLeasingApprovalAfterVote(args: {
  req: NextRequest;
  ctx: OperationalContext;
  runtimeActionId: string;
  entityType: LeasingEntityType;
  entityId: string;
  contractId?: string | null;
  quotationId?: string | null;
}) {
  const summary = await syncRuntimeActionCounts(args.runtimeActionId);
  const actionRows = await prisma.$queryRawUnsafe<Array<{
    service_type_key: string;
    action_key: string;
    reference_number: string | null;
  }>>(
    `SELECT service_type_key, action_key, reference_number
       FROM lease_runtime_actions
      WHERE id = $1::uuid
      LIMIT 1`,
    args.runtimeActionId,
  ).catch(() => []);
  const action = actionRows[0];
  if (!action) return;

  if (summary.status === 'REJECTED') {
    await createLeasingAlert({
      tenantId: args.ctx.tenantId,
      entityType: args.entityType,
      entityId: args.entityId,
      contractId: args.contractId,
      quotationId: args.quotationId,
      alertType: 'APPROVAL_PENDING',
      severity: 'ERROR',
      title: `${action.service_type_key} approval rejected`,
      message: `${action.reference_number ?? args.entityId} was rejected and can no longer continue until resubmitted.`,
    });
  } else if (summary.status === 'APPROVED') {
    await recordOperationalChange({
      req: args.req,
      ctx: args.ctx,
      entityType: 'LeaseRuntimeAction',
      entityId: args.runtimeActionId,
      action: 'STATUS_CHANGE',
      after: { status: 'APPROVED', approvedApprovals: summary.approved },
      summary: `Runtime approval completed for ${action.service_type_key} / ${action.action_key}`,
      relatedEntityType: args.entityType === 'CONTRACT' ? 'LeaseContract' : args.entityType === 'QUOTATION' ? 'LeaseQuotation' : null,
      relatedEntityId: args.entityId,
      riskSeverity: 'medium',
    });
  }
}

export async function persistPreBillingVariance(args: {
  statementId: string;
  authorizedPoAmount?: number | null;
  actualCostAmount?: number | null;
  varianceNotes?: string | null;
}) {
  await ensureLeasingRuntimeApprovalTables();
  const authorized = numberValue(args.authorizedPoAmount);
  const actual = numberValue(args.actualCostAmount);
  if (authorized == null && actual == null && !args.varianceNotes) return null;

  const varianceAmount = authorized != null && actual != null ? actual - authorized : null;
  const variancePct = authorized && varianceAmount != null
    ? Number(((varianceAmount / authorized) * 100).toFixed(2))
    : null;
  const varianceStatus =
    varianceAmount == null ? null :
    varianceAmount > 0 ? 'EXCEEDED' :
    varianceAmount < 0 ? 'UNDER' :
    'MATCHED';

  await prisma.$executeRawUnsafe(
    `UPDATE lease_pre_billing_statements
        SET authorized_po_amount = $2,
            actual_cost_amount = $3,
            variance_amount = $4,
            variance_pct = $5,
            variance_status = $6,
            variance_notes = $7
      WHERE id = $1::uuid`,
    args.statementId,
    authorized,
    actual,
    varianceAmount,
    variancePct,
    varianceStatus,
    stringValue(args.varianceNotes),
  ).catch(() => {});

  return { authorized, actual, varianceAmount, variancePct, varianceStatus };
}
