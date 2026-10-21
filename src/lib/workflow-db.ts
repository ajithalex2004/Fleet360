import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { runOutsideRlsScope } from '@/lib/rls-scope';
import {
  conditionApplies, levelOutcome, parseDecisions, positiveHours,
  type LevelDecision, type WorkflowContext,
} from '@/lib/workflow/levels';

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
  contextJson: unknown;
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
  /** Who may act on the level, resolved when it opened (20261021090000). */
  approverEmails: string[] | null;
  /** Each approver's decision (src/lib/workflow/levels.ts, LevelDecision). */
  approvals: unknown;
  activatedAt: Date | null;
  escalatedAt: Date | null;
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
//
// A workflow's steps are its approval levels, passed in step order
// (src/lib/workflow/levels.ts):
//   - a level whose condition doesn't hold for the approval's context (its
//     amount, …) is SKIPPED when the approval starts;
//   - a level opens (PENDING) only when the one before it is approved: its
//     approvers are resolved then (role holders, the submitter's manager or
//     department head, …), emailed, and its time limit starts;
//   - a level requiring all approvers waits for every one of them; otherwise
//     the first approval decides; any rejection rejects the approval;
//   - notification levels email (when they have their own wording) and pass;
//     auto-approve levels pass.
// When the last level passes, or one is rejected, the approval completes and
// the module that started it applies the outcome to its record
// (src/lib/workflow/subjects.ts).

export type WorkflowInstanceStatus = 'IN_PROGRESS' | 'APPROVED' | 'REJECTED';

export interface AdvanceResult {
  status: WorkflowInstanceStatus | 'NOT_PENDING' | 'ALREADY_DECIDED';
  /** The level now waiting, when the approval moved on to it. */
  nextStep?: string;
  /** Approvers the current level still waits for (levels requiring all). */
  waitingFor?: string[];
}

// ── One transaction per decision ────────────────────────────────────────────
//
// Starting or deciding an approval writes several rows (the decision, the
// level, the instance) and, when it ends, applies the outcome to the
// module's record. They run in one tenant transaction: all of it commits or
// none of it does. Side effects outside the database — approver emails, a
// module's after-hook — wait for the commit (afterCommit), so a decision
// that rolls back sends nothing.

const afterCommitQueue = new AsyncLocalStorage<Array<() => Promise<void>>>();

/** Run `job` once the current decision's transaction has committed. */
function afterCommit(job: () => Promise<void>): void {
  const queue = afterCommitQueue.getStore();
  if (queue) queue.push(job);
  else void job().catch((e) => console.warn('[Workflow] side effect failed:', e instanceof Error ? e.message : e));
}

async function inDecisionTransaction<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  const queue: Array<() => Promise<void>> = [];
  const result = await afterCommitQueue.run(queue, () => withTenantRls(prisma, tenantId, () => fn(), { timeoutMs: 60_000 }));
  for (const job of queue) {
    await job().catch((e) => console.warn('[Workflow] side effect failed:', e instanceof Error ? e.message : e));
  }
  return result;
}

/** The module could not apply an approval's outcome; nothing was changed. */
export class WorkflowOutcomeError extends Error {
  constructor(
    readonly outcome: 'APPROVED' | 'REJECTED',
    readonly referenceType: string,
    readonly referenceId: string,
    readonly cause: unknown,
  ) {
    super(`Could not apply the ${outcome.toLowerCase()} outcome to ${referenceType} ${referenceId}: `
      + (cause instanceof Error ? cause.message : String(cause)));
    this.name = 'WorkflowOutcomeError';
  }
}

/** Start an approval for a record (see triggerWorkflowInTx). One transaction. */
export async function triggerWorkflow(
  params: Parameters<typeof triggerWorkflowInTx>[0],
): ReturnType<typeof triggerWorkflowInTx> {
  return inDecisionTransaction(params.tenantId, () => triggerWorkflowInTx(params));
}

/**
 * Record a decision and move the approval on (see advanceWorkflowInTx).
 * One transaction: when it ends the approval, a failure to apply the
 * outcome throws WorkflowOutcomeError and nothing — not even the decision —
 * is recorded.
 */
export async function advanceWorkflow(
  ...args: Parameters<typeof advanceWorkflowInTx>
): ReturnType<typeof advanceWorkflowInTx> {
  return inDecisionTransaction(args[0], () => advanceWorkflowInTx(...args));
}

async function triggerWorkflowInTx(params: {
  // Canonical Phase 2 keying — preferred for new callers.
  serviceTypeId?: string;
  /** Tenant the approval runs in: always the caller's own (from the session). */
  tenantId:       string;
  scopeId?:       string | null;
  // Legacy keying — still supported. If serviceTypeId is provided, the
  // resolver tries that first and only falls back to (module, procedure).
  module?:    string;
  procedure?: string;
  /** Only the tenant's own workflow, never a platform template. */
  tenantOnly?: boolean;
  referenceType: string; referenceId: string; referenceNumber: string;
  initiatedByEmail: string; initiatedByName?: string;
  /**
   * What is being approved (amount, …). Each level's condition is evaluated
   * against it, so it must come from the record on the server, never from
   * the request (see src/lib/workflow/subjects.ts).
   */
  contextData?: WorkflowContext;
  force?: boolean; // set true to re-trigger even if already in progress
}): Promise<{ error: string } | { instanceId: string; workflowName: string; status: WorkflowInstanceStatus; reused?: boolean; nextStep?: string }> {

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
    // The tenant's own workflow first, else (unless tenantOnly) a platform
    // template. Never another tenant's: that started approvals on (and
    // emailed the approvers of) whichever tenant's workflow the database
    // happened to return.
    wfRows = await prisma.$queryRawUnsafe(
      `SELECT * FROM "WorkflowDefinition"
       WHERE module=$1 AND procedure=$2 AND "isActive"=true
         AND ("tenantId" = $3 OR ($4::boolean = false AND "tenantId" IS NULL))
       ORDER BY ("tenantId" IS NULL), "createdAt" ASC
       LIMIT 1`,
      params.module, params.procedure, tenantId, params.tenantOnly === true);
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
      return { instanceId: existing[0].id, workflowName: wf.name, reused: true, status: 'IN_PROGRESS' };
    }
  }

  const steps: WorkflowStepRow[] = await prisma.$queryRawUnsafe(
    `SELECT * FROM "WorkflowStep" WHERE "workflowId"=$1 ORDER BY "stepOrder"`, wf.id);
  if (!steps.length) {
    console.warn(`[Workflow] Workflow "${wf.name}" has no steps. Add steps in Admin > Workflow Management.`);
    return { error: `Workflow "${wf.name}" has no steps configured. Add steps in Admin > Workflow Management.` };
  }

  const context = params.contextData ?? {};
  const instanceId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "WorkflowInstance"
     (id,"workflowId","referenceType","referenceId","referenceNumber",
      "currentStepOrder",status,"initiatedByEmail","initiatedByName","tenantId","contextJson")
     VALUES ($1,$2,$3,$4,$5,$6,'IN_PROGRESS',$7,$8,$9,$10::jsonb)`,
    instanceId, wf.id, params.referenceType, params.referenceId,
    params.referenceNumber, steps[0].stepOrder,
    params.initiatedByEmail, params.initiatedByName ?? null, tenantId, JSON.stringify(context));

  // Every level is recorded; those whose condition doesn't hold are skipped.
  for (const step of steps) {
    const applies = conditionApplies(step.conditionJson, context);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "WorkflowStepInstance"
       (id,"workflowInstanceId","stepId","stepOrder","stepName","assignedToEmail",status,comments,"tenantId")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      randomUUID(), instanceId, step.id, step.stepOrder, step.stepName,
      step.assigneeEmail ?? null, applies ? 'WAITING' : 'SKIPPED',
      applies ? null : 'Not needed: the level\'s condition does not apply', tenantId);
  }

  const opened = await openNextLevel(tenantId, instanceId, null, { actor: params.initiatedByEmail });
  return { instanceId, workflowName: wf.name, status: opened.status as WorkflowInstanceStatus, nextStep: opened.nextStep };
}

interface InstanceHead {
  id: string; workflowId: string; referenceType: string; referenceId: string;
  referenceNumber: string | null; initiatedByEmail: string | null; initiatedByName: string | null;
  status: string; contextJson: unknown;
}

async function loadInstanceHead(tenantId: string, instanceId: string): Promise<InstanceHead | null> {
  const rows = await prisma.$queryRawUnsafe<InstanceHead[]>(
    `SELECT id, "workflowId", "referenceType", "referenceId", "referenceNumber",
            "initiatedByEmail", "initiatedByName", status, "contextJson"
       FROM "WorkflowInstance" WHERE id=$1 AND "tenantId"=$2`, instanceId, tenantId);
  return rows[0] ?? null;
}

/**
 * Opens the next level waiting after `afterOrder` (the first when null),
 * passing notification and auto-approve levels, and completes the approval
 * as APPROVED when none is left.
 */
async function openNextLevel(
  tenantId: string, instanceId: string, afterOrder: number | null,
  last: { actor: string; comments?: string },
): Promise<AdvanceResult> {
  const head = await loadInstanceHead(tenantId, instanceId);
  if (!head) return { status: 'NOT_PENDING' };
  let after = afterOrder;
  // Bounded: one pass per level at most.
  for (let guard = 0; guard < 200; guard++) {
    const next = await prisma.$queryRawUnsafe<Array<WorkflowStepRow & { stepInstanceId: string }>>(
      `SELECT ws.*, wsi.id AS "stepInstanceId"
         FROM "WorkflowStepInstance" wsi
         JOIN "WorkflowStep" ws ON ws.id = wsi."stepId"
        WHERE wsi."workflowInstanceId"=$1 AND wsi."tenantId"=$2 AND wsi.status='WAITING'
          AND ($3::int IS NULL OR wsi."stepOrder" > $3::int)
        ORDER BY wsi."stepOrder", wsi."createdAt" LIMIT 1`,
      instanceId, tenantId, after);
    if (!next.length) return completeInstance(tenantId, instanceId, 'APPROVED', last.actor, last.comments ?? '');
    const step = next[0];
    after = step.stepOrder;

    const passes = step.stepType === 'NOTIFICATION' || step.stepType === 'AUTO_APPROVE';
    let approvers: Array<{ email: string; name?: string }> = [];
    if (!passes || step.stepType === 'NOTIFICATION') {
      try {
        approvers = await resolveStepApprovers(tenantId, step, head.initiatedByEmail);
      } catch (e) {
        console.error('[Workflow] Could not resolve approvers:', e instanceof Error ? e.message : e);
      }
    }
    const sla = positiveHours(step.slaHours, 0);
    const opened = await prisma.$executeRawUnsafe(
      `UPDATE "WorkflowStepInstance"
          SET status='PENDING', "activatedAt"=NOW(),
              "dueAt" = CASE WHEN $3::int > 0 THEN NOW() + make_interval(hours => $3::int) END,
              "approverEmails"=$4::text[],
              "assignedToEmail"=COALESCE($5, "assignedToEmail"),
              "assignedToName"=$6
        WHERE id=$1 AND "tenantId"=$2 AND status='WAITING'`,
      step.stepInstanceId, tenantId, Math.round(sla), approvers.map((a) => a.email),
      approvers[0]?.email ?? null, approvers.length === 1 ? approvers[0].name ?? null : null);
    // Opened by a concurrent decision: it carries on from there.
    if (!opened) return { status: 'IN_PROGRESS' };
    await prisma.$executeRawUnsafe(
      `UPDATE "WorkflowInstance" SET "currentStepOrder"=$1,"updatedAt"=NOW() WHERE id=$2 AND "tenantId"=$3`,
      step.stepOrder, instanceId, tenantId);

    const workflow = await prisma.$queryRawUnsafe<WorkflowDefinitionRow[]>(
      `SELECT * FROM "WorkflowDefinition" WHERE id=$1`, head.workflowId);
    const notify = {
      tenantId, instanceId, workflow: workflow[0] ?? { name: '', module: '', defaultEmailSubject: null, defaultEmailBody: null },
      step, approvers,
      referenceNumber: head.referenceNumber ?? '', referenceType: head.referenceType,
      submittedBy: head.initiatedByName || head.initiatedByEmail || '',
    };

    if (!passes) {
      if (!approvers.length) {
        console.warn(`[Workflow] Level "${step.stepName}" of ${head.referenceNumber} has no approver (assignee type ${step.assigneeType}); a tenant administrator can decide it.`);
      }
      afterCommit(() => notifyStepApprovers(notify));
      return { status: 'IN_PROGRESS', nextStep: step.stepName };
    }
    // A notification level emails only with its own wording: the default
    // email asks for an approval it doesn't need.
    if (step.stepType === 'NOTIFICATION' && step.emailSubject?.trim() && step.emailBody?.trim()) {
      afterCommit(() => notifyStepApprovers(notify));
    }
    await prisma.$executeRawUnsafe(
      `UPDATE "WorkflowStepInstance"
          SET status='APPROVED', comments=$2, "actionedAt"=NOW(), "actionedByEmail"='system'
        WHERE id=$1 AND status='PENDING'`,
      step.stepInstanceId,
      step.stepType === 'NOTIFICATION' ? 'Notification level: passed automatically' : 'Approved automatically');
  }
  return { status: 'IN_PROGRESS' };
}

/**
 * Ends an approval and lets the module that started it apply the outcome
 * to its record (once: only the call that ends it does).
 */
async function completeInstance(
  tenantId: string, instanceId: string, status: 'APPROVED' | 'REJECTED', actor: string, comments: string,
): Promise<AdvanceResult> {
  const ended = await prisma.$executeRawUnsafe(
    `UPDATE "WorkflowInstance"
        SET status=$1, "completedAt"=NOW(), "updatedAt"=NOW()
      WHERE id=$2 AND "tenantId"=$3 AND status='IN_PROGRESS'`,
    status, instanceId, tenantId);
  if (!ended) return { status };
  if (status === 'REJECTED') {
    // Levels that never opened won't: they are no longer needed.
    await prisma.$executeRawUnsafe(
      `UPDATE "WorkflowStepInstance" SET status='SKIPPED', comments='Not needed: the approval was rejected'
        WHERE "workflowInstanceId"=$1 AND "tenantId"=$2 AND status='WAITING'`,
      instanceId, tenantId);
  }
  const head = await loadInstanceHead(tenantId, instanceId);
  if (head) {
    // In the same transaction as the status change above. This used to log
    // and swallow a failure: the approval read APPROVED, the caller got a
    // success, the record stayed in its old state, and a retry was refused
    // as "already APPROVED". Now a failure rolls the whole decision back
    // and reaches the caller, who can try again.
    // Loaded on use: the module handlers pull in their modules' code.
    const { applyWorkflowOutcomeInTx } = await import('@/lib/workflow/subjects');
    let after: (() => Promise<void>) | void;
    try {
      after = await applyWorkflowOutcomeInTx({
        tenantId, instanceId, status, actorEmail: actor, comments,
        referenceType: head.referenceType, referenceId: head.referenceId,
        context: (head.contextJson && typeof head.contextJson === 'object' ? head.contextJson : {}) as WorkflowContext,
      });
    } catch (e) {
      throw new WorkflowOutcomeError(status, head.referenceType, head.referenceId, e);
    }
    if (after) {
      const run = after;
      afterCommit(() => run());
    }
  }
  return { status };
}

/**
 * Records a decision on the level at `currentStepOrder` and moves the
 * approval on when the level is decided. `override` is a tenant
 * administrator deciding the level for its approvers. 'AUTO' passes the
 * level (system use).
 */
async function advanceWorkflowInTx(
  tenantId: string, instanceId: string, currentStepOrder: number,
  action: 'APPROVE' | 'REJECT' | 'AUTO', comments: string, actionedByEmail: string,
  opts: { override?: boolean } = {},
): Promise<AdvanceResult> {
  if (action === 'AUTO') {
    const passed = await prisma.$executeRawUnsafe(
      `UPDATE "WorkflowStepInstance"
          SET status='APPROVED', comments=$1, "actionedAt"=NOW(), "actionedByEmail"=$2
        WHERE "workflowInstanceId"=$3 AND "stepOrder"=$4 AND status='PENDING' AND "tenantId"=$5`,
      comments, actionedByEmail, instanceId, currentStepOrder, tenantId);
    if (!passed) return { status: 'NOT_PENDING' };
    return openNextLevel(tenantId, instanceId, currentStepOrder, { actor: actionedByEmail, comments });
  }

  const email = actionedByEmail.trim().toLowerCase();
  const decision: LevelDecision = {
    email, action, at: new Date().toISOString(), comments: comments || null,
    ...(opts.override ? { override: true } : {}),
  };
  // One decision per person per level, appended atomically: concurrent
  // approvers on an all-approvers level each see the others' decisions.
  const recorded = await prisma.$queryRawUnsafe<Array<{
    id: string; approvals: unknown; approverEmails: string[] | null; requireAll: boolean | null;
  }>>(
    `UPDATE "WorkflowStepInstance" wsi
        SET approvals = COALESCE(wsi.approvals, '[]'::jsonb) || $1::jsonb
      WHERE wsi."workflowInstanceId"=$2 AND wsi."stepOrder"=$3 AND wsi.status='PENDING' AND wsi."tenantId"=$4
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(wsi.approvals, '[]'::jsonb)) d WHERE lower(d->>'email') = $5)
      RETURNING wsi.id, wsi.approvals, wsi."approverEmails",
        (SELECT ws."requireAllApprovers" FROM "WorkflowStep" ws WHERE ws.id = wsi."stepId") AS "requireAll"`,
    JSON.stringify([decision]), instanceId, currentStepOrder, tenantId, email);
  if (!recorded.length) {
    const mine = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT wsi.id FROM "WorkflowStepInstance" wsi
        WHERE wsi."workflowInstanceId"=$1 AND wsi."stepOrder"=$2 AND wsi.status='PENDING' AND wsi."tenantId"=$3
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(wsi.approvals, '[]'::jsonb)) d WHERE lower(d->>'email') = $4)`,
      instanceId, currentStepOrder, tenantId, email);
    return { status: mine.length ? 'ALREADY_DECIDED' : 'NOT_PENDING' };
  }
  const row = recorded[0];
  const outcome = levelOutcome({
    requireAll: row.requireAll === true,
    approverEmails: row.approverEmails ?? [],
    decisions: parseDecisions(row.approvals),
  });
  if (outcome.status === 'PENDING') return { status: 'IN_PROGRESS', waitingFor: outcome.waitingFor };

  const decided = await prisma.$executeRawUnsafe(
    `UPDATE "WorkflowStepInstance"
        SET status=$1, comments=$2, "actionedAt"=NOW(), "actionedByEmail"=$3
      WHERE id=$4 AND status='PENDING'`,
    outcome.status, comments, actionedByEmail, row.id);
  // Decided by a concurrent decision: it moves the approval on.
  if (!decided) return { status: 'IN_PROGRESS' };
  if (outcome.status === 'REJECTED') return completeInstance(tenantId, instanceId, 'REJECTED', actionedByEmail, comments);
  return openNextLevel(tenantId, instanceId, currentStepOrder, { actor: actionedByEmail, comments });
}

/** The approval in progress for a record, if any. */
export async function getActiveInstanceForReference(tenantId: string, referenceType: string, referenceId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string; workflowName: string; currentStepOrder: number; stepName: string | null; contextJson: unknown;
  }>>(
    `SELECT wi.id, wd.name AS "workflowName", wi."currentStepOrder", wi."contextJson",
            (SELECT s."stepName" FROM "WorkflowStepInstance" s
              WHERE s."workflowInstanceId" = wi.id AND s.status = 'PENDING' ORDER BY s."stepOrder" LIMIT 1) AS "stepName"
       FROM "WorkflowInstance" wi
       JOIN "WorkflowDefinition" wd ON wd.id = wi."workflowId"
      WHERE wi."tenantId"=$1 AND wi."referenceType"=$2 AND wi."referenceId"=$3 AND wi.status='IN_PROGRESS'
      ORDER BY wi."initiatedAt" DESC LIMIT 1`,
    tenantId, referenceType, referenceId).catch((e) => {
    // Deployed before 20261021090000 ran: no module approval can be running.
    if (isMissingWorkflowColumn(e)) return [];
    throw e;
  });
  return rows[0] ?? null;
}

/** Whether a record's latest approval (any status) was approved. */
export async function latestInstanceStatusForReference(tenantId: string, referenceType: string, referenceId: string): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ status: string }>>(
    `SELECT status FROM "WorkflowInstance"
      WHERE "tenantId"=$1 AND "referenceType"=$2 AND "referenceId"=$3
      ORDER BY "initiatedAt" DESC LIMIT 1`,
    tenantId, referenceType, referenceId).catch((e) => {
    if (isMissingWorkflowColumn(e)) return [];
    throw e;
  });
  return rows[0]?.status ?? null;
}

/**
 * Withdraws the approval running for a record that was cancelled in its
 * module: it ends CANCELLED (no outcome to apply) and leaves the approvers'
 * inboxes. Returns whether one was running.
 */
export async function cancelActiveInstancesForReference(
  tenantId: string, referenceType: string, referenceId: string, reason: string,
): Promise<boolean> {
  const ended = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE "WorkflowInstance" SET status='CANCELLED', "completedAt"=NOW(), "updatedAt"=NOW()
      WHERE "tenantId"=$1 AND "referenceType"=$2 AND "referenceId"=$3 AND status='IN_PROGRESS'
      RETURNING id`,
    tenantId, referenceType, referenceId);
  if (!ended.length) return false;
  await prisma.$executeRawUnsafe(
    `UPDATE "WorkflowStepInstance" SET status='SKIPPED', comments=$3
      WHERE "workflowInstanceId" = ANY($1::text[]) AND "tenantId"=$2 AND status IN ('PENDING', 'WAITING')`,
    ended.map((e) => e.id), tenantId, `Withdrawn: ${reason}`);
  return true;
}

/** Whether the tenant has its own active workflow, with levels, for a module's procedure. */
export async function hasTenantWorkflow(tenantId: string, module: string, procedure: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT d.id FROM "WorkflowDefinition" d
      WHERE d.module=$1 AND d.procedure=$2 AND d."isActive"=true AND d."tenantId"=$3
        AND EXISTS (SELECT 1 FROM "WorkflowStep" s WHERE s."workflowId" = d.id)
      LIMIT 1`,
    module, procedure, tenantId);
  return rows.length > 0;
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
  requireAllApprovers: boolean | null;
  approverEmails: string[] | null;
  approvals: unknown;
  /** When the level opened, its escalation (job run) and what is being approved. */
  openedAt?: Date | null;
  escalatedAt?: Date | null;
  escalationHours?: number | null;
  escalationEmail?: string | null;
  contextJson?: unknown;
}

/** SLA / escalation columns of a pending level (activatedAt, escalatedAt: 20261021090000). */
const LEVEL_SLA_COLUMNS = `
      COALESCE(wsi."activatedAt", wsi."createdAt") as "openedAt",
      wsi."escalatedAt",
      COALESCE(NULLIF(ws."escalationHours", 0), NULLIF(wd."defaultEscalationHours", 0), 48) as "escalationHours",
      COALESCE(NULLIF(trim(ws."escalationEmail"), ''), NULLIF(trim(wd."defaultEscalationEmail"), '')) as "escalationEmail",
      wi."contextJson"`;

/**
 * Pending steps `email` may act on in `tenantId`: assigned to that address,
 * among the approvers resolved when the level opened, listed on a
 * multi-user step, or on a role step whose role is one of `roleCodes` (the
 * caller's roles in the tenant). Levels `email` has already approved (an
 * all-approvers level waiting for others) are left out.
 */
export async function getMyPendingApprovals(tenantId: string, email: string, roleCodes: string[] = []) {
  const query = (levels: boolean) => prisma.$queryRawUnsafe<PendingApprovalRow[]>(`
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
      wd.procedure,
      ws."requireAllApprovers"${levels ? `,
      wsi."approverEmails",
      wsi.approvals,${LEVEL_SLA_COLUMNS}` : ''}
    FROM "WorkflowStepInstance" wsi
    JOIN "WorkflowInstance" wi ON wi.id = wsi."workflowInstanceId"
    JOIN "WorkflowDefinition" wd ON wd.id = wi."workflowId"
    LEFT JOIN "WorkflowStep" ws ON ws.id = wsi."stepId"
    WHERE wsi.status = 'PENDING'
      AND wsi."tenantId" = $2${levels ? `
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(wsi.approvals, '[]'::jsonb)) d WHERE lower(d->>'email') = lower($1))` : ''}
      AND (
        lower(wsi."assignedToEmail") = lower($1)${levels ? `
        OR lower($1) = ANY(SELECT lower(a) FROM unnest(COALESCE(wsi."approverEmails", '{}'::text[])) a)` : ''}
        OR (ws."assigneeType" = 'MULTI_USER'
            AND lower($1) = ANY(regexp_split_to_array(lower(coalesce(ws."multiApproverEmails", '')), '[,;[:space:]]+')))
        OR (ws."assigneeType" = 'ROLE' AND upper(ws."assigneeRoleCode") = ANY($3::text[]))
      )
    ORDER BY wsi."createdAt" DESC
  `, email, tenantId, roleCodes.map((c) => c.toUpperCase()));
  try {
    return await query(true);
  } catch (e) {
    // Deployed before 20261021090000 ran: the inbox as it was.
    if (!isMissingWorkflowColumn(e)) throw e;
    return query(false);
  }
}

/**
 * Pending levels escalated to `email` (it is their escalation contact and
 * the workflow-escalation job has emailed it), in `tenantId`. Shown in the
 * escalation contact's inbox; deciding them stays with the level's
 * approvers or a tenant administrator.
 */
export async function getEscalatedToMe(tenantId: string, email: string) {
  try {
    return await prisma.$queryRawUnsafe<PendingApprovalRow[]>(`
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
        wd.procedure,
        ws."requireAllApprovers",
        wsi."approverEmails",
        wsi.approvals,${LEVEL_SLA_COLUMNS}
      FROM "WorkflowStepInstance" wsi
      JOIN "WorkflowInstance" wi ON wi.id = wsi."workflowInstanceId" AND wi.status = 'IN_PROGRESS'
      JOIN "WorkflowDefinition" wd ON wd.id = wi."workflowId"
      LEFT JOIN "WorkflowStep" ws ON ws.id = wsi."stepId"
      WHERE wsi.status = 'PENDING'
        AND wsi."tenantId" = $2
        AND wsi."escalatedAt" IS NOT NULL
        AND lower($1) = ANY(regexp_split_to_array(lower(COALESCE(
              NULLIF(trim(ws."escalationEmail"), ''), NULLIF(trim(wd."defaultEscalationEmail"), ''), '')), '[,;[:space:]]+'))
      ORDER BY wsi."escalatedAt"
      LIMIT 200
    `, email, tenantId);
  } catch (e) {
    if (!isMissingWorkflowColumn(e)) throw e;
    return [];
  }
}

/** A query on a workflow column added by 20261021090000 before that migration ran. */
export function isMissingWorkflowColumn(e: unknown): boolean {
  const err = e as { code?: string; meta?: { code?: string }; message?: string };
  return err?.code === '42703' || err?.meta?.code === '42703' || /column .* does not exist/i.test(err?.message ?? '');
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
    requireAllApprovers: boolean | null; stepType: string | null;
  }> = await prisma.$queryRawUnsafe(
    `SELECT wsi.*, ws."assigneeType", ws."assigneeRoleCode", ws."multiApproverEmails",
            ws."requireAllApprovers", ws."stepType"
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

/**
 * Whether `email` is a member of `tenantId`: ACTIVE, INACTIVE (every
 * membership deactivated) or NONE (no account there, e.g. an outside
 * approver named by email on a step).
 */
export async function getMembershipStatus(tenantId: string, email: string): Promise<'ACTIVE' | 'INACTIVE' | 'NONE'> {
  const rows = await runOutsideRlsScope(() => withPlatformAdmin(prisma, (tx) => tx.userTenant.findMany({
    where: { tenantId, user: { email: { equals: email, mode: 'insensitive' } } },
    select: { isActive: true },
  })));
  if (!rows.length) return 'NONE';
  // A deactivated membership can no longer decide anything.
  return rows.some((r) => r.isActive !== false) ? 'ACTIVE' : 'INACTIVE';
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
 *   DEPARTMENT_HEAD      the submitter's manager / department head in this
 *                        company (Admin > Users), else its assignee email
 * Capped at MAX_STEP_APPROVER_EMAILS, duplicates removed.
 */
export async function resolveStepApprovers(
  tenantId: string,
  step: Pick<WorkflowStepRow, 'assigneeType' | 'assigneeEmail' | 'assigneeRoleCode' | 'multiApproverEmails'>,
  submitterEmail?: string | null,
): Promise<Array<{ email: string; name?: string }>> {
  const assignee = parseEmailList(step.assigneeEmail).map((email) => ({ email }));
  const found: Array<{ email: string; name?: string }> = [];
  if (step.assigneeType === 'DIRECT_MANAGER' || step.assigneeType === 'DEPARTMENT_HEAD') {
    const line = submitterEmail
      ? await getReportingLine(tenantId, submitterEmail, step.assigneeType === 'DIRECT_MANAGER' ? 'manager' : 'departmentHead')
      : null;
    found.push(...(line ? [line] : assignee));
  } else {
    found.push(...assignee);
  }
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
 * The manager or department head recorded for `email` in `tenantId`
 * (user_tenants.manager_user_id / department_head_user_id), if they are an
 * active member of that company. Platform context with an explicit tenant
 * filter, like getRoleHolders.
 */
export async function getReportingLine(
  tenantId: string, email: string, line: 'manager' | 'departmentHead',
): Promise<{ email: string; name?: string } | null> {
  return runOutsideRlsScope(() => withPlatformAdmin(prisma, async (tx) => {
    const member = await tx.userTenant.findFirst({
      where: { tenantId, isActive: { not: false }, user: { email: { equals: email, mode: 'insensitive' } } },
      select: { managerUserId: true, departmentHeadUserId: true },
    });
    const userId = line === 'manager' ? member?.managerUserId : member?.departmentHeadUserId;
    if (!userId) return null;
    const lead = await tx.userTenant.findFirst({
      where: { tenantId, userId, isActive: { not: false } },
      select: { user: { select: { email: true, firstName: true, lastName: true } } },
    });
    if (!lead || !EMAIL_RE.test(lead.user.email)) return null;
    return {
      email: lead.user.email.toLowerCase(),
      name: [lead.user.firstName, lead.user.lastName].filter(Boolean).join(' ') || undefined,
    };
  }));
}

const moduleLabel = (module: string) =>
  module.toLowerCase().replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Emails every approver of an approval step, each a personal copy with
 * their name filled in. The wording is the step's own, else the workflow's
 * default, else the tenant's "Approval request" email template (Admin >
 * Email templates, English or Arabic by the tenant's language), else the
 * built-in wording; see src/lib/email-templates. Sent through the platform
 * email sender (src/lib/email.ts). Best-effort: never throws.
 */
async function notifyStepApprovers(args: {
  tenantId: string; instanceId: string;
  workflow: Pick<WorkflowDefinitionRow, 'name' | 'module' | 'defaultEmailSubject' | 'defaultEmailBody'>;
  step: WorkflowStepRow & { stepInstanceId?: string };
  /** Resolved when the level opened (resolveStepApprovers). */
  approvers: Array<{ email: string; name?: string }>;
  referenceNumber: string; referenceType: string; submittedBy: string;
}) {
  const { tenantId, workflow, step, approvers } = args;
  if (!approvers.length) {
    console.warn(`[Workflow] Step "${step.stepName}" of ${args.referenceNumber} has no approver to email (assignee type ${step.assigneeType}).`);
    return;
  }
  try {
    // Loaded on use: the renderer and sender pull in branding, Sentry and env
    // validation, which modules importing this file (admin-scope, its tests)
    // shouldn't need.
    const [{ renderEmail, tenantEmailContext }, { sendEmail }, { signDecisionLink, decisionLinkUrl }] = await Promise.all([
      import('@/lib/email-templates'), import('@/lib/email'), import('@/lib/workflow/decision-link'),
    ]);
    const context = await tenantEmailContext(tenantId);
    const approvalUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/approvals`;
    const override = {
      subject: step.emailSubject?.trim() || workflow.defaultEmailSubject?.trim() || null,
      body: step.emailBody?.trim() || workflow.defaultEmailBody?.trim() || null,
    };
    for (const approver of approvers) {
      // Each approver's own link to decide this level from their phone
      // (decision-link.ts); the inbox link when one can't be made.
      let decisionUrl = approvalUrl;
      if (step.stepInstanceId && step.stepType !== 'NOTIFICATION') {
        try {
          decisionUrl = decisionLinkUrl(signDecisionLink({
            tenantId, instanceId: args.instanceId, stepInstanceId: step.stepInstanceId, email: approver.email,
          }));
        } catch (e) {
          console.warn('[Workflow] No email decision link (session secret not set):', e instanceof Error ? e.message : e);
        }
      }
      const email = await renderEmail({
        tenantId, key: 'workflow.approval_request', context, override,
        values: {
          approverName: approver.name ?? '',
          approverEmail: approver.email,
          referenceNumber: args.referenceNumber,
          referenceType: args.referenceType,
          stepName: step.stepName,
          stepOrder: String(step.stepOrder),
          workflowName: workflow.name,
          moduleLabel: moduleLabel(workflow.module),
          submittedBy: args.submittedBy,
          approvalUrl,
          decisionUrl,
        },
      });
      const result = await sendEmail({ to: approver.email, subject: email.subject, html: email.html, text: email.text });
      if (!result.sent) {
        console.warn(`[Workflow] Approval email for ${args.referenceNumber} not sent (${result.reason ?? 'unknown'})${
          result.reason === 'smtp_not_configured' ? ': set up SMTP in Admin > Settings > Notifications.' : ''}`);
      }
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
  openedAt: Date | null;
  escalatedAt: Date | null;
  escalationHours: number | null;
  escalationEmail: string | null;
  contextJson: unknown;
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
      wd.procedure,${LEVEL_SLA_COLUMNS}
    FROM "WorkflowStepInstance" wsi
    JOIN "WorkflowInstance" wi ON wi.id = wsi."workflowInstanceId"
    JOIN "WorkflowDefinition" wd ON wd.id = wi."workflowId"
    LEFT JOIN "WorkflowStep" ws ON ws.id = wsi."stepId"
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
