/**
 * /api/bus-ops/route-passengers — standing-roster CRUD.
 *
 * A passenger registers against a Route (not a Trip). Trip attendance is
 * derived downstream by expanding this roster into TripPassenger rows when
 * a trip is scheduled — that expansion is phase 2.
 *
 * GET  — list, filter by routeId / staffMemberId / status, tenant-scoped
 * POST — create; tenantId always stamped from x-tenant-id
 *
 * Uniqueness: enforced at the app layer (no active overlap for the same
 * route+employee) — DB-level constraint would need a partial-index PostgreSQL
 * expression that's fine to add once the pattern settles.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
const VALID_STATUSES = new Set(['ACTIVE', 'INACTIVE']);

/**
 * Parse a YYYY-MM-DD string into a UTC-midnight Date so effective-window
 * comparisons don't shift by ±1 day when the operator's browser sits in a
 * non-UTC timezone (audit risk #17). Accepts either 'YYYY-MM-DD' or an
 * ISO with time portion; the time portion is discarded.
 */
function parseDateUtcMidnight(iso: string | Date | null | undefined): Date | null {
  if (!iso) return null;
  const s = typeof iso === 'string' ? iso : iso.toISOString();
  const [y, m, d] = s.slice(0, 10).split('-').map(n => parseInt(n, 10));
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function pickupDropoffValid(body: { pickupTime?: string; dropoffTime?: string }): string | null {
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (body.pickupTime  && !timeRe.test(body.pickupTime))  return 'pickupTime must be HH:MM (24h)';
  if (body.dropoffTime && !timeRe.test(body.dropoffTime)) return 'dropoffTime must be HH:MM (24h)';
  return null;
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const routeId       = sp.get('routeId');
  const staffMemberId = sp.get('staffMemberId');
  const status        = sp.get('status');

  try {
    const rows = await prisma.routePassenger.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(routeId       ? { routeId }       : {}),
        ...(staffMemberId ? { staffMemberId } : {}),
        ...(status && VALID_STATUSES.has(status) ? { status } : {}),
      },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    return NextResponse.json(rows, { headers: { 'Cache-Control': 'private, max-age=15' } });
  } catch (e) {
    console.error('[route-passengers.GET]', e);
    return NextResponse.json({ error: 'Failed to fetch route passengers' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });
  const createdBy = req.headers.get('x-user-id') ?? null;

  try {
    const body = await req.json();
    if (!body.routeId)        return NextResponse.json({ error: 'routeId is required' }, { status: 400 });
    if (!body.staffMemberId)  return NextResponse.json({ error: 'staffMemberId is required' }, { status: 400 });
    if (body.status && !VALID_STATUSES.has(body.status)) {
      return NextResponse.json({ error: 'status must be ACTIVE or INACTIVE' }, { status: 400 });
    }
    const timeErr = pickupDropoffValid(body);
    if (timeErr) return NextResponse.json({ error: timeErr }, { status: 400 });

    const effectiveFrom = parseDateUtcMidnight(body.effectiveFrom) ?? parseDateUtcMidnight(new Date().toISOString())!;
    const effectiveTo   = parseDateUtcMidnight(body.effectiveTo);
    if (effectiveTo && effectiveTo < effectiveFrom) {
      return NextResponse.json({ error: 'effectiveTo must be on or after effectiveFrom' }, { status: 400 });
    }

    // Block overlapping ACTIVE roster entries for the same (route, employee).
    // Overlap check: another active row exists whose window intersects ours.
    const active = body.status ?? 'ACTIVE';
    if (active === 'ACTIVE') {
      const overlaps = await prisma.routePassenger.findMany({
        where: {
          tenantId, deletedAt: null,
          routeId: body.routeId, staffMemberId: body.staffMemberId,
          status: 'ACTIVE',
          effectiveFrom: { lte: effectiveTo ?? new Date('9999-12-31') },
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gte: effectiveFrom } },
          ],
        },
        select: { id: true, effectiveFrom: true, effectiveTo: true },
      });
      if (overlaps.length > 0) {
        return NextResponse.json({
          error: 'This employee already has an active roster assignment on this route in the given date range.',
          overlaps,
        }, { status: 409 });
      }
    }

    const row = await prisma.routePassenger.create({
      data: {
        tenantId,                       // stamped from session
        routeId:       body.routeId,
        staffMemberId: body.staffMemberId,
        pickupStopId:  body.pickupStopId  || null,
        pickupTime:    body.pickupTime    || null,
        dropoffStopId: body.dropoffStopId || null,
        dropoffTime:   body.dropoffTime   || null,
        effectiveFrom,
        effectiveTo,
        status: active,
        notes:  body.notes?.trim() || null,
        createdBy,
      },
    });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    console.error('[route-passengers.POST]', e);
    return NextResponse.json({ error: 'Failed to create route passenger' }, { status: 500 });
  }
}
