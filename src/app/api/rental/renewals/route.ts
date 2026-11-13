export const dynamic = 'force-dynamic';

/**
 * RAC Renewals & Extensions API — /api/rental/renewals (1 Unified Extension Process)
 *
 * Delegates all reads, creation, conflict locking, master-tariff pricing, 5% UAE VAT,
 * and lifecycle updates (`RentalAgreement` + `RentalBooking` + `RentalAdditionalCharge`)
 * to `@/lib/rental/extension-service`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  approvalGate,
  approvalInProgress,
  withApprovalStart,
  withdrawApproval,
} from '@/lib/workflow/approvals';
import { prisma } from '@/lib/prisma';
import { hasRentalPermission, requireRentalPermission } from '@/lib/rental/rbac';
import { isRentalSecurityError } from '@/lib/rental/security-guards';
import {
  createUnifiedExtension,
  decideUnifiedExtension,
  ExtensionConflictError,
  listUnifiedExtensions,
} from '@/lib/rental/extension-service';

function hasValue(v: unknown): boolean {
  return v !== undefined && v !== null && v !== '';
}

/* ─── GET ─── */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const permErr = await requireRentalPermission(
    req.headers,
    tenantId,
    'view',
    '*',
    req.nextUrl.pathname,
  );
  if (permErr) return permErr;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const sp = req.nextUrl.searchParams;
      const status = sp.get('status');
      const agreementId = sp.get('agreementId');
      const customerId = sp.get('customerId');
      const search = sp.get('search');
      const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10));
      const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '50', 10)));

      const result = await listUnifiedExtensions(tx, {
        tenantId,
        status,
        agreementId,
        customerId,
        search,
        page,
        limit,
      });

      const rows = result.data;
      return NextResponse.json({
        data: rows,
        renewals: rows,
        total: rows.length,
        counts: result.counts,
        kpis: result.kpis,
        page: result.page,
        limit: result.limit,
      });
    } catch (err) {
      console.error('GET /api/rental/renewals error:', err);
      return NextResponse.json({ error: 'Failed to load extensions' }, { status: 500 });
    }
  });
}

/* ─── POST ─── */
export async function POST(req: NextRequest) {
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

  const rawNewEnd = body.newEndDate ?? body.newDropoffDate;
  const newEndDate = rawNewEnd ? new Date(String(rawNewEnd)) : null;
  if (!newEndDate || Number.isNaN(newEndDate.getTime())) {
    return NextResponse.json({ error: 'Valid newEndDate is required' }, { status: 400 });
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
      const created = await createUnifiedExtension(tx, {
        tenantId,
        agreementId: body.agreementId ? String(body.agreementId) : null,
        agreementNo: body.agreementNo ? String(body.agreementNo) : null,
        bookingId: body.bookingId ? String(body.bookingId) : null,
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

      if (created.status === 'PENDING') {
        pendingId = created.id;
      }

      return NextResponse.json(created, { status: 201 });
    } catch (err) {
      if (isRentalSecurityError(err)) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      }
      if (err instanceof ExtensionConflictError) {
        return NextResponse.json({ error: err.message }, { status: err.statusCode });
      }
      console.error('POST /api/rental/renewals error:', err);
      return NextResponse.json({ error: 'Failed to create extension' }, { status: 500 });
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

/* ─── PATCH ─── */
export async function PATCH(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  // Enforce `rental:approve:renewals` before approving / rejecting / completing extensions
  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'approve',
    'renewals',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  const bodyRaw = await req.json().catch(() => null);
  const body = stripTenantOwnershipFields(
    (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
  );
  const id = body.id ? String(body.id).trim() : '';
  const status = body.status ? String(body.status).trim().toUpperCase() : '';
  const notes = typeof body.notes === 'string' ? body.notes : null;
  // Audit actor strictly derived from authenticated session header
  const approvedBy = (req.headers.get('x-user-id') ?? '').trim() || 'MANAGER';

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }
  if (!['APPROVED', 'REJECTED', 'COMPLETED'].includes(status)) {
    return NextResponse.json(
      { error: 'status must be APPROVED, REJECTED, or COMPLETED' },
      { status: 400 },
    );
  }

  if (status === 'APPROVED' || status === 'REJECTED') {
    const gated = await approvalGate({
      headers: req.headers,
      tenantId,
      referenceType: 'rental_renewal',
      referenceId: id,
      action: status === 'APPROVED' ? 'APPROVE' : 'REJECT',
      comments: notes ?? '',
    });
    if (gated) return gated;
  } else if (status === 'COMPLETED') {
    if (await approvalInProgress(tenantId, 'rental_renewal', id)) {
      return NextResponse.json(
        { error: 'Cannot complete extension while approval workflow is in progress' },
        { status: 409 },
      );
    }
  }

  const allowCreditOverride = await hasRentalPermission(
    req.headers,
    tenantId,
    'approve',
    'customers',
  );

  const response = await withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const updated = await decideUnifiedExtension(tx, {
        tenantId,
        extensionId: id,
        status: status as 'APPROVED' | 'REJECTED' | 'COMPLETED',
        approvedBy,
        notes,
        allowCreditOverride,
      });
      return NextResponse.json(updated);
    } catch (err) {
      if (isRentalSecurityError(err)) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      }
      if (err instanceof ExtensionConflictError) {
        return NextResponse.json({ error: err.message }, { status: err.statusCode });
      }
      console.error('PATCH /api/rental/renewals error:', err);
      return NextResponse.json({ error: 'Failed to update extension' }, { status: 500 });
    }
  });

  if (status === 'REJECTED' && response.ok) {
    await withdrawApproval(tenantId, 'rental_renewal', id, 'Extension rejected');
  }
  return response;
}
