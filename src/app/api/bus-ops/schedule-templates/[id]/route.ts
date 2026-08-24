/**
 * /api/bus-ops/schedule-templates/[id] — single-template ops.
 *
 * DELETE is soft (sets deletedAt). Generated TripSchedule rows remain — a
 * template softly retired shouldn't disappear the trips that ran on its
 * behalf. If you truly need to purge, follow up with per-trip deletion.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
const VALID_WEEK_TYPES = new Set(['SUN_THU', 'MON_FRI', 'SAT_WED', 'CUSTOM']);
const VALID_SESSIONS   = new Set(['MORNING', 'EVENING', 'NIGHT', 'SPLIT']);
const VALID_DIRECTIONS = new Set(['PICKUP', 'DROPOFF']);
const VALID_STATUSES   = new Set(['ACTIVE', 'INACTIVE']);
const TIME_RE          = /^([01]\d|2[0-3]):[0-5]\d$/;

async function loadOwned(id: string, tenantId: string) {
  return prisma.busOpsScheduleTemplate.findFirst({ where: { id, tenantId, deletedAt: null } });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });
  const { id } = await ctx.params;
  const row = await loadOwned(id, tenantId);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });
  const { id } = await ctx.params;
  const existing = await loadOwned(id, tenantId);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    const body = await req.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: any = {};
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
    if (body.routeId)   patch.routeId   = body.routeId;
    if ('vehicleId' in body) patch.vehicleId = body.vehicleId || null;
    if ('driverId'  in body) patch.driverId  = body.driverId  || null;
    if (body.weekType) {
      if (!VALID_WEEK_TYPES.has(body.weekType)) return NextResponse.json({ error: 'invalid weekType' }, { status: 400 });
      patch.weekType = body.weekType;
    }
    if (Array.isArray(body.activeDays)) {
      if (body.activeDays.some((d: number) => !Number.isInteger(d) || d < 0 || d > 6)) {
        return NextResponse.json({ error: 'activeDays entries must be integers 0..6' }, { status: 400 });
      }
      patch.activeDays = body.activeDays;
    }
    if (body.session) {
      if (!VALID_SESSIONS.has(body.session)) return NextResponse.json({ error: 'invalid session' }, { status: 400 });
      patch.session = body.session;
    }
    if (body.direction) {
      if (!VALID_DIRECTIONS.has(body.direction)) return NextResponse.json({ error: 'invalid direction' }, { status: 400 });
      patch.direction = body.direction;
    }
    if (body.departureTime) {
      if (!TIME_RE.test(body.departureTime)) return NextResponse.json({ error: 'departureTime must be HH:MM' }, { status: 400 });
      patch.departureTime = body.departureTime;
    }
    if ('arrivalTime' in body) {
      if (body.arrivalTime && !TIME_RE.test(body.arrivalTime)) return NextResponse.json({ error: 'arrivalTime must be HH:MM' }, { status: 400 });
      patch.arrivalTime = body.arrivalTime || null;
    }
    if ('effectiveFrom' in body && body.effectiveFrom) patch.effectiveFrom = new Date(body.effectiveFrom);
    if ('effectiveTo'   in body) patch.effectiveTo = body.effectiveTo ? new Date(body.effectiveTo) : null;
    if ('exceptionDates' in body && Array.isArray(body.exceptionDates)) {
      patch.exceptionDates = body.exceptionDates.map((d: string) => new Date(d)).filter((d: Date) => !isNaN(d.getTime()));
    }
    if (body.status) {
      if (!VALID_STATUSES.has(body.status)) return NextResponse.json({ error: 'invalid status' }, { status: 400 });
      patch.status = body.status;
    }
    if ('notes' in body) patch.notes = body.notes?.trim() || null;

    const nextFrom = patch.effectiveFrom ?? existing.effectiveFrom;
    const nextTo   = ('effectiveTo' in patch) ? patch.effectiveTo : existing.effectiveTo;
    if (nextTo && nextTo < nextFrom) {
      return NextResponse.json({ error: 'effectiveTo must be on or after effectiveFrom' }, { status: 400 });
    }

    const row = await prisma.busOpsScheduleTemplate.update({ where: { id }, data: patch });
    return NextResponse.json(row);
  } catch (e) {
    console.error('[schedule-templates.PATCH]', e);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });
  const { id } = await ctx.params;
  const existing = await loadOwned(id, tenantId);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    await prisma.busOpsScheduleTemplate.update({ where: { id }, data: { deletedAt: new Date() } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[schedule-templates.DELETE]', e);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
