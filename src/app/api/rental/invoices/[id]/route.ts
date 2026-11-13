export const dynamic = 'force-dynamic';

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
import { withSavepoint } from '@/lib/rental/locks';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function isStatutoryFineType(lineTypeUpper: string): boolean {
  return (
    lineTypeUpper === 'FINE' ||
    lineTypeUpper === 'TRAFFIC_FINE' ||
    lineTypeUpper === 'STATUTORY_FINE'
  );
}

// ── GET /api/rental/invoices/:id ─────────────────────────────────────────────
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT ri.*,
                ra.agreement_no,
                COALESCE(NULLIF(ra.customer_name, ''), NULLIF(rc.company_name, ''), rc.full_name) AS customer_name,
                rc.email AS customer_email,
                rc.phone AS customer_phone,
                parent.invoice_no AS parent_invoice_no,
                CASE
                  WHEN ri.invoice_type = 'CREDIT_NOTE' THEN 0
                  ELSE COALESCE(ri.balance_due, GREATEST(0, ri.total_amount - COALESCE(ri.paid_amount, 0)), 0)
                END AS balance_due
           FROM rental_invoices ri
           LEFT JOIN rental_agreements ra
             ON ra.id = ri.agreement_id
            AND ra.tenant_id::text = ri.tenant_id::text
           LEFT JOIN rental_customers rc
             ON rc.id::text = COALESCE(NULLIF(ri.customer_id::text, ''), NULLIF(ra.customer_id::text, ''))
            AND rc.tenant_id::text = ri.tenant_id::text
           LEFT JOIN rental_invoices parent
             ON parent.id = ri.parent_invoice_id
            AND parent.tenant_id::text = ri.tenant_id::text
          WHERE ri.id = $1
            AND ri.tenant_id::text = $2
            AND ri.deleted_at IS NULL`,
        params.id,
        tenantId,
      );

      if (!rows.length) {
        return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
      }

      const lineItems = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT *
           FROM rental_invoice_line_items
          WHERE invoice_id = $1
            AND tenant_id::text = $2
          ORDER BY sort_order ASC`,
        params.id,
        tenantId,
      );

      const payments = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT *
           FROM rental_invoice_payments
          WHERE invoice_id = $1
            AND tenant_id::text = $2
          ORDER BY paid_at DESC`,
        params.id,
        tenantId,
      );

      const creditNotes = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT id, invoice_no, invoice_date, subtotal, taxable_amount, tax_amount, total_amount, status, notes
           FROM rental_invoices
          WHERE parent_invoice_id = $1
            AND tenant_id::text = $2
            AND invoice_type = 'CREDIT_NOTE'
            AND deleted_at IS NULL
          ORDER BY created_at DESC`,
        params.id,
        tenantId,
      );

      return NextResponse.json({ ...rows[0], lineItems, payments, creditNotes });
    } catch (e) {
      console.error('Invoice GET error:', e);
      return NextResponse.json({ error: 'Failed to fetch invoice' }, { status: 500 });
    }
  });
}

const IMMUTABLE_FINANCIAL_FIELDS = new Set([
  'paid_amount',
  'paidAmount',
  'balance_due',
  'balanceDue',
  'total_amount',
  'totalAmount',
  'subtotal',
  'discount_amount',
  'discountAmount',
  'taxable_amount',
  'taxableAmount',
  'tax_rate',
  'taxRate',
  'tax_amount',
  'taxAmount',
  'invoice_type',
  'invoiceType',
  'corporate_account_id',
  'corporateAccountId',
  'customer_id',
  'customerId',
  'agreement_id',
  'agreementId',
  'invoice_no',
  'invoiceNo',
]);

// ── PUT /api/rental/invoices/:id ─────────────────────────────────────────────
export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const bodyRaw = await req.json();
    const body = stripTenantOwnershipFields(
      (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
    );

    for (const key of Object.keys(body)) {
      if (IMMUTABLE_FINANCIAL_FIELDS.has(key)) {
        return NextResponse.json(
          {
            error: `Field '${key}' cannot be modified via PUT. Use PATCH on DRAFT invoices, or /payments or /void for financial state changes.`,
          },
          { status: 422 },
        );
      }
    }

    const actor = (req.headers.get('x-user-id') ?? '').trim() || 'rental-api';

    type PutOutcome =
      | { ok: true; updated: Record<string, unknown> }
      | { ok: false; response: NextResponse };

    const outcome = await withTenantRls<PutOutcome>(prisma, tenantId, async (tx) => {
      const existingRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT *
           FROM rental_invoices
          WHERE id = $1
            AND tenant_id::text = $2
            AND deleted_at IS NULL
          LIMIT 1`,
        params.id,
        tenantId,
      );
      if (!existingRows.length) {
        return {
          ok: false,
          response: NextResponse.json({ error: 'Invoice not found' }, { status: 404 }),
        };
      }

      const existing = existingRows[0];
      const currentStatus = String(existing.status ?? 'DRAFT').toUpperCase();
      if (['PAID', 'VOID', 'CANCELLED', 'CREDITED'].includes(currentStatus)) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: `Cannot modify a ${currentStatus} invoice` },
            { status: 409 },
          ),
        };
      }

      const now = new Date().toISOString();
      const setClauses: string[] = ['updated_at = $1::timestamptz'];
      const values: unknown[] = [now];
      let idx = 2;
      let transitionedFromDraftToIssued = false;
      let nextStatus = currentStatus;

      if ('notes' in body) {
        setClauses.push(`notes = $${idx++}`);
        values.push(body.notes ?? null);
      }

      const dueDateVal = 'due_date' in body ? body.due_date : body.dueDate;
      if ('due_date' in body || 'dueDate' in body) {
        setClauses.push(`due_date = $${idx++}::timestamptz`);
        values.push(dueDateVal ?? null);
      }

      const hasPeriodStart =
        'billing_period_start' in body ||
        'billingPeriodStart' in body ||
        'period_from' in body ||
        'periodFrom' in body;
      if (hasPeriodStart) {
        const periodStartVal =
          body.billing_period_start ??
          body.billingPeriodStart ??
          body.period_from ??
          body.periodFrom ??
          null;
        setClauses.push(`period_from = $${idx++}::timestamptz`);
        values.push(periodStartVal);
      }

      const hasPeriodEnd =
        'billing_period_end' in body ||
        'billingPeriodEnd' in body ||
        'period_to' in body ||
        'periodTo' in body;
      if (hasPeriodEnd) {
        const periodEndVal =
          body.billing_period_end ??
          body.billingPeriodEnd ??
          body.period_to ??
          body.periodTo ??
          null;
        setClauses.push(`period_to = $${idx++}::timestamptz`);
        values.push(periodEndVal);
      }

      if ('status' in body && body.status !== undefined && body.status !== null) {
        const requestedStatus = String(body.status).trim().toUpperCase();
        if (requestedStatus === currentStatus) {
          // No-op status
        } else if (
          currentStatus === 'DRAFT' &&
          (requestedStatus === 'SENT' || requestedStatus === 'ISSUED')
        ) {
          setClauses.push(`status = $${idx++}`);
          values.push(requestedStatus);
          transitionedFromDraftToIssued = true;
          nextStatus = requestedStatus;
        } else {
          return {
            ok: false,
            response: NextResponse.json(
              {
                error:
                  'PUT may only transition invoice status from DRAFT to SENT/ISSUED. Use /payments or /void for settlement or voiding.',
              },
              { status: 422 },
            ),
          };
        }
      }

      values.push(params.id, tenantId);
      await tx.$executeRawUnsafe(
        `UPDATE rental_invoices
            SET ${setClauses.join(', ')}
          WHERE id = $${idx}
            AND tenant_id::text = $${idx + 1}
            AND deleted_at IS NULL`,
        ...values,
      );

      if (transitionedFromDraftToIssued) {
        const lines = await tx.$queryRawUnsafe<
          Array<{
            line_type: string | null;
            description: string | null;
            amount: string | number;
            taxable: boolean | null;
            quantity: string | number | null;
            unit_label: string | null;
          }>
        >(
          `SELECT line_type, description, amount, taxable, quantity, unit_label
             FROM rental_invoice_line_items
            WHERE invoice_id = $1 AND tenant_id::text = $2
            ORDER BY sort_order ASC`,
          params.id,
          tenantId,
        );
        const mappedLines = lines.map((l) => ({
          lineType: l.line_type,
          description: l.description,
          amount: Number(l.amount ?? 0),
          taxable: l.taxable,
          quantity: l.quantity != null ? Number(l.quantity) : 1,
          unitLabel: l.unit_label,
        }));

        if (String(existing.invoice_type ?? '').toUpperCase() === 'CREDIT_NOTE') {
          await postRacCreditNoteOrVoidGl(tx, {
            tenantId,
            creditNoteOrInvoiceId: params.id,
            documentNo: String(existing.invoice_no ?? params.id),
            entryDate: (existing.invoice_date as string | Date | null) ?? now,
            currency: String(existing.currency ?? 'AED'),
            subtotalMagnitude: Math.abs(Number(existing.subtotal ?? 0)),
            taxMagnitude: Math.abs(Number(existing.tax_amount ?? 0)),
            totalMagnitude: Math.abs(Number(existing.total_amount ?? 0)),
            lines: mappedLines,
            preparedBy: actor,
          });
        } else {
          await postRacInvoiceIssuedGl(tx, {
            tenantId,
            invoiceId: params.id,
            invoiceNo: String(existing.invoice_no ?? params.id),
            invoiceDate: (existing.invoice_date as string | Date | null) ?? now,
            status: nextStatus,
            currency: String(existing.currency ?? 'AED'),
            subtotal: Number(existing.subtotal ?? 0),
            discountAmount: Number(existing.discount_amount ?? 0),
            taxAmount: Number(existing.tax_amount ?? 0),
            totalAmount: Number(existing.total_amount ?? 0),
            lines: mappedLines,
            preparedBy: actor,
          });
        }
      }

      const updated = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT *
           FROM rental_invoices
          WHERE id = $1
            AND tenant_id::text = $2
            AND deleted_at IS NULL`,
        params.id,
        tenantId,
      );

      return { ok: true, updated: updated[0] };
    });

    if (!outcome.ok) {
      return outcome.response;
    }

    await mirrorRentalInvoiceToFinance(params.id, tenantId, actor).catch((err) =>
      console.warn('[rental/invoices PUT] mirror failed:', err),
    );

    return NextResponse.json(outcome.updated);
  } catch (e) {
    console.error('Invoice PUT error:', e);
    return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 });
  }
}

// ── PATCH /api/rental/invoices/:id (Draft line-item / discount / VAT editing & issuance) ──
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const permErr = await requireRentalPermission(
    req.headers,
    tenantId,
    'edit',
    'invoices',
    req.nextUrl.pathname,
  );
  if (permErr) return permErr;

  try {
    const bodyRaw = await req.json();
    const body = stripTenantOwnershipFields(
      (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
    );
    const actor = (req.headers.get('x-user-id') ?? '').trim() || 'rental-api';

    type PatchOutcome =
      | { ok: true; payload: Record<string, unknown> }
      | { ok: false; response: NextResponse };

    const outcome = await withTenantRls<PatchOutcome>(prisma, tenantId, async (tx) => {
      const existingRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT *
           FROM rental_invoices
          WHERE id = $1
            AND tenant_id::text = $2
            AND deleted_at IS NULL
          LIMIT 1`,
        params.id,
        tenantId,
      );
      if (!existingRows.length) {
        return {
          ok: false,
          response: NextResponse.json({ error: 'Invoice not found' }, { status: 404 }),
        };
      }

      const existing = existingRows[0];
      const currentStatus = String(existing.status ?? 'DRAFT').toUpperCase();
      const invoiceType = String(existing.invoice_type ?? 'STANDARD').toUpperCase();

      if (['PAID', 'VOID', 'CANCELLED', 'CREDITED'].includes(currentStatus)) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: `Cannot modify a ${currentStatus} invoice` },
            { status: 409 },
          ),
        };
      }

      const touchesFinancials =
        'lineItems' in body ||
        'discountAmount' in body ||
        'discount_amount' in body ||
        'taxRate' in body ||
        'tax_rate' in body;

      if (touchesFinancials && currentStatus !== 'DRAFT') {
        return {
          ok: false,
          response: NextResponse.json(
            {
              error: `Line items, discounts, and VAT rates can only be edited while an invoice is in DRAFT (current status: ${currentStatus}). Issue a Tax Credit Note via /void to adjust an issued invoice.`,
            },
            { status: 409 },
          ),
        };
      }

      let nextStatus = currentStatus;
      let transitionedFromDraftToIssued = false;
      if ('status' in body && body.status !== undefined && body.status !== null) {
        const requestedStatus = String(body.status).trim().toUpperCase();
        if (requestedStatus === currentStatus) {
          // No-op
        } else if (
          currentStatus === 'DRAFT' &&
          ['SENT', 'ISSUED', 'UNPAID'].includes(requestedStatus)
        ) {
          nextStatus = requestedStatus;
          transitionedFromDraftToIssued = true;
        } else {
          return {
            ok: false,
            response: NextResponse.json(
              {
                error:
                  'PATCH may only transition invoice status from DRAFT to SENT/ISSUED/UNPAID. Use /payments or /void for settlement or credit notes.',
              },
              { status: 422 },
            ),
          };
        }
      }

      // Load or recompute line items & VAT totals
      let finalLines: Array<{
        lineType: string;
        description: string;
        quantity: number;
        unitPrice: number;
        unitLabel: string;
        discountPct: number;
        taxable: boolean;
        amount: number;
        referenceId: string | null;
      }> = [];

      let subtotal = Number(existing.subtotal ?? 0);
      let discountAmount = Number(existing.discount_amount ?? 0);
      let taxRate = Number(existing.tax_rate ?? 5);
      let taxableAmount = Number(existing.taxable_amount ?? 0);
      let taxAmount = Number(existing.tax_amount ?? 0);
      let totalAmount = Number(existing.total_amount ?? 0);
      let balanceDue = Number(existing.balance_due ?? 0);

      if (touchesFinancials) {
        if ('discountAmount' in body || 'discount_amount' in body) {
          discountAmount = Number(body.discountAmount ?? body.discount_amount ?? 0);
          if (!Number.isFinite(discountAmount) || discountAmount < 0) {
            return {
              ok: false,
              response: NextResponse.json(
                { error: 'discountAmount must be a non-negative number' },
                { status: 400 },
              ),
            };
          }
        }
        if ('taxRate' in body || 'tax_rate' in body) {
          taxRate = Number(body.taxRate ?? body.tax_rate ?? 5);
          if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
            return {
              ok: false,
              response: NextResponse.json(
                { error: 'taxRate must be between 0 and 100' },
                { status: 400 },
              ),
            };
          }
        }

        if ('lineItems' in body) {
          if (!Array.isArray(body.lineItems)) {
            return {
              ok: false,
              response: NextResponse.json(
                { error: 'lineItems must be an array' },
                { status: 400 },
              ),
            };
          }
          for (const rawLi of body.lineItems as Array<Record<string, unknown>>) {
            if (!rawLi || typeof rawLi !== 'object') {
              return {
                ok: false,
                response: NextResponse.json({ error: 'Invalid line item' }, { status: 400 }),
              };
            }
            const lineType = String(rawLi.lineType ?? rawLi.line_type ?? 'OTHER').trim() || 'OTHER';
            const lineTypeUpper = lineType.toUpperCase();
            const description = String(rawLi.description ?? '').trim();
            if (!description) {
              return {
                ok: false,
                response: NextResponse.json(
                  { error: 'Each line item requires a description' },
                  { status: 400 },
                ),
              };
            }
            const quantity = Number(rawLi.quantity ?? 1);
            if (!Number.isFinite(quantity) || quantity <= 0) {
              return {
                ok: false,
                response: NextResponse.json(
                  { error: 'Line item quantity must be greater than 0' },
                  { status: 400 },
                ),
              };
            }
            let unitPrice = Number(rawLi.unitPrice ?? rawLi.unit_price ?? 0);
            if (!Number.isFinite(unitPrice)) {
              return {
                ok: false,
                response: NextResponse.json(
                  { error: 'Line item unitPrice must be a valid number' },
                  { status: 400 },
                ),
              };
            }
            if (
              unitPrice < 0 &&
              lineTypeUpper !== 'DISCOUNT' &&
              lineTypeUpper !== 'CREDIT_NOTE' &&
              invoiceType !== 'CREDIT_NOTE'
            ) {
              return {
                ok: false,
                response: NextResponse.json(
                  { error: 'Negative unit prices are not permitted on non-discount line items' },
                  { status: 400 },
                ),
              };
            }
            if (invoiceType === 'CREDIT_NOTE' && unitPrice > 0) {
              unitPrice = -unitPrice;
            }
            const discountPct = Number(rawLi.discountPct ?? rawLi.discount_pct ?? 0);
            if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) {
              return {
                ok: false,
                response: NextResponse.json(
                  { error: 'Line item discountPct must be between 0 and 100' },
                  { status: 400 },
                ),
              };
            }
            const defaultTaxable =
              lineTypeUpper === 'DISCOUNT' ? false : !isStatutoryFineType(lineTypeUpper);
            const taxable =
              rawLi.taxable !== undefined ? Boolean(rawLi.taxable) : defaultTaxable;
            const amount = round2(quantity * unitPrice * (1 - discountPct / 100));

            finalLines.push({
              lineType,
              description,
              quantity,
              unitPrice,
              unitLabel: String(rawLi.unitLabel ?? rawLi.unit_label ?? 'day'),
              discountPct,
              taxable,
              amount,
              referenceId:
                typeof rawLi.referenceId === 'string' && rawLi.referenceId.trim()
                  ? rawLi.referenceId.trim()
                  : null,
            });
          }
        } else {
          const dbLines = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
            `SELECT * FROM rental_invoice_line_items
              WHERE invoice_id = $1 AND tenant_id::text = $2
              ORDER BY sort_order ASC`,
            params.id,
            tenantId,
          );
          finalLines = dbLines.map((l) => ({
            lineType: String(l.line_type ?? 'OTHER'),
            description: String(l.description ?? ''),
            quantity: Number(l.quantity ?? 1),
            unitPrice: Number(l.unit_price ?? 0),
            unitLabel: String(l.unit_label ?? 'day'),
            discountPct: Number(l.discount_pct ?? 0),
            taxable: l.taxable !== false,
            amount: Number(l.amount ?? 0),
            referenceId: (l.reference_id as string | null) ?? null,
          }));
        }

        if (finalLines.length > 0) {
          subtotal = round2(finalLines.reduce((s, l) => s + l.amount, 0));
          const discountLinesAbs = Math.abs(
            finalLines
              .filter((l) => l.lineType.toUpperCase() === 'DISCOUNT')
              .reduce((s, l) => s + l.amount, 0),
          );
          const headerDiscountToDeduct = discountLinesAbs > 0 ? 0 : discountAmount;

          if (invoiceType !== 'CREDIT_NOTE' && subtotal - headerDiscountToDeduct < 0) {
            return {
              ok: false,
              response: NextResponse.json(
                { error: 'Invoice net amount before tax cannot be negative' },
                { status: 400 },
              ),
            };
          }

          const taxableLinesSum = finalLines
            .filter((l) => l.taxable && l.lineType.toUpperCase() !== 'DISCOUNT')
            .reduce((s, l) => s + l.amount, 0);

          if (invoiceType === 'CREDIT_NOTE') {
            taxableAmount = round2(taxableLinesSum);
            taxAmount = round2((taxableAmount * taxRate) / 100);
            totalAmount = round2(subtotal + taxAmount);
            balanceDue = 0;
          } else {
            const totalDiscountOnTaxable = discountLinesAbs > 0 ? discountLinesAbs : discountAmount;
            taxableAmount = round2(Math.max(0, taxableLinesSum - totalDiscountOnTaxable));
            taxAmount = round2((taxableAmount * taxRate) / 100);
            const netAfterDiscount = round2(subtotal - headerDiscountToDeduct);
            totalAmount = round2(netAfterDiscount + taxAmount);
            balanceDue = round2(Math.max(0, totalAmount - Number(existing.paid_amount ?? 0)));
          }
        } else {
          const netAfterDiscount =
            invoiceType === 'CREDIT_NOTE' ? subtotal : round2(Math.max(0, subtotal - discountAmount));
          taxableAmount = netAfterDiscount;
          taxAmount = round2((taxableAmount * taxRate) / 100);
          totalAmount = round2(netAfterDiscount + taxAmount);
          balanceDue =
            invoiceType === 'CREDIT_NOTE'
              ? 0
              : round2(Math.max(0, totalAmount - Number(existing.paid_amount ?? 0)));
        }

        if ('lineItems' in body) {
          await tx.$executeRawUnsafe(
            'DELETE FROM rental_invoice_line_items WHERE invoice_id = $1 AND tenant_id::text = $2',
            params.id,
            tenantId,
          );
          let sortOrder = 0;
          for (const li of finalLines) {
            await tx.$executeRawUnsafe(
              `INSERT INTO rental_invoice_line_items
                 (id, tenant_id, invoice_id, line_type, description, quantity, unit_price,
                  unit_label, discount_pct, taxable, amount, sort_order, reference_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
              crypto.randomUUID(),
              tenantId,
              params.id,
              li.lineType,
              li.description,
              li.quantity,
              li.unitPrice,
              li.unitLabel,
              li.discountPct,
              li.taxable,
              li.amount,
              sortOrder++,
              li.referenceId,
            );
          }
        }
      }

      const now = new Date().toISOString();
      const notesVal = 'notes' in body ? (body.notes ?? null) : (existing.notes ?? null);
      const dueDateVal =
        'dueDate' in body || 'due_date' in body
          ? (body.dueDate ?? body.due_date ?? null)
          : (existing.due_date ?? null);
      const periodFromVal =
        'periodFrom' in body || 'period_from' in body || 'billingPeriodStart' in body
          ? (body.periodFrom ?? body.period_from ?? body.billingPeriodStart ?? null)
          : (existing.period_from ?? null);
      const periodToVal =
        'periodTo' in body || 'period_to' in body || 'billingPeriodEnd' in body
          ? (body.periodTo ?? body.period_to ?? body.billingPeriodEnd ?? null)
          : (existing.period_to ?? null);

      await tx.$executeRawUnsafe(
        `UPDATE rental_invoices
            SET subtotal = $1,
                discount_amount = $2,
                taxable_amount = $3,
                tax_rate = $4,
                tax_amount = $5,
                total_amount = $6,
                balance_due = $7,
                status = $8,
                notes = $9,
                due_date = $10::timestamptz,
                period_from = $11::timestamptz,
                period_to = $12::timestamptz,
                updated_at = $13::timestamptz
          WHERE id = $14
            AND tenant_id::text = $15
            AND deleted_at IS NULL`,
        subtotal,
        discountAmount,
        taxableAmount,
        taxRate,
        taxAmount,
        totalAmount,
        balanceDue,
        nextStatus,
        notesVal,
        dueDateVal,
        periodFromVal,
        periodToVal,
        now,
        params.id,
        tenantId,
      );

      const currentLineItems = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT *
           FROM rental_invoice_line_items
          WHERE invoice_id = $1 AND tenant_id::text = $2
          ORDER BY sort_order ASC`,
        params.id,
        tenantId,
      );

      if (transitionedFromDraftToIssued) {
        const glLines = currentLineItems.map((l) => ({
          lineType: l.line_type as string | null,
          description: l.description as string | null,
          amount: Number(l.amount ?? 0),
          taxable: l.taxable as boolean | null,
          quantity: l.quantity != null ? Number(l.quantity) : 1,
          unitLabel: l.unit_label as string | null,
        }));

        if (invoiceType === 'CREDIT_NOTE') {
          await postRacCreditNoteOrVoidGl(tx, {
            tenantId,
            creditNoteOrInvoiceId: params.id,
            documentNo: String(existing.invoice_no ?? params.id),
            entryDate: (existing.invoice_date as string | Date | null) ?? now,
            currency: String(existing.currency ?? 'AED'),
            subtotalMagnitude: Math.abs(subtotal),
            taxMagnitude: Math.abs(taxAmount),
            totalMagnitude: Math.abs(totalAmount),
            lines: glLines,
            preparedBy: actor,
          });
        } else {
          await postRacInvoiceIssuedGl(tx, {
            tenantId,
            invoiceId: params.id,
            invoiceNo: String(existing.invoice_no ?? params.id),
            invoiceDate: (existing.invoice_date as string | Date | null) ?? now,
            status: nextStatus,
            currency: String(existing.currency ?? 'AED'),
            subtotal,
            discountAmount,
            taxAmount,
            totalAmount,
            lines: glLines,
            preparedBy: actor,
          });
        }
      }

      const updatedRows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT *
           FROM rental_invoices
          WHERE id = $1 AND tenant_id::text = $2 AND deleted_at IS NULL`,
        params.id,
        tenantId,
      );

      return {
        ok: true,
        payload: { ...updatedRows[0], lineItems: currentLineItems },
      };
    });

    if (!outcome.ok) {
      return outcome.response;
    }

    await mirrorRentalInvoiceToFinance(params.id, tenantId, actor).catch((err) =>
      console.warn('[rental/invoices PATCH] mirror failed:', err),
    );

    return NextResponse.json(outcome.payload);
  } catch (e) {
    console.error('Invoice PATCH error:', e);
    return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 });
  }
}

// ── DELETE /api/rental/invoices/:id  (soft delete) ───────────────────────────
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'delete',
    'invoices',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  try {
    type DeleteOutcome = { ok: true } | { ok: false; response: NextResponse };

    const outcome = await withTenantRls<DeleteOutcome>(prisma, tenantId, async (tx) => {
      const rows = await tx.$queryRawUnsafe<
        Array<{ status: string | null; paid_amount: string | number | null }>
      >(
        `SELECT status, paid_amount
           FROM rental_invoices
          WHERE id = $1
            AND tenant_id::text = $2
            AND deleted_at IS NULL`,
        params.id,
        tenantId,
      );
      if (!rows.length) {
        return {
          ok: false,
          response: NextResponse.json({ error: 'Not found' }, { status: 404 }),
        };
      }

      const currentStatus = String(rows[0].status ?? 'DRAFT').toUpperCase();
      const paidAmt = Number(rows[0].paid_amount ?? 0);
      if (
        ['PAID', 'PARTIAL', 'PARTIALLY_PAID', 'CREDITED'].includes(currentStatus) ||
        paidAmt > 0
      ) {
        return {
          ok: false,
          response: NextResponse.json(
            {
              error:
                'Paid or partially paid invoices cannot be deleted. Issue a credit note or void instead.',
            },
            { status: 409 },
          ),
        };
      }

      if (!['DRAFT', 'VOID'].includes(currentStatus)) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: 'Only DRAFT or VOID invoices can be deleted. Void the invoice first.' },
            { status: 409 },
          ),
        };
      }

      const now = new Date().toISOString();
      await tx.$executeRawUnsafe(
        `UPDATE rental_invoices
            SET deleted_at = $1::timestamptz,
                updated_at = $1::timestamptz
          WHERE id = $2
            AND tenant_id::text = $3
            AND deleted_at IS NULL`,
        now,
        params.id,
        tenantId,
      );

      await withSavepoint(
        tx,
        'del_inv_finance_mirror',
        () =>
          tx.$executeRawUnsafe(
            `UPDATE finance_invoices
                SET payment_status = 'CANCELLED',
                    deleted_at = $3::timestamptz,
                    updated_at = $3::timestamptz
              WHERE reference_type = 'RENTAL_INVOICE'
                AND reference_id::text = $1
                AND tenant_id::text = $2`,
            params.id,
            tenantId,
            now,
          ),
        0,
      );

      return { ok: true };
    });

    if (!outcome.ok) {
      return outcome.response;
    }

    await mirrorRentalInvoiceToFinance(params.id, tenantId, 'rental-api').catch((err) =>
      console.warn('[rental/invoices DELETE] mirror failed:', err),
    );

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Invoice DELETE error:', e);
    return NextResponse.json({ error: 'Failed to delete invoice' }, { status: 500 });
  }
}
