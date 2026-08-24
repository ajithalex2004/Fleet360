/**
 * /api/bus-ops/geofences — Bus-ops named-zone CRUD.
 *
 * PHASE 2a — storage swap. Data now lives in `spatial.places` with
 * `sourceModule='bus-ops'`. The response contract is unchanged so any
 * consumer (bus-ops geofences page, driver-app arrival detector,
 * school-bus / ambulance references) keeps working without a rewrite.
 *
 * Field mapping (Place → GeofenceRecord shape returned to caller):
 *   description → notes    (legacy column was `notes`, Place uses `description`)
 *   everything else        → direct pass-through
 *
 * The old `public.bus_ops_geofences` table is no longer written to but
 * remains readable for one release; Phase 3a drops it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const VALID_TYPES  = new Set(['STOP', 'GARAGE', 'ORIGIN_DESTINATION', 'BASE_CAMP', 'ACCOMMODATION']);
const VALID_SHAPES = new Set(['CIRCLE', 'POLYGON']);

/**
 * Reshape a Place row into the legacy GeofenceRecord contract. Notes
 * lives in description on the shared table but the API keeps `notes`
 * so downstream consumers (page, driver-app) don't need updates today.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toLegacy(p: any) {
  return {
    id:        p.id,
    tenantId:  p.tenantId,
    name:      p.name,
    type:      p.type,
    shape:     p.shape,
    centerLat: p.centerLat,
    centerLng: p.centerLng,
    radiusM:   p.radiusM,
    polygon:   p.polygon,
    address:   p.address,
    notes:     p.description,
    active:    p.active,
    createdBy: p.createdBy,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    deletedAt: p.deletedAt,
  };
}

function shapeIsValid(body: {
  shape?: string;
  centerLat?: number | null;
  centerLng?: number | null;
  radiusM?: number | null;
  polygon?: unknown;
}): string | null {
  if (!body.shape || !VALID_SHAPES.has(body.shape)) return `shape must be one of ${[...VALID_SHAPES].join('|')}`;
  if (body.shape === 'CIRCLE') {
    if (typeof body.centerLat !== 'number' || typeof body.centerLng !== 'number') return 'CIRCLE requires numeric centerLat/centerLng';
    if (typeof body.radiusM !== 'number' || body.radiusM <= 0) return 'CIRCLE requires positive radiusM';
  }
  if (body.shape === 'POLYGON') {
    if (!Array.isArray(body.polygon) || body.polygon.length < 3) return 'POLYGON requires an array of >=3 vertices';
  }
  return null;
}

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const sp = req.nextUrl.searchParams;
      const type    = sp.get('type');
      const active  = sp.get('active'); // '1' | '0' | null (all)

      try {
        const rows = await tx.place.findMany({
          where: {
            tenantId,
            sourceModule: 'bus-ops',
            deletedAt: null,
            // Also include any Place rows that use bus-ops types but never
            // carried a sourceModule tag (e.g. rows created directly through
            // /api/places with type=STOP but no sourceModule). Keeps the API
            // usable as a single view over "everything bus-ops cares about".
            ...(type && VALID_TYPES.has(type) ? { type } : { type: { in: [...VALID_TYPES] } }),
            ...(active === '1' ? { active: true } : active === '0' ? { active: false } : {}),
          },
          orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json(rows.map(toLegacy), { headers: { 'Cache-Control': 'private, max-age=15' } });
        } catch (e) {
        console.error('[geofences.GET]', e);
        return NextResponse.json({ error: 'Failed to fetch geofences' }, { status: 500 });
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
        if (!body.name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });
        if (!body.type || !VALID_TYPES.has(body.type)) {
          return NextResponse.json({ error: `type must be one of ${[...VALID_TYPES].join('|')}` }, { status: 400 });
        }
        const shapeErr = shapeIsValid(body);
        if (shapeErr) return NextResponse.json({ error: shapeErr }, { status: 400 });

        // Create against spatial.places with the bus-ops sourceModule tag so
        // this row can be filtered back out through this endpoint AND also
        // shows up on the shared /locations catalogue.
        const row = await tx.place.create({
          data: {
            tenantId,
            sourceModule: 'bus-ops',
            name:        body.name.trim(),
            type:        body.type,
            shape:       body.shape,
            centerLat:   body.shape === 'CIRCLE' ? body.centerLat : null,
            centerLng:   body.shape === 'CIRCLE' ? body.centerLng : null,
            radiusM:     body.shape === 'CIRCLE' ? Math.round(body.radiusM) : null,
            polygon:     body.shape === 'POLYGON' ? body.polygon : null,
            address:     body.address?.trim() || null,
            description: body.notes?.trim() || null,
            active:      body.active ?? true,
            createdBy,
          },
        });
        return NextResponse.json(toLegacy(row), { status: 201 });
        } catch (e) {
        console.error('[geofences.POST]', e);
        return NextResponse.json({ error: 'Failed to create geofence' }, { status: 500 });
      }
  });
}

