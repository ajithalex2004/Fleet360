export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { ALL_RAC_PORTAL_ROLES, requireRacPortalRole } from '../_helpers';

interface CustomerRow {
  id: string;
  full_name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  customer_type: string | null;
  trade_license: string | null;
  vat_number: string | null;
  payment_terms_days: number | null;
  blacklisted: boolean | null;
  credit_limit: string | number | null;
}

export async function GET(req: NextRequest) {
  const ctx = await requireRacPortalRole(req, ALL_RAC_PORTAL_ROLES);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const payload = await withTenantRls(prisma, ctx.tenantId, async (tx) => {
      const custRows = await tx.$queryRawUnsafe<CustomerRow[]>(
        `SELECT id, full_name, company_name, email, phone, customer_type,
                trade_license, vat_number, payment_terms_days, blacklisted, credit_limit
           FROM rental_customers
          WHERE id = $1 AND tenant_id::text = $2 AND deleted_at IS NULL
          LIMIT 1`,
        ctx.customerId,
        ctx.tenantId,
      );
      const customer = custRows[0];
      if (!customer) return null;

      const tenant = await tx.tenant
        .findFirst({
          where: { id: ctx.tenantId },
          select: { id: true, name: true, code: true },
        })
        .catch(() => null);

      const invRows = await tx.$queryRawUnsafe<Array<{ outstanding: string }>>(
        `SELECT COALESCE(
                  SUM(
                    GREATEST(
                      0,
                      COALESCE(balance_due, total_amount - COALESCE(paid_amount, 0))
                    )
                  ),
                  0
                )::text AS outstanding
           FROM rental_invoices
          WHERE tenant_id::text = $1
            AND customer_id = $2
            AND deleted_at IS NULL
            AND COALESCE(status, '') NOT IN ('VOID', 'CANCELLED', 'PAID')`,
        ctx.tenantId,
        ctx.customerId,
      );

      const bkRows = await tx.$queryRawUnsafe<Array<{ cnt: string }>>(
        `SELECT COUNT(*)::text AS cnt
           FROM rental_bookings
          WHERE tenant_id::text = $1
            AND customer_id = $2
            AND deleted_at IS NULL
            AND status IN ('PENDING', 'CONFIRMED', 'ACTIVE')`,
        ctx.tenantId,
        ctx.customerId,
      );

      const agRows = await tx.$queryRawUnsafe<Array<{ cnt: string }>>(
        `SELECT COUNT(*)::text AS cnt
           FROM rental_agreements
          WHERE tenant_id::text = $1
            AND customer_id = $2
            AND deleted_at IS NULL
            AND status = 'ACTIVE'`,
        ctx.tenantId,
        ctx.customerId,
      );

      const paRows = await tx.$queryRawUnsafe<
        Array<{ cnt: string; total_hold: string }>
      >(
        `SELECT COUNT(*)::text AS cnt,
                COALESCE(SUM(amount), 0)::text AS total_hold
           FROM rac_card_preauths
          WHERE tenant_id = $1
            AND customer_id = $2
            AND status = 'AUTHORIZED'`,
        ctx.tenantId,
        ctx.customerId,
      );

      const creditLimit = Number(customer.credit_limit ?? 0);
      const outstandingBalance = Number(Number(invRows[0]?.outstanding ?? 0).toFixed(2));
      const availableCredit =
        creditLimit > 0 ? Math.max(0, Number((creditLimit - outstandingBalance).toFixed(2))) : 0;

      const activeBookingsCount = parseInt(bkRows[0]?.cnt ?? '0', 10);
      const activeAgreementsCount = parseInt(agRows[0]?.cnt ?? '0', 10);
      const activePreAuthCount = parseInt(paRows[0]?.cnt ?? '0', 10);
      const activePreAuthTotal = Number(Number(paRows[0]?.total_hold ?? 0).toFixed(2));

      const slug =
        tenant?.code?.toLowerCase() ??
        tenant?.name?.toLowerCase().replace(/\s+/g, '-') ??
        ctx.tenantId;

      return {
        user: ctx.user,
        customer: {
          id: customer.id,
          fullName: customer.full_name,
          companyName: customer.company_name ?? customer.full_name,
          email: customer.email,
          phone: customer.phone,
          customerType: customer.customer_type ?? 'CORPORATE',
          corporateCode: customer.trade_license ?? customer.vat_number ?? null,
          tradeLicense: customer.trade_license ?? null,
          vatNumber: customer.vat_number ?? null,
          paymentTermsDays: Number(customer.payment_terms_days ?? 30),
          blacklisted: Boolean(customer.blacklisted),
          creditLimit,
          outstandingBalance,
          availableCredit,
        },
        tenant: {
          id: tenant?.id ?? ctx.tenantId,
          name: tenant?.name ?? 'Fleet360 Mobility',
          slug,
        },
        stats: {
          activeBookingsCount,
          activeAgreementsCount,
          activePreAuthCount,
          activePreAuthTotal,
        },
      };
    });

    if (!payload) {
      return NextResponse.json(
        { error: 'Corporate customer account not found' },
        { status: 404 },
      );
    }

    return NextResponse.json(payload);
  } catch (err) {
    console.error('[rac-portal/me] GET failed:', err);
    return NextResponse.json(
      { error: 'Failed to load corporate portal profile' },
      { status: 500 },
    );
  }
}
