export const dynamic = 'force-dynamic';

/**
 * POST /api/rental/bookings/[id]/extend
 *
 * Unified extension entry-point for bookings: delegates to `createUnifiedExtension`
 * from `@/lib/rental/extension-service` so extending from Bookings and Renewals
 * uses the exact same conflict lock, master-tariff pricing, 5% UAE VAT, customer
 * eligibility checks, and agreement/booking lifecycle updates.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { withApprovalStart } from '@/lib/workflow/approvals';
import { hasRentalPermission, requireRentalPermission } from '@/lib/rental/rbac';
import { isRentalSecurityError } from '@/lib/rental/security-guards';
import {
  createUnifiedExtension,
  ExtensionConflictError,
} from '@/lib/rental/extension-service';

function hasValue(v: unknown): boolean {
  return v !== undefined && v !== null && v !== '';
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const createDenied = await requireRentalPermission(
    req.headers,
    tenantId,
    'create',
    'renewals',
    req.nextUrl.pathname,
  );
  if (createDenied) return createDenied;

  const bodyRaw = await req.json().catch(() => null);
  const body = stripTenantOwnershipFields(
    (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
  );

  // Enforce `rental:approve:rates` whenever ANY custom rate (`dailyRate` or `dailyRateOverride`) is supplied
  const hasExplicitRateOverride =
    hasValue(body.dailyRateOverride) ||
    hasValue(body.dailyRate) ||
    body.rateOverride === true;

  if (hasExplicitRateOverride) {
    const denied = await requireRentalPermission(
      req.headers,
      tenantId,
      'approve',
      'rates',
      req.nextUrl.pathname,
    );
    if (denied) return denied;
  }

  const rawDate = body.newDropoffDate ?? body.newEndDate;
  if (!rawDate) {
    return NextResponse.json(
      { error: 'newEndDate or newDropoffDate is required' },
      { status: 400 },
    );
  }
  const newEndDate = new Date(String(rawDate));
  if (Number.isNaN(newEndDate.getTime())) {
    return NextResponse.json({ error: 'Invalid extension end date' }, { status: 400 });
  }

  const requestedDailyRate = hasValue(body.dailyRateOverride)
    ? Number(body.dailyRateOverride)
    : hasValue(body.dailyRate)
      ? Number(body.dailyRate)
      : null;

  if (requestedDailyRate !== null && (!Number.isFinite(requestedDailyRate) || requestedDailyRate < 0)) {
    return NextResponse.json({ error: 'Invalid dailyRate override' }, { status: 400 });
  }

  const depositTopUp = hasValue(body.depositTopUp) ? Number(body.depositTopUp) : 0;
  if (!Number.isFinite(depositTopUp) || depositTopUp < 0) {
    return NextResponse.json({ error: 'Invalid depositTopUp' }, { status: 400 });
  }

  const canAutoApprove = await hasRentalPermission(
    req.headers,
    tenantId,
    'approve',
    'renewals',
  );
  const allowCreditOverride = await hasRentalPermission(
    req.headers,
    tenantId,
    'approve',
    'customers',
  );
  const autoApprove = body.autoApprove !== false && canAutoApprove;
  const actorUserId = (req.headers.get('x-user-id') ?? '').trim() || 'MANAGER';

  let pendingId: string | null = null;
  const response = await withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const extension = await createUnifiedExtension(tx, {
        tenantId,
        bookingId: params.id,
        newEndDate,
        requestedDailyRate,
        allowRateOverride: hasExplicitRateOverride,
        allowCreditOverride,
        depositTopUp,
        reason: body.reason ? String(body.reason) : null,
        notes: body.notes ? String(body.notes) : null,
        autoApprove,
        approvedBy: autoApprove ? actorUserId : null,
      });

      if (extension.status === 'PENDING') {
        pendingId = extension.id;
      }

      const booking = await tx.rentalBooking.findFirst({
        where: { id: params.id, tenantId, deletedAt: null },
      });

      return NextResponse.json({
        ok: true,
        booking,
        extension,
        extraDays: extension.extensionDays,
        extraAmount: extension.renewalAmount,
        vatAmount: extension.vatAmount,
        totalAmount: extension.totalAmount,
      });
    } catch (err) {
      if (isRentalSecurityError(err)) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      }
      if (err instanceof ExtensionConflictError) {
        return NextResponse.json({ error: err.message }, { status: err.statusCode });
      }
      console.error('Error extending booking:', err);
      return NextResponse.json({ error: 'Failed to extend booking' }, { status: 500 });
    }
  });

  return pendingId
    ? withApprovalStart(response, {
        headers: req.headers,
        tenantId,
        referenceType: 'rental_renewal',
        referenceId: pendingId,
      })
    : response;
}
