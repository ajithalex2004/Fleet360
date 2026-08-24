/**
 * /api/bus-ops/headway — CRUD for headway rules + expand endpoint.
 *
 * GET  /api/bus-ops/headway?routeId=…        — list rules for a route
 * GET  /api/bus-ops/headway?routeId=…&from=…&to=…[&tz=Asia/Dubai]
 *                                          — list rules + their expanded
 *                                            departures for [from, to],
 *                                            with wall-clock times
 *                                            interpreted in `tz` (IANA)
 * POST /api/bus-ops/headway                  — create a rule
 * DELETE /api/bus-ops/headway?id=…          — soft-delete a rule
 *
 * R3 (2026-08-14): timezone parameter threaded through to expandHeadway
 * so the ISO output is DST-aware for tenants outside UTC. Defaults to
 * 'Asia/Dubai' (platform's primary operational zone). Follow-up:
 * persist a per-tenant IANA timezone on tenants and read it here so
 * the client no longer needs to send `tz`.
 */

/** Fallback timezone when neither query param nor per-tenant setting is
 *  available. UAE is the platform's primary market — everywhere else
 *  should override via ?tz=. */
const DEFAULT_TZ = 'Asia/Dubai';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { revalidateCache } from '@/lib/server-cache';
import { requireBusOpsAdminAccess } from '@/lib/bus-ops/require-admin-access';
import { expandHeadway, daysToMask, maskToDays } from '@/lib/headway/service';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
/**
 * Every method is gated on bus-ops:admin:headway. Headway rules define the
 * published service frequency and each one can bind to a CBA rule-set via
 * cbaRuleSetId, so an unguarded write here reshapes the timetable and can
 * repoint it at different pay rules. Shipped with no RBAC gate at all;
 * matches the planning-constraints pattern now.
 */
const HEADWAY_RESOURCE = 'headway';

const CACHE_TAG = 'bus-ops:headway';

interface RuleRow {
  id: string;
  routeId: string;
  tripId: string | null;
  dayMask: string;
  startTime: string;
  endTime: string;
  headwayMinutes: number;
  anchorTime: string | null;
  cbaRuleSetId: string | null;
  notes: string | null;
}

function shapeRule(r: RuleRow) {
  return {
    id: r.id,
    routeId: r.routeId,
    tripId: r.tripId,
    dayMask: r.dayMask,
    startTime: r.startTime,
    endTime: r.endTime,
    headwayMinutes: r.headwayMinutes,
    anchorTime: r.anchorTime,
    cbaRuleSetId: r.cbaRuleSetId,
    notes: r.notes,
  };
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const tenantId = req.headers.get('x-tenant-id') ?? '';
  if (!tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 400 });
  const permError = requireBusOpsAdminAccess(req, HEADWAY_RESOURCE);
  if (permError) return permError;
  const sp = new URL(req.url).searchParams;
  const routeId = sp.get('routeId');
  const from    = sp.get('from');
  const to      = sp.get('to');
  // Timezone for wall-clock → UTC conversion. Query param wins so the
  // client (which knows the operator's locale) can override; falls back
  // to DEFAULT_TZ. When a per-tenant timezone column exists, read it
  // here as the second-priority default.
  const tz      = sp.get('tz') ?? DEFAULT_TZ;
  try {
    const rules = await withTenantRls(prisma, tenantId, (tx) =>
      tx.headwayRule.findMany({
        where: {
          tenantId, deletedAt: null,
          ...(routeId ? { routeId } : {}),
        },
        orderBy: [{ routeId: 'asc' }, { startTime: 'asc' }],
      })
    );
    const shaped = rules.map((r) => shapeRule(r as unknown as RuleRow));
    if (!from || !to) {
      return NextResponse.json({ rules: shaped }, { headers: { 'Cache-Control': 'private, max-age=60' } });
    }
    const departures = expandHeadway(shaped, from, to, tz);
    return NextResponse.json({ rules: shaped, departures, from, to, tz },
      { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' } });
  } catch (e) {
    console.error('[headway GET]', e);
    return NextResponse.json({ error: 'Failed to list' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const tenantId = req.headers.get('x-tenant-id') ?? '';
  if (!tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 400 });
  const permError = requireBusOpsAdminAccess(req, HEADWAY_RESOURCE);
  if (permError) return permError;
  try {
    const body = await req.json() as {
      routeId: string;
      dayMask?: string;
      days?: number[];
      startTime: string;
      endTime: string;
      headwayMinutes: number;
      anchorTime?: string | null;
      cbaRuleSetId?: string | null;
      notes?: string;
    };
    if (!body.routeId || !body.startTime || !body.endTime || !body.headwayMinutes) {
      return NextResponse.json({ error: 'routeId, startTime, endTime, headwayMinutes are required' }, { status: 400 });
    }
    const dayMask = body.dayMask ?? (body.days ? daysToMask(body.days) : 'YYYYYYY');
    const created = await withTenantRls(prisma, tenantId, (tx) =>
      tx.headwayRule.create({
        data: {
          tenantId,
          routeId: body.routeId,
          dayMask,
          startTime: body.startTime,
          endTime: body.endTime,
          headwayMinutes: Math.max(1, Math.min(240, Math.floor(body.headwayMinutes))),
          anchorTime: body.anchorTime ?? null,
          cbaRuleSetId: body.cbaRuleSetId ?? null,
          notes: body.notes ?? null,
        },
      })
    );
    revalidateCache([CACHE_TAG]);
    return NextResponse.json(shapeRule(created as unknown as RuleRow), { status: 201 });
  } catch (e) {
    console.error('[headway POST]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const tenantId = req.headers.get('x-tenant-id') ?? '';
  if (!tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 400 });
  const permError = requireBusOpsAdminAccess(req, HEADWAY_RESOURCE);
  if (permError) return permError;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  try {
    await withTenantRls(prisma, tenantId, (tx) =>
      tx.headwayRule.update({ where: { id }, data: { deletedAt: new Date() } })
    );
    revalidateCache([CACHE_TAG]);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[headway DELETE]', e);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
