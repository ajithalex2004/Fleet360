export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { revalidateCache } from '@/lib/server-cache';
import { logAudit } from '@/lib/audit';

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
        // No inner transaction here: withTenantRls has already opened one, and
        // Prisma strips $transaction from a TransactionClient at runtime
        // (denylist: $connect, $disconnect, $on, $transaction, $use, $extends).
        // Calling tx.$transaction threw "tx.$transaction is not a function",
        // which the catch below turned into a bare 500 "Failed to update" — so
        // saving from the Route Planner failed while rename/deactivate edits,
        // which send no `stops` and skipped this branch, kept working.
        // The delete and the update are atomic regardless: both run inside the
        // transaction withTenantRls already holds.
        if (Array.isArray(stops)) {
          // Route ownership is proven by the findFirst above; tenantId here
          // keeps this destructive delete scoped in its own right.
          await tx.routeStop.deleteMany({ where: { routeId: id, tenantId } });
        }
        const route = await tx.busRoute.update({
          where: { id },
          data: {
            ...data,
            updatedAt: new Date(),
            ...(Array.isArray(stops) && stops.length > 0
              ? {
                  stops: {
                    create: stops.map((s: Record<string, unknown>, i: number) => ({
                      stopName:             (s.stopName as string) ?? '',
                      sequence:             (s.sequence as number | undefined) ?? i + 1,
                      gpsLat:               (s.gpsLat  as number | null | undefined) ?? null,
                      gpsLng:               (s.gpsLng  as number | null | undefined) ?? null,
                      landmark:             (s.landmark as string | null | undefined) ?? null,
                      estimatedArrivalMins: (s.estimatedArrivalMins as number | null | undefined) ?? null,
                    })),
                  },
                }
              : {}),
          },
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

  // Filled inside the transaction, written after it commits. Auditing from
  // inside an interactive transaction is unsafe in both directions: a
  // fire-and-forget promise is abandoned when the callback returns (the entry
  // silently never lands), and awaiting it holds the transaction's connection
  // while logAudit checks out a second one from the same pool — which can
  // exhaust the pool under concurrency.
  let auditDetails: string | null = null;
  let auditRouteName: string | null = null;

  const response = await withTenantRls(prisma, tenantId, async (tx) => {

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

        // Refuse to delete a route that still has non-deleted trip schedules.
        // Without this guard a soft-deleted route would leave orphan schedules whose
        // route.deletedAt filter now hides the parent — the schedule stays visible
        // on dispatch/plan pages but its origin/destination context vanishes.
        //
        // Note this counts CANCELLED-but-not-deleted schedules too, and that is
        // deliberate: analytics still reads cancelled trips (see the CANCELLED
        // count in analytics/route.ts), so they would lose route context just the
        // same. Cancelling therefore does NOT release the route — POST
        // schedules/[id]/cancel sets status only and leaves deletedAt null. The
        // message below must not suggest otherwise; only DELETE schedules/[id]
        // (which sets deletedAt) or reassigning routeId clears this.
        const blockingScheduleCount = await tx.tripSchedule.count({
          where: { routeId: id, tenantId, deletedAt: null },
        });
        if (blockingScheduleCount > 0) {
          const one = blockingScheduleCount === 1;
          return NextResponse.json(
            {
              error:
                `Cannot delete: ${blockingScheduleCount} trip schedule${one ? '' : 's'} ` +
                `still ${one ? 'references' : 'reference'} this route. Delete or reassign ` +
                `${one ? 'it' : 'them'} first — cancelling alone does not release the route.`,
            },
            { status: 409 },
          );
        }
        await tx.busRoute.update({
          where: { id },
          data: { deletedAt: new Date(), isActive: false },
        });

        // Deleting a route is auditable. Only the message is built here; the
        // write happens once the transaction has closed (see above).
        auditRouteName = route.name;
        auditDetails = `Soft-deleted route "${route.name}" (${id.slice(0, 8)}); deletedAt set, isActive false. No trip schedules referenced it.`;

        // Same reason as PATCH above — bust the list cache so the deleted row
        // disappears from the grid immediately, not after the 30 s TTL expires.
        revalidateCache([CACHE_TAG]);
        return NextResponse.json({ success: true });
        } catch (e) {
        return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
      }
  });

  // Transaction has committed and released its connection. Awaiting here is
  // safe and makes the audit trail authoritative for a destructive action —
  // logAudit swallows its own errors, so it still cannot fail the delete.
  if (auditDetails) {
    await logAudit({
      tenantId,
      userId:   req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      entityType: 'BusRoute',
      entityId:   id,
      entityName: auditRouteName ?? undefined,
      action:     'DELETE',
      details:    auditDetails,
      ipAddress:  req.headers.get('x-forwarded-for') ?? undefined,
      userAgent:  req.headers.get('user-agent') ?? undefined,
    });
  }

  return response;
}

