/**
 * /api/bus-ops/route-passengers/[id] — single-roster-row ops.
 *
 * DELETE is soft (sets deletedAt) so a de-registered passenger's history
 * remains resolvable for reports and past-trip attendance.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const VALID_STATUSES = new Set(['ACTIVE', 'INACTIVE']);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseDateUtcMidnight(iso: string | Date | null | undefined): Date | null {
  if (!iso) return null;
  const s = typeof iso === 'string' ? iso : iso.toISOString();
  const [y, m, d] = s.slice(0, 10).split('-').map(n => parseInt(n, 10));
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

async function loadOwned(id: string, tenantId: string) {
  return prisma.routePassenger.findFirst({ where: { id, tenantId, deletedAt: null } });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { id } = await ctx.params;
  const row = await loadOwned(id, tenantId);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { id } = await ctx.params;
  const existing = await loadOwned(id, tenantId);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    const body = await req.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: any = {};
    if (body.routeId)       patch.routeId       = body.routeId;
    if (body.staffMemberId) patch.staffMemberId = body.staffMemberId;
    if ('pickupStopId'  in body) patch.pickupStopId  = body.pickupStopId  || null;
    if ('dropoffStopId' in body) patch.dropoffStopId = body.dropoffStopId || null;
    if ('pickupTime' in body) {
      if (body.pickupTime && !TIME_RE.test(body.pickupTime)) return NextResponse.json({ error: 'pickupTime must be HH:MM' }, { status: 400 });
      patch.pickupTime = body.pickupTime || null;
    }
    if ('dropoffTime' in body) {
      if (body.dropoffTime && !TIME_RE.test(body.dropoffTime)) return NextResponse.json({ error: 'dropoffTime must be HH:MM' }, { status: 400 });
      patch.dropoffTime = body.dropoffTime || null;
    }
    // UTC-midnight normalisation — see audit risk #17 note in route.ts
    if ('effectiveFrom' in body && body.effectiveFrom) patch.effectiveFrom = parseDateUtcMidnight(body.effectiveFrom);
    if ('effectiveTo'   in body) patch.effectiveTo = parseDateUtcMidnight(body.effectiveTo);
    if (typeof body.status === 'string') {
      if (!VALID_STATUSES.has(body.status)) return NextResponse.json({ error: 'invalid status' }, { status: 400 });
      patch.status = body.status;
    }
    if ('notes' in body) patch.notes = body.notes?.trim() || null;

    const nextFrom = patch.effectiveFrom ?? existing.effectiveFrom;
    const nextTo   = ('effectiveTo' in patch) ? patch.effectiveTo : existing.effectiveTo;
    if (nextTo && nextTo < nextFrom) {
      return NextResponse.json({ error: 'effectiveTo must be on or after effectiveFrom' }, { status: 400 });
    }

    const row = await prisma.routePassenger.update({ where: { id }, data: patch });
    return NextResponse.json(row);
  } catch (e) {
    console.error('[route-passengers.PATCH]', e);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { id } = await ctx.params;
  const existing = await loadOwned(id, tenantId);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    await prisma.routePassenger.update({ where: { id }, data: { deletedAt: new Date() } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[route-passengers.DELETE]', e);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
