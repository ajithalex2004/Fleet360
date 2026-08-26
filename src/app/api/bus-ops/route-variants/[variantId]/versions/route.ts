/**
 * /api/bus-ops/route-variants/[variantId]/versions — version CRUD.
 *
 * GET  — list versions of a variant
 * POST — publish a new version. Optional body:
 *          - effectiveFrom (defaults to today)
 *          - stops: [{ stopName, sequence, gpsLat, gpsLng, geofenceRadiusM, landmark, estimatedArrivalMins }]
 *          - notes
 *          - publishNow (bool, default true — creates in PUBLISHED status
 *                       and closes the prior PUBLISHED version's effectiveTo)
 *
 * Publishing rules:
 *   - versionNumber = max(existing) + 1
 *   - If publishNow=true and a PUBLISHED version exists for the variant,
 *     that version's effectiveTo is set to yesterday (effectiveFrom - 1)
 *     and its status becomes ARCHIVED. The new one becomes PUBLISHED.
 *   - If publishNow=false, version stays DRAFT and no side-effects fire.
 *
 * Historical trips continue referencing the ARCHIVED version — nothing
 * about their stored routeVariantVersionId changes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
interface StopInput {
  stopName?: string;
  sequence?: number;
  gpsLat?: number | null;
  gpsLng?: number | null;
  geofenceRadiusM?: number | null;
  landmark?: string | null;
  estimatedArrivalMins?: number | null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ variantId: string }> }) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const { variantId } = await params;
      try {
        const versions = await tx.busRouteVariantVersion.findMany({
          where: { tenantId, variantId, deletedAt: null },
          orderBy: { versionNumber: 'desc' },
          include: {
            stops: { orderBy: { sequence: 'asc' } },
          },
        });
        return NextResponse.json(versions);
      } catch (e) {
        console.error('[versions.GET]', e);
        return NextResponse.json({ error: 'Failed to fetch versions' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest, { params }: { params: Promise<{ variantId: string }> }) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const publishedBy = req.headers.get('x-user-id') ?? null;
      const { variantId } = await params;

      try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const variant = await tx.busRouteVariant.findFirst({
          where: { id: variantId, tenantId, deletedAt: null },
          select: { id: true, routeId: true },
        });
        if (!variant) return NextResponse.json({ error: 'Variant not found' }, { status: 404 });

        const effectiveFromDate = body.effectiveFrom ? new Date(body.effectiveFrom) : new Date();
        // Normalise to UTC midnight so DATE comparisons don't shift by 1 day
        // for operators in non-UTC timezones (audit risk #17 pattern).
        const effectiveFrom = new Date(Date.UTC(
          effectiveFromDate.getUTCFullYear(),
          effectiveFromDate.getUTCMonth(),
          effectiveFromDate.getUTCDate(),
        ));

        const stops = Array.isArray(body.stops) ? body.stops as StopInput[] : [];
        const publishNow = body.publishNow !== false;

        // Version number = max(existing) + 1.
        // Variant ownership is proven by the findFirst above; tenantId keeps
        // that visible here rather than requiring a trace back.
        const last = await tx.busRouteVariantVersion.findFirst({
          where: { tenantId, variantId, deletedAt: null },
          orderBy: { versionNumber: 'desc' },
          select: { versionNumber: true },
        });
        const versionNumber = (last?.versionNumber ?? 0) + 1;

        // The published-version cutover + new-version create + stop
        // materialisation must not straddle a partial failure, or the variant
        // could end up with two PUBLISHED versions. They already don't:
        // withTenantRls has opened a transaction and everything below runs
        // inside it.
        //
        // This used to call tx.$transaction(...) for that guarantee. Prisma
        // strips $transaction from a TransactionClient at runtime, so the call
        // threw "tx.$transaction is not a function" and publishing a version
        // failed outright — the atomicity it was reaching for was already
        // there, and asking for it again broke the endpoint.
        const created = await (async () => {
          let closedPrevious: string | null = null;
          if (publishNow) {
            const prev = await tx.busRouteVariantVersion.findFirst({
              where: { tenantId, variantId, status: 'PUBLISHED', deletedAt: null },
            });
            if (prev) {
              const yesterday = new Date(effectiveFrom.getTime() - 24 * 3600 * 1000);
              await tx.busRouteVariantVersion.update({
                where: { id: prev.id },
                data:  { status: 'ARCHIVED', effectiveTo: yesterday },
              });
              closedPrevious = prev.id;
            }
          }

          const version = await tx.busRouteVariantVersion.create({
            data: {
              id: randomUUID(),
              tenantId,
              variantId,
              versionNumber,
              effectiveFrom,
              status:      publishNow ? 'PUBLISHED' : 'DRAFT',
              publishedAt: publishNow ? new Date() : null,
              publishedBy: publishNow ? publishedBy : null,
              notes:       body.notes?.trim() || null,
            },
          });

          if (stops.length > 0) {
            await tx.routeStop.createMany({
              data: stops.map((s, i) => ({
                id: randomUUID(),
                tenantId,
                routeId: variant.routeId,           // back-compat: routeId stays populated
                variantVersionId: version.id,        // Phase 1: link to the version
                stopName: s.stopName ?? `Stop ${i + 1}`,
                sequence: s.sequence ?? i + 1,
                gpsLat:   s.gpsLat ?? null,
                gpsLng:   s.gpsLng ?? null,
                geofenceRadiusM:      s.geofenceRadiusM ?? null,
                estimatedArrivalMins: s.estimatedArrivalMins ?? null,
                landmark: s.landmark ?? null,
              })),
            });
          }

          return { version, closedPrevious, stopCount: stops.length };
        })();

        return NextResponse.json(created, { status: 201 });
        } catch (e) {
        console.error('[versions.POST]', e);
        const msg = e instanceof Error ? e.message : 'Failed to publish version';
        if (/uq_bus_route_variant_versions_one_published/.test(msg)) {
          return NextResponse.json({ error: 'A PUBLISHED version already exists — cutover conflict, please retry' }, { status: 409 });
        }
        return NextResponse.json({ error: msg }, { status: 500 });
      }
  });
}

