export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { mirrorRentalInvoiceToFinance } from '@/lib/finance/module-ledger';
import {
  postRacCreditNoteOrVoidGl,
  postRacInvoiceIssuedGl,
} from '@/lib/finance/rac-gl-posting';
import { nextRentalSerial } from '@/lib/rental/locks';
import { requireRentalPermission } from '@/lib/rental/rbac';
import {
  assertRentalForeignKeysInTenant,
  escapeIlikePattern,
  isRentalSecurityError,
} from '@/lib/rental/security-guards';

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

function normalizeInvoiceRow(r: Record<string, unknown>) {
  const invoiceType = String(r.invoice_type ?? 'STANDARD');
  const totalAmount = Number(r.total_amount ?? 0);
  const paidAmount = Number(r.paid_amount ?? 0);
  const balanceDue =
    invoiceType === 'CREDIT_NOTE'
      ? 0
      : r.balance_due != null
        ? Number(r.balance_due)
        : Number(Math.max(0, totalAmount - paidAmount).toFixed(2));
  const subtotal = Number(r.subtotal ?? 0);
  const discountAmount = Number(r.discount_amount ?? 0);
  const taxableAmount = Number(r.taxable_amount ?? 0);
  const taxRate = Number(r.tax_rate ?? 5);
  const taxAmount = Number(r.tax_amount ?? 0);
  const companyName = (r.company_name as string | null) ?? null;
  const fullName =
    (r.customer_full_name as string | null) ?? (r.customer_name as string | null) ?? null;
  const customerName = companyName
    ? fullName
      ? `${companyName} (${fullName})`
      : companyName
    : fullName;
  const invoiceDateIso = r.invoice_date ? new Date(String(r.invoice_date)).toISOString() : null;
  const dueDateIso = r.due_date ? new Date(String(r.due_date)).toISOString() : null;
  const createdAtIso = r.created_at ? new Date(String(r.created_at)).toISOString() : null;
  const paidAtIso = r.paid_at ? new Date(String(r.paid_at)).toISOString() : null;

  return {
    // Preserve all snake_case keys
    ...r,
    balance_due: balanceDue,
    customer_name: customerName,
    // Standardized camelCase keys
    id: String(r.id),
    invoiceNo: String(r.invoice_no ?? ''),
    invoiceNumber: String(r.invoice_no ?? ''),
    agreementId: String(r.agreement_id ?? ''),
    agreementNo: (r.agreement_no as string | null) ?? null,
    customerId: String(r.customer_id ?? ''),
    customerName,
    companyName,
    invoiceType,
    parentInvoiceId: (r.parent_invoice_id as string | null) ?? null,
    currency: String(r.currency ?? 'AED'),
    subtotal,
    discountAmount,
    taxableAmount,
    taxRate,
    taxAmount,
    totalAmount,
    paidAmount,
    balanceDue,
    status: String(r.status ?? 'DRAFT'),
    dueDate: dueDateIso,
    invoiceDate: invoiceDateIso,
    issuedAt: invoiceDateIso ?? createdAtIso,
    createdAt: createdAtIso,
    paidAt: paidAtIso,
    notes: (r.notes as string | null) ?? null,
  };
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const sp = req.nextUrl.searchParams;
      const status = sp.get('status')?.trim() ?? '';
      const customerId = sp.get('customerId')?.trim() ?? '';
      const agreementId = sp.get('agreementId')?.trim() ?? '';
      const invoiceType = sp.get('invoiceType')?.trim() ?? '';
      const corporateAcctId = sp.get('corporateAccountId')?.trim() ?? '';
      const search = sp.get('search')?.trim() ?? '';
      const overdueOnly = sp.get('overdue') === 'true';
      const { take, skip, page, limit } = paginate(sp);

      const clauses: string[] = ['ri.deleted_at IS NULL', 'ri.tenant_id::text = $1'];
      const params: unknown[] = [tenantId];
      let idx = 2;

      if (status && status !== 'ALL') {
        clauses.push(`ri.status = $${idx++}`);
        params.push(status);
      }
      if (customerId) {
        clauses.push(`ri.customer_id = $${idx++}`);
        params.push(customerId);
      }
      if (agreementId) {
        clauses.push(`ri.agreement_id = $${idx++}`);
        params.push(agreementId);
      }
      if (invoiceType && invoiceType !== 'ALL') {
        clauses.push(`ri.invoice_type = $${idx++}`);
        params.push(invoiceType);
      }
      if (corporateAcctId) {
        clauses.push(`ri.corporate_account_id = $${idx++}`);
        params.push(corporateAcctId);
      }
      if (overdueOnly) {
        clauses.push("ri.due_date < NOW() AND ri.status NOT IN ('PAID', 'VOID', 'CREDITED') AND ri.invoice_type <> 'CREDIT_NOTE'");
      }
      if (search) {
        clauses.push(
          `(ri.invoice_no ILIKE $${idx} ESCAPE '\\' OR COALESCE(ra.agreement_no, '') ILIKE $${idx} ESCAPE '\\' OR COALESCE(rc.full_name, '') ILIKE $${idx} ESCAPE '\\' OR COALESCE(rc.company_name, '') ILIKE $${idx} ESCAPE '\\')`,
        );
        params.push(`%${escapeIlikePattern(search)}%`);
        idx++;
      }

      const whereSql = `WHERE ${clauses.join(' AND ')}`;

      // Execute sequentially on the single RLS transaction connection (never Promise.all on tx)
      const rawRows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT
           ri.*,
           ra.agreement_no,
           rc.full_name AS customer_full_name,
           rc.company_name,
           COALESCE(ri.balance_due, GREATEST(0, ri.total_amount - COALESCE(ri.paid_amount, 0)), 0) AS balance_due
         FROM rental_invoices ri
         LEFT JOIN rental_agreements ra
           ON ra.id = ri.agreement_id
          AND ra.tenant_id::text = ri.tenant_id::text
         LEFT JOIN rental_customers rc
           ON rc.id = ri.customer_id
          AND rc.tenant_id::text = ri.tenant_id::text
         ${whereSql}
         ORDER BY ri.invoice_date DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        ...params,
        take,
        skip,
      );

      const countRows = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) AS count
         FROM rental_invoices ri
         LEFT JOIN rental_agreements ra
           ON ra.id = ri.agreement_id
          AND ra.tenant_id::text = ri.tenant_id::text
         LEFT JOIN rental_customers rc
           ON rc.id = ri.customer_id
          AND rc.tenant_id::text = ri.tenant_id::text
         ${whereSql}`,
        ...params,
      );

      const total = Number(countRows[0]?.count ?? 0);
      const data = rawRows.map(normalizeInvoiceRow);

      return NextResponse.json(paginatedResponse(data, total, page, limit));
    } catch (e) {
      console.error('Invoice list error:', e);
      return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 });
    }
  });
}

interface ComputedLineItem {
  lineType: string;
  description: string;
  quantity: number;
  unitPrice: number;
  unitLabel: string;
  discountPct: number;
  taxable: boolean;
  amount: number;
  referenceId: string | null;
}

const ALLOWED_INITIAL_STATUSES = new Set(['DRAFT', 'SENT', 'ISSUED', 'UNPAID']);

export async function POST(req: NextRequest) {
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
    const { lineItems = [], ...invoiceData } = body;

    const invoiceType = String(invoiceData.invoiceType ?? 'STANDARD').trim().toUpperCase() || 'STANDARD';
    if (invoiceType === 'CREDIT_NOTE') {
      const denied = await requireRentalPermission(
        req.headers,
        tenantId,
        'approve',
        'invoices',
        req.nextUrl.pathname,
      );
      if (denied) return denied;
    }

    const initialStatus =
      invoiceData.status !== undefined && invoiceData.status !== null && invoiceData.status !== ''
        ? String(invoiceData.status).trim().toUpperCase()
        : 'DRAFT';
    if (!ALLOWED_INITIAL_STATUSES.has(initialStatus)) {
      return NextResponse.json(
        { error: "Invoice status on creation may only be 'DRAFT', 'SENT', 'ISSUED', or 'UNPAID'" },
        { status: 400 },
      );
    }

    const customerId =
      typeof invoiceData.customerId === 'string' && invoiceData.customerId.trim()
        ? invoiceData.customerId.trim()
        : null;
    if (!customerId) {
      return NextResponse.json({ error: 'customerId is required' }, { status: 400 });
    }

    const agreementId =
      typeof invoiceData.agreementId === 'string' && invoiceData.agreementId.trim()
        ? invoiceData.agreementId.trim()
        : null;
    const corporateAccountId =
      typeof invoiceData.corporateAccountId === 'string' && invoiceData.corporateAccountId.trim()
        ? invoiceData.corporateAccountId.trim()
        : null;
    const parentInvoiceId =
      typeof invoiceData.parentInvoiceId === 'string' && invoiceData.parentInvoiceId.trim()
        ? invoiceData.parentInvoiceId.trim()
        : null;

    const taxRate =
      invoiceData.taxRate !== undefined && invoiceData.taxRate !== null && invoiceData.taxRate !== ''
        ? Number(invoiceData.taxRate)
        : 5;
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      return NextResponse.json({ error: 'taxRate must be between 0 and 100' }, { status: 400 });
    }

    const discountAmount =
      invoiceData.discountAmount !== undefined &&
      invoiceData.discountAmount !== null &&
      invoiceData.discountAmount !== ''
        ? Number(invoiceData.discountAmount)
        : 0;
    if (!Number.isFinite(discountAmount) || discountAmount < 0) {
      return NextResponse.json(
        { error: 'discountAmount must be a non-negative number' },
        { status: 400 },
      );
    }

    if (!Array.isArray(lineItems)) {
      return NextResponse.json({ error: 'lineItems must be an array' }, { status: 400 });
    }

    const computedLines: ComputedLineItem[] = [];
    for (const rawLi of lineItems as Array<Record<string, unknown>>) {
      if (!rawLi || typeof rawLi !== 'object') {
        return NextResponse.json({ error: 'Invalid line item payload' }, { status: 400 });
      }
      const lineType = String(rawLi.lineType ?? 'OTHER').trim() || 'OTHER';
      const lineTypeUpper = lineType.toUpperCase();
      const description = String(rawLi.description ?? '').trim();
      if (!description) {
        return NextResponse.json(
          { error: 'Each line item requires a description' },
          { status: 400 },
        );
      }

      const quantity = rawLi.quantity !== undefined ? Number(rawLi.quantity) : 1;
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return NextResponse.json(
          { error: 'Line item quantity must be greater than 0' },
          { status: 400 },
        );
      }

      let unitPrice = rawLi.unitPrice !== undefined ? Number(rawLi.unitPrice) : 0;
      if (!Number.isFinite(unitPrice)) {
        return NextResponse.json(
          { error: 'Line item unitPrice must be a valid number' },
          { status: 400 },
        );
      }
      if (
        unitPrice < 0 &&
        lineTypeUpper !== 'DISCOUNT' &&
        lineTypeUpper !== 'CREDIT_NOTE' &&
        invoiceType !== 'CREDIT_NOTE'
      ) {
        return NextResponse.json(
          { error: 'Negative unit prices are not permitted on non-discount line items' },
          { status: 400 },
        );
      }

      if (invoiceType === 'CREDIT_NOTE' && unitPrice > 0) {
        unitPrice = -unitPrice;
      }

      const discountPct = rawLi.discountPct !== undefined ? Number(rawLi.discountPct) : 0;
      if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) {
        return NextResponse.json(
          { error: 'Line item discountPct must be between 0 and 100' },
          { status: 400 },
        );
      }

      // Statutory traffic fine principal is Out-of-Scope (0% VAT) by default per UAE FTA VATP006/VATP040
      const defaultTaxable =
        lineTypeUpper === 'DISCOUNT' ? false : !isStatutoryFineType(lineTypeUpper);
      const taxable =
        rawLi.taxable !== undefined ? Boolean(rawLi.taxable) : defaultTaxable;
      const amount = Number((quantity * unitPrice * (1 - discountPct / 100)).toFixed(2));

      computedLines.push({
        lineType,
        description,
        quantity,
        unitPrice,
        unitLabel: String(rawLi.unitLabel ?? 'day'),
        discountPct,
        taxable,
        amount,
        referenceId:
          typeof rawLi.referenceId === 'string' && rawLi.referenceId.trim()
            ? rawLi.referenceId.trim()
            : null,
      });
    }

    let subtotal: number;
    let taxableAmount: number;
    let taxAmount: number;
    let totalAmount: number;

    if (computedLines.length > 0) {
      subtotal = Number(computedLines.reduce((sum, l) => sum + l.amount, 0).toFixed(2));
      const discountLinesAbs = Math.abs(
        computedLines
          .filter((l) => l.lineType.toUpperCase() === 'DISCOUNT')
          .reduce((sum, l) => sum + l.amount, 0),
      );
      // Avoid subtracting discount twice when caller supplied both a negative DISCOUNT line and discountAmount
      const headerDiscountToDeduct = discountLinesAbs > 0 ? 0 : discountAmount;

      if (invoiceType !== 'CREDIT_NOTE' && subtotal - headerDiscountToDeduct < 0) {
        return NextResponse.json(
          { error: 'Invoice net amount before tax cannot be negative' },
          { status: 400 },
        );
      }

      const taxableLinesSum = computedLines
        .filter((l) => l.taxable && l.lineType.toUpperCase() !== 'DISCOUNT')
        .reduce((sum, l) => sum + l.amount, 0);

      if (invoiceType === 'CREDIT_NOTE') {
        taxableAmount = Number(taxableLinesSum.toFixed(2));
        taxAmount = Number(((taxableAmount * taxRate) / 100).toFixed(2));
        totalAmount = Number((subtotal + taxAmount).toFixed(2));
      } else {
        const totalDiscountOnTaxable = discountLinesAbs > 0 ? discountLinesAbs : discountAmount;
        taxableAmount = Number(Math.max(0, taxableLinesSum - totalDiscountOnTaxable).toFixed(2));
        taxAmount = Number(((taxableAmount * taxRate) / 100).toFixed(2));
        const netAfterDiscount = Number((subtotal - headerDiscountToDeduct).toFixed(2));
        totalAmount = Number((netAfterDiscount + taxAmount).toFixed(2));
      }
    } else {
      if (invoiceData.subtotal !== undefined && invoiceData.subtotal !== null) {
        subtotal = Number(invoiceData.subtotal);
      } else if (invoiceData.totalAmount !== undefined && invoiceData.totalAmount !== null) {
        const rawTotal = Number(invoiceData.totalAmount);
        subtotal =
          taxRate > 0
            ? Number(((rawTotal + discountAmount) / (1 + taxRate / 100)).toFixed(2))
            : rawTotal;
      } else {
        subtotal = 0;
      }

      if (!Number.isFinite(subtotal)) {
        return NextResponse.json({ error: 'subtotal must be a valid number' }, { status: 400 });
      }
      if (invoiceType !== 'CREDIT_NOTE' && (subtotal < 0 || subtotal - discountAmount < 0)) {
        return NextResponse.json(
          { error: 'Invoice subtotal cannot be negative on a non-credit-note invoice' },
          { status: 400 },
        );
      }

      if (invoiceType === 'CREDIT_NOTE') {
        const signedSub = subtotal > 0 ? -subtotal : subtotal;
        subtotal = round2(signedSub);
        taxableAmount = subtotal;
        taxAmount = Number(((taxableAmount * taxRate) / 100).toFixed(2));
        totalAmount = Number((subtotal + taxAmount).toFixed(2));
      } else {
        const netAfterDiscount = Number((subtotal - discountAmount).toFixed(2));
        taxableAmount = netAfterDiscount;
        taxAmount = Number(((taxableAmount * taxRate) / 100).toFixed(2));
        totalAmount = Number((netAfterDiscount + taxAmount).toFixed(2));
      }
    }

    const balanceDue = invoiceType === 'CREDIT_NOTE' ? 0 : totalAmount;
    const actor = (req.headers.get('x-user-id') ?? '').trim() || 'rental-api';

    const committed = await withTenantRls(prisma, tenantId, async (tx) => {
      await assertRentalForeignKeysInTenant(tx, tenantId, {
        agreementId,
        customerId,
        corporateAccountId,
      });

      const isCreditNote = invoiceType === 'CREDIT_NOTE';
      let invoiceNo =
        typeof invoiceData.invoiceNo === 'string' && invoiceData.invoiceNo.trim()
          ? invoiceData.invoiceNo.trim()
          : '';
      if (!invoiceNo) {
        invoiceNo = await nextRentalSerial(tx, {
          tenantId,
          series: isCreditNote ? 'RCN' : 'RINV',
          prefix: isCreditNote ? 'RCN-' : 'RINV-',
          table: 'rental_invoices',
          column: 'invoice_no',
        });
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      await tx.$executeRawUnsafe(
        'INSERT INTO rental_invoices (id,tenant_id,created_at,updated_at,invoice_no,agreement_id,customer_id,' +
          'invoice_type,invoice_date,due_date,period_from,period_to,currency,subtotal,discount_amount,' +
          'taxable_amount,tax_rate,tax_amount,total_amount,paid_amount,balance_due,status,is_corporate,' +
          'corporate_account_id,billing_mode,payment_terms_days,notes,internal_notes,parent_invoice_id) ' +
          'VALUES ($1,$2,$3::timestamptz,$4::timestamptz,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz,$11::timestamptz,$12::timestamptz,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)',
        id,
        tenantId,
        now,
        now,
        invoiceNo,
        agreementId,
        customerId,
        invoiceType,
        invoiceData.invoiceDate ?? now,
        invoiceData.dueDate ?? now,
        invoiceData.periodFrom ?? null,
        invoiceData.periodTo ?? null,
        invoiceData.currency ?? 'AED',
        subtotal,
        discountAmount,
        taxableAmount,
        taxRate,
        taxAmount,
        totalAmount,
        0,
        balanceDue,
        initialStatus,
        Boolean(invoiceData.isCorporate ?? false),
        corporateAccountId,
        invoiceData.billingMode ?? 'SEPARATE',
        invoiceData.paymentTermsDays ?? 30,
        invoiceData.notes ?? null,
        invoiceData.internalNotes ?? null,
        parentInvoiceId,
      );

      let sortOrder = 0;
      for (const li of computedLines) {
        const liId = crypto.randomUUID();
        await tx.$executeRawUnsafe(
          'INSERT INTO rental_invoice_line_items (id,tenant_id,invoice_id,line_type,description,quantity,unit_price,unit_label,discount_pct,taxable,amount,sort_order,reference_id) ' +
            'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
          liId,
          tenantId,
          id,
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

      const invoiceRows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT ri.*, ra.agreement_no, rc.full_name AS customer_full_name, rc.company_name
           FROM rental_invoices ri
           LEFT JOIN rental_agreements ra
             ON ra.id = ri.agreement_id
            AND ra.tenant_id::text = ri.tenant_id::text
           LEFT JOIN rental_customers rc
             ON rc.id = ri.customer_id
            AND rc.tenant_id::text = ri.tenant_id::text
          WHERE ri.id = $1 AND ri.tenant_id::text = $2`,
        id,
        tenantId,
      );

      if (initialStatus !== 'DRAFT') {
        if (isCreditNote) {
          let parentInvoiceNo: string | null = null;
          if (parentInvoiceId) {
            const pRows = await tx.$queryRawUnsafe<Array<{ invoice_no: string }>>(
              'SELECT invoice_no FROM rental_invoices WHERE id = $1 AND tenant_id::text = $2 LIMIT 1',
              parentInvoiceId,
              tenantId,
            );
            parentInvoiceNo = pRows[0]?.invoice_no ?? null;
          }
          await postRacCreditNoteOrVoidGl(tx, {
            tenantId,
            creditNoteOrInvoiceId: id,
            documentNo: invoiceNo,
            parentInvoiceNo,
            entryDate: (invoiceData.invoiceDate as string | undefined) ?? now,
            currency: String(invoiceData.currency ?? 'AED'),
            subtotalMagnitude: Math.abs(subtotal),
            taxMagnitude: Math.abs(taxAmount),
            totalMagnitude: Math.abs(totalAmount),
            lines: computedLines,
            preparedBy: actor,
          });
        } else {
          await postRacInvoiceIssuedGl(tx, {
            tenantId,
            invoiceId: id,
            invoiceNo,
            agreementNo: (invoiceRows[0]?.agreement_no as string | null) ?? null,
            invoiceDate: (invoiceData.invoiceDate as string | undefined) ?? now,
            status: initialStatus,
            currency: String(invoiceData.currency ?? 'AED'),
            subtotal,
            discountAmount,
            taxAmount,
            totalAmount,
            lines: computedLines,
            preparedBy: actor,
          });
        }
      }

      return {
        id,
        payload: invoiceRows[0] ? normalizeInvoiceRow(invoiceRows[0]) : { id },
      };
    });

    await mirrorRentalInvoiceToFinance(committed.id, tenantId, actor).catch((err) =>
      console.warn('[rental/invoices] mirror failed:', err),
    );

    return NextResponse.json(committed.payload, { status: 201 });
  } catch (e) {
    if (isRentalSecurityError(e)) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    console.error('Invoice create error:', e);
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
  }
}
