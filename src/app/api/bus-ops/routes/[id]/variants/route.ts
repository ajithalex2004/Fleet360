/**
 * /api/bus-ops/routes/[id]/variants — variant CRUD for a route.
 *
 * A variant is a named direction (Morning → Office, Evening →
 * Residence, Weekend Shuttle). Every trip runs against a variant; each
 * variant has its own version history so stops can differ across time.
 *
 * GET  — list variants for a route (tenant-scoped)
 * POST — create a new variant; a first DRAFT version is auto-created
 *        so the operator can add stops immediately via the versions
 *        endpoint. Not published until the operator explicitly publishes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });
  const { id: routeId } = await params;
  try {
    const variants = await prisma.busRouteVariant.findMany({
      where: { tenantId, routeId, deletedAt: null },
      include: {
        versions: {
          where: { deletedAt: null },
          orderBy: { versionNumber: 'desc' },
          select: {
            id: true, versionNumber: true, effectiveFrom: true, effectiveTo: true,
            status: true, publishedAt: true, publishedBy: true, notes: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    return NextResponse.json(variants);
  } catch (e) {
    console.error('[variants.GET]', e);
    return NextResponse.json({ error: 'Failed to fetch variants' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });
  const createdBy = req.headers.get('x-user-id') ?? null;
  const { id: routeId } = await params;

  try {
    const body = await req.json();
    if (!body.name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });

    // Verify the route exists in this tenant so we don't create a variant
    // pointing at a stranger's route (RLS on public.bus_routes may not be
    // enforced everywhere; belt-and-suspenders check).
    const route = await prisma.busRoute.findFirst({ where: { id: routeId, OR: [{ tenantId }, { tenantId: null }] } });
    if (!route) return NextResponse.json({ error: 'Route not found' }, { status: 404 });

    // Wrap variant + first DRAFT version in one transaction so we never
    // leave an orphan variant with no versions (which the UI would then
    // show as un-editable).
    const created = await prisma.$transaction(async (tx) => {
      const variant = await tx.busRouteVariant.create({
        data: {
          id: randomUUID(),
          tenantId,
          routeId,
          name:        body.name.trim(),
          kind:        body.kind?.trim() || null,
          description: body.description?.trim() || null,
          isActive:    body.isActive ?? true,
          createdBy,
        },
      });
      const version = await tx.busRouteVariantVersion.create({
        data: {
          id: randomUUID(),
          tenantId,
          variantId: variant.id,
          versionNumber: 1,
          effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : new Date(),
          status: 'DRAFT',
        },
      });
      return { variant, version };
    });

    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    console.error('[variants.POST]', e);
    const msg = e instanceof Error ? e.message : 'Failed to create variant';
    if (/uq_bus_route_variants_route_name/.test(msg)) {
      return NextResponse.json({ error: 'A variant with this name already exists on the route' }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
