export const dynamic = 'force-dynamic';

/**
 * POST /api/rental/invoices/:id/void
 *
 * Implements UAE FTA Federal Decree-Law No. 8 of 2017 Art. 61 & Executive Regulations Art. 60:
 *  - `DRAFT` invoice (never issued): voids directly (`status = 'VOID'`, `balance_due = 0`), no Credit Note, no GL.
 *  - Issued Tax Invoice (`SENT`, `ISSUED`, `UNPAID`, `OVERDUE`, `PARTIALLY_PAID`, `PAID`):
 *      * Supports both full reversal (`creditAmount` omitted) and partial credit note (`0 < creditAmount <= remainingCapacity`)
 *      * Issues sequential `RCN-XXXXXX` (`invoice_type = 'CREDIT_NOTE'`, `status = 'ISSUED'`, `parent_invoice_id = parent.id`)
 *      * Preserves exact proportional split between `5%` taxable supplies and `0%` Out-of-Scope statutory fines
 *      * Posts balanced reversal GL (`postRacCreditNoteOrVoidGl`: DR Revenue / DR 2160 / DR 2120 Output VAT / CR 1131 AR)
 *      * Mirrors both parent invoice and child `RCN-XXXXXX` to `finance_invoices` post-commit
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { mirrorRentalInvoiceToFinance } from '@/lib/finance/module-ledger';
import {
  postRacCreditNoteOrVoidGl,
  postRacInvoiceIssuedGl,
} from '@/lib/finance/rac-gl-posting';
import { requireRentalPermission } from '@/lib/rental/rbac';
import {
  nextRentalSerial,
  withInvoicePaymentLock,
  withSavepoint,
} from '@/lib/rental/locks';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'approve',
    'invoices',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  try {
    const bodyRaw = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(
      (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
    );
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const voidedBy = req.headers.get('x-user-id')?.trim() || 'system';
    const rawCreditAmount = body.creditAmount ?? body.amount;

    if (!reason) {
      return NextResponse.json(
        { error: 'reason is required to void or issue a credit note for an invoice' },
        { status: 400 },
      );
    }

    if (rawCreditAmount !== undefined && rawCreditAmount !== null && rawCreditAmount !== '') {
      const parsedCredit = Number(rawCreditAmount);
      if (!Number.isFinite(parsedCredit) || parsedCredit <= 0) {
        return NextResponse.json(
          { error: 'creditAmount must be a positive number when specified' },
          { status: 400 },
        );
      }
    }

    type CreditNoteSummary = {
      id: string;
      invoiceNo: string;
      parentInvoiceId: string;
      parentInvoiceNo: string;
      subtotal: number;
      taxableAmount: number;
      taxRate: number;
      taxAmount: number;
      totalAmount: number;
      amount: number;
      status: string;
    };

    type VoidOutcome =
      | { ok: true; invoice: any; creditNote: CreditNoteSummary | null }
      | { ok: false; response: NextResponse };

    const outcome = await withTenantRls<VoidOutcome>(prisma, tenantId, async (tx) =>
      withInvoicePaymentLock(tx, tenantId, params.id, async () => {
        const rows = await tx.$queryRawUnsafe<any[]>(
          'SELECT * FROM rental_invoices WHERE id = $1 AND tenant_id::text = $2 AND deleted_at IS NULL',
          params.id,
          tenantId,
        );
        if (!rows.length) {
          return {
            ok: false,
            response: NextResponse.json({ error: 'Invoice not found' }, { status: 404 }),
          };
        }

        const inv = rows[0];
        const currentStatus = String(inv.status ?? 'DRAFT').toUpperCase();
        const invoiceType = String(inv.invoice_type ?? 'STANDARD').toUpperCase();

        if (invoiceType === 'CREDIT_NOTE') {
          return {
            ok: false,
            response: NextResponse.json(
              { error: 'A Tax Credit Note cannot itself be voided or credited' },
              { status: 422 },
            ),
          };
        }

        if (currentStatus === 'VOID' || currentStatus === 'CANCELLED') {
          return {
            ok: false,
            response: NextResponse.json({ error: 'Invoice is already void' }, { status: 422 }),
          };
        }

        if (currentStatus === 'CREDITED') {
          return {
            ok: false,
            response: NextResponse.json(
              { error: 'Invoice has already been fully credited' },
              { status: 422 },
            ),
          };
        }

        const now = new Date().toISOString();

        // ── Case 1: DRAFT invoice (never issued to customer, never posted to GL) ──
        if (currentStatus === 'DRAFT') {
          const voidNote = `[VOID ${now.split('T')[0]}] ${reason} — by ${voidedBy}`;
          const existingNotes = inv.internal_notes
            ? inv.internal_notes + '\n' + voidNote
            : voidNote;

          await tx.$executeRawUnsafe(
            `UPDATE rental_invoices
                SET status = 'VOID',
                    balance_due = 0,
                    voided_at = $2::timestamptz,
                    void_reason = $4,
                    internal_notes = $1,
                    updated_at = $2::timestamptz
              WHERE id = $3 AND tenant_id::text = $5`,
            existingNotes,
            now,
            params.id,
            reason,
            tenantId,
          );

          await withSavepoint(
            tx,
            'void_draft_finance_mirror',
            () =>
              tx.$executeRawUnsafe(
                `UPDATE finance_invoices
                    SET payment_status = 'CANCELLED',
                        updated_at = NOW()
                  WHERE reference_type = 'RENTAL_INVOICE'
                    AND reference_id::text = $1
                    AND tenant_id::text = $2`,
                params.id,
                tenantId,
              ),
            0,
          );

          const updated = await tx.$queryRawUnsafe<any[]>(
            'SELECT * FROM rental_invoices WHERE id = $1 AND tenant_id::text = $2',
            params.id,
            tenantId,
          );
          return { ok: true, invoice: updated[0], creditNote: null };
        }

        // ── Case 2: Issued Tax Invoice -> UAE FTA Art. 61 Tax Credit Note (`RCN-XXXXXX`) ──
        const origTotal = round2(Number(inv.total_amount ?? 0));
        const origTax = round2(Math.max(0, Number(inv.tax_amount ?? 0)));
        const origTaxable = round2(Math.max(0, Number(inv.taxable_amount ?? 0)));
        const origTaxRate = Number(inv.tax_rate ?? 5);
        const paidAmt = round2(Number(inv.paid_amount ?? 0));

        const priorCnRows = await withSavepoint(
          tx,
          'void_prior_cns',
          () =>
            tx.$queryRawUnsafe<
              Array<{
                credited_total: string | number;
                credited_taxable: string | number;
                credited_tax: string | number;
              }>
            >(
              `SELECT COALESCE(SUM(ABS(total_amount)), 0) AS credited_total,
                      COALESCE(SUM(ABS(taxable_amount)), 0) AS credited_taxable,
                      COALESCE(SUM(ABS(tax_amount)), 0) AS credited_tax
                 FROM rental_invoices
                WHERE parent_invoice_id = $1
                  AND tenant_id::text = $2
                  AND invoice_type = 'CREDIT_NOTE'
                  AND deleted_at IS NULL
                  AND status NOT IN ('VOID', 'CANCELLED')`,
              params.id,
              tenantId,
            ),
          [{ credited_total: 0, credited_taxable: 0, credited_tax: 0 }],
        );

        const priorCreditedTotal = round2(Number(priorCnRows[0]?.credited_total ?? 0));
        const priorCreditedTaxable = round2(Number(priorCnRows[0]?.credited_taxable ?? 0));
        const priorCreditedTax = round2(Number(priorCnRows[0]?.credited_tax ?? 0));
        const remainingGrossCapacity = round2(Math.max(0, origTotal - priorCreditedTotal));

        if (remainingGrossCapacity <= 0.009 && origTotal > 0) {
          return {
            ok: false,
            response: NextResponse.json(
              { error: 'Invoice has already been fully credited' },
              { status: 422 },
            ),
          };
        }

        let creditGross: number;
        if (rawCreditAmount !== undefined && rawCreditAmount !== null && rawCreditAmount !== '') {
          const requestedGross = round2(Number(rawCreditAmount));
          if (requestedGross > remainingGrossCapacity + 0.01) {
            return {
              ok: false,
              response: NextResponse.json(
                {
                  error: `Requested creditAmount (${requestedGross.toFixed(2)}) exceeds remaining creditable invoice total (${remainingGrossCapacity.toFixed(2)})`,
                },
                { status: 422 },
              ),
            };
          }
          creditGross = Math.min(requestedGross, remainingGrossCapacity);
        } else {
          creditGross = remainingGrossCapacity;
        }

        const isFullRemainingReversal = Math.abs(creditGross - remainingGrossCapacity) <= 0.01;
        const ratio = origTotal > 0 ? creditGross / origTotal : 1;

        const creditTax = isFullRemainingReversal
          ? round2(Math.max(0, origTax - priorCreditedTax))
          : round2(origTax * ratio);
        const creditNet = round2(creditGross - creditTax);
        const creditTaxable = isFullRemainingReversal
          ? round2(Math.max(0, origTaxable - priorCreditedTaxable))
          : round2(origTaxable * ratio);

        const parentLines = await withSavepoint(
          tx,
          'void_load_parent_lines',
          () =>
            tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
              `SELECT *
                 FROM rental_invoice_line_items
                WHERE invoice_id = $1 AND tenant_id::text = $2
                ORDER BY sort_order ASC`,
              params.id,
              tenantId,
            ),
          [],
        );

        // Ensure parent invoice's original issue GL exists idempotently before posting reversal GL
        const parentGlLines = parentLines.map((l) => ({
          lineType: l.line_type as string | null,
          description: l.description as string | null,
          amount: Number(l.amount ?? 0),
          taxable: l.taxable as boolean | null,
          quantity: l.quantity != null ? Number(l.quantity) : 1,
          unitLabel: l.unit_label as string | null,
        }));

        await postRacInvoiceIssuedGl(tx, {
          tenantId,
          invoiceId: params.id,
          invoiceNo: String(inv.invoice_no ?? params.id),
          invoiceDate: inv.invoice_date ?? now,
          status: currentStatus,
          currency: String(inv.currency ?? 'AED'),
          subtotal: Number(inv.subtotal ?? 0),
          discountAmount: Number(inv.discount_amount ?? 0),
          taxAmount: origTax,
          totalAmount: origTotal,
          lines: parentGlLines,
          preparedBy: voidedBy,
        });

        const cnId = crypto.randomUUID();
        const cnNo = await nextRentalSerial(tx, {
          tenantId,
          series: 'RCN',
          prefix: 'RCN-',
          table: 'rental_invoices',
          column: 'invoice_no',
        });

        const cnNotes = `${isFullRemainingReversal ? 'Tax Credit Note (Full Reversal)' : 'Tax Credit Note (Partial Adjustment)'} against Tax Invoice ${inv.invoice_no} — ${reason}`;

        await tx.$executeRawUnsafe(
          'INSERT INTO rental_invoices ' +
            '(id,tenant_id,created_at,updated_at,invoice_no,agreement_id,customer_id,invoice_type,invoice_date,' +
            'due_date,period_from,period_to,currency,subtotal,discount_amount,taxable_amount,tax_rate,tax_amount,' +
            'total_amount,paid_amount,balance_due,status,is_corporate,corporate_account_id,billing_mode,parent_invoice_id,notes) ' +
            "VALUES ($1,$2,$3::timestamptz,$4::timestamptz,$5,$6,$7,'CREDIT_NOTE',$8::timestamptz,$9::timestamptz,$10::timestamptz,$11::timestamptz,$12,$13,0,$14,$15,$16,$17,0,0,'ISSUED',$18,$19,$20,$21,$22)",
          cnId,
          tenantId,
          now,
          now,
          cnNo,
          inv.agreement_id,
          inv.customer_id,
          now,
          now,
          inv.period_from ?? null,
          inv.period_to ?? null,
          inv.currency ?? 'AED',
          -creditNet,
          -creditTaxable,
          origTaxRate,
          -creditTax,
          -creditGross,
          Boolean(inv.is_corporate ?? false),
          inv.corporate_account_id ?? null,
          inv.billing_mode ?? 'SEPARATE',
          params.id,
          cnNotes,
        );

        // Build negated child Credit Note line items preserving each line's `taxable` flag
        const cnLines: Array<{
          lineType: string;
          description: string;
          quantity: number;
          unitPrice: number;
          unitLabel: string;
          discountPct: number;
          taxable: boolean;
          amount: number;
        }> = [];

        if (parentLines.length > 0 && creditNet > 0) {
          for (const pl of parentLines) {
            const pAmt = Number(pl.amount ?? 0);
            if (pAmt === 0) continue;
            const scaledAmt = round2(-pAmt * ratio);
            if (scaledAmt === 0) continue;
            const qty = Math.max(1, Number(pl.quantity ?? 1));
            cnLines.push({
              lineType: String(pl.line_type ?? 'CREDIT_NOTE'),
              description: `Credit Reversal (${inv.invoice_no}): ${String(pl.description ?? pl.line_type ?? 'Charge')}`,
              quantity: qty,
              unitPrice: round2(scaledAmt / qty),
              unitLabel: String(pl.unit_label ?? 'flat'),
              discountPct: 0,
              taxable: pl.taxable !== false && String(pl.line_type ?? '').toUpperCase() !== 'DISCOUNT',
              amount: scaledAmt,
            });
          }

          if (cnLines.length > 0) {
            const sumCn = round2(cnLines.reduce((s, l) => s + l.amount, 0));
            const diff = round2(-creditNet - sumCn);
            if (Math.abs(diff) > 0) {
              cnLines[0].amount = round2(cnLines[0].amount + diff);
              cnLines[0].unitPrice = round2(cnLines[0].amount / cnLines[0].quantity);
            }
          }
        }

        if (cnLines.length === 0) {
          cnLines.push({
            lineType: 'CREDIT_NOTE',
            description: cnNotes,
            quantity: 1,
            unitPrice: -creditNet,
            unitLabel: 'flat',
            discountPct: 0,
            taxable: creditTax > 0,
            amount: -creditNet,
          });
        }

        let sortOrder = 0;
        for (const cl of cnLines) {
          await withSavepoint(
            tx,
            `void_cn_li_${sortOrder}`,
            () =>
              tx.$executeRawUnsafe(
                'INSERT INTO rental_invoice_line_items ' +
                  '(id,tenant_id,invoice_id,line_type,description,quantity,unit_price,unit_label,discount_pct,taxable,amount,sort_order,reference_id) ' +
                  'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
                crypto.randomUUID(),
                tenantId,
                cnId,
                cl.lineType,
                cl.description,
                cl.quantity,
                cl.unitPrice,
                cl.unitLabel,
                cl.discountPct,
                cl.taxable,
                cl.amount,
                sortOrder++,
                params.id,
              ),
            0,
          );
        }

        // Post balanced reversal GL (`DR Revenue/2160` + `DR 2120 Output VAT` / `CR 1131 AR`)
        await postRacCreditNoteOrVoidGl(tx, {
          tenantId,
          creditNoteOrInvoiceId: cnId,
          documentNo: cnNo,
          parentInvoiceNo: String(inv.invoice_no ?? params.id),
          entryDate: now,
          currency: String(inv.currency ?? 'AED'),
          subtotalMagnitude: creditNet,
          taxMagnitude: creditTax,
          totalMagnitude: creditGross,
          lines: cnLines,
          preparedBy: voidedBy,
        });

        // Update parent invoice balance_due & status
        const totalCreditedAfter = round2(priorCreditedTotal + creditGross);
        const fullyCredited = totalCreditedAfter >= origTotal - 0.01;
        const newParentBalanceDue = round2(
          Math.max(0, origTotal - paidAmt - totalCreditedAfter),
        );

        let targetParentStatus: string;
        if (fullyCredited) {
          targetParentStatus = paidAmt <= 0.009 ? 'VOID' : 'CREDITED';
        } else if (newParentBalanceDue <= 0.009 && paidAmt > 0) {
          targetParentStatus = 'PAID';
        } else if (paidAmt > 0) {
          targetParentStatus = 'PARTIALLY_PAID';
        } else {
          targetParentStatus = String(inv.status);
        }

        const cnAuditNote = `[CREDIT NOTE ${cnNo} ${now.split('T')[0]} AED -${creditGross.toFixed(2)}] ${reason} — by ${voidedBy}`;
        const updatedInternalNotes = inv.internal_notes
          ? `${inv.internal_notes}\n${cnAuditNote}`
          : cnAuditNote;

        const appliedParentUpdate = await withSavepoint(
          tx,
          'void_upd_parent_status',
          async () => {
            await tx.$executeRawUnsafe(
              `UPDATE rental_invoices
                  SET status = $1,
                      balance_due = $2,
                      voided_at = CASE WHEN $1 IN ('VOID', 'CREDITED') THEN $3::timestamptz ELSE voided_at END,
                      void_reason = CASE WHEN $1 IN ('VOID', 'CREDITED') THEN $4 ELSE void_reason END,
                      internal_notes = $5,
                      updated_at = $3::timestamptz
                WHERE id = $6 AND tenant_id::text = $7`,
              targetParentStatus,
              newParentBalanceDue,
              now,
              reason,
              updatedInternalNotes,
              params.id,
              tenantId,
            );
            return true;
          },
          false,
        );

        if (!appliedParentUpdate) {
          // Fallback if a strict DB check constraint disallows 'CREDITED'
          const fallbackStatus = targetParentStatus === 'CREDITED' ? 'PAID' : targetParentStatus;
          await tx.$executeRawUnsafe(
            `UPDATE rental_invoices
                SET status = $1,
                    balance_due = $2,
                    internal_notes = $3,
                    updated_at = $4::timestamptz
              WHERE id = $5 AND tenant_id::text = $6`,
            fallbackStatus,
            newParentBalanceDue,
            updatedInternalNotes,
            now,
            params.id,
            tenantId,
          );
        }

        const creditNote: CreditNoteSummary = {
          id: cnId,
          invoiceNo: cnNo,
          parentInvoiceId: params.id,
          parentInvoiceNo: String(inv.invoice_no ?? params.id),
          subtotal: -creditNet,
          taxableAmount: -creditTaxable,
          taxRate: origTaxRate,
          taxAmount: -creditTax,
          totalAmount: -creditGross,
          amount: -creditGross,
          status: 'ISSUED',
        };

        const updated = await tx.$queryRawUnsafe<any[]>(
          'SELECT * FROM rental_invoices WHERE id = $1 AND tenant_id::text = $2',
          params.id,
          tenantId,
        );

        return { ok: true, invoice: updated[0], creditNote };
      }),
    );

    if (!outcome.ok) {
      return outcome.response;
    }

    await mirrorRentalInvoiceToFinance(params.id, tenantId, voidedBy).catch((err) =>
      console.warn('[rental/void] parent mirror failed:', err),
    );
    if (outcome.creditNote) {
      await mirrorRentalInvoiceToFinance(outcome.creditNote.id, tenantId, voidedBy).catch(
        (err) => console.warn('[rental/void] credit-note mirror failed:', err),
      );
    }

    return NextResponse.json({ invoice: outcome.invoice, creditNote: outcome.creditNote });
  } catch (e) {
    console.error('Invoice void error:', e);
    return NextResponse.json({ error: 'Failed to void or credit invoice' }, { status: 500 });
  }
}
