export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls, runSequential } from '@/lib/rls';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { cacheRead, privateCacheControl, revalidateCache } from '@/lib/server-cache';
import { hasRentalPermission, requireRentalPermission } from '@/lib/rental/rbac';
import {
  assertRentalForeignKeysInTenant,
  isRentalSecurityError,
  validateSafeDocumentOrSignatureUrl,
} from '@/lib/rental/security-guards';

const CACHE_TAG = 'rental:damage-claims';

const getClaims = cacheRead(
  async (
    tenantId: string,
    status: string | null,
    bookingId: string | null,
    take: number,
    skip: number,
    page: number,
    limit: number,
  ) => {
    const where = {
      tenantId,
      ...(status ? { status } : {}),
      ...(bookingId ? { bookingId } : {}),
    };
    const [data, total] = await withTenantRls(prisma, tenantId, (tx) =>
      runSequential([
        tx.damageClaim.findMany({
          where,
          include: {
            booking: {
              select: { bookingRef: true, customer: { select: { fullName: true } } },
            },
          },
          orderBy: { createdAt: 'desc' },
          take,
          skip,
        }),
        tx.damageClaim.count({ where }),
      ]),
    );
    return paginatedResponse(data, total, page, limit);
  },
  [CACHE_TAG],
  30,
);

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'view',
    'damage_claims',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  try {
    const sp = req.nextUrl.searchParams;
    const status = sp.get('status');
    const bookingId = sp.get('bookingId');
    const { take, skip, page, limit } = paginate(sp);
    const data = await getClaims(tenantId, status, bookingId, take, skip, page, limit);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': privateCacheControl(30, 120) },
    });
  } catch (e) {
    console.error('Error fetching damage claims:', e);
    return NextResponse.json({ error: 'Failed to fetch damage claims' }, { status: 500 });
  }
}

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
    'damage',
    req.nextUrl.pathname,
  );
  if (createDenied) return createDenied;

  try {
    const bodyRaw = await req.json();
    const cleaned = stripTenantOwnershipFields(
      (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
    );

    const bookingId =
      typeof cleaned.bookingId === 'string'
        ? cleaned.bookingId.trim()
        : typeof cleaned.booking_id === 'string'
          ? cleaned.booking_id.trim()
          : '';
    if (!bookingId) {
      return NextResponse.json({ error: 'bookingId is required' }, { status: 400 });
    }

    const vehicleId =
      typeof cleaned.vehicleId === 'string' && cleaned.vehicleId.trim()
        ? cleaned.vehicleId.trim()
        : typeof cleaned.vehicle_id === 'string' && cleaned.vehicle_id.trim()
          ? cleaned.vehicle_id.trim()
          : null;

    const requestedStatusUpper =
      cleaned.status !== undefined && cleaned.status !== null && String(cleaned.status).trim()
        ? String(cleaned.status).trim().toUpperCase()
        : 'OPEN';

    const rawActualCost =
      cleaned.actualCost !== undefined ? cleaned.actualCost : cleaned.actual_cost;
    const hasActualCost =
      rawActualCost !== undefined && rawActualCost !== null && rawActualCost !== '';

    // Setting non-OPEN initial status or actualCost on creation requires `rental:approve:damage`
    if (requestedStatusUpper !== 'OPEN' || hasActualCost) {
      const approveDenied = await requireRentalPermission(
        req.headers,
        tenantId,
        'approve',
        'damage',
        req.nextUrl.pathname,
      );
      if (approveDenied) return approveDenied;
    }

    if (!['OPEN', 'ASSESSED'].includes(requestedStatusUpper)) {
      return NextResponse.json(
        { error: 'New damage claims must start as OPEN or ASSESSED' },
        { status: 400 },
      );
    }

    let estimatedCost: number | null | undefined = undefined;
    const rawEstimatedCost =
      cleaned.estimatedCost !== undefined ? cleaned.estimatedCost : cleaned.estimated_cost;
    if (rawEstimatedCost !== undefined && rawEstimatedCost !== null && rawEstimatedCost !== '') {
      const parsedEst = Number(rawEstimatedCost);
      if (!Number.isFinite(parsedEst) || parsedEst < 0) {
        return NextResponse.json(
          { error: 'estimatedCost must be zero or more' },
          { status: 400 },
        );
      }
      estimatedCost = parsedEst;
    }

    let actualCost: number | undefined = undefined;
    if (hasActualCost) {
      const parsedAct = Number(rawActualCost);
      if (!Number.isFinite(parsedAct) || parsedAct < 0) {
        return NextResponse.json({ error: 'actualCost must be zero or more' }, { status: 400 });
      }
      actualCost = parsedAct;
    }

    if (Array.isArray(cleaned.photos)) {
      for (const photo of cleaned.photos) {
        validateSafeDocumentOrSignatureUrl(photo, { fieldName: 'photos' });
      }
    }

    const canApproveDamage = await hasRentalPermission(req.headers, tenantId, 'approve', 'damage');
    const rawBilledToCustomer =
      cleaned.billedToCustomer !== undefined
        ? cleaned.billedToCustomer
        : cleaned.billed_to_customer;
    const billedToCustomer =
      canApproveDamage && typeof rawBilledToCustomer === 'boolean'
        ? rawBilledToCustomer
        : false;

    const baseDescription =
      typeof cleaned.description === 'string' ? cleaned.description.trim() : '';
    const extraMeta: string[] = [];
    if (typeof cleaned.damageLocation === 'string' && cleaned.damageLocation.trim()) {
      extraMeta.push(`Location: ${cleaned.damageLocation.trim()}`);
    }
    if (typeof cleaned.severity === 'string' && cleaned.severity.trim()) {
      extraMeta.push(`Severity: ${cleaned.severity.trim()}`);
    }
    if (typeof cleaned.insuranceRef === 'string' && cleaned.insuranceRef.trim()) {
      extraMeta.push(`Insurance Ref: ${cleaned.insuranceRef.trim()}`);
    }
    if (typeof cleaned.notes === 'string' && cleaned.notes.trim()) {
      extraMeta.push(`Notes: ${cleaned.notes.trim()}`);
    }
    const description = [baseDescription, extraMeta.join(' | ')].filter(Boolean).join('\n');
    if (!description) {
      return NextResponse.json({ error: 'description is required' }, { status: 400 });
    }

    const createData: Prisma.DamageClaimUncheckedCreateInput = {
      tenantId,
      bookingId,
      description,
      status: requestedStatusUpper,
      billedToCustomer,
      ...(estimatedCost !== undefined ? { estimatedCost } : {}),
      ...(actualCost !== undefined ? { actualCost } : {}),
      ...(typeof cleaned.insuranceClaim === 'boolean'
        ? { insuranceClaim: cleaned.insuranceClaim }
        : {}),
    };

    const damageClaim = await withTenantRls(prisma, tenantId, async (tx) => {
      await assertRentalForeignKeysInTenant(tx, tenantId, {
        bookingId,
        vehicleId,
      });
      return tx.damageClaim.create({ data: createData });
    });

    revalidateCache([CACHE_TAG]);
    return NextResponse.json(damageClaim, { status: 201 });
  } catch (e) {
    if (isRentalSecurityError(e)) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    console.error('Error creating damage claim:', e);
    return NextResponse.json({ error: 'Failed to create damage claim' }, { status: 500 });
  }
}
