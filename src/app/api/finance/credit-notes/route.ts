export const dynamic = 'force-dynamic';

/**
 * Enhanced Credit Notes API — /api/finance/credit-notes
 * Full lifecycle: DRAFT → ISSUED → APPLIED | REFUNDED | VOIDED
 * Linked to finance_invoices, with reason codes and line items
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { nextDocumentNumber } from '@/lib/finance/document-number';
import { postOperationalJournalEntry } from '@/lib/finance/journal-service';
// Tables come from migrations (the last: 20261005090000_finance_tenant_tables).
// A request runs no DDL: the runtime role may not create tables, and the
// failed statement aborted the request's transaction, so every query after
// it failed too.

type CnRow = Record<string, unknown>;


export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
      const sp      = req.nextUrl.searchParams;
      const status  = sp.get('status');
      const moduleParam = sp.get('module');
      const page    = Math.max(1, parseInt(sp.get('page')  ?? '1'));
      const limit   = Math.min(100, parseInt(sp.get('limit') ?? '50'));
      const offset  = (page - 1) * limit;

      let where = `WHERE tenant_id = $1 AND deleted_at IS NULL`;
      const params: unknown[] = [tenantId];
      let pi = 2;
      if (status) { where += ` AND status = $${pi++}`;  params.push(status); }
      if (moduleParam) { where += ` AND module = $${pi++}`;  params.push(moduleParam); }

      const [rows, counts] = await Promise.all([
        tx.$queryRawUnsafe<CnRow[]>(
          `SELECT * FROM finance_credit_notes ${where} ORDER BY created_at DESC LIMIT $${pi} OFFSET $${pi+1}`,
          ...params, limit, offset
        ).catch(() => []),
        tx.$queryRawUnsafe<{ status: string; count: string; total: string }[]>(
          `SELECT status, COUNT(*)::text as count, COALESCE(SUM(total_amount),0)::text as total
             FROM finance_credit_notes WHERE tenant_id = $1 AND deleted_at IS NULL GROUP BY status`,
          tenantId,
        ).catch(() => []),
      ]);

      return NextResponse.json({ data: rows, counts, page, limit });
  });
}

export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    return await withTenantRls(prisma, tenantId, async (tx) => {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);

      if (body.reason !== undefined && typeof body.reason === 'string' && body.reason.trim().length === 0) {
        return NextResponse.json({ error: 'Credit note reason cannot be whitespace only' }, { status: 400 });
      }

      if (body.remainingBalance !== undefined && Number(body.remainingBalance) <= 0) {
        return NextResponse.json({ error: 'Cannot issue credit note against invoice with zero remaining balance' }, { status: 422 });
      }

      const targetInvoiceId = body.invoiceId || body.originalInvoiceId;
      if (!targetInvoiceId) {
        return NextResponse.json(
          { error: 'Valid linked invoiceId is required for credit note issuance' },
          { status: 400 },
        );
      }

      const lineItems  = body.lineItems ?? [];
      let total = 0;
      let subtotal = 0;
      let vatAmount = 0;

      if (body.amount !== undefined) {
        total = Number(Number(body.amount).toFixed(2));
        subtotal = Number((total / 1.05).toFixed(2));
        vatAmount = Number((total - subtotal).toFixed(2));
      } else {
        subtotal   = lineItems.reduce((s: number, l: { total: number }) => s + (l.total ?? 0), 0) || parseFloat(body.subtotal ?? '0');
        vatAmount  = parseFloat(body.vatAmount ?? '0') || Math.round(subtotal * 0.05 * 100) / 100;
        total      = Number((subtotal + vatAmount).toFixed(2));
      }

      // Validate linked invoice existence and available balance
      const [linkedInv] = await tx.$queryRawUnsafe<any[]>(
        `SELECT id, invoice_number, total_amount, paid_amount, client_name
           FROM finance_invoices
          WHERE (id::text = $1 OR invoice_number = $1) AND tenant_id = $2 AND deleted_at IS NULL
          LIMIT 1`,
        String(targetInvoiceId),
        tenantId,
      );

      if (!linkedInv) {
        return NextResponse.json({ error: 'Linked invoice not found' }, { status: 404 });
      }

      const invTotal = Number(linkedInv.total_amount ?? 0);
      const invPaid = Number(linkedInv.paid_amount ?? 0);
      const invBalance = Number((invTotal - invPaid).toFixed(2));
      if (total > invBalance + 0.05) {
        return NextResponse.json({
          error: `Credit note amount (${total}) exceeds original invoice balance (${invBalance})`,
        }, { status: 422 });
      }

      const cnNumber = await nextDocumentNumber(tx, tenantId, 'CN');

      const [row] = await tx.$queryRawUnsafe<CnRow[]>(
        `INSERT INTO finance_credit_notes
           (cn_number, original_invoice_id, original_invoice_no, client_name, client_email,
            module, reason_code, reason_detail, line_items, subtotal, vat_amount, total_amount,
            currency, issue_date, issued_by, notes, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::numeric,$11::numeric,$12::numeric,$13,$14::date,$15,$16,$17)
         RETURNING *`,
        cnNumber,
        linkedInv?.id ?? body.originalInvoiceId ?? null,
        linkedInv?.invoice_number ?? body.originalInvoiceNo ?? null,
        body.clientName || linkedInv?.client_name || 'Customer',
        body.clientEmail ?? null,
        body.module ?? null,
        body.reasonCode || 'BILLING_CORRECTION',
        body.reasonDetail ?? body.reason ?? null,
        JSON.stringify(lineItems),
        subtotal,
        vatAmount,
        total,
        body.currency ?? 'AED',
        body.issueDate ?? new Date().toISOString().slice(0, 10),
        body.issuedBy ?? null,
        body.notes ?? null,
        tenantId,
      );

      if (!row) return NextResponse.json({ error: 'Failed to create credit note' }, { status: 500 });

      // Post double-entry GL reversing entries inside an explicit SAVEPOINT
      const cnId = (row as Record<string, unknown>).id;
      await tx.$executeRawUnsafe('SAVEPOINT sp_cn_gl');
      try {
        const glEntry = await postOperationalJournalEntry(tx, {
          tenantId,
          entryDate: body.issueDate ?? new Date().toISOString().slice(0, 10),
          narration: `Credit Note ${cnNumber} for invoice ${linkedInv?.invoice_number || targetInvoiceId}`,
          reference: cnNumber,
          sourceType: 'CREDIT_NOTE',
          sourceId: String(cnId),
          currency: body.currency ?? 'AED',
          preparedBy: body.issuedBy ?? 'Finance',
          idempotencyKey: `CREDIT_NOTE:${cnId}`,
          lines: [
            { code: '4400', name: 'Revenue Reversal', description: `Credit note ${cnNumber}`, debit: subtotal, credit: 0 },
            { code: '2120', name: 'VAT Output Tax Payable', description: `Output VAT adjustment ${cnNumber}`, debit: vatAmount, credit: 0 },
            { code: '1130', name: 'Accounts Receivable', description: `AR credit note clearance ${cnNumber}`, debit: 0, credit: total },
          ],
        });
        if (!glEntry) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sp_cn_gl');
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT sp_cn_gl').catch(() => {});
          console.warn('[credit-notes] GL reversing entry returned null; rolled back to savepoint', { cnNumber, cnId });
        } else {
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT sp_cn_gl');
        }
      } catch (err) {
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sp_cn_gl').catch(() => {});
        await tx.$executeRawUnsafe('RELEASE SAVEPOINT sp_cn_gl').catch(() => {});
        console.warn('[credit-notes] GL reversing entry warning (rolled back to savepoint):', err);
      }

      return NextResponse.json(row, { status: 201 });
    });
  } catch (err) {
    console.error('[finance/credit-notes POST]', err);
    return NextResponse.json({ error: 'Failed to create credit note' }, { status: 500 });
  }
}

