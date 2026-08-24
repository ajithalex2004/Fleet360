/**
 * /api/bus-ops/schedule-templates — recurring schedule template CRUD.
 *
 * A template is the RULE ("Marina Morning SUN-THU pickup at 07:00 from Aug 7").
 * The concrete TripSchedule rows are materialised by
 * POST /api/bus-ops/schedule-templates/[id]/generate for a chosen date window.
 *
 * GET  — list; filters: routeId, status
 * POST — create; tenantId is stamped from x-tenant-id (never trust body)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const VALID_WEEK_TYPES = new Set(['SUN_THU', 'MON_FRI', 'SAT_WED', 'CUSTOM']);
const VALID_SESSIONS   = new Set(['MORNING', 'EVENING', 'NIGHT', 'SPLIT']);
const VALID_DIRECTIONS = new Set(['PICKUP', 'DROPOFF']);
const VALID_STATUSES   = new Set(['ACTIVE', 'INACTIVE']);
const TIME_RE          = /^([01]\d|2[0-3]):[0-5]\d$/;

function validateShape(b: {
  name?: string; routeId?: string; weekType?: string; session?: string;
  direction?: string; departureTime?: string; arrivalTime?: string | null;
  activeDays?: number[]; status?: string;
}): string | null {
  if (!b.name?.trim())                              return 'name is required';
  if (!b.routeId)                                   return 'routeId is required';
  if (!b.weekType || !VALID_WEEK_TYPES.has(b.weekType)) return `weekType must be one of ${[...VALID_WEEK_TYPES].join('|')}`;
  if (!b.session  || !VALID_SESSIONS.has(b.session))    return `session must be one of ${[...VALID_SESSIONS].join('|')}`;
  if (!b.direction || !VALID_DIRECTIONS.has(b.direction)) return `direction must be one of ${[...VALID_DIRECTIONS].join('|')}`;
  if (!b.departureTime || !TIME_RE.test(b.departureTime)) return 'departureTime must be HH:MM (24h)';
  if (b.arrivalTime && !TIME_RE.test(b.arrivalTime))      return 'arrivalTime must be HH:MM (24h)';
  if (!Array.isArray(b.activeDays) || b.activeDays.length === 0) return 'activeDays must be a non-empty array of 0..6';
  if (b.activeDays.some(d => !Number.isInteger(d) || d < 0 || d > 6)) return 'activeDays entries must be integers 0..6';
  if (b.status && !VALID_STATUSES.has(b.status))    return 'status must be ACTIVE or INACTIVE';
  return null;
}

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const sp      = req.nextUrl.searchParams;
      const routeId = sp.get('routeId');
      const status  = sp.get('status');

      try {
        const rows = await tx.busOpsScheduleTemplate.findMany({
          where: {
            tenantId, deletedAt: null,
            ...(routeId ? { routeId } : {}),
            ...(status && VALID_STATUSES.has(status) ? { status } : {}),
          },
          orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
        });
        return NextResponse.json(rows, { headers: { 'Cache-Control': 'private, max-age=15' } });
        } catch (e) {
        console.error('[schedule-templates.GET]', e);
        return NextResponse.json({ error: 'Failed to fetch schedule templates' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const createdBy = req.headers.get('x-user-id') ?? null;

      try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const err = validateShape(body);
        if (err) return NextResponse.json({ error: err }, { status: 400 });

        const effectiveFrom = body.effectiveFrom ? new Date(body.effectiveFrom) : new Date();
        const effectiveTo   = body.effectiveTo   ? new Date(body.effectiveTo)   : null;
        if (effectiveTo && effectiveTo < effectiveFrom) {
          return NextResponse.json({ error: 'effectiveTo must be on or after effectiveFrom' }, { status: 400 });
        }

        const exceptionDates: Date[] = Array.isArray(body.exceptionDates)
          ? body.exceptionDates.map((d: string) => new Date(d)).filter((d: Date) => !isNaN(d.getTime()))
          : [];

        const row = await tx.busOpsScheduleTemplate.create({
          data: {
            tenantId,                       // stamped from session
            name:          body.name.trim(),
            routeId:       body.routeId,
            vehicleId:     body.vehicleId  || null,
            driverId:      body.driverId   || null,
            weekType:      body.weekType,
            activeDays:    body.activeDays,
            session:       body.session,
            departureTime: body.departureTime,
            arrivalTime:   body.arrivalTime || null,
            direction:     body.direction,
            effectiveFrom,
            effectiveTo,
            exceptionDates,
            status:        body.status || 'ACTIVE',
            notes:         body.notes?.trim() || null,
            createdBy,
          },
        });
        return NextResponse.json(row, { status: 201 });
        } catch (e) {
        console.error('[schedule-templates.POST]', e);
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to create schedule template' }, { status: 500 });
      }
  });
}

