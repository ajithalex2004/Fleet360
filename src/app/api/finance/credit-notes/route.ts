/**
 * Enhanced Credit Notes API - /api/finance/credit-notes
 * Full lifecycle: DRAFT -> ISSUED -> APPLIED | REFUNDED | VOIDED
 * Linked to finance_invoices, with reason codes and line items
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOperationalContext } from '@/lib/cross-module-governance';
import { prisma } from '@/lib/prisma';
import { ensureFinanceStatementTables } from '@/lib/finance/customer-statement';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

type CnRow = Record<string, unknown>;

async function nextCnNumber(): Promise<string> {
  const [row] = await prisma.$queryRawUnsafe<{ count: string }[]>(
    `SELECT COUNT(*)::text as count FROM finance_credit_notes WHERE deleted_at IS NULL`
  ).catch(() => [{ count: '0' }]);
  const seq = (parseInt(row?.count ?? '0', 10) + 1).toString().padStart(4, '0');
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  return `CN-${ym}-${seq}`;
}

export async function GET(req: NextRequest) {
  await ensureFinanceStatementTables();
  const sp = req.nextUrl.searchParams;
  const ctx = requireOperationalContext(req, 'finance', { requestedTenantId: sp.get('tenantId') });
  if (ctx instanceof NextResponse) return ctx;

  const status = sp.get('status');
  const moduleFilter = sp.get('module');
  const branch = sp.get('branch');
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10));
  const limit = Math.min(100, parseInt(sp.get('limit') ?? '50', 10));
  const offset = (page - 1) * limit;

  let where = `WHERE deleted_at IS NULL AND tenant_id::text = $1`;
  const params: unknown[] = [ctx.tenantId];
  let pi = 2;
  if (status) { where += ` AND status = $${pi++}`; params.push(status); }
  if (moduleFilter) { where += ` AND module = $${pi++}`; params.push(moduleFilter); }
  if (branch) { where += ` AND branch = $${pi++}`; params.push(branch); }

  const [rows, counts] = await Promise.all([
    prisma.$queryRawUnsafe<CnRow[]>(
      `SELECT * FROM finance_credit_notes ${where} ORDER BY created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`,
      ...params, limit, offset
    ).catch(() => []),
    prisma.$queryRawUnsafe<{ status: string; count: string; total: string }[]>(
      `SELECT status, COUNT(*)::text as count, COALESCE(SUM(total_amount),0)::text as total
         FROM finance_credit_notes
        WHERE deleted_at IS NULL
          AND tenant_id::text = $1
        GROUP BY status`,
      ctx.tenantId,
    ).catch(() => []),
  ]);

  return NextResponse.json({ data: rows, counts, page, limit });
}

export async function POST(req: NextRequest) {
  await ensureFinanceStatementTables();
  const ctx = requireOperationalContext(req, 'finance', { write: true });
  if (ctx instanceof NextResponse) return ctx;

  const body = await req.json();
  const cnNumber = await nextCnNumber();

  const lineItems = body.lineItems ?? [];
  const subtotal = lineItems.reduce((sum: number, line: { total: number }) => sum + (line.total ?? 0), 0) || parseFloat(body.subtotal ?? '0');
  const vatAmount = parseFloat(body.vatAmount ?? '0') || Math.round(subtotal * 0.05 * 100) / 100;
  const total = subtotal + vatAmount;

  const [row] = await prisma.$queryRawUnsafe<CnRow[]>(
    `INSERT INTO finance_credit_notes
       (cn_number, original_invoice_id, original_invoice_no, client_name, client_email,
        module, branch, reason_code, reason_detail, line_items, subtotal, vat_amount, total_amount,
        currency, issue_date, issued_by, tenant_id, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING *`,
    cnNumber,
    body.originalInvoiceId ?? null,
    body.originalInvoiceNo ?? null,
    body.clientName,
    body.clientEmail ?? null,
    body.module ?? null,
    body.branch ?? 'Unassigned',
    body.reasonCode,
    body.reasonDetail ?? null,
    JSON.stringify(lineItems),
    subtotal,
    vatAmount,
    total,
    body.currency ?? 'AED',
    body.issueDate ?? new Date().toISOString().slice(0, 10),
    body.issuedBy ?? null,
    ctx.tenantId,
    body.notes ?? null,
  ).catch(() => []);

  if (!row) return NextResponse.json({ error: 'Failed to create credit note' }, { status: 500 });
  const workflow = await triggerServiceWorkflow({
    req,
    ctx,
    serviceTypeKey: 'FINANCE_BILLING_EXCEPTION',
    referenceType: 'CreditNote',
    referenceId: String(row.id ?? cnNumber),
    referenceNumber: String(row.cn_number ?? cnNumber),
    contextData: {
      originalInvoiceId: body.originalInvoiceId ?? null,
      originalInvoiceNo: body.originalInvoiceNo ?? null,
      module: body.module ?? null,
      branch: body.branch ?? 'Unassigned',
      reasonCode: body.reasonCode,
      totalAmount: total,
      status: row.status ?? 'DRAFT',
    },
    force: true,
  });
  return NextResponse.json({ ...row, workflow }, { status: 201 });
}
