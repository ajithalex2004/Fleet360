/**
 * resolveVariantVersionForTrip — pick the right variant version to
 * snapshot on a new TripSchedule.
 *
 * Priority order:
 *   1. Explicit routeVariantVersionId on the body — use as-is (must exist
 *      and belong to the same tenant).
 *   2. Explicit routeVariantId — pick that variant's currently PUBLISHED
 *      version.
 *   3. routeId + direction (legacy) — find a variant on that route whose
 *      `kind` matches direction (case-insensitive), else the first
 *      active variant. Pick its PUBLISHED version.
 *   4. routeId alone — pick the first active variant's PUBLISHED version.
 *   5. Nothing found → null. Caller decides whether to reject or write
 *      the trip with routeVariantVersionId=NULL (which today still works
 *      because readers haven't been cut over to require it — see Phase 2
 *      in FOLLOWUP_ROUTE_VERSIONING.md).
 */

import { prisma } from '@/lib/prisma';

export interface ResolveArgs {
  tenantId: string;
  routeId?: string | null;
  direction?: string | null;
  routeVariantId?: string | null;
  routeVariantVersionId?: string | null;
}

export async function resolveVariantVersionForTrip(
  args: ResolveArgs,
): Promise<{ id: string; variantId: string; versionNumber: number } | null> {
  const { tenantId } = args;

  if (args.routeVariantVersionId) {
    const v = await prisma.busRouteVariantVersion.findFirst({
      where: { id: args.routeVariantVersionId, tenantId, deletedAt: null },
      select: { id: true, variantId: true, versionNumber: true },
    });
    return v;
  }

  if (args.routeVariantId) {
    const v = await prisma.busRouteVariantVersion.findFirst({
      where: { variantId: args.routeVariantId, tenantId, status: 'PUBLISHED', deletedAt: null },
      select: { id: true, variantId: true, versionNumber: true },
    });
    return v;
  }

  if (!args.routeId) return null;

  // routeId + optional direction. Match variant.kind case-insensitively so
  // legacy trips with direction='INBOUND' pick a variant with kind='INBOUND'
  // (or 'inbound', or a MORNING variant if that's what the operator named
  // for inbound trips).
  const variants = await prisma.busRouteVariant.findMany({
    where: { tenantId, routeId: args.routeId, isActive: true, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  if (variants.length === 0) return null;

  const dir = args.direction?.toUpperCase() ?? null;
  const preferred = dir
    ? variants.find(v => (v.kind ?? '').toUpperCase() === dir)
    : null;
  const chosen = preferred ?? variants[0];

  const v = await prisma.busRouteVariantVersion.findFirst({
    where: { variantId: chosen.id, tenantId, status: 'PUBLISHED', deletedAt: null },
    select: { id: true, variantId: true, versionNumber: true },
  });
  return v;
}
