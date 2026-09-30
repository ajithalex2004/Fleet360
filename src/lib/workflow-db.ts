import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { withPlatformAdmin } from '@/lib/rls';
import { runOutsideRlsScope } from '@/lib/rls-scope';

/**
 * Tenant isolation (prisma/migrations/20261018090000_workflow_tenant_isolation):
 * all four tables carry "tenantId" and are under forced RLS. Queries here use
 * the global client, which runs each statement of an authenticated request
 * with that request's app.tenant_id (src/lib/prisma.ts), so a tenant sees its
 * own rows plus platform templates (definitions and steps with tenantId NULL,
 * read-only). Platform admins reach every tenant by running the call under
 * runAsTenant('*') (see withWorkflowCaller in src/lib/admin-scope.ts).
 * The engine functions also filter by tenant explicitly, so a connection that
 * bypasses RLS still cannot cross tenants.
 *
 * WorkflowDefinition / WorkflowStep / WorkflowInstance / WorkflowStepInstance
 * schema now lives in prisma/migrations/20260910000032_workflow_tables.
 * ensureWorkflowTables() used to lazily bootstrap it here on every call
 * (with a 42501 catch, since the runtime role has no CREATE privilege on
 * public schema in every live environment); callers no longer call it.
 */

// Row shapes below mirror the columns created in
// prisma/migrations/20260910000032_workflow_tables/migration.sql exactly —
// these tables are raw SQL (no Prisma model), so $queryRawUnsafe gives back
// untyped rows at runtime; these types just describe that same shape to the
// compiler and change no query or runtime behavior.
interface WorkflowDefinitionRow {
  id: string;
  name: string;
  module: string;
  procedure: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  serviceTypeId: string | null;
  tenantId: string | null;
  scopeId: string | null;
  defaultAssigneeType: string | null;
  defaultAssigneeEmail: string | null;
  defaultAssigneeRoleCode: string | null;
  defaultEmailSubject: string | null;
  defaultEmailBody: string | null;
  defaultSlaHours: number | null;
  defaultEscalationEmail: string | null;
  defaultEscalationHours: number | null;
}

interface WorkflowStepRow {
  id: string;
  workflowId: string;
  stepOrder: number;
  stepName: string;
  stepType: string;
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
  createdAt: Date;
}

interface WorkflowInstanceRow {
  id: string;
  workflowId: string;
  referenceType: string;
  referenceId: string;
  referenceNumber: string | null;
  currentStepOrder: number;
  status: string;
  initiatedByEmail: string | null;
  initiatedByName: string | null;
  initiatedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  tenantId: string | null;
}

interface WorkflowStepInstanceRow {
  id: string;
  workflowInstanceId: string;
  stepId: string;
  stepOrder: number;
  stepName: string;
  assignedToEmail: string | null;
  assignedToName: string | null;
  status: string;
  comments: string | null;
  actionedAt: Date | null;
  actionedByEmail: string | null;
  dueAt: Date | null;
  createdAt: Date;
  tenantId: string | null;
}

interface CountRow {
  workflowId: string;
  count: string;
}

//  Workflow Definition CRUD
/**
 * List workflows with optional filters. Backward-compatible signature —
 * pass a string for the legacy module-only filter, or an options object
 * for the Phase 2 service-type / tenant filters.
 */
export async function listWorkflows(filter?: string | {
  module?: string;
  serviceTypeId?: string;
  tenantId?: string;
}) {
  const opts = typeof filter === 'string' ? { module: filter } : (filter ?? {});
  const where: string[] = [];
  const args: string[] = [];
  let p = 1;
  if (opts.module)        { where.push(`module = $${p++}`);              args.push(opts.module); }
  if (opts.serviceTypeId) { where.push(`"serviceTypeId" = $${p++}`);     args.push(opts.serviceTypeId); }
  if (opts.tenantId)      { where.push(`"tenantId" = $${p++}`);          args.push(opts.tenantId); }
  const sql = where.length
    ? `SELECT * FROM "WorkflowDefinition" WHERE ${where.join(' AND ')} ORDER BY module, procedure`
    : `SELECT * FROM "WorkflowDefinition" ORDER BY module, procedure`;
  const rows: WorkflowDefinitionRow[] = await prisma.$queryRawUnsafe(sql, ...args);
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const counts: CountRow[] = await prisma.$queryRawUnsafe(
    `SELECT "workflowId", COUNT(*) as count FROM "WorkflowStep"
     WHERE "workflowId" = ANY($1::text[]) GROUP BY "workflowId"`, ids);
  // active instances per workflow
  const instances: CountRow[] = await prisma.$queryRawUnsafe<CountRow[]>(
    `SELECT "workflowId", COUNT(*) as count FROM "WorkflowInstance"
     WHERE "workflowId" = ANY($1::text[]) AND status='IN_PROGRESS' GROUP BY "workflowId"`, ids).catch(() => [] as CountRow[]);
  const countMap: Record<string, number> = {};
  const instanceMap: Record<string, number> = {};
  counts.forEach((c) => { countMap[c.workflowId] = parseInt(c.count); });
  instances.forEach((c) => { instanceMap[c.workflowId] = parseInt(c.count); });
  return rows.map(r => ({
    ...r,
    stepCount:       countMap[r.id] ?? 0,
    activeInstances: instanceMap[r.id] ?? 0,
  }));
}

/**
 * Phase 3 — canonical resolver. Returns the active workflow for a given
 * service type at a given scope, walking the scope chain up to the tenant
 * root. Falls back to a tenant-wide (scopeId IS NULL) workflow if no
 * scope-specific one exists. Returns null when nothing is configured.
 *
 * Consumers should prefer this over the legacy (module, procedure) lookup.
 */
export async function getActiveWorkflowForServiceType(args: {
  serviceTypeId: string;
  tenantId: string;
  /** Optional active scope. When provided, the resolver walks parent
   *  scopes via service_scopes.parent_scope_id until a matching workflow
   *  is found, or reaches the tenant root. */
  scopeId?: string | null;
}): Promise<{ id: string; name: string; isActive: boolean } | null> {
  const { serviceTypeId, tenantId, scopeId } = args;

  // Build the scope chain (leaf → root) so we resolve overrides correctly.
  let scopeChain: string[] = [];
  if (scopeId) {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `WITH RECURSIVE chain AS (
           SELECT id::text, parent_scope_id, 0 AS depth
             FROM service_scopes
            WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL
           UNION ALL
           SELECT s.id::text, s.parent_scope_id, c.depth + 1
             FROM service_scopes s
             JOIN chain c ON s.id = c.parent_scope_id
            WHERE s.tenant_id = $2 AND s.deleted_at IS NULL
         )
         SELECT id FROM chain ORDER BY depth ASC`,
        scopeId, tenantId,
      );
      scopeChain = rows.map(r => r.id);
    } catch { scopeChain = [scopeId]; }
  }

  // 1) Walk the scope chain, leaf-first.
  for (const sId of scopeChain) {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; isActive: boolean }>>(
      `SELECT id, name, "isActive"
         FROM "WorkflowDefinition"
        WHERE "serviceTypeId" = $1
          AND "tenantId"      = $2
          AND "scopeId"       = $3::uuid
          AND "isActive"      = true
        LIMIT 1`,
      serviceTypeId, tenantId, sId,
    );
    if (rows[0]) return rows[0];
  }

  // 2) Tenant-wide (scopeId IS NULL) — applies when no scope override.
  const tenantWide = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; isActive: boolean }>>(
    `SELECT id, name, "isActive"
       FROM "WorkflowDefinition"
      WHERE "serviceTypeId" = $1
        AND "tenantId"      = $2
        AND "scopeId"       IS NULL
        AND "isActive"      = true
      ORDER BY "createdAt" ASC
      LIMIT 1`,
    serviceTypeId, tenantId,
  );
  return tenantWide[0] ?? null;
}

export async function getWorkflowWithSteps(id: string) {
  const rows: WorkflowDefinitionRow[] = await prisma.$queryRawUnsafe(
    `SELECT * FROM "WorkflowDefinition" WHERE id = $1`, id);
  if (!rows.length) return null;
  const steps: WorkflowStepRow[] = await prisma.$queryRawUnsafe(
    `SELECT * FROM "WorkflowStep" WHERE "workflowId" = $1 ORDER BY "stepOrder"`, id);
  return { ...rows[0], steps };
}

/**
 * Tenant that owns a workflow definition: the tenant id, `null` for a
 * platform template (tenantId NULL), or `undefined` when it doesn't exist.
 */
export async function getWorkflowOwner(id: string): Promise<string | null | undefined> {
  const rows = await prisma.$queryRawUnsafe<Array<{ tenantId: string | null }>>(
    `SELECT "tenantId" FROM "WorkflowDefinition" WHERE id = $1`, id);
  return rows.length ? rows[0].tenantId : undefined;
}

/** Owner (see getWorkflowOwner) of the workflow a step belongs to. */
export async function getStepWorkflowOwner(stepId: string): Promise<string | null | undefined> {
  const rows = await prisma.$queryRawUnsafe<Array<{ tenantId: string | null }>>(
    `SELECT d."tenantId"
       FROM "WorkflowStep" s
       JOIN "WorkflowDefinition" d ON d.id = s."workflowId"
      WHERE s.id = $1`, stepId);
  return rows.length ? rows[0].tenantId : undefined;
}

export async function createWorkflow(data: {
  name: string; module: string; procedure: string; description?: string;
  // Phase 2 — canonical service-type / tenant linkage. Optional during the
  // transition; the legacy (module, procedure) keying still works.
  serviceTypeId?: string | null;
  tenantId?:      string | null;
  scopeId?:       string | null;
}) {
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "WorkflowDefinition"
       (id, name, module, procedure, description,
        "serviceTypeId", "tenantId", "scopeId")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid)`,
    id, data.name, data.module, data.procedure, data.description ?? null,
    data.serviceTypeId ?? null, data.tenantId ?? null, data.scopeId ?? null);
  return id;
}

export async function updateWorkflow(id: string, data: {
  name?: string; module?: string; procedure?: string; description?: string; isActive?: boolean;
  defaultAssigneeType?: string; defaultAssigneeEmail?: string; defaultAssigneeRoleCode?: string;
  defaultEmailSubject?: string; defaultEmailBody?: string;
  defaultSlaHours?: number; defaultEscalationEmail?: string; defaultEscalationHours?: number;
}) {
  await prisma.$executeRawUnsafe(
    `UPDATE "WorkflowDefinition"
     SET name=COALESCE($2,name),
         module=COALESCE($3,module),
         procedure=COALESCE($4,procedure),
         description=COALESCE($5,description),
         "isActive"=COALESCE($6,"isActive"),
         "defaultAssigneeType"=COALESCE($7,"defaultAssigneeType"),
         "defaultAssigneeEmail"=COALESCE($8,"defaultAssigneeEmail"),
         "defaultAssigneeRoleCode"=COALESCE($9,"defaultAssigneeRoleCode"),
         "defaultEmailSubject"=COALESCE($10,"defaultEmailSubject"),
         "defaultEmailBody"=COALESCE($11,"defaultEmailBody"),
         "defaultSlaHours"=COALESCE($12,"defaultSlaHours"),
         "defaultEscalationEmail"=COALESCE($13,"defaultEscalationEmail"),
         "defaultEscalationHours"=COALESCE($14,"defaultEscalationHours"),
         "updatedAt"=NOW()
     WHERE id=$1`,
    id, data.name ?? null, data.module ?? null, data.procedure ?? null,
    data.description ?? null, data.isActive ?? null,
    data.defaultAssigneeType ?? null, data.defaultAssigneeEmail ?? null,
    data.defaultAssigneeRoleCode ?? null, data.defaultEmailSubject ?? null,
    data.defaultEmailBody ?? null, data.defaultSlaHours ?? null,
    data.defaultEscalationEmail ?? null, data.defaultEscalationHours ?? null);
}

export async function deleteWorkflow(id: string) {
  await prisma.$executeRawUnsafe(`DELETE FROM "WorkflowStep" WHERE "workflowId" = $1`, id);
  await prisma.$executeRawUnsafe(`DELETE FROM "WorkflowDefinition" WHERE id = $1`, id);
}

/**
 * Copies a workflow and its steps. `tenantId` sets the owner of the copy;
 * omit it (platform admins) to create a platform template.
 */
export async function duplicateWorkflow(id: string, tenantId: string | null = null) {
  const original = await getWorkflowWithSteps(id);
  if (!original) throw new Error('Workflow not found');
  const newId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "WorkflowDefinition" (id, name, module, procedure, description, "isActive", "tenantId")
     VALUES ($1,$2,$3,$4,$5,false,$6)`,
    newId, `${original.name} (Copy)`, original.module, original.procedure, original.description ?? null,
    tenantId);
  for (const step of (original.steps ?? [])) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "WorkflowStep"
       (id,"workflowId","stepOrder","stepName","stepType","assigneeType","assigneeEmail",
        "assigneeRoleCode","multiApproverEmails","requireAllApprovers","emailSubject","emailBody",
        "slaHours","escalationEmail","escalationHours","conditionJson","isOptional","tenantId")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      randomUUID(), newId, step.stepOrder, step.stepName, step.stepType,
      step.assigneeType, step.assigneeEmail ?? null, step.assigneeRoleCode ?? null,
      step.multiApproverEmails ?? null, step.requireAllApprovers ?? false,
      step.emailSubject ?? null, step.emailBody ?? null, step.slaHours ?? 24,
      step.escalationEmail ?? null, step.escalationHours ?? 48,
      step.conditionJson ?? null, step.isOptional ?? false, tenantId);
  }
  return newId;
}

//  Global Stats 
/** Counts for one tenant (its own workflows plus platform templates), or
 *  for every tenant when `tenantId` is null (platform admins). */
export async function getWorkflowStats(tenantId: string | null) {
  const defScope = tenantId ? `WHERE ("tenantId" = $1 OR "tenantId" IS NULL)` : '';
  const runScope = tenantId ? `AND "tenantId" = $1` : '';
  const args = tenantId ? [tenantId] : [];
  const totals: Array<{ total: string; active: string }> = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) as total,
            SUM(CASE WHEN "isActive" THEN 1 ELSE 0 END) as active
     FROM "WorkflowDefinition" ${defScope}`, ...args);
  const pending: Array<{ count: string }> = await prisma.$queryRawUnsafe<Array<{ count: string }>>(
    `SELECT COUNT(*) as count FROM "WorkflowStepInstance" WHERE status='PENDING' ${runScope}`, ...args);
  const instances: Array<{ count: string }> = await prisma.$queryRawUnsafe<Array<{ count: string }>>(
    `SELECT COUNT(*) as count FROM "WorkflowInstance" WHERE status='IN_PROGRESS' ${runScope}`, ...args);
  return {
    total: parseInt(totals[0]?.total ?? '0'),
    active: parseInt(totals[0]?.active ?? '0'),
    pendingApprovals: parseInt(pending[0]?.count ?? '0'),
    activeInstances: parseInt(instances[0]?.count ?? '0'),
  };
}

//  Workflow Step CRUD
export async function listSteps(workflowId: string) {
  return prisma.$queryRawUnsafe<WorkflowStepRow[]>(
    `SELECT * FROM "WorkflowStep" WHERE "workflowId" = $1 ORDER BY "stepOrder"`, workflowId);
}

export async function createStep(workflowId: string, data: {
  stepOrder: number; stepName: string; stepType: string;
  assigneeType: string; assigneeEmail?: string; assigneeRoleCode?: string;
  multiApproverEmails?: string; requireAllApprovers?: boolean;
  emailSubject?: string; emailBody?: string; slaHours?: number;
  escalationEmail?: string; escalationHours?: number;
  conditionJson?: string; isOptional?: boolean;
}) {
  const id = randomUUID();
  // The step belongs to its workflow's tenant (NULL for a platform template).
  await prisma.$executeRawUnsafe(
    `INSERT INTO "WorkflowStep"
     (id,"workflowId","stepOrder","stepName","stepType","assigneeType","assigneeEmail",
      "assigneeRoleCode","multiApproverEmails","requireAllApprovers","emailSubject","emailBody",
      "slaHours","escalationEmail","escalationHours","conditionJson","isOptional","tenantId")
     SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,d."tenantId"
       FROM "WorkflowDefinition" d WHERE d.id = $2`,
    id, workflowId, data.stepOrder, data.stepName, data.stepType, data.assigneeType,
    data.assigneeEmail ?? null, data.assigneeRoleCode ?? null,
    data.multiApproverEmails ?? null, data.requireAllApprovers ?? false,
    data.emailSubject ?? null, data.emailBody ?? null, data.slaHours ?? 24,
    data.escalationEmail ?? null, data.escalationHours ?? 48,
    data.conditionJson ?? null, data.isOptional ?? false);
  return id;
}

export async function updateStep(stepId: string, data: {
  stepOrder?: number; stepName?: string; stepType?: string;
  assigneeType?: string; assigneeEmail?: string; assigneeRoleCode?: string;
  multiApproverEmails?: string; requireAllApprovers?: boolean;
  emailSubject?: string; emailBody?: string; slaHours?: number;
  escalationEmail?: string; escalationHours?: number;
  conditionJson?: string; isOptional?: boolean;
}) {
  await prisma.$executeRawUnsafe(
    `UPDATE "WorkflowStep" SET
      "stepOrder"=COALESCE($2,"stepOrder"),
      "stepName"=COALESCE($3,"stepName"),
      "stepType"=COALESCE($4,"stepType"),
      "assigneeType"=COALESCE($5,"assigneeType"),
      "assigneeEmail"=COALESCE($6,"assigneeEmail"),
      "assigneeRoleCode"=COALESCE($7,"assigneeRoleCode"),
      "multiApproverEmails"=COALESCE($8,"multiApproverEmails"),
      "requireAllApprovers"=COALESCE($9,"requireAllApprovers"),
      "emailSubject"=COALESCE($10,"emailSubject"),
      "emailBody"=COALESCE($11,"emailBody"),
      "slaHours"=COALESCE($12,"slaHours"),
      "escalationEmail"=COALESCE($13,"escalationEmail"),
      "escalationHours"=COALESCE($14,"escalationHours"),
      "conditionJson"=COALESCE($15,"conditionJson"),
      "isOptional"=COALESCE($16,"isOptional")
    WHERE id=$1`,
    stepId,
    data.stepOrder ?? null, data.stepName ?? null, data.stepType ?? null,
    data.assigneeType ?? null, data.assigneeEmail ?? null, data.assigneeRoleCode ?? null,
    data.multiApproverEmails ?? null, data.requireAllApprovers ?? null,
    data.emailSubject ?? null, data.emailBody ?? null, data.slaHours ?? null,
    data.escalationEmail ?? null, data.escalationHours ?? null,
    data.conditionJson ?? null, data.isOptional ?? null);
}

export async function deleteStep(stepId: string) {
  await prisma.$executeRawUnsafe(`DELETE FROM "WorkflowStep" WHERE id = $1`, stepId);
}

//  Workflow Engine
export async function triggerWorkflow(params: {
  // Canonical Phase 2 keying — preferred for new callers.
  serviceTypeId?: string;
  /** Tenant the approval runs in: always the caller's own (from the session). */
  tenantId:       string;
  scopeId?:       string | null;
  // Legacy keying — still supported. If serviceTypeId is provided, the
  // resolver tries that first and only falls back to (module, procedure).
  module?:    string;
  procedure?: string;
  referenceType: string; referenceId: string; referenceNumber: string;
  initiatedByEmail: string; initiatedByName?: string;
  // Accepted from callers (see src/app/api/workflow/trigger/route.ts) but not
  // yet persisted anywhere — WorkflowInstance has no column for it. Typed
  // as unknown rather than any so a future consumer still has to narrow it;
  // wiring it into storage is a schema change, tracked separately.
  contextData?: Record<string, unknown>;
  force?: boolean; // set true to re-trigger even if already in progress
}) {

  // Resolution order:
  //   1) (serviceTypeId, tenantId, scopeId) — Phase 2 canonical path
  //   2) (module, procedure)                — legacy fallback
  let wfRows: WorkflowDefinitionRow[] = [];
  const tenantId = params.tenantId;
  if (params.serviceTypeId) {
    const found = await getActiveWorkflowForServiceType({
      serviceTypeId: params.serviceTypeId,
      tenantId,
      scopeId:       params.scopeId ?? null,
    });
    if (found) {
      wfRows = await prisma.$queryRawUnsafe(
        `SELECT * FROM "WorkflowDefinition" WHERE id = $1 LIMIT 1`,
        found.id,
      );
    }
  }
  if (!wfRows.length && params.module && params.procedure) {
    // The tenant's own workflow first, else a platform template. Never
    // another tenant's: that started approvals on (and emailed the approvers
    // of) whichever tenant's workflow the database happened to return.
    wfRows = await prisma.$queryRawUnsafe(
      `SELECT * FROM "WorkflowDefinition"
       WHERE module=$1 AND procedure=$2 AND "isActive"=true
         AND ("tenantId" = $3 OR "tenantId" IS NULL)
       ORDER BY ("tenantId" IS NULL), "createdAt" ASC
       LIMIT 1`,
      params.module, params.procedure, tenantId);
  }
  if (!wfRows.length) {
    const key = params.serviceTypeId
      ? `serviceType=${params.serviceTypeId} tenant=${tenantId}`
      : `module=${params.module} procedure=${params.procedure}`;
    console.warn(`[Workflow] No active workflow for ${key}`);
    return { error: `No active workflow found for ${key}. Please define and activate one in Admin > Service Configuration > Workflow.` };
  }

  const wf = wfRows[0];

  // Idempotency: if an IN_PROGRESS instance already exists for this referenceId, return it
  if (!params.force) {
    const existing: Array<{ id: string }> = await prisma.$queryRawUnsafe(
      `SELECT id FROM "WorkflowInstance"
        WHERE "referenceId"=$1 AND "workflowId"=$2 AND "tenantId"=$3 AND status='IN_PROGRESS' LIMIT 1`,
      params.referenceId, wf.id, tenantId);
    if (existing.length) {
      console.info(`[Workflow] Reusing existing instance ${existing[0].id} for ${params.referenceNumber}`);
      return { instanceId: existing[0].id, workflowName: wf.name, reused: true };
    }
  }

  const steps: WorkflowStepRow[] = await prisma.$queryRawUnsafe(
    `SELECT * FROM "WorkflowStep" WHERE "workflowId"=$1 ORDER BY "stepOrder"`, wf.id);
  if (!steps.length) {
    console.warn(`[Workflow] Workflow "${wf.name}" has no steps. Add steps in Admin > Workflow Management.`);
    return { error: `Workflow "${wf.name}" has no steps configured. Add steps in Admin > Workflow Management.` };
  }

  const instanceId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "WorkflowInstance"
     (id,"workflowId","referenceType","referenceId","referenceNumber",
      "currentStepOrder",status,"initiatedByEmail","initiatedByName","tenantId")
     VALUES ($1,$2,$3,$4,$5,$6,'IN_PROGRESS',$7,$8,$9)`,
    instanceId, wf.id, params.referenceType, params.referenceId,
    params.referenceNumber, steps[0].stepOrder,
    params.initiatedByEmail, params.initiatedByName ?? null, tenantId);

  for (const step of steps) {
    const siId = randomUUID();
    const dueAt = step.slaHours
      ? new Date(Date.now() + step.slaHours * 3600000).toISOString() : null;
    const isPending = step.stepOrder === steps[0].stepOrder;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "WorkflowStepInstance"
       (id,"workflowInstanceId","stepId","stepOrder","stepName","assignedToEmail","assignedToName",status,"dueAt","tenantId")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamp,$10)`,
      siId, instanceId, step.id, step.stepOrder, step.stepName,
      step.assigneeEmail ?? null, null,
      isPending ? 'PENDING' : 'WAITING', dueAt, tenantId);
  }

  const firstStep = steps[0];
  if (firstStep.stepType === 'APPROVAL') {
    await notifyStepApprovers({
      tenantId, instanceId, workflow: wf, step: firstStep,
      referenceNumber: params.referenceNumber, referenceType: params.referenceType,
      submittedBy: params.initiatedByName || params.initiatedByEmail,
    });
  }
  if (firstStep.stepType === 'NOTIFICATION') {
    await advanceWorkflow(tenantId, instanceId, firstStep.stepOrder, 'AUTO',
      'Auto-advanced (notification step)', 'system');
  }

  return { instanceId, workflowName: wf.name };
}

export async function advanceWorkflow(
  tenantId: string, instanceId: string, currentStepOrder: number,
  action: 'APPROVE' | 'REJECT' | 'AUTO', comments: string, actionedByEmail: string
) {
  const actioned = await prisma.$executeRawUnsafe(
    `UPDATE "WorkflowStepInstance"
     SET status=$1, comments=$2, "actionedAt"=NOW(), "actionedByEmail"=$3
     WHERE "workflowInstanceId"=$4 AND "stepOrder"=$5 AND status='PENDING' AND "tenantId"=$6`,
    action === 'REJECT' ? 'REJECTED' : 'APPROVED',
    comments, actionedByEmail, instanceId, currentStepOrder, tenantId);
  // Nothing awaiting approval here (another tenant's instance, or a step
  // already actioned): change nothing else.
  if (!actioned) return { status: 'NOT_PENDING' as const };

  if (action === 'REJECT') {
    await prisma.$executeRawUnsafe(
      `UPDATE "WorkflowInstance"
       SET status='REJECTED',"completedAt"=NOW(),"updatedAt"=NOW() WHERE id=$1 AND "tenantId"=$2`,
      instanceId, tenantId);
    return { status: 'REJECTED' };
  }

  const nextSteps: WorkflowStepRow[] = await prisma.$queryRawUnsafe(
    `SELECT ws.* FROM "WorkflowStepInstance" wsi
     JOIN "WorkflowStep" ws ON ws.id=wsi."stepId"
     WHERE wsi."workflowInstanceId"=$1 AND wsi."stepOrder">$2 AND wsi.status='WAITING'
       AND wsi."tenantId"=$3
     ORDER BY wsi."stepOrder" LIMIT 1`,
    instanceId, currentStepOrder, tenantId);

  if (!nextSteps.length) {
    await prisma.$executeRawUnsafe(
      `UPDATE "WorkflowInstance"
       SET status='APPROVED',"completedAt"=NOW(),"updatedAt"=NOW() WHERE id=$1 AND "tenantId"=$2`,
      instanceId, tenantId);
    return { status: 'APPROVED' };
  }

  const nextStep = nextSteps[0];
  await prisma.$executeRawUnsafe(
    `UPDATE "WorkflowStepInstance" SET status='PENDING'
     WHERE "workflowInstanceId"=$1 AND "stepOrder"=$2 AND "tenantId"=$3`,
    instanceId, nextStep.stepOrder, tenantId);
  await prisma.$executeRawUnsafe(
    `UPDATE "WorkflowInstance" SET "currentStepOrder"=$1,"updatedAt"=NOW() WHERE id=$2 AND "tenantId"=$3`,
    nextStep.stepOrder, instanceId, tenantId);

  if (nextStep.stepType === 'APPROVAL') {
    const instance: WorkflowInstanceRow[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "WorkflowInstance" WHERE id=$1 AND "tenantId"=$2`, instanceId, tenantId);
    const workflow: WorkflowDefinitionRow[] = instance.length
      ? await prisma.$queryRawUnsafe(`SELECT * FROM "WorkflowDefinition" WHERE id=$1`, instance[0].workflowId)
      : [];
    if (instance.length && workflow.length) {
      await notifyStepApprovers({
        tenantId, instanceId, workflow: workflow[0], step: nextStep,
        referenceNumber: instance[0].referenceNumber ?? '', referenceType: instance[0].referenceType,
        submittedBy: instance[0].initiatedByName || instance[0].initiatedByEmail || '',
      });
    }
  }
  if (nextStep.stepType === 'NOTIFICATION') {
    return advanceWorkflow(tenantId, instanceId, nextStep.stepOrder, 'AUTO',
      'Auto-advanced (notification step)', 'system');
  }
  return { status: 'IN_PROGRESS', nextStep: nextStep.stepName };
}

interface PendingApprovalRow {
  stepInstanceId: string;
  workflowInstanceId: string;
  stepName: string;
  dueAt: Date | null;
  receivedAt: Date;
  referenceType: string;
  referenceId: string;
  referenceNumber: string | null;
  initiatedByEmail: string | null;
  initiatedByName: string | null;
  initiatedAt: Date;
  workflowName: string;
  module: string;
  procedure: string;
}

/**
 * Pending steps `email` may act on in `tenantId`: assigned to that address,
 * listed on a multi-user step, or on a role step whose role is one of
 * `roleCodes` (the caller's roles in the tenant).
 */
export async function getMyPendingApprovals(tenantId: string, email: string, roleCodes: string[] = []) {
  return prisma.$queryRawUnsafe<PendingApprovalRow[]>(`
    SELECT
      wsi.id as "stepInstanceId",
      wsi."workflowInstanceId",
      wsi."stepName",
      wsi."dueAt",
      wsi."createdAt" as "receivedAt",
      wi."referenceType",
      wi."referenceId",
      wi."referenceNumber",
      wi."initiatedByEmail",
      wi."initiatedByName",
      wi."initiatedAt",
      wd.name as "workflowName",
      wd.module,
      wd.procedure
    FROM "WorkflowStepInstance" wsi
    JOIN "WorkflowInstance" wi ON wi.id = wsi."workflowInstanceId"
    JOIN "WorkflowDefinition" wd ON wd.id = wi."workflowId"
    LEFT JOIN "WorkflowStep" ws ON ws.id = wsi."stepId"
    WHERE wsi.status = 'PENDING'
      AND wsi."tenantId" = $2
      AND (
        lower(wsi."assignedToEmail") = lower($1)
        OR (ws."assigneeType" = 'MULTI_USER'
            AND lower($1) = ANY(regexp_split_to_array(lower(coalesce(ws."multiApproverEmails", '')), '[,;[:space:]]+')))
        OR (ws."assigneeType" = 'ROLE' AND upper(ws."assigneeRoleCode") = ANY($3::text[]))
      )
    ORDER BY wsi."createdAt" DESC
  `, email, tenantId, roleCodes.map((c) => c.toUpperCase()));
}

/** An approval with its steps, if it belongs to `tenantId` (any tenant when null: platform admins). */
export async function getWorkflowInstanceWithHistory(instanceId: string, tenantId: string | null) {
  const instances: Array<WorkflowInstanceRow & { workflowName: string; module: string; procedure: string }> =
    await prisma.$queryRawUnsafe(`
    SELECT wi.*, wd.name as "workflowName", wd.module, wd.procedure
    FROM "WorkflowInstance" wi
    JOIN "WorkflowDefinition" wd ON wd.id=wi."workflowId"
    WHERE wi.id=$1 AND ($2::text IS NULL OR wi."tenantId" = $2)
  `, instanceId, tenantId);
  if (!instances.length) return null;
  // Steps with their step definition's assignee role, for the approver check.
  const stepInstances: Array<WorkflowStepInstanceRow & {
    assigneeType: string | null; assigneeRoleCode: string | null; multiApproverEmails: string | null;
  }> = await prisma.$queryRawUnsafe(
    `SELECT wsi.*, ws."assigneeType", ws."assigneeRoleCode", ws."multiApproverEmails"
       FROM "WorkflowStepInstance" wsi
       LEFT JOIN "WorkflowStep" ws ON ws.id = wsi."stepId"
      WHERE wsi."workflowInstanceId"=$1 AND wsi."tenantId" IS NOT DISTINCT FROM $2
      ORDER BY wsi."stepOrder"`,
    instanceId, instances[0].tenantId);
  return { ...instances[0], steps: stepInstances };
}

export async function getInstancesForReference(tenantId: string, referenceId: string) {
  return prisma.$queryRawUnsafe<Array<WorkflowInstanceRow & { workflowName: string; procedure: string }>>(`
    SELECT wi.*, wd.name as "workflowName", wd.procedure
    FROM "WorkflowInstance" wi
    JOIN "WorkflowDefinition" wd ON wd.id=wi."workflowId"
    WHERE wi."referenceId"=$1 AND wi."tenantId"=$2
    ORDER BY wi."createdAt" DESC
  `, referenceId, tenantId);
}

//  Approvers
/** Most approver emails a single step sends (a role can have many holders). */
export const MAX_STEP_APPROVER_EMAILS = 25;

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** Emails in a comma / semicolon / whitespace separated list, lower-cased. */
export function parseEmailList(value: string | null | undefined): string[] {
  return (value ?? '').split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE.test(e));
}

/**
 * Members of `tenantId` with an active membership whose role in that tenant
 * has `roleCode` (case-insensitive). Membership is what makes someone active
 * in a tenant; "User" has no active flag on every install. Runs in platform context with an explicit tenant filter:
 * users and memberships are read across the RLS boundary, like the session
 * user lookup (src/lib/session-user.ts).
 */
export async function getRoleHolders(tenantId: string, roleCode: string, limit = MAX_STEP_APPROVER_EMAILS) {
  const rows = await runOutsideRlsScope(() => withPlatformAdmin(prisma, (tx) => tx.userTenant.findMany({
    where: {
      tenantId,
      isActive: { not: false },
      role: { code: { equals: roleCode, mode: 'insensitive' } },
    },
    select: { user: { select: { email: true, firstName: true, lastName: true } } },
    take: limit,
  })));
  return rows
    .filter((r) => EMAIL_RE.test(r.user.email))
    .map((r) => ({
      email: r.user.email.toLowerCase(),
      name: [r.user.firstName, r.user.lastName].filter(Boolean).join(' ') || undefined,
    }));
}

/** Role codes `email` holds in `tenantId` (its membership role). */
export async function getUserRoleCodes(tenantId: string, email: string): Promise<string[]> {
  const rows = await runOutsideRlsScope(() => withPlatformAdmin(prisma, (tx) => tx.userTenant.findMany({
    where: { tenantId, isActive: { not: false }, user: { email: { equals: email, mode: 'insensitive' } } },
    select: { role: { select: { code: true } } },
  })));
  return rows.map((r) => r.role.code);
}

/**
 * Who is asked to act on a step:
 *   SPECIFIC_USER        its assignee email
 *   MULTI_USER           every address in its approver list (plus the assignee)
 *   ROLE                 every active member holding its role (plus the assignee)
 *   DIRECT_MANAGER /
 *   DEPARTMENT_HEAD      its assignee email only: no reporting lines are
 *                        recorded yet to resolve these
 * Capped at MAX_STEP_APPROVER_EMAILS, duplicates removed.
 */
export async function resolveStepApprovers(
  tenantId: string,
  step: Pick<WorkflowStepRow, 'assigneeType' | 'assigneeEmail' | 'assigneeRoleCode' | 'multiApproverEmails'>,
): Promise<Array<{ email: string; name?: string }>> {
  const found: Array<{ email: string; name?: string }> = parseEmailList(step.assigneeEmail).map((email) => ({ email }));
  if (step.assigneeType === 'MULTI_USER') {
    found.push(...parseEmailList(step.multiApproverEmails).map((email) => ({ email })));
  }
  if (step.assigneeType === 'ROLE' && step.assigneeRoleCode?.trim()) {
    found.push(...await getRoleHolders(tenantId, step.assigneeRoleCode.trim()));
  }
  const seen = new Set<string>();
  return found.filter((a) => !seen.has(a.email) && seen.add(a.email)).slice(0, MAX_STEP_APPROVER_EMAILS);
}

/**
 * Fills {name} and {{name}} placeholders (the workflow screen documents the
 * single-brace form). Unknown placeholders are left as written. Values are
 * inserted as plain text; the HTML email escapes the result.
 */
export function fillPlaceholders(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{?\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}?\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match);
}

const moduleLabel = (module: string) =>
  module.toLowerCase().replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Emails every approver of an approval step. Subject and body come from the
 * step, else the workflow's defaults, else built-in wording; each approver
 * gets their own copy with their name filled in. Best-effort: never throws.
 */
async function notifyStepApprovers(args: {
  tenantId: string; instanceId: string;
  workflow: Pick<WorkflowDefinitionRow, 'name' | 'module' | 'defaultEmailSubject' | 'defaultEmailBody'>;
  step: WorkflowStepRow;
  referenceNumber: string; referenceType: string; submittedBy: string;
}) {
  const { tenantId, instanceId, workflow, step } = args;
  let approvers: Array<{ email: string; name?: string }> = [];
  try {
    approvers = await resolveStepApprovers(tenantId, step);
  } catch (e) {
    console.error('[Workflow] Could not resolve approvers:', e instanceof Error ? e.message : e);
  }
  if (!approvers.length) {
    console.warn(`[Workflow] Step "${step.stepName}" of ${args.referenceNumber} has no approver to email (assignee type ${step.assigneeType}).`);
    return;
  }
  const approvalUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/approvals`;
  const subjectTemplate = step.emailSubject?.trim() || workflow.defaultEmailSubject?.trim()
    || 'Action Required: {referenceNumber} awaiting your approval';
  const bodyTemplate = step.emailBody?.trim() || workflow.defaultEmailBody?.trim()
    || 'Dear {approverName},\n\n{referenceNumber} ({referenceType}) has been submitted for your approval.\n\nStep: {stepName}\nSubmitted by: {submittedBy}\n\nPlease log in to Fleet360 to review and approve.';
  for (const approver of approvers) {
    const vars: Record<string, string> = {
      approverName: approver.name ?? 'Approver',
      approverEmail: approver.email,
      referenceNumber: args.referenceNumber,
      referenceType: args.referenceType,
      stepName: step.stepName,
      stepOrder: String(step.stepOrder),
      workflowName: workflow.name,
      moduleLabel: moduleLabel(workflow.module),
      submittedBy: args.submittedBy,
      approvalUrl,
    };
    await sendWorkflowEmail({
      to: approver.email,
      // One line: a line break in a subject could start a new mail header.
      subject: fillPlaceholders(subjectTemplate, vars).replace(/[\r\n]+/g, ' '),
      body: fillPlaceholders(bodyTemplate, vars),
      instanceId, referenceNumber: args.referenceNumber,
      referenceType: args.referenceType, stepName: step.stepName,
    });
  }
}

//  Email Sender
const escapeHtml = (v: string) => v
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The approval request email. Every interpolated value is escaped: step
 *  names, reference numbers and bodies come from tenant configuration. */
export function buildWorkflowEmailHtml(params: {
  body: string; referenceNumber: string; referenceType: string; stepName: string; approvalUrl: string;
}): string {
  const { body, referenceNumber, referenceType, stepName, approvalUrl } = params;
  return `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:24px;border-radius:12px;">
        <div style="background:linear-gradient(135deg,#6366f1,#4f46e5);padding:24px;border-radius:10px;margin-bottom:24px;">
          <h1 style="color:white;margin:0;font-size:20px;">Action Required</h1>
          <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;">Fleet360</p>
        </div>
        <div style="background:white;border-radius:10px;padding:24px;border:1px solid #e2e8f0;">
          <h2 style="color:#1e293b;margin:0 0 16px;font-size:18px;">${escapeHtml(stepName)}</h2>
          <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
            <tr><td style="padding:8px;background:#f1f5f9;border-radius:6px;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;">Reference</td><td style="padding:8px;color:#1e293b;font-weight:700;">${escapeHtml(referenceNumber)}</td></tr>
            <tr><td style="padding:8px;background:#f1f5f9;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;">Type</td><td style="padding:8px;color:#1e293b;">${escapeHtml(referenceType)}</td></tr>
          </table>
          <pre style="font-family:Arial,sans-serif;white-space:pre-wrap;color:#374151;line-height:1.6;">${escapeHtml(body)}</pre>
          <a href="${escapeHtml(approvalUrl)}" style="display:inline-block;margin-top:20px;background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Review &amp; Approve</a>
        </div>
        <p style="color:#94a3b8;font-size:12px;margin-top:16px;text-align:center;">Fleet360 Platform</p>
      </div>
    `;
}

/**
 * Sends an approval request through the platform email sender
 * (src/lib/email.ts: the SMTP settings under Admin > Settings >
 * Notifications, or SendGrid when SENDGRID_API_KEY is set).
 *
 * This used to read an "IntegrationConfig" row with columns that table does
 * not have ("isActive", a JSON "config"), so the query always failed and no
 * approval email was ever sent. Best-effort: a failed send is logged and
 * never fails the approval itself.
 */
async function sendWorkflowEmail(params: {
  to: string; subject: string; body: string;
  instanceId: string; referenceNumber: string; referenceType: string; stepName: string;
}) {
  try {
    const approvalUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/approvals`;
    // Loaded on use: the sender pulls in Sentry and env validation, which
    // modules importing this file (admin-scope, its tests) shouldn't need.
    const { sendEmail } = await import('@/lib/email');
    const result = await sendEmail({
      to: params.to,
      subject: params.subject,
      html: buildWorkflowEmailHtml({ ...params, approvalUrl }),
      text: `${params.body}\n\nReview: ${approvalUrl}`,
    });
    if (!result.sent) {
      console.warn(`[Workflow] Approval email for ${params.referenceNumber} not sent (${result.reason ?? 'unknown'})${
        result.reason === 'smtp_not_configured' ? ': set up SMTP in Admin > Settings > Notifications.' : ''}`);
    }
  } catch (e) {
    console.error('Workflow email error:', e instanceof Error ? e.message : e);
  }
}

// Returns ALL of a tenant's pending step instances (admin view - no email
// filter). Filtered on the instance's own tenant: the workflow's tenant is
// NULL for platform templates, whose approvals belong to whichever tenant
// started them (a filter on the definition showed those to every tenant).
interface AllPendingStepInstanceRow {
  stepInstanceId: string;
  workflowInstanceId: string;
  stepName: string;
  assignedToEmail: string | null;
  assignedToName: string | null;
  dueAt: Date | null;
  receivedAt: Date;
  stepStatus: string;
  referenceType: string;
  referenceId: string;
  referenceNumber: string | null;
  initiatedByEmail: string | null;
  initiatedByName: string | null;
  initiatedAt: Date;
  instanceStatus: string;
  workflowName: string;
  module: string;
  procedure: string;
}

export async function getAllPendingStepInstances(tenantId: string) {
  return prisma.$queryRawUnsafe<AllPendingStepInstanceRow[]>(`
    SELECT
      wsi.id as "stepInstanceId",
      wsi."workflowInstanceId",
      wsi."stepName",
      wsi."assignedToEmail",
      wsi."assignedToName",
      wsi."dueAt",
      wsi."createdAt" as "receivedAt",
      wsi.status as "stepStatus",
      wi."referenceType",
      wi."referenceId",
      wi."referenceNumber",
      wi."initiatedByEmail",
      wi."initiatedByName",
      wi."initiatedAt",
      wi.status as "instanceStatus",
      wd.name as "workflowName",
      wd.module,
      wd.procedure
    FROM "WorkflowStepInstance" wsi
    JOIN "WorkflowInstance" wi ON wi.id = wsi."workflowInstanceId"
    JOIN "WorkflowDefinition" wd ON wd.id = wi."workflowId"
    WHERE wsi.status = 'PENDING'
      AND wsi."tenantId" = $1
    ORDER BY wsi."createdAt" DESC
  `, tenantId);
}

// Returns all workflow instances (admin overview). See tenantId note above.
export async function getAllWorkflowInstances(
  tenantId: string,
  opts?: { status?: string; module?: string; limit?: number },
) {
  const conditions: string[] = ['wi."tenantId" = $1'];
  const values: string[] = [tenantId];
  let idx = 2;
  if (opts?.status) { conditions.push(`wi.status=$${idx++}`); values.push(opts.status); }
  if (opts?.module) { conditions.push(`wd.module=$${idx++}`); values.push(opts.module); }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const limit = opts?.limit ?? 100;
  return prisma.$queryRawUnsafe<Array<{
    id: string; status: string; referenceType: string; referenceId: string; referenceNumber: string | null;
    currentStepOrder: number; initiatedByEmail: string | null; initiatedAt: Date; completedAt: Date | null;
    workflowName: string; module: string; procedure: string;
    totalSteps: string; completedSteps: string;
  }>>(`
    SELECT
      wi.id, wi.status, wi."referenceType", wi."referenceId", wi."referenceNumber",
      wi."currentStepOrder", wi."initiatedByEmail", wi."initiatedAt", wi."completedAt",
      wd.name as "workflowName", wd.module, wd.procedure,
      (SELECT COUNT(*) FROM "WorkflowStepInstance" s WHERE s."workflowInstanceId"=wi.id) as "totalSteps",
      (SELECT COUNT(*) FROM "WorkflowStepInstance" s WHERE s."workflowInstanceId"=wi.id AND s.status='APPROVED') as "completedSteps"
    FROM "WorkflowInstance" wi
    JOIN "WorkflowDefinition" wd ON wd.id=wi."workflowId"
    ${where}
    ORDER BY wi."initiatedAt" DESC
    LIMIT ${limit}
  `, ...values);
}
