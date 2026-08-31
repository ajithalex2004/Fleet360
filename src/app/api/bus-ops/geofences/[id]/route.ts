export const dynamic = 'force-dynamic';

/**
 * /api/bus-ops/geofences/[id] — single-geofence GET / PATCH / DELETE.
 *
 * PHASE 2a — reads and writes against `spatial.places` filtered by
 * `sourceModule='bus-ops'`. Response contract unchanged; see the parent
 * route for the field-mapping details.
 *
 * DELETE is soft-delete (sets deletedAt).
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const VALID_TYPES  = new Set(['STOP', 'GARAGE', 'ORIGIN_DESTINATION', 'BASE_CAMP', 'ACCOMMODATION']);
const VALID_SHAPES = new Set(['CIRCLE', 'POLYGON']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toLegacy(p: any) {
  return {
    id: p.id, tenantId: p.tenantId, name: p.name, type: p.type, shape: p.shape,
    centerLat: p.centerLat, centerLng: p.centerLng, radiusM: p.radiusM, polygon: p.polygon,
    address: p.address, notes: p.description, active: p.active, createdBy: p.createdBy,
    createdAt: p.createdAt, updatedAt: p.updatedAt, deletedAt: p.deletedAt,
  };
}

async function loadOwned(id: string, tenantId: string) {
  // Also accept legacy ids that were assigned before Phase 1 backfill:
  // the migration preserves `id`, and pre-backfill callers may pass the
  // former UUID which also lives in `source_id`.
  return prisma.place.findFirst({
    where: {
      tenantId, deletedAt: null,
      OR: [
        { id },
        { sourceModule: 'bus-ops', sourceId: id },
      ],
    },
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;
  const { id } = await ctx.params;

  const row = await loadOwned(id, tenantId);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(toLegacy(row));
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const updatedBy = req.headers.get('x-user-id') ?? null;
      const { id } = await ctx.params;

      const existing = await loadOwned(id, tenantId);
      if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const patch: any = { updatedBy };
        if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
        if (typeof body.type === 'string') {
          if (!VALID_TYPES.has(body.type)) return NextResponse.json({ error: 'invalid type' }, { status: 400 });
          patch.type = body.type;
        }
        if (typeof body.shape === 'string') {
          if (!VALID_SHAPES.has(body.shape)) return NextResponse.json({ error: 'invalid shape' }, { status: 400 });
          patch.shape = body.shape;
        }
        // Geometry — accept whichever set matches the (patched or existing) shape.
        const nextShape = patch.shape ?? existing.shape;
        if (nextShape === 'CIRCLE') {
          if (typeof body.centerLat === 'number') patch.centerLat = body.centerLat;
          if (typeof body.centerLng === 'number') patch.centerLng = body.centerLng;
          if (typeof body.radiusM   === 'number' && body.radiusM > 0) patch.radiusM = Math.round(body.radiusM);
          if ('polygon' in body) patch.polygon = null; // switching to circle clears polygon
        } else if (nextShape === 'POLYGON') {
          if (Array.isArray(body.polygon) && body.polygon.length >= 3) patch.polygon = body.polygon;
          if ('centerLat' in body || 'centerLng' in body || 'radiusM' in body) {
            patch.centerLat = null; patch.centerLng = null; patch.radiusM = null;
          }
        }
        if ('address' in body) patch.address     = body.address?.trim() || null;
        if ('notes'   in body) patch.description = body.notes?.trim()   || null;
        if (typeof body.active === 'boolean') patch.active = body.active;

        const row = await tx.place.update({ where: { id: existing.id }, data: patch });
        return NextResponse.json(toLegacy(row));
      } catch (e) {
        console.error('[geofences.PATCH]', e);
        return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
      }
  });
}


export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const { id } = await ctx.params;

      const existing = await loadOwned(id, tenantId);
      if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      try {
        await tx.place.update({
          where: { id: existing.id },
          data: { deletedAt: new Date() },
        });
        return NextResponse.json({ ok: true });
        } catch (e) {
        console.error('[geofences.DELETE]', e);
        return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
      }
  });
}

