import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { AdminContext } from '@/lib/admin-auth';
import { getApprovalState, markAdminApprovalExecuted } from '@/lib/admin-approvals';
import { createWorkflow, deleteWorkflow, ensureWorkflowTables, snapshotWorkflowVersion } from '@/lib/workflow-db';
import { getServiceTypeKeyCandidatesForProcedure } from '@/lib/service-config/workflow-procedure';
import { ensureServiceConfigTables } from '@/lib/service-config/schema';
import { rollbackToVersion, saveRules } from '@/lib/service-config/rules-schema';
import { SERVICE_TONES, type ServiceTone } from '@/types/service-config';
import { RULE_CATEGORIES, type RuleCategory } from '@/types/service-rules';
import {
  awardCarrierBid,
  createShipmentAssignment,
  syncShipmentStatusFromBooking,
} from '@/lib/logistics/domain';

type ApprovalRequestRow = {
  id: string;
  tenant_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  summary: string | null;
  payload_json: Record<string, unknown> | null;
  status: string;
  execution_status: string | null;
};

function normalizeTone(value: unknown): ServiceTone {
  return (SERVICE_TONES as readonly string[]).includes(String(value ?? ''))
    ? String(value) as ServiceTone
    : 'violet';
}

async function loadApprovalRequest(id: string): Promise<ApprovalRequestRow | null> {
  const rows = await prisma.$queryRawUnsafe<ApprovalRequestRow[]>(
    `SELECT id::text, tenant_id, action, target_type, target_id, summary, payload_json, status, execution_status
       FROM admin_approval_requests
      WHERE id = $1::uuid
      LIMIT 1`,
    id,
  ).catch(() => []);
  return rows[0] ?? null;
}

async function resolveWorkflowServiceTypeId(args: {
  tenantId: string | null;
  procedure: string;
  requestedServiceTypeId?: string | null;
}) {
  const requestedServiceTypeId = args.requestedServiceTypeId ? String(args.requestedServiceTypeId).trim() : null;
  if (requestedServiceTypeId) {
    const requestedMatch = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id::text AS id
         FROM service_types
        WHERE id = $1::uuid
          AND ($2::text IS NULL OR tenant_id = $2)
          AND deleted_at IS NULL
        LIMIT 1`,
      requestedServiceTypeId,
      args.tenantId ?? null,
    ).catch(() => []);

    if (requestedMatch[0]?.id) {
      return requestedMatch[0].id;
    }
  }

  if (!args.tenantId) return null;

  const serviceTypeCandidates = getServiceTypeKeyCandidatesForProcedure(args.procedure);
  if (serviceTypeCandidates.length === 0) return null;

  const matches = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text AS id
       FROM service_types
      WHERE tenant_id = $1
        AND deleted_at IS NULL
        AND key = ANY($2::text[])
      ORDER BY created_at DESC
      LIMIT 2`,
    args.tenantId,
    serviceTypeCandidates,
  ).catch(() => []);

  return matches.length === 1 ? matches[0].id : null;
}

async function executeWorkflowCreate(row: ApprovalRequestRow) {
  await ensureWorkflowTables();
  const payload = row.payload_json ?? {};
  const name = String(payload.name ?? '').trim();
  const workflowModule = String(payload.module ?? '').trim();
  const procedure = String(payload.procedure ?? '').trim();
  const serviceTypeId = await resolveWorkflowServiceTypeId({
    tenantId: row.tenant_id ?? null,
    procedure,
    requestedServiceTypeId: payload.serviceTypeId ? String(payload.serviceTypeId) : null,
  });
  const scopeId = payload.scopeId ? String(payload.scopeId) : null;
  if (!name || !workflowModule || !procedure) {
    throw new Error('Approved workflow request is missing name, module, or procedure.');
  }

  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text
       FROM "WorkflowDefinition"
      WHERE name = $1
        AND module = $2
        AND procedure = $3
        AND "tenantId" IS NOT DISTINCT FROM $4
        AND "serviceTypeId" IS NOT DISTINCT FROM $5
        AND "scopeId" IS NOT DISTINCT FROM $6::uuid
      LIMIT 1`,
    name,
    workflowModule,
    procedure,
    row.tenant_id ?? null,
    serviceTypeId,
    scopeId,
  ).catch(() => []);
  if (existing[0]?.id) {
    return { entityType: 'WorkflowDefinition', entityId: existing[0].id, reused: true };
  }

  const id = await createWorkflow({
    name,
    module: workflowModule,
    procedure,
    description: payload.description ? String(payload.description) : undefined,
    serviceTypeId,
    tenantId: row.tenant_id ?? null,
    scopeId,
    status: 'DRAFT',
  });
  await snapshotWorkflowVersion({
    workflowId: id,
    createdBy: 'admin-approval-executor',
    status: 'DRAFT',
    changeSummary: 'Initial workflow draft created from approved admin action',
  });
  return { entityType: 'WorkflowDefinition', entityId: id, reused: false };
}

async function executeWorkflowDelete(row: ApprovalRequestRow) {
  await ensureWorkflowTables();
  const workflowId = String(row.target_id ?? '').trim();
  if (!workflowId) {
    throw new Error('Approved workflow delete request is missing target workflow id.');
  }

  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text
       FROM "WorkflowDefinition"
      WHERE id = $1
      LIMIT 1`,
    workflowId,
  ).catch(() => []);

  if (!existing[0]?.id) {
    return { entityType: 'WorkflowDefinition', entityId: workflowId, reused: true };
  }

  await deleteWorkflow(workflowId);
  return { entityType: 'WorkflowDefinition', entityId: workflowId, reused: false };
}

async function executeServiceConfigCategoryCreate(row: ApprovalRequestRow) {
  await ensureServiceConfigTables();
  const payload = row.payload_json ?? {};
  const tenantId = row.tenant_id;
  const key = String(payload.key ?? row.target_id ?? '').trim().toUpperCase();
  const name = String(payload.name ?? '').trim();
  if (!tenantId || !key || !name) {
    throw new Error('Approved service category request is missing tenant, key, or name.');
  }

  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text
       FROM service_categories
      WHERE tenant_id = $1
        AND key = $2
        AND deleted_at IS NULL
      LIMIT 1`,
    tenantId,
    key,
  ).catch(() => []);
  if (existing[0]?.id) {
    return { entityType: 'ServiceCategory', entityId: existing[0].id, reused: true };
  }

  const inserted = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO service_categories
      (tenant_id, key, name, description, icon, tone, sort_order, is_system)
     VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)
     RETURNING id::text`,
    tenantId,
    key,
    name,
    payload.description ? String(payload.description) : null,
    payload.icon ? String(payload.icon) : null,
    normalizeTone(payload.tone),
    Number.isFinite(payload.sortOrder) ? Number(payload.sortOrder) : 100,
  );
  return { entityType: 'ServiceCategory', entityId: inserted[0]?.id ?? key, reused: false };
}

async function executeServiceConfigTypeCreate(row: ApprovalRequestRow) {
  await ensureServiceConfigTables();
  const payload = row.payload_json ?? {};
  const tenantId = row.tenant_id;
  const categoryId = String(payload.categoryId ?? '').trim();
  const key = String(payload.key ?? row.target_id ?? '').trim().toUpperCase();
  const name = String(payload.name ?? '').trim();
  if (!tenantId || !categoryId || !key || !name) {
    throw new Error('Approved service type request is missing tenant, category, key, or name.');
  }

  const category = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text
       FROM service_categories
      WHERE id = $1::uuid
        AND tenant_id = $2
        AND deleted_at IS NULL
      LIMIT 1`,
    categoryId,
    tenantId,
  ).catch(() => []);
  if (!category[0]?.id) {
    throw new Error('Referenced service category was not found for this tenant.');
  }

  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text
       FROM service_types
      WHERE tenant_id = $1
        AND key = $2
        AND deleted_at IS NULL
      LIMIT 1`,
    tenantId,
    key,
  ).catch(() => []);
  const typeId = existing[0]?.id ?? (
    await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO service_types
        (tenant_id, category_id, key, name, description, icon, tone, default_priority, sort_order, is_system)
       VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, FALSE)
       RETURNING id::text`,
      tenantId,
      categoryId,
      key,
      name,
      payload.description ? String(payload.description) : null,
      payload.icon ? String(payload.icon) : null,
      normalizeTone(payload.tone),
      ['Low', 'Medium', 'High'].includes(String(payload.priority ?? '')) ? String(payload.priority) : 'Medium',
      Number.isFinite(payload.sortOrder) ? Number(payload.sortOrder) : 100,
    )
  )[0]?.id;

  if (!typeId) throw new Error('Failed to materialize approved service type.');

  await prisma.$executeRawUnsafe(
    `INSERT INTO service_module_mapping
       (service_type_id, linked_module, sub_module,
        workflow_engine_enabled, notification_engine_enabled, approval_engine_enabled,
        finance_engine_enabled, dispatch_engine_enabled)
     VALUES ($1::uuid, 'ADMIN', NULL, FALSE, TRUE, FALSE, FALSE, FALSE)
     ON CONFLICT (service_type_id) DO NOTHING`,
    typeId,
  );

  return { entityType: 'ServiceType', entityId: typeId, reused: Boolean(existing[0]?.id) };
}

function normalizeRuleCategory(value: unknown): RuleCategory {
  const category = String(value ?? '').trim();
  if ((RULE_CATEGORIES as readonly string[]).includes(category)) {
    return category as RuleCategory;
  }
  throw new Error(`Unknown service rule category "${category}".`);
}

async function ensureServiceTypeOwnership(tenantId: string | null, serviceTypeId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; key: string }>>(
    `SELECT id::text, key
       FROM service_types
      WHERE id = $1::uuid
        AND tenant_id = $2
        AND deleted_at IS NULL
      LIMIT 1`,
    serviceTypeId,
    tenantId,
  ).catch(() => []);
  if (!rows[0]?.id) {
    throw new Error('Referenced service type was not found for this tenant.');
  }
  return rows[0];
}

async function executeServiceConfigRulesUpdate(row: ApprovalRequestRow, updatedBy: string) {
  const payload = row.payload_json ?? {};
  const serviceTypeId = String(row.target_id ?? '').trim();
  const scopeId = String(payload.scopeId ?? '').trim();
  const category = normalizeRuleCategory(payload.category);
  const rules = payload.rules;
  if (!serviceTypeId || !scopeId || !rules || typeof rules !== 'object') {
    throw new Error('Approved service rules update is missing service type, scope, or rules payload.');
  }

  const owner = await ensureServiceTypeOwnership(row.tenant_id, serviceTypeId);
  await saveRules(serviceTypeId, category, rules, updatedBy, scopeId);
  return {
    entityType: 'ServiceRules',
    entityId: `${serviceTypeId}:${category}:${scopeId}`,
    reused: false,
    entityName: owner.key,
  };
}

async function executeServiceConfigRulesReset(row: ApprovalRequestRow, updatedBy: string) {
  const payload = row.payload_json ?? {};
  const serviceTypeId = String(row.target_id ?? '').trim();
  const scopeId = String(payload.scopeId ?? '').trim();
  const category = normalizeRuleCategory(payload.category);
  if (!serviceTypeId || !scopeId) {
    throw new Error('Approved service rules reset is missing service type or scope.');
  }

  const owner = await ensureServiceTypeOwnership(row.tenant_id, serviceTypeId);
  await prisma.$executeRawUnsafe(
    `UPDATE service_rules
        SET effective_to = NOW(), updated_at = NOW(), updated_by = $4
      WHERE service_type_id = $1::uuid
        AND category = $2
        AND scope_id = $3::uuid
        AND effective_to IS NULL`,
    serviceTypeId,
    category,
    scopeId,
    updatedBy,
  );
  return {
    entityType: 'ServiceRules',
    entityId: `${serviceTypeId}:${category}:${scopeId}`,
    reused: false,
    entityName: owner.key,
  };
}

async function executeServiceConfigRulesRollback(row: ApprovalRequestRow, updatedBy: string) {
  const payload = row.payload_json ?? {};
  const serviceTypeId = String(row.target_id ?? '').trim();
  const scopeId = String(payload.scopeId ?? '').trim();
  const category = normalizeRuleCategory(payload.category);
  const historicalId = String(payload.historicalId ?? payload.versionId ?? '').trim();
  if (!serviceTypeId || !scopeId || !historicalId) {
    throw new Error('Approved service rules rollback is missing service type, scope, or historical version.');
  }

  const owner = await ensureServiceTypeOwnership(row.tenant_id, serviceTypeId);
  const result = await rollbackToVersion(serviceTypeId, category, scopeId, historicalId, updatedBy);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return {
    entityType: 'ServiceRules',
    entityId: `${serviceTypeId}:${category}:${scopeId}`,
    reused: false,
    entityName: owner.key,
  };
}

function operationPayload(row: ApprovalRequestRow) {
  const payload = row.payload_json ?? {};
  const operation = payload.operation;
  return operation && typeof operation === 'object' && !Array.isArray(operation)
    ? operation as Record<string, unknown>
    : {};
}

function stringOrNull(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function objectOrEmpty(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function executeLogisticsComplianceAward(row: ApprovalRequestRow, ctx: AdminContext) {
  const op = operationPayload(row);
  const tenantId = stringOrNull(op.tenantId) ?? row.tenant_id;
  const rfqId = stringOrNull(op.rfqId);
  const bidId = stringOrNull(op.bidId);
  if (!tenantId || !rfqId || !bidId) {
    throw new Error('Approved Logistics award override is missing tenant, RFQ, or bid.');
  }

  const result = await awardCarrierBid({
    tenantId,
    rfqId,
    bidId,
    vehicleId: stringOrNull(op.vehicleId),
    driverId: stringOrNull(op.driverId),
    overrideCompliance: true,
    overrideReason: stringOrNull(op.overrideReason) ?? row.summary ?? 'Approved Logistics compliance override',
    actorRole: 'SUPER_ADMIN',
    actorUserId: ctx.userId,
    notes: stringOrNull(op.notes) ?? 'Award executed from approved Logistics compliance override',
  });

  return {
    entityType: 'LogisticsCarrierBid',
    entityId: result.bid?.id ?? bidId,
    reused: false,
  };
}

async function executeLogisticsComplianceAssignment(row: ApprovalRequestRow, ctx: AdminContext) {
  const op = operationPayload(row);
  const tenantId = stringOrNull(op.tenantId) ?? row.tenant_id;
  const shipmentOrderId = stringOrNull(op.shipmentOrderId) ?? row.target_id;
  if (!tenantId || !shipmentOrderId) {
    throw new Error('Approved Logistics assignment override is missing tenant or shipment.');
  }

  const assignment = await createShipmentAssignment({
    tenantId,
    shipmentOrderId,
    carrierId: stringOrNull(op.carrierId),
    driverId: stringOrNull(op.driverId),
    vehicleId: stringOrNull(op.vehicleId),
    assignmentType: stringOrNull(op.assignmentType),
    status: stringOrNull(op.status) ?? 'ASSIGNED',
    costAmount: numberOrNull(op.costAmount),
    currency: stringOrNull(op.currency) ?? 'AED',
    metadata: {
      ...objectOrEmpty(op.metadata),
      assignedBy: ctx.userId,
      actorRole: 'SUPER_ADMIN',
      overrideCompliance: true,
      overrideReason: stringOrNull(op.overrideReason) ?? row.summary ?? 'Approved Logistics compliance override',
      approvalRequestId: row.id,
      source: 'admin-approval-logistics-compliance-override',
    },
  });

  return {
    entityType: 'LogisticsShipmentAssignment',
    entityId: assignment?.id ?? shipmentOrderId,
    reused: false,
  };
}

async function executeLogisticsComplianceDispatch(row: ApprovalRequestRow, ctx: AdminContext) {
  const op = operationPayload(row);
  const tenantId = stringOrNull(op.tenantId) ?? row.tenant_id;
  const bookingId = stringOrNull(op.bookingId) ?? row.target_id;
  const toStatus = stringOrNull(op.status);
  if (!tenantId || !bookingId || !toStatus) {
    throw new Error('Approved Logistics dispatch override is missing tenant, booking, or status.');
  }

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new Error('Booking not found for approved Logistics dispatch override.');

  const patchData: Record<string, unknown> = { status: toStatus };
  const vehicleId = stringOrNull(op.vehicleId);
  const driverId = stringOrNull(op.driverId);
  const driverName = stringOrNull(op.driverName);
  const vehiclePlate = stringOrNull(op.vehiclePlate);
  if (vehicleId) patchData.vehicleId = vehicleId;
  if (driverId || driverName || vehiclePlate) {
    let notesObj: Record<string, unknown> = {};
    try { notesObj = JSON.parse(booking.notes ?? '{}') as Record<string, unknown>; } catch { notesObj = {}; }
    if (driverId) notesObj.driverId = driverId;
    if (driverName) notesObj.driverName = driverName;
    if (vehiclePlate) notesObj.vehiclePlate = vehiclePlate;
    notesObj.complianceOverride = true;
    notesObj.complianceOverrideApprovalId = row.id;
    notesObj.complianceOverrideReason = stringOrNull(op.overrideReason);
    patchData.notes = JSON.stringify(notesObj);
  }

  await prisma.booking.update({
    where: { id: bookingId },
    data: patchData,
  });

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS trip_status_history (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      booking_id TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL,
      changed_by TEXT, note TEXT, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`).catch(() => {});

  await prisma.$executeRawUnsafe(
    `INSERT INTO trip_status_history (booking_id, from_status, to_status, changed_by, note)
     VALUES ($1, $2, $3, $4, $5)`,
    bookingId,
    booking.status ?? 'PENDING',
    toStatus,
    ctx.userId,
    stringOrNull(op.overrideReason) ?? 'Approved Logistics compliance override',
  ).catch(() => {});

  await syncShipmentStatusFromBooking({
    tenantId,
    bookingId,
    status: toStatus,
    actorUserId: ctx.userId,
    note: stringOrNull(op.overrideReason) ?? row.summary,
    metadata: {
      vehicleId,
      driverId,
      driverName,
      vehiclePlate,
      complianceOverride: true,
      approvalRequestId: row.id,
    },
  });

  return {
    entityType: 'LogisticsTripStatus',
    entityId: bookingId,
    reused: false,
  };
}

export async function executeAdminApprovalAction(req: NextRequest, ctx: AdminContext, approvalId: string): Promise<NextResponse | null> {
  const state = await getApprovalState(approvalId);
  if (!state) return NextResponse.json({ error: 'Approval request not found' }, { status: 404 });
  if (state.status !== 'APPROVED') {
    return NextResponse.json({ error: 'Approval is not complete' }, { status: 409 });
  }
  if (state.execution_status === 'EXECUTED') {
    return NextResponse.json({ error: 'Approval already executed' }, { status: 409 });
  }

  const row = await loadApprovalRequest(approvalId);
  if (!row) return NextResponse.json({ error: 'Approval request not found' }, { status: 404 });

  let result: { entityType: string; entityId: string; reused?: boolean };
  switch (row.action) {
    case 'workflow.create':
      result = await executeWorkflowCreate(row);
      break;
    case 'workflow.delete':
      result = await executeWorkflowDelete(row);
      break;
    case 'service_config.rules.update':
      result = await executeServiceConfigRulesUpdate(row, ctx.userId);
      break;
    case 'service_config.rules.reset_override':
      result = await executeServiceConfigRulesReset(row, ctx.userId);
      break;
    case 'service_config.rules.rollback':
      result = await executeServiceConfigRulesRollback(row, ctx.userId);
      break;
    case 'service_config.category.create':
      result = await executeServiceConfigCategoryCreate(row);
      break;
    case 'service_config.type.create':
      result = await executeServiceConfigTypeCreate(row);
      break;
    case 'logistics.compliance_override.award':
      result = await executeLogisticsComplianceAward(row, ctx);
      break;
    case 'logistics.compliance_override.assignment':
      result = await executeLogisticsComplianceAssignment(row, ctx);
      break;
    case 'logistics.compliance_override.dispatch':
      result = await executeLogisticsComplianceDispatch(row, ctx);
      break;
    default:
      return null;
  }

  await markAdminApprovalExecuted(req, ctx, approvalId, {
    status: 'EXECUTED',
    action: row.action,
    entityType: result.entityType,
    entityId: result.entityId,
    reused: result.reused ?? false,
  });

  return NextResponse.json({
    ok: true,
    action: row.action,
    entityType: result.entityType,
    entityId: result.entityId,
    reused: result.reused ?? false,
  });
}

export function shouldAutoExecuteAdminApproval(action: string): boolean {
  return action === 'workflow.create'
    || action === 'workflow.delete'
    || action === 'service_config.rules.update'
    || action === 'service_config.rules.reset_override'
    || action === 'service_config.rules.rollback'
    || action.startsWith('logistics.compliance_override.');
}
