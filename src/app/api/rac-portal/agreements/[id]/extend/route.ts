export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  createUnifiedExtension,
  ExtensionConflictError,
} from '@/lib/rental/extension-service';
import {
  assertCustomerEligibleForRental,
  isRentalSecurityError,
} from '@/lib/rental/security-guards';
import {
  BOOKING_RAC_PORTAL_ROLES,
  requireRacPortalRole,
} from '../../../_helpers';

const ExtendAgreementSchema = z.object({
  newEndDate: z.string().min(1, 'New end date is required'),
  reason: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await requireRacPortalRole(
    req,
    BOOKING_RAC_PORTAL_ROLES,
    'Corporate Booker (RAC_B2B_BOOKER) or B2B Admin (RAC_B2B_ADMIN) role is required to request rental extensions.',
  );
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { id } = await context.params;
    const rawBody = await req.json().catch(() => null);
    const sanitizedBody =
      rawBody && typeof rawBody === 'object'
        ? stripTenantOwnershipFields(rawBody as Record<string, unknown>)
        : rawBody;
    const parsed = ExtendAgreementSchema.safeParse(sanitizedBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid extension request' },
        { status: 400 },
      );
    }

    const newEndDt = new Date(parsed.data.newEndDate);
    if (isNaN(newEndDt.getTime())) {
      return NextResponse.json({ error: 'Invalid newEndDate format' }, { status: 400 });
    }

    const extension = await withTenantRls(prisma, ctx.tenantId, async (tx) => {
      // Strictly verify the agreement belongs to this corporate customer & tenant before extending
      const agRows = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          customer_id: string;
          status: string | null;
          end_date: string | Date;
          daily_rate: string | number | null;
        }>
      >(
        `SELECT id, customer_id, status, end_date, daily_rate
           FROM rental_agreements
          WHERE id = $1 AND tenant_id::text = $2 AND customer_id = $3 AND deleted_at IS NULL
          LIMIT 1`,
        id,
        ctx.tenantId,
        ctx.customerId,
      );
      const agr = agRows[0];
      if (!agr) {
        throw new ExtensionConflictError('Rental agreement not found', 404);
      }

      const currentEndDt = new Date(agr.end_date);
      const extraDays = Math.max(
        1,
        Math.ceil((newEndDt.getTime() - currentEndDt.getTime()) / 86_400_000),
      );
      const estAdditionalExposure = Number(
        (extraDays * Math.max(0, Number(agr.daily_rate ?? 0)) * 1.05).toFixed(2),
      );

      // Enforce blacklist, driving license validity through newEndDate, and corporate credit limit
      await assertCustomerEligibleForRental(tx, {
        tenantId: ctx.tenantId,
        customerId: ctx.customerId,
        dropoffDate: newEndDt,
        additionalExposureAed: estAdditionalExposure,
      });

      const actorLabel = `${ctx.user.fullName ?? ctx.user.email} <${ctx.user.email}>`;
      const reason = parsed.data.reason?.trim() || 'B2B Portal Extension Request';
      const notes = parsed.data.notes?.trim()
        ? `${parsed.data.notes.trim()} (Requested via B2B Portal by ${actorLabel})`
        : `${reason} (Requested via B2B Portal by ${actorLabel})`;

      return createUnifiedExtension(tx, {
        tenantId: ctx.tenantId,
        agreementId: id,
        newEndDate: newEndDt,
        reason,
        notes,
        autoApprove: false,
      });
    });

    return NextResponse.json({ ok: true, extension }, { status: 201 });
  } catch (err) {
    if (isRentalSecurityError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    if (err instanceof ExtensionConflictError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error('[rac-portal/agreements/[id]/extend] POST failed:', err);
    return NextResponse.json(
      { error: 'Failed to submit extension request' },
      { status: 500 },
    );
  }
}
