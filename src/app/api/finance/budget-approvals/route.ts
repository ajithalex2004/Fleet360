export const dynamic = 'force-dynamic';

/**
 * Budget Approvals API — /api/finance/budget-approvals
 * Department-level budget submissions with multi-step approval workflow
 * Departments submit → Finance Manager reviews → CFO approves for large budgets
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
// Tables come from migrations (the last: 20261005090000_finance_tenant_tables).
// A request runs no DDL: the runtime role may not create tables, and the
// failed statement aborted the request's transaction, so every query after
// it failed too.

function nextSubmissionNo(year: number, count: number): string {
  return `BUDG-${year}-${String(count + 1).padStart(3, '0')}`;
}

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const sp      = req.nextUrl.searchParams;
      const year    = sp.get('year');
      const dept    = sp.get('department');
      const status  = sp.get('status');
      const id      = sp.get('id');

      if (id) {
        const [sub] = await tx.$queryRawUnsafe<Record<string,unknown>[]>(
          `SELECT * FROM finance_budget_submissions WHERE id::text=$1 AND tenant_id=$2 AND deleted_at IS NULL`, id, tenantId
        ).catch(()=>[]);
        if (!sub) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        const comments = await tx.$queryRawUnsafe<Record<string,unknown>[]>(
          `SELECT * FROM finance_budget_comments WHERE submission_id=$1 AND tenant_id=$2 ORDER BY created_at ASC`, id, tenantId
        ).catch(()=>[]);
        return NextResponse.json({ ...sub, comments });
      }

      let where = 'WHERE tenant_id = $1 AND deleted_at IS NULL';
      const params: unknown[] = [tenantId];
      let pi = 2;
      if (year)   { where += ` AND fiscal_year = $${pi++}`;  params.push(parseInt(year)); }
      if (dept)   { where += ` AND department = $${pi++}`;   params.push(dept); }
      if (status) { where += ` AND status = $${pi++}`;       params.push(status); }

      const subs = await tx.$queryRawUnsafe<Record<string,unknown>[]>(
        `SELECT * FROM finance_budget_submissions ${where} ORDER BY created_at DESC`, ...params
      ).catch(()=>[]);

      // Status summary
      const statusCounts = await tx.$queryRawUnsafe<{status:string; count:string; total_requested:string}[]>(
        `SELECT status, COUNT(*)::text as count, COALESCE(SUM(total_requested),0)::text as total_requested
         FROM finance_budget_submissions WHERE tenant_id = $1 AND deleted_at IS NULL GROUP BY status`,
        tenantId,
      ).catch(()=>[]);

      return NextResponse.json({ data: subs, statusCounts });
  });
}

export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);

      if (body.action === 'submit') {
        // Dept head submits draft for FM review
        const [row] = await tx.$queryRawUnsafe<Record<string,unknown>[]>(
          `UPDATE finance_budget_submissions
           SET status='SUBMITTED', submitted_at=NOW(), updated_at=NOW()
           WHERE id::text=$1 AND tenant_id=$2 AND status='DRAFT' RETURNING *`, body.submissionId, tenantId
        ).catch(()=>[]);
        if (row) {
          await tx.$executeRawUnsafe(
            `INSERT INTO finance_budget_comments (submission_id, author, role, comment, action, tenant_id)
             VALUES ($1,$2,'DEPT_HEAD','Budget submitted for Finance Manager review','SUBMITTED',$3)`,
            body.submissionId, body.performedBy ?? 'Dept Head', tenantId
          ).catch(()=>{});
        }
        return NextResponse.json(row ?? {});
      }

      if (body.action === 'fm_review') {
        // FM approves → CFO_REVIEW (if > 500k) or APPROVED; or rejects / requests revision
        const { submissionId, decision, notes, approvedAmount, reviewedBy } = body;
        let newStatus = 'CFO_REVIEW';
        const [current] = await tx.$queryRawUnsafe<{total_requested: string}[]>(
          `SELECT total_requested FROM finance_budget_submissions WHERE id::text=$1 AND tenant_id=$2`, submissionId, tenantId
        ).catch(()=>[{total_requested:'0'}]);
        const amount = parseFloat(current?.total_requested ?? '0');

        if (decision === 'APPROVE') {
          newStatus = amount > 500_000 ? 'CFO_REVIEW' : 'APPROVED';
        } else if (decision === 'REJECT') {
          newStatus = 'REJECTED';
        } else {
          newStatus = 'REVISION_REQUIRED';
        }

        const [row] = await tx.$queryRawUnsafe<Record<string,unknown>[]>(
          `UPDATE finance_budget_submissions
           SET status=$2, fm_reviewed_at=NOW(), fm_reviewed_by=$3, fm_notes=$4,
               total_approved=COALESCE($5,total_requested), updated_at=NOW()
           WHERE id::text=$1 AND tenant_id=$6 RETURNING *`,
          submissionId, newStatus, reviewedBy ?? 'Finance Manager', notes ?? null, approvedAmount ?? null, tenantId
        ).catch(()=>[]);
        if (row) {
          await tx.$executeRawUnsafe(
            `INSERT INTO finance_budget_comments (submission_id, author, role, comment, action, tenant_id)
             VALUES ($1,$2,'FM',$3,$4,$5)`,
            submissionId, reviewedBy ?? 'Finance Manager',
            notes ?? `FM ${decision}D budget`,
            `FM_${decision === 'APPROVE' ? 'APPROVED' : 'REJECTED'}`, tenantId
          ).catch(()=>{});
        }
        return NextResponse.json(row ?? {});
      }

      if (body.action === 'cfo_decision') {
        const { submissionId, decision, notes, approvedAmount, decidedBy } = body;
        const newStatus = decision === 'APPROVE' ? 'APPROVED' : decision === 'REJECT' ? 'REJECTED' : 'REVISION_REQUIRED';
        const [row] = await tx.$queryRawUnsafe<Record<string,unknown>[]>(
          `UPDATE finance_budget_submissions
           SET status=$2, cfo_approved_at=NOW(), cfo_approved_by=$3, cfo_notes=$4,
               total_approved=COALESCE($5,total_approved), updated_at=NOW()
           WHERE id::text=$1 AND tenant_id=$6 RETURNING *`,
          submissionId, newStatus, decidedBy ?? 'CFO', notes ?? null, approvedAmount ?? null, tenantId
        ).catch(()=>[]);
        if (row) {
          await tx.$executeRawUnsafe(
            `INSERT INTO finance_budget_comments (submission_id, author, role, comment, action, tenant_id)
             VALUES ($1,$2,'CFO',$3,$4,$5)`,
            submissionId, decidedBy ?? 'CFO',
            notes ?? `CFO ${decision}D budget`,
            `CFO_${decision === 'APPROVE' ? 'APPROVED' : 'REJECTED'}`, tenantId
          ).catch(()=>{});
        }
        return NextResponse.json(row ?? {});
      }

      if (body.action === 'add_comment') {
        const [row] = await tx.$queryRawUnsafe<Record<string,unknown>[]>(
          `INSERT INTO finance_budget_comments (submission_id, author, role, comment, tenant_id)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          body.submissionId, body.author, body.role ?? 'FM', body.comment, tenantId
        ).catch(()=>[]);
        return NextResponse.json(row ?? {}, { status: 201 });
      }

      // Create new budget submission
      const { fiscalYear, department, departmentHead, lineItems, notes } = body;
      const totalRequested = (lineItems ?? []).reduce((s: number, i: {amount: number}) => s + (i.amount ?? 0), 0);

      const [countRow] = await tx.$queryRawUnsafe<{count:string}[]>(
        `SELECT COUNT(*)::text as count FROM finance_budget_submissions WHERE tenant_id=$1 AND fiscal_year=$2`, tenantId, fiscalYear
      ).catch(()=>[{count:'0'}]);
      const submissionNo = nextSubmissionNo(fiscalYear, parseInt(countRow?.count ?? '0'));

      const [row] = await tx.$queryRawUnsafe<Record<string,unknown>[]>(
        `INSERT INTO finance_budget_submissions
           (submission_no, fiscal_year, department, department_head, total_requested, line_items, notes, tenant_id)
         VALUES ($1,$2,$3,$4,$5::numeric,$6::jsonb,$7,$8) RETURNING *`,
        submissionNo, fiscalYear, department, departmentHead, totalRequested,
        JSON.stringify(lineItems ?? []), notes ?? null, tenantId
      ).catch(()=>[]);

      if (!row) return NextResponse.json({ error: 'Failed to create submission' }, { status: 500 });
      return NextResponse.json(row, { status: 201 });
  });
}

export async function DELETE(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const sp = req.nextUrl.searchParams;
      const id = sp.get('id');
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      await tx.$executeRawUnsafe(
        `UPDATE finance_budget_submissions SET deleted_at=NOW() WHERE id::text=$1 AND tenant_id=$2 AND status='DRAFT'`, id, tenantId
      ).catch(()=>{});
      return NextResponse.json({ ok: true });
  });
}

