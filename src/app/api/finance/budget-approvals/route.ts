/**
 * Budget Approvals API — /api/finance/budget-approvals
 * Department-level budget submissions with multi-step approval workflow
 * Departments submit → Finance Manager reviews → CFO approves for large budgets
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

const INIT_BUDGET_SUBMISSIONS = `
  CREATE TABLE IF NOT EXISTS finance_budget_submissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    submission_no   TEXT UNIQUE NOT NULL,    -- BUDG-2025-001
    fiscal_year     INTEGER NOT NULL,
    department      TEXT NOT NULL,           -- FLEET | RAC | LOGISTICS | STAFF_TRANSPORT | SCHOOL_BUS | AMBULANCE | ADMIN | FINANCE | HR | IT
    department_head TEXT NOT NULL,
    total_requested NUMERIC(15,2) NOT NULL,
    total_approved  NUMERIC(15,2),
    status          TEXT DEFAULT 'DRAFT',    -- DRAFT | SUBMITTED | FM_REVIEW | CFO_REVIEW | APPROVED | REJECTED | REVISION_REQUIRED
    submitted_at    TIMESTAMPTZ,
    fm_reviewed_at  TIMESTAMPTZ,
    fm_reviewed_by  TEXT,
    fm_notes        TEXT,
    cfo_approved_at TIMESTAMPTZ,
    cfo_approved_by TEXT,
    cfo_notes       TEXT,
    rejection_reason TEXT,
    notes           TEXT,
    line_items      JSONB DEFAULT '[]',      -- [{category, amount, description, justification}]
    tenant_id       TEXT
  );
`;

const INIT_BUDGET_COMMENTS = `
  CREATE TABLE IF NOT EXISTS finance_budget_comments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    submission_id TEXT NOT NULL,
    author      TEXT NOT NULL,
    role        TEXT NOT NULL,              -- DEPT_HEAD | FM | CFO | SYSTEM
    comment     TEXT NOT NULL,
    action      TEXT                        -- SUBMITTED | FM_APPROVED | FM_REJECTED | CFO_APPROVED | CFO_REJECTED | REVISED
  );
`;

const MIGRATE = `
  ALTER TABLE finance_budget_submissions ADD COLUMN IF NOT EXISTS tenant_id TEXT;
  CREATE INDEX IF NOT EXISTS idx_finance_budget_submissions_tenant_id ON finance_budget_submissions(tenant_id);
`;

function nextSubmissionNo(year: number, count: number): string {
  return `BUDG-${year}-${String(count + 1).padStart(3, '0')}`;
}

export async function GET(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT_BUDGET_SUBMISSIONS).catch(()=>{});
  await prisma.$executeRawUnsafe(INIT_BUDGET_COMMENTS).catch(()=>{});
  await prisma.$executeRawUnsafe(MIGRATE).catch(()=>{});
  const ctx = requireOperationalContext(req, 'finance', { requestedTenantId: req.nextUrl.searchParams.get('tenantId') });
  if (ctx instanceof NextResponse) return ctx;

  const sp      = req.nextUrl.searchParams;
  const year    = sp.get('year');
  const dept    = sp.get('department');
  const status  = sp.get('status');
  const id      = sp.get('id');

  if (id) {
    const [sub] = await prisma.$queryRawUnsafe<Record<string,unknown>[]>(
      `SELECT * FROM finance_budget_submissions WHERE id=$1 AND tenant_id::text = $2 AND deleted_at IS NULL`, id, ctx.tenantId
    ).catch(()=>[]);
    if (!sub) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const comments = await prisma.$queryRawUnsafe<Record<string,unknown>[]>(
      `SELECT * FROM finance_budget_comments WHERE submission_id=$1 ORDER BY created_at ASC`, id
    ).catch(()=>[]);
    return NextResponse.json({ ...sub, comments });
  }

  let where = 'WHERE deleted_at IS NULL AND tenant_id::text = $1';
  const params: unknown[] = [ctx.tenantId];
  let pi = 2;
  if (year)   { where += ` AND fiscal_year = $${pi++}`;  params.push(parseInt(year)); }
  if (dept)   { where += ` AND department = $${pi++}`;   params.push(dept); }
  if (status) { where += ` AND status = $${pi++}`;       params.push(status); }

  const subs = await prisma.$queryRawUnsafe<Record<string,unknown>[]>(
    `SELECT * FROM finance_budget_submissions ${where} ORDER BY created_at DESC`, ...params
  ).catch(()=>[]);

  // Status summary
  const statusCounts = await prisma.$queryRawUnsafe<{status:string; count:string; total_requested:string}[]>(
    `SELECT status, COUNT(*)::text as count, COALESCE(SUM(total_requested),0)::text as total_requested
     FROM finance_budget_submissions
     WHERE deleted_at IS NULL
       AND tenant_id::text = $1
     GROUP BY status`,
    ctx.tenantId,
  ).catch(()=>[]);

  return NextResponse.json({ data: subs, statusCounts });
}

export async function POST(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT_BUDGET_SUBMISSIONS).catch(()=>{});
  await prisma.$executeRawUnsafe(INIT_BUDGET_COMMENTS).catch(()=>{});
  await prisma.$executeRawUnsafe(MIGRATE).catch(()=>{});
  const ctx = requireOperationalContext(req, 'finance', { write: true });
  if (ctx instanceof NextResponse) return ctx;

  const body = await req.json();

  if (body.action === 'submit') {
    // Dept head submits draft for FM review
    const [row] = await prisma.$queryRawUnsafe<Record<string,unknown>[]>(
      `UPDATE finance_budget_submissions
       SET status='SUBMITTED', submitted_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND tenant_id::text = $2 AND status='DRAFT' RETURNING *`, body.submissionId, ctx.tenantId
    ).catch(()=>[]);
    if (row) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO finance_budget_comments (submission_id, author, role, comment, action)
         VALUES ($1,$2,'DEPT_HEAD','Budget submitted for Finance Manager review','SUBMITTED')`,
        body.submissionId, body.performedBy ?? 'Dept Head'
      ).catch(()=>{});
    }
    const workflow = row ? await triggerServiceWorkflow({
      req,
      ctx,
      serviceTypeKey: 'FINANCE_BUDGET_EXCEPTION',
      referenceType: 'BudgetSubmission',
      referenceId: String(row.id ?? body.submissionId),
      referenceNumber: String(row.submission_no ?? body.submissionId),
      contextData: {
        department: row.department ?? null,
        totalRequested: row.total_requested ?? null,
        status: row.status ?? 'SUBMITTED',
      },
      force: true,
    }) : null;
    return NextResponse.json(row ? { ...row, workflow } : {});
  }

  if (body.action === 'fm_review') {
    // FM approves → CFO_REVIEW (if > 500k) or APPROVED; or rejects / requests revision
    const { submissionId, decision, notes, approvedAmount, reviewedBy } = body;
    let newStatus = 'CFO_REVIEW';
    const [current] = await prisma.$queryRawUnsafe<{total_requested: string}[]>(
      `SELECT total_requested FROM finance_budget_submissions WHERE id=$1 AND tenant_id::text = $2`, submissionId, ctx.tenantId
    ).catch(()=>[{total_requested:'0'}]);
    const amount = parseFloat(current?.total_requested ?? '0');

    if (decision === 'APPROVE') {
      newStatus = amount > 500_000 ? 'CFO_REVIEW' : 'APPROVED';
    } else if (decision === 'REJECT') {
      newStatus = 'REJECTED';
    } else {
      newStatus = 'REVISION_REQUIRED';
    }

    const [row] = await prisma.$queryRawUnsafe<Record<string,unknown>[]>(
      `UPDATE finance_budget_submissions
       SET status=$2, fm_reviewed_at=NOW(), fm_reviewed_by=$3, fm_notes=$4,
           total_approved=COALESCE($5,total_requested), updated_at=NOW()
       WHERE id=$1 AND tenant_id::text = $6 RETURNING *`,
      submissionId, newStatus, reviewedBy ?? 'Finance Manager', notes ?? null, approvedAmount ?? null, ctx.tenantId
    ).catch(()=>[]);
    if (row) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO finance_budget_comments (submission_id, author, role, comment, action)
         VALUES ($1,$2,'FM',$3,$4)`,
        submissionId, reviewedBy ?? 'Finance Manager',
        notes ?? `FM ${decision}D budget`,
        `FM_${decision === 'APPROVE' ? 'APPROVED' : 'REJECTED'}`
      ).catch(()=>{});
    }
    const workflow = row ? await triggerServiceWorkflow({
      req,
      ctx,
      serviceTypeKey: 'FINANCE_BUDGET_EXCEPTION',
      referenceType: 'BudgetSubmission',
      referenceId: String(row.id ?? submissionId),
      referenceNumber: String(row.submission_no ?? submissionId),
      contextData: {
        decision,
        department: row.department ?? null,
        totalRequested: row.total_requested ?? null,
        totalApproved: row.total_approved ?? null,
        status: row.status ?? null,
      },
      force: true,
    }) : null;
    return NextResponse.json(row ? { ...row, workflow } : {});
  }

  if (body.action === 'cfo_decision') {
    const { submissionId, decision, notes, approvedAmount, decidedBy } = body;
    const newStatus = decision === 'APPROVE' ? 'APPROVED' : decision === 'REJECT' ? 'REJECTED' : 'REVISION_REQUIRED';
    const [row] = await prisma.$queryRawUnsafe<Record<string,unknown>[]>(
      `UPDATE finance_budget_submissions
       SET status=$2, cfo_approved_at=NOW(), cfo_approved_by=$3, cfo_notes=$4,
           total_approved=COALESCE($5,total_approved), updated_at=NOW()
       WHERE id=$1 AND tenant_id::text = $6 RETURNING *`,
      submissionId, newStatus, decidedBy ?? 'CFO', notes ?? null, approvedAmount ?? null, ctx.tenantId
    ).catch(()=>[]);
    if (row) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO finance_budget_comments (submission_id, author, role, comment, action)
         VALUES ($1,$2,'CFO',$3,$4)`,
        submissionId, decidedBy ?? 'CFO',
        notes ?? `CFO ${decision}D budget`,
        `CFO_${decision === 'APPROVE' ? 'APPROVED' : 'REJECTED'}`
      ).catch(()=>{});
    }
    const workflow = row ? await triggerServiceWorkflow({
      req,
      ctx,
      serviceTypeKey: 'FINANCE_BUDGET_EXCEPTION',
      referenceType: 'BudgetSubmission',
      referenceId: String(row.id ?? submissionId),
      referenceNumber: String(row.submission_no ?? submissionId),
      contextData: {
        decision,
        department: row.department ?? null,
        totalRequested: row.total_requested ?? null,
        totalApproved: row.total_approved ?? null,
        status: row.status ?? null,
      },
      force: true,
    }) : null;
    return NextResponse.json(row ? { ...row, workflow } : {});
  }

  if (body.action === 'add_comment') {
    const [row] = await prisma.$queryRawUnsafe<Record<string,unknown>[]>(
      `INSERT INTO finance_budget_comments (submission_id, author, role, comment)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      body.submissionId, body.author, body.role ?? 'FM', body.comment
    ).catch(()=>[]);
    return NextResponse.json(row ?? {}, { status: 201 });
  }

  // Create new budget submission
  const { fiscalYear, department, departmentHead, lineItems, notes } = body;
  const totalRequested = (lineItems ?? []).reduce((s: number, i: {amount: number}) => s + (i.amount ?? 0), 0);

  const [countRow] = await prisma.$queryRawUnsafe<{count:string}[]>(
    `SELECT COUNT(*)::text as count
       FROM finance_budget_submissions
      WHERE fiscal_year=$1
        AND tenant_id::text = $2`,
    fiscalYear,
    ctx.tenantId,
  ).catch(()=>[{count:'0'}]);
  const submissionNo = nextSubmissionNo(fiscalYear, parseInt(countRow?.count ?? '0'));

  const [row] = await prisma.$queryRawUnsafe<Record<string,unknown>[]>(
    `INSERT INTO finance_budget_submissions
       (submission_no, fiscal_year, department, department_head, total_requested, line_items, notes, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    submissionNo, fiscalYear, department, departmentHead, totalRequested,
    JSON.stringify(lineItems ?? []), notes ?? null, ctx.tenantId
  ).catch(()=>[]);

  if (!row) return NextResponse.json({ error: 'Failed to create submission' }, { status: 500 });
  const workflow = await triggerServiceWorkflow({
    req,
    ctx,
    serviceTypeKey: 'FINANCE_BUDGET_EXCEPTION',
    referenceType: 'BudgetSubmission',
    referenceId: String(row.id ?? submissionNo),
    referenceNumber: String(row.submission_no ?? submissionNo),
    contextData: {
      department,
      totalRequested,
      status: row.status ?? 'DRAFT',
      fiscalYear,
    },
  });
  return NextResponse.json({ ...row, workflow }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const ctx = requireOperationalContext(req, 'finance', { write: true });
  if (ctx instanceof NextResponse) return ctx;
  const sp = req.nextUrl.searchParams;
  const id = sp.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const [before] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM finance_budget_submissions WHERE id=$1 AND tenant_id::text = $2 AND deleted_at IS NULL`,
    id,
    ctx.tenantId,
  ).catch(()=>[]);
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await prisma.$executeRawUnsafe(
    `UPDATE finance_budget_submissions SET deleted_at=NOW() WHERE id=$1 AND tenant_id::text = $2 AND status='DRAFT'`, id, ctx.tenantId
  ).catch(()=>{});
  await recordOperationalChange({
    req,
    ctx,
    entityType: 'BudgetSubmission',
    entityId: id,
    action: 'DELETE',
    before,
    after: null,
    summary: `Deleted budget submission ${String(before.submission_no ?? id)}.`,
  });
  const workflow = await triggerServiceWorkflow({
    req,
    ctx,
    serviceTypeKey: 'FINANCE_BUDGET_EXCEPTION',
    referenceType: 'BudgetSubmission',
    referenceId: id,
    referenceNumber: String(before.submission_no ?? id),
    contextData: {
      action: 'delete',
      previousStatus: before.status ?? null,
      department: before.department ?? null,
      totalRequested: before.total_requested ?? null,
    },
    force: true,
  });
  return NextResponse.json({ ok: true, workflow });
}
