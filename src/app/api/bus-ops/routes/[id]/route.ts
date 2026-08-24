import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { revalidateCache } from '@/lib/server-cache';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
// Must match the tag used by the list endpoint's cacheRead — every write
// here invalidates the same key so the next GET /api/bus-ops/routes serves
// fresh data instead of the cached snapshot.
const CACHE_TAG = 'bus-ops:routes';

// Next 15.2+ signature: `params` is a Promise that must be awaited. Old shape
// `{ params }: { params: { id: string } }` still runs but fails typecheck.
type IdCtx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: IdCtx) {

  const { id } = await params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      try {
        const route = await tx.busRoute.findFirst({
          where: { id, tenantId, deletedAt: null },
          include: {
            stops: { orderBy: { sequence: 'asc' } },
            schedules: {
              where: { deletedAt: null },
              orderBy: { departureTime: 'desc' },
              take: 10,
              include: { _count: { select: { passengers: true } } },
            },
          },
        });
        if (!route) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        return NextResponse.json(route);
      } catch (e) {
        return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
      }
  });
}


export async function PATCH(req: NextRequest, { params }: IdCtx) {

  const { id } = await params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      try {
        const existing = await tx.busRoute.findFirst({ where: { id, tenantId, deletedAt: null }, select: { id: true } });
        if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        // `schedules` on the route is a computed relation — never accept it on write.
        // `stops` is handled separately below; it stays out of the top-level update.
        const { stops, schedules: _schedules, ...data } = body;

        // Stops are a 1:N replace-set: when the client sends a stops array, treat
        // it as the new complete list. Delete existing rows in the same tx and
        // recreate from the payload so the DB matches what the operator saved in
        // the modal / planner. Skip when stops is undefined (e.g. Deactivate,
        // rename-only edits — no stop churn intended).
        const route = Array.isArray(stops)
          ? await tx.$transaction(async (tx) => {
              await tx.routeStop.deleteMany({ where: { routeId: id } });
              return tx.busRoute.update({
                where: { id },
                data: {
                  ...data,
                  updatedAt: new Date(),
                  stops: stops.length > 0 ? {
                    create: stops.map((s: Record<string, unknown>, i: number) => ({
                      stopName:             (s.stopName as string) ?? '',
                      sequence:             (s.sequence as number | undefined) ?? i + 1,
                      gpsLat:               (s.gpsLat  as number | null | undefined) ?? null,
                      gpsLng:               (s.gpsLng  as number | null | undefined) ?? null,
                      landmark:             (s.landmark as string | null | undefined) ?? null,
                      estimatedArrivalMins: (s.estimatedArrivalMins as number | null | undefined) ?? null,
                    })),
                  } : undefined,
                },
                include: { stops: { orderBy: { sequence: 'asc' } } },
              });
            })
          : await tx.busRoute.update({
              where: { id },
              data: { ...data, updatedAt: new Date() },
              include: { stops: { orderBy: { sequence: 'asc' } } },
            });

        // Bust the list cache so the next GET reflects this write immediately.
        // Without this, the operator would see Deactivate silently "fail" for up
        // to 30 s because the cached list still says isActive: true.
        revalidateCache([CACHE_TAG]);
        return NextResponse.json(route);
      } catch (e) {
        console.error('[bus-ops/routes/[id].PATCH]', e);
        return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
      }
  });
}


export async function DELETE(req: NextRequest, { params }: IdCtx) {

  const { id } = await params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      try {
        // Load the route first so we can enforce the two-step delete protocol:
        // route must be deactivated (isActive = false) BEFORE it can be deleted.
        // This forces the operator to confirm the route is out of service via a
        // reversible action first — deactivation is safe to undo, deletion isn't.
        const route = await tx.busRoute.findFirst({
          where: { id, tenantId, deletedAt: null },
          select: { id: true, name: true, isActive: true },
        });
        if (!route) return NextResponse.json({ error: 'Route not found' }, { status: 404 });
        if (route.isActive) {
          return NextResponse.json(
            { error: `Deactivate "${route.name}" first, then delete. Active routes cannot be deleted.` },
            { status: 409 },
          );
        }

        // Refuse to delete a route that still has live (non-deleted) trip schedules.
        // Without this guard a soft-deleted route would leave orphan schedules whose
        // route.deletedAt filter now hides the parent — the schedule stays visible
        // on dispatch/plan pages but its origin/destination context vanishes.
        const activeScheduleCount = await tx.tripSchedule.count({
          where: { routeId: id, deletedAt: null },
        });
        if (activeScheduleCount > 0) {
          return NextResponse.json(
            { error: `Cannot delete: ${activeScheduleCount} live trip schedule${activeScheduleCount === 1 ? '' : 's'} still reference this route. Cancel or reassign them first.` },
            { status: 409 },
          );
        }
        await tx.busRoute.update({
          where: { id },
          data: { deletedAt: new Date(), isActive: false },
        });
        // Same reason as PATCH above — bust the list cache so the deleted row
        // disappears from the grid immediately, not after the 30 s TTL expires.
        revalidateCache([CACHE_TAG]);
        return NextResponse.json({ success: true });
        } catch (e) {
        return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
      }
  });
}

