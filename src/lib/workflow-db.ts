import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';

const _g = globalThis as { _workflowDbInit?: Promise<void> };

function _ensureWorkflowTablesOnce(): Promise<void> {
  if (_g._workflowDbInit) return _g._workflowDbInit;
  _g._workflowDbInit = _doInit().catch((e) => {
    delete _g._workflowDbInit;
    throw e;
  });
  return _g._workflowDbInit;
}

async function _doInit(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    DO $DDL$
    BEGIN
      CREATE TABLE IF NOT EXISTS "WorkflowDefinition" (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        module TEXT NOT NULL,
        procedure TEXT NOT NULL,
        description TEXT,
        "isActive" BOOLEAN DEFAULT true,
        "createdAt" TIMESTAMP DEFAULT NOW(),
        "updatedAt" TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS "WorkflowStep" (
        id TEXT PRIMARY KEY,
        "workflowId" TEXT NOT NULL,
        "stepOrder" INTEGER NOT NULL,
        "stepName" TEXT NOT NULL,
        "stepType" TEXT NOT NULL DEFAULT 'APPROVAL',
        "assigneeType" TEXT NOT NULL DEFAULT 'SPECIFIC_USER',
        "assigneeEmail" TEXT,
        "assigneeRoleCode" TEXT,
        "multiApproverEmails" TEXT,
        "requireAllApprovers" BOOLEAN DEFAULT false,
        "emailSubject" TEXT,
        "emailBody" TEXT,
        "slaHours" INTEGER DEFAULT 24,
        "escalationEmail" TEXT,
        "escalationHours" INTEGER DEFAULT 48,
        "conditionJson" TEXT,
        "isOptional" BOOLEAN DEFAULT false,
        "createdAt" TIMESTAMP DEFAULT NOW()
      );

      -- Migrate existing WorkflowStep tables (add new columns if not present)
      ALTER TABLE "WorkflowStep" ADD COLUMN IF NOT EXISTS "multiApproverEmails" TEXT;
      ALTER TABLE "WorkflowStep" ADD COLUMN IF NOT EXISTS "requireAllApprovers" BOOLEAN DEFAULT false;
      ALTER TABLE "WorkflowStep" ADD COLUMN IF NOT EXISTS "escalationEmail" TEXT;
      ALTER TABLE "WorkflowStep" ADD COLUMN IF NOT EXISTS "escalationHours" INTEGER DEFAULT 48;
      ALTER TABLE "WorkflowStep" ADD COLUMN IF NOT EXISTS "conditionJson" TEXT;

      -- WorkflowDefinition defaults
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultAssigneeType" TEXT DEFAULT 'SPECIFIC_USER';
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultAssigneeEmail" TEXT;
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultAssigneeRoleCode" TEXT;
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultEmailSubject" TEXT;
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultEmailBody" TEXT;
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultSlaHours" INTEGER DEFAULT 24;
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultEscalationEmail" TEXT;
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultEscalationHours" INTEGER DEFAULT 48;

      CREATE TABLE IF NOT EXISTS "WorkflowInstance" (
        id TEXT PRIMARY KEY,
        "workflowId" TEXT NOT NULL,
        "referenceType" TEXT NOT NULL,
        "referenceId" TEXT NOT NULL,
        "referenceNumber" TEXT,
        "currentStepOrder" INTEGER DEFAULT 1,
        status TEXT DEFAULT 'IN_PROGRESS',
        "initiatedByEmail" TEXT,
        "initiatedByName" TEXT,
        "initiatedAt" TIMESTAMP DEFAULT NOW(),
        "completedAt" TIMESTAMP,
        "createdAt" TIMESTAMP DEFAULT NOW(),
        "updatedAt" TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS "WorkflowStepInstance" (
        id TEXT PRIMARY KEY,
        "workflowInstanceId" TEXT NOT NULL,
        "stepId" TEXT NOT NULL,
        "stepOrder" INTEGER NOT NULL,
        "stepName" TEXT NOT NULL,
        "assignedToEmail" TEXT,
        "assignedToName" TEXT,
        status TEXT DEFAULT 'PENDING',
        comments TEXT,
        "actionedAt" TIMESTAMP,
        "actionedByEmail" TEXT,
        "dueAt" TIMESTAMP,
        "createdAt" TIMESTAMP DEFAULT NOW()
      );
    END
    $DDL$
  `);
}

//  Table Bootstrap
export async function ensureWorkflowTables() {
  await _ensureWorkflowTablesOnce();
}

//  Workflow Definition CRUD 
export async function listWorkflows(module?: string) {
  await ensureWorkflowTables();
  const rows: any[] = module
    ? await prisma.$queryRawUnsafe(
        `SELECT * FROM "WorkflowDefinition" WHERE module = $1 ORDER BY module, procedure`, module)
    : await prisma.$queryRawUnsafe(
        `SELECT * FROM "WorkflowDefinition" ORDER BY module, procedure`);
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const counts: any[] = await prisma.$queryRawUnsafe(
    `SELECT "workflowId", COUNT(*) as count FROM "WorkflowStep"
     WHERE "workflowId" = ANY($1::text[]) GROUP BY "workflowId"`, ids);
  // active instances per workflow
  const instances: any[] = await prisma.$queryRawUnsafe(
    `SELECT "workflowId", COUNT(*) as count FROM "WorkflowInstance"
     WHERE "workflowId" = ANY($1::text[]) AND status='IN_PROGRESS' GROUP BY "workflowId"`, ids).catch(() => []);
  const countMap: Record<string, number> = {};
  const instanceMap: Record<string, number> = {};
  counts.forEach((c: any) => { countMap[c.workflowId] = parseInt(c.count); });
  (instances as any[]).forEach((c: any) => { instanceMap[c.workflowId] = parseInt(c.count); });
  return rows.map(r => ({
    ...r,
    stepCount: countMap[r.id] ?? 0,
    activeInstances: instanceMap[r.id] ?? 0,
  }));
}

export async function getWorkflowWithSteps(id: string) {
  await ensureWorkflowTables();
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT * FROM "WorkflowDefinition" WHERE id = $1`, id);
  if (!rows.length) return null;
  const steps: any[] = await prisma.$queryRawUnsafe(
    `SELECT * FROM "WorkflowStep" WHERE "workflowId" = $1 ORDER BY "stepOrder"`, id);
  return { ...rows[0], steps };
}

export async function createWorkflow(data: {
  name: string; module: string; procedure: string; description?: string;
}) {
  await ensureWorkflowTables();
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "WorkflowDefinition" (id, name, module, procedure, description)
     VALUES ($1,$2,$3,$4,$5)`,
    id, data.name, data.module, data.procedure, data.description ?? null);
  return id;
}

export async function updateWorkflow(id: string, data: {
  name?: string; module?: string; procedure?: string; description?: string; isActive?: boolean;
  defaultAssigneeType?: string; defaultAssigneeEmail?: string; defaultAssigneeRoleCode?: string;
  defaultEmailSubject?: string; defaultEmailBody?: string;
  defaultSlaHours?: number; defaultEscalationEmail?: string; defaultEscalationHours?: number;
}) {
  await ensureWorkflowTables();
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
  await ensureWorkflowTables();
  await prisma.$executeRawUnsafe(`DELETE FROM "WorkflowStep" WHERE "workflowId" = $1`, id);
  await prisma.$executeRawUnsafe(`DELETE FROM "WorkflowDefinition" WHERE id = $1`, id);
}

export async function duplicateWorkflow(id: string) {
  const original = await getWorkflowWithSteps(id);
  if (!original) throw new Error('Workflow not found');
  const newId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "WorkflowDefinition" (id, name, module, procedure, description, "isActive")
     VALUES ($1,$2,$3,$4,$5,false)`,
    newId, `${original.name} (Copy)`, original.module, original.procedure, original.description ?? null);
  for (const step of (original.steps ?? [])) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "WorkflowStep"
       (id,"workflowId","stepOrder","stepName","stepType","assigneeType","assigneeEmail",
        "assigneeRoleCode","multiApproverEmails","requireAllApprovers","emailSubject","emailBody",
        "slaHours","escalationEmail","escalationHours","conditionJson","isOptional")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      randomUUID(), newId, step.stepOrder, step.stepName, step.stepType,
      step.assigneeType, step.assigneeEmail ?? null, step.assigneeRoleCode ?? null,
      step.multiApproverEmails ?? null, step.requireAllApprovers ?? false,
      step.emailSubject ?? null, step.emailBody ?? null, step.slaHours ?? 24,
      step.escalationEmail ?? null, step.escalationHours ?? 48,
      step.conditionJson ?? null, step.isOptional ?? false);
  }
  return newId;
}

//  Global Stats 
export async function getWorkflowStats() {
  await ensureWorkflowTables();
  const totals: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) as total,
            SUM(CASE WHEN "isActive" THEN 1 ELSE 0 END) as active
     FROM "WorkflowDefinition"`);
  const pending: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) as count FROM "WorkflowStepInstance" WHERE status='PENDING'`
  ).catch(() => [{ count: 0 }]);
  const instances: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) as count FROM "WorkflowInstance" WHERE status='IN_PROGRESS'`
  ).catch(() => [{ count: 0 }]);
  return {
    total: parseInt(totals[0]?.total ?? 0),
    active: parseInt(totals[0]?.active ?? 0),
    pendingApprovals: parseInt((pending[0] as any)?.count ?? 0),
    activeInstances: parseInt((instances[0] as any)?.count ?? 0),
  };
}

//  Workflow Step CRUD 
export async function listSteps(workflowId: string) {
  await ensureWorkflowTables();
  return prisma.$queryRawUnsafe<any[]>(
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
  await prisma.$executeRawUnsafe(
    `INSERT INTO "WorkflowStep"
     (id,"workflowId","stepOrder","stepName","stepType","assigneeType","assigneeEmail",
      "assigneeRoleCode","multiApproverEmails","requireAllApprovers","emailSubject","emailBody",
      "slaHours","escalationEmail","escalationHours","conditionJson","isOptional")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
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
  module: string; procedure: string;
  referenceType: string; referenceId: string; referenceNumber: string;
  initiatedByEmail: string; initiatedByName?: string;
  contextData?: Record<string, any>;
  force?: boolean; // set true to re-trigger even if already in progress
}) {
  await ensureWorkflowTables();
  const wfRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT * FROM "WorkflowDefinition"
     WHERE module=$1 AND procedure=$2 AND "isActive"=true LIMIT 1`,
    params.module, params.procedure);
  if (!wfRows.length) {
    console.warn(`[Workflow] No active workflow for module=${params.module} procedure=${params.procedure}`);
    return { error: `No active workflow found for ${params.module} / ${params.procedure}. Please define and activate one in Admin > Workflow Management.` };
  }

  const wf = wfRows[0];

  // Idempotency: if an IN_PROGRESS instance already exists for this referenceId, return it
  if (!params.force) {
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM "WorkflowInstance" WHERE "referenceId"=$1 AND "workflowId"=$2 AND status='IN_PROGRESS' LIMIT 1`,
      params.referenceId, wf.id);
    if (existing.length) {
      console.info(`[Workflow] Reusing existing instance ${existing[0].id} for ${params.referenceNumber}`);
      return { instanceId: existing[0].id, workflowName: wf.name, reused: true };
    }
  }

  const steps: any[] = await prisma.$queryRawUnsafe(
    `SELECT * FROM "WorkflowStep" WHERE "workflowId"=$1 ORDER BY "stepOrder"`, wf.id);
  if (!steps.length) {
    console.warn(`[Workflow] Workflow "${wf.name}" has no steps. Add steps in Admin > Workflow Management.`);
    return { error: `Workflow "${wf.name}" has no steps configured. Add steps in Admin > Workflow Management.` };
  }

  const instanceId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "WorkflowInstance"
     (id,"workflowId","referenceType","referenceId","referenceNumber",
      "currentStepOrder",status,"initiatedByEmail","initiatedByName")
     VALUES ($1,$2,$3,$4,$5,$6,'IN_PROGRESS',$7,$8)`,
    instanceId, wf.id, params.referenceType, params.referenceId,
    params.referenceNumber, steps[0].stepOrder,
    params.initiatedByEmail, params.initiatedByName ?? null);

  for (const step of steps) {
    const siId = randomUUID();
    const dueAt = step.slaHours
      ? new Date(Date.now() + step.slaHours * 3600000).toISOString() : null;
    const isPending = step.stepOrder === steps[0].stepOrder;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "WorkflowStepInstance"
       (id,"workflowInstanceId","stepId","stepOrder","stepName","assignedToEmail","assignedToName",status,"dueAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      siId, instanceId, step.id, step.stepOrder, step.stepName,
      step.assigneeEmail ?? null, null,
      isPending ? 'PENDING' : 'WAITING', dueAt);
  }

  const firstStep = steps[0];
  if (firstStep.assigneeEmail && firstStep.stepType === 'APPROVAL') {
    await sendWorkflowEmail({
      to: firstStep.assigneeEmail,
      subject: firstStep.emailSubject ??
        `Action Required: ${params.referenceNumber} awaiting your approval`,
      body: firstStep.emailBody ??
        `Dear Approver,\n\n${params.referenceNumber} (${params.referenceType}) has been submitted for your approval.\n\nStep: ${firstStep.stepName}\nSubmitted by: ${params.initiatedByEmail}\n\nPlease log in to XL AI Smart Mobility to review and approve.`,
      instanceId, referenceNumber: params.referenceNumber,
      referenceType: params.referenceType, stepName: firstStep.stepName,
    });
  }
  if (firstStep.stepType === 'NOTIFICATION') {
    await advanceWorkflow(instanceId, firstStep.stepOrder, 'AUTO',
      'Auto-advanced (notification step)', 'system');
  }

  return { instanceId, workflowName: wf.name };
}

export async function advanceWorkflow(
  instanceId: string, currentStepOrder: number,
  action: 'APPROVE' | 'REJECT' | 'AUTO', comments: string, actionedByEmail: string
) {
  await prisma.$executeRawUnsafe(
    `UPDATE "WorkflowStepInstance"
     SET status=$1, comments=$2, "actionedAt"=NOW(), "actionedByEmail"=$3
     WHERE "workflowInstanceId"=$4 AND "stepOrder"=$5 AND status='PENDING'`,
    action === 'REJECT' ? 'REJECTED' : 'APPROVED',
    comments, actionedByEmail, instanceId, currentStepOrder);

  if (action === 'REJECT') {
    await prisma.$executeRawUnsafe(
      `UPDATE "WorkflowInstance"
       SET status='REJECTED',"completedAt"=NOW(),"updatedAt"=NOW() WHERE id=$1`, instanceId);
    return { status: 'REJECTED' };
  }

  const nextSteps: any[] = await prisma.$queryRawUnsafe(
    `SELECT ws.* FROM "WorkflowStepInstance" wsi
     JOIN "WorkflowStep" ws ON ws.id=wsi."stepId"
     WHERE wsi."workflowInstanceId"=$1 AND wsi."stepOrder">$2 AND wsi.status='WAITING'
     ORDER BY wsi."stepOrder" LIMIT 1`,
    instanceId, currentStepOrder);

  if (!nextSteps.length) {
    await prisma.$executeRawUnsafe(
      `UPDATE "WorkflowInstance"
       SET status='APPROVED',"completedAt"=NOW(),"updatedAt"=NOW() WHERE id=$1`, instanceId);
    return { status: 'APPROVED' };
  }

  const nextStep = nextSteps[0];
  await prisma.$executeRawUnsafe(
    `UPDATE "WorkflowStepInstance" SET status='PENDING'
     WHERE "workflowInstanceId"=$1 AND "stepOrder"=$2`,
    instanceId, nextStep.stepOrder);
  await prisma.$executeRawUnsafe(
    `UPDATE "WorkflowInstance" SET "currentStepOrder"=$1,"updatedAt"=NOW() WHERE id=$2`,
    nextStep.stepOrder, instanceId);

  if (nextStep.assigneeEmail && nextStep.stepType === 'APPROVAL') {
    const instance: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "WorkflowInstance" WHERE id=$1`, instanceId);
    if (instance.length) {
      await sendWorkflowEmail({
        to: nextStep.assigneeEmail,
        subject: nextStep.emailSubject ??
          `Action Required: ${instance[0].referenceNumber}  Step ${nextStep.stepOrder}: ${nextStep.stepName}`,
        body: nextStep.emailBody ??
          `Dear Approver,\n\n${instance[0].referenceNumber} requires your approval.\n\nStep: ${nextStep.stepName}\n\nPlease log in to XL AI Smart Mobility to review.`,
        instanceId, referenceNumber: instance[0].referenceNumber,
        referenceType: instance[0].referenceType, stepName: nextStep.stepName,
      });
    }
  }
  if (nextStep.stepType === 'NOTIFICATION') {
    return advanceWorkflow(instanceId, nextStep.stepOrder, 'AUTO',
      'Auto-advanced (notification step)', 'system');
  }
  return { status: 'IN_PROGRESS', nextStep: nextStep.stepName };
}

export async function getMyPendingApprovals(email: string) {
  await ensureWorkflowTables();
  return prisma.$queryRawUnsafe<any[]>(`
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
    WHERE wsi."assignedToEmail" = $1 AND wsi.status = 'PENDING'
    ORDER BY wsi."createdAt" DESC
  `, email);
}

export async function getWorkflowInstanceWithHistory(instanceId: string) {
  await ensureWorkflowTables();
  const instances: any[] = await prisma.$queryRawUnsafe(`
    SELECT wi.*, wd.name as "workflowName", wd.module, wd.procedure
    FROM "WorkflowInstance" wi
    JOIN "WorkflowDefinition" wd ON wd.id=wi."workflowId"
    WHERE wi.id=$1
  `, instanceId);
  if (!instances.length) return null;
  const stepInstances: any[] = await prisma.$queryRawUnsafe(
    `SELECT * FROM "WorkflowStepInstance" WHERE "workflowInstanceId"=$1 ORDER BY "stepOrder"`,
    instanceId);
  return { ...instances[0], steps: stepInstances };
}

export async function getInstancesForReference(referenceId: string) {
  await ensureWorkflowTables();
  return prisma.$queryRawUnsafe<any[]>(`
    SELECT wi.*, wd.name as "workflowName", wd.procedure
    FROM "WorkflowInstance" wi
    JOIN "WorkflowDefinition" wd ON wd.id=wi."workflowId"
    WHERE wi."referenceId"=$1
    ORDER BY wi."createdAt" DESC
  `, referenceId);
}

//  Email Sender 
async function sendWorkflowEmail(params: {
  to: string; subject: string; body: string;
  instanceId: string; referenceNumber: string; referenceType: string; stepName: string;
}) {
  try {
    const cfgRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "IntegrationConfig" WHERE type='EMAIL' AND "isActive"=true LIMIT 1`);
    if (!cfgRows.length) {
      console.warn('[Workflow] Email skipped: no active EMAIL integration configured. Go to Admin > Integrations to set up SMTP.');
      return;
    }
    const cfg = cfgRows[0];
    const config = typeof cfg.config === 'string' ? JSON.parse(cfg.config) : cfg.config;
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.createTransport({
      host: config.smtpHost, port: parseInt(config.smtpPort) || 587,
      secure: config.smtpSecure === true || config.smtpPort === '465',
      auth: { user: config.smtpUser, pass: config.smtpPassword },
    });
    const approvalUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/approvals`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:24px;border-radius:12px;">
        <div style="background:linear-gradient(135deg,#6366f1,#4f46e5);padding:24px;border-radius:10px;margin-bottom:24px;">
          <h1 style="color:white;margin:0;font-size:20px;">Action Required</h1>
          <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;">XL AI Smart Mobility</p>
        </div>
        <div style="background:white;border-radius:10px;padding:24px;border:1px solid #e2e8f0;">
          <h2 style="color:#1e293b;margin:0 0 16px;font-size:18px;">${params.stepName}</h2>
          <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
            <tr><td style="padding:8px;background:#f1f5f9;border-radius:6px;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;">Reference</td><td style="padding:8px;color:#1e293b;font-weight:700;">${params.referenceNumber}</td></tr>
            <tr><td style="padding:8px;background:#f1f5f9;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;">Type</td><td style="padding:8px;color:#1e293b;">${params.referenceType}</td></tr>
          </table>
          <pre style="font-family:Arial,sans-serif;white-space:pre-wrap;color:#374151;line-height:1.6;">${params.body}</pre>
          <a href="${approvalUrl}" style="display:inline-block;margin-top:20px;background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Review &amp; Approve</a>
        </div>
        <p style="color:#94a3b8;font-size:12px;margin-top:16px;text-align:center;">XL AI Smart Mobility Platform</p>
      </div>
    `;
    await transporter.sendMail({
      from: config.fromEmail ?? config.smtpUser,
      to: params.to, subject: params.subject, html,
    });
  } catch (e: any) {
    console.error('Workflow email error:', e?.message);
  }
}

// Returns ALL pending step instances (admin view - no email filter)
export async function getAllPendingStepInstances() {
  await ensureWorkflowTables();
  return prisma.$queryRawUnsafe<any[]>(`
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
    ORDER BY wsi."createdAt" DESC
  `);
}

// Returns all workflow instances (admin overview)
export async function getAllWorkflowInstances(opts?: { status?: string; module?: string; limit?: number }) {
  await ensureWorkflowTables();
  const conditions: string[] = [];
  const values: any[] = [];
  let idx = 1;
  if (opts?.status) { conditions.push(`wi.status=$${idx++}`); values.push(opts.status); }
  if (opts?.module) { conditions.push(`wd.module=$${idx++}`); values.push(opts.module); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts?.limit ?? 100;
  return prisma.$queryRawUnsafe<any[]>(`
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
