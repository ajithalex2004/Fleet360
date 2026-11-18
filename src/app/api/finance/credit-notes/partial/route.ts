import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { nextDocumentNumber } from '@/lib/finance/document-number';
import { assertPeriodOpen, postOperationalJournalEntry } from '@/lib/finance/journal-service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  try {
    const rawBody = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(rawBody);
    const invoiceId = body.invoiceId ? String(body.invoiceId) : null;
    const amount = Number(body.amount ?? 0);

    if (!invoiceId || isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: 'invoiceId and a positive amount are required' }, { status: 400 });
    }

    return await withTenantRls(prisma, tenantId, async (tx) => {
      // Statement 1: Lock invoice row FOR UPDATE to serialize concurrent partial credit notes
      const [invoice] = await tx.$queryRawUnsafe<Array<{
        id: string;
        invoice_number: string;
        total_amount: unknown;
        paid_amount: unknown;
        client_name: string | null;
      }>>(
        `SELECT id, invoice_number, total_amount, paid_amount, client_name
           FROM finance_invoices
          WHERE (id::text = $1 OR invoice_number = $1)
            AND tenant_id = $2
            AND deleted_at IS NULL
          LIMIT 1
            FOR UPDATE`,
        invoiceId,
        tenantId,
      );

      if (!invoice) {
        return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
      }

      // Statement 2: Fresh committed sum of existing credit notes (2nd statement avoids PG17 EPQ stale subplan snapshot)
      const cnRows = await tx.$queryRawUnsafe<Array<{ credited: string | number | null }>>(
        `SELECT COALESCE(SUM(total_amount), 0)::numeric AS credited
           FROM finance_credit_notes
          WHERE original_invoice_id = $1
            AND tenant_id = $2
            AND deleted_at IS NULL
            AND UPPER(COALESCE(status, 'DRAFT')) NOT IN ('VOID', 'VOIDED', 'CANCELLED')`,
        String(invoice.id),
        tenantId,
      );

      const invTotal = Number(invoice.total_amount ?? 0);
      const invPaid = Number(invoice.paid_amount ?? 0);
      const existingCredited = Number(cnRows?.[0]?.credited ?? 0);
      const remainingCreditable = Math.max(0, Number((invTotal - invPaid - existingCredited).toFixed(2)));

      if (remainingCreditable <= 0 || amount > remainingCreditable + 0.005) {
        return NextResponse.json({
          error: `Partial credit note amount (${amount}) exceeds invoice outstanding balance (${remainingCreditable})`,
        }, { status: 422 });
      }

      const entryDate = new Date().toISOString().slice(0, 10);
      try {
        await assertPeriodOpen(tx, tenantId, entryDate);
      } catch (periodErr: unknown) {
        const statusCode = (periodErr as { statusCode?: number })?.statusCode;
        if (statusCode === 422) {
          return NextResponse.json(
            { error: (periodErr as Error).message },
            { status: 422 },
          );
        }
        throw periodErr;
      }

      const cnNumber = await nextDocumentNumber(tx, tenantId, 'CN');
      const subtotal = Number((amount / 1.05).toFixed(2));
      const vatAmount = Number((amount - subtotal).toFixed(2));

      const [cnRow] = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `INSERT INTO finance_credit_notes
           (cn_number, original_invoice_id, original_invoice_no, client_name,
            reason_code, reason_detail, subtotal, vat_amount, total_amount,
            status, applied_amount, currency, issue_date, tenant_id)
         VALUES ($1, $2, $3, 'Customer',
                 'PARTIAL_CREDIT', 'Partial settlement credit note', $4, $5, $6,
                 'APPLIED', $6, 'AED', CURRENT_DATE, $7)
         RETURNING *`,
        cnNumber,
        invoice.id,
        invoice.invoice_number,
        subtotal,
        vatAmount,
        amount,
        tenantId,
      );

      if (!cnRow?.id) {
        throw new Error('Failed to insert partial credit note');
      }

      const newOutstanding = Math.max(0, Number((remainingCreditable - amount).toFixed(2)));

      // Post GL reversing entry isolated inside an explicit PostgreSQL SAVEPOINT
      let glEntry: { id: string; number: string; created: boolean } | null = null;
      await tx.$executeRawUnsafe('SAVEPOINT sp_cn_partial_gl');
      try {
        glEntry = await postOperationalJournalEntry(tx, {
          tenantId,
          entryDate,
          narration: `Partial Credit Note ${cnNumber} for invoice ${invoice.invoice_number}`,
          reference: cnNumber,
          sourceType: 'CREDIT_NOTE',
          sourceId: String(cnRow.id),
          currency: 'AED',
          idempotencyKey: `CREDIT_NOTE_PARTIAL:${cnRow.id}`,
          lines: [
            { code: '4400', name: 'Revenue Reversal', description: `Partial credit note ${cnNumber}`, debit: subtotal, credit: 0 },
            { code: '2120', name: 'VAT Output Tax Payable', description: `Output VAT adjustment ${cnNumber}`, debit: vatAmount, credit: 0 },
            { code: '1130', name: 'Accounts Receivable', description: `AR partial credit clearance ${cnNumber}`, debit: 0, credit: amount },
          ],
        });
        if (!glEntry) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sp_cn_partial_gl');
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT sp_cn_partial_gl').catch(() => {});
          console.warn('[finance/credit-notes/partial] GL reversing entry returned null; rolled back to savepoint', {
            tenantId,
            creditNoteId: cnRow.id,
            cnNumber,
          });
        } else {
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT sp_cn_partial_gl');
        }
      } catch (glErr) {
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sp_cn_partial_gl').catch(() => {});
        await tx.$executeRawUnsafe('RELEASE SAVEPOINT sp_cn_partial_gl').catch(() => {});
        console.warn('[finance/credit-notes/partial] GL reversing entry failed; rolled back to savepoint:', glErr);
      }

      return NextResponse.json({
        ok: true,
        creditNote: cnRow,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        creditedAmount: amount,
        previousOutstanding: remainingCreditable,
        newOutstanding,
        glPosted: Boolean(glEntry),
        glEntry,
      }, { status: 201 });
    });
  } catch (e) {
    console.error('[finance/credit-notes/partial]', e);
    return NextResponse.json({ error: 'Failed to issue partial credit note' }, { status: 500 });
  }
}
