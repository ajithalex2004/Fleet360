export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import {
  listPreAuthsForCustomer,
  toPublicRacPreAuth,
} from '@/lib/rac-portal/preauth-store';
import { ALL_RAC_PORTAL_ROLES, requireRacPortalRole } from '../_helpers';

interface InvoiceRow {
  id: string;
  invoice_no: string;
  agreement_id: string;
  customer_id: string;
  invoice_type: string | null;
  invoice_date: string | Date;
  due_date: string | Date;
  currency: string | null;
  subtotal: string | number;
  discount_amount: string | number | null;
  tax_rate: string | number | null;
  tax_amount: string | number | null;
  total_amount: string | number;
  paid_amount: string | number | null;
  balance_due: string | number | null;
  status: string | null;
  paid_at: string | Date | null;
  notes: string | null;
  created_at: string | Date;
  agreement_no: string | null;
}

export async function GET(req: NextRequest) {
  const ctx = await requireRacPortalRole(req, ALL_RAC_PORTAL_ROLES);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const invoices = await withTenantRls(prisma, ctx.tenantId, async (tx) => {
      const rows = await tx.$queryRawUnsafe<InvoiceRow[]>(
        `SELECT
           ri.id,
           ri.invoice_no,
           ri.agreement_id,
           ri.customer_id,
           ri.invoice_type,
           ri.invoice_date,
           ri.due_date,
           ri.currency,
           ri.subtotal,
           ri.discount_amount,
           ri.tax_rate,
           ri.tax_amount,
           ri.total_amount,
           ri.paid_amount,
           ri.balance_due,
           ri.status,
           ri.paid_at,
           ri.notes,
           ri.created_at,
           ra.agreement_no
         FROM rental_invoices ri
         LEFT JOIN rental_agreements ra
           ON ra.id = ri.agreement_id AND ra.tenant_id::text = ri.tenant_id::text
         WHERE ri.tenant_id::text = $1
           AND ri.customer_id = $2
           AND ri.deleted_at IS NULL
           AND UPPER(COALESCE(ri.status, '')) <> 'DRAFT'
         ORDER BY ri.invoice_date DESC, ri.created_at DESC`,
        ctx.tenantId,
        ctx.customerId,
      );

      return rows.map((r) => {
        const total = Number(r.total_amount ?? 0);
        const paid = Number(r.paid_amount ?? 0);
        const balance =
          r.balance_due != null
            ? Math.max(0, Number(r.balance_due))
            : Math.max(0, Number((total - paid).toFixed(2)));
        return {
          id: r.id,
          invoiceNo: r.invoice_no,
          agreementId: r.agreement_id,
          agreementNo: r.agreement_no ?? null,
          invoiceType: r.invoice_type ?? 'STANDARD',
          invoiceDate: new Date(r.invoice_date).toISOString(),
          dueDate: new Date(r.due_date).toISOString(),
          currency: r.currency ?? 'AED',
          subtotal: Number(r.subtotal ?? 0),
          discountAmount: Number(r.discount_amount ?? 0),
          taxRate: Number(r.tax_rate ?? 5),
          taxAmount: Number(r.tax_amount ?? 0),
          totalAmount: total,
          paidAmount: paid,
          balanceDue: balance,
          status: r.status ?? 'SENT',
          paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
          notes: r.notes ?? null,
          createdAt: new Date(r.created_at).toISOString(),
        };
      });
    });

    const preauths = (await listPreAuthsForCustomer(ctx.tenantId, ctx.customerId)).map(
      toPublicRacPreAuth,
    );

    return NextResponse.json({ invoices, preauths });
  } catch (err) {
    console.error('[rac-portal/invoices] GET failed:', err);
    return NextResponse.json(
      { error: 'Failed to load corporate invoices and card holds' },
      { status: 500 },
    );
  }
}
