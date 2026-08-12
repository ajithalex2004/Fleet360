/**
 * /api/bus-ops/geofences — Bus-ops named-zone CRUD.
 *
 * A geofence is a first-class, tenant-scoped, named zone the operator draws
 * on the map. Type (STOP / GARAGE / ORIGIN_DESTINATION / BASE_CAMP /
 * ACCOMMODATION) is what the zone represents; shape (CIRCLE / POLYGON) is
 * how it was drawn. Downstream (Phase 2) we'll wire routes/stops and the
 * driver-app arrival detector to reference these by id.
 *
 * GET  — list, filter by type/active, tenant-scoped
 * POST — create, tenantId always stamped from x-tenant-id (never trust body)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const VALID_TYPES  = new Set(['STOP', 'GARAGE', 'ORIGIN_DESTINATION', 'BASE_CAMP', 'ACCOMMODATION']);
const VALID_SHAPES = new Set(['CIRCLE', 'POLYGON']);

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
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const type    = sp.get('type');
  const active  = sp.get('active'); // '1' | '0' | null (all)

  try {
    const rows = await prisma.busOpsGeofence.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(type && VALID_TYPES.has(type) ? { type } : {}),
        ...(active === '1' ? { active: true } : active === '0' ? { active: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(rows, { headers: { 'Cache-Control': 'private, max-age=15' } });
  } catch (e) {
    console.error('[geofences.GET]', e);
    return NextResponse.json({ error: 'Failed to fetch geofences' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const createdBy = req.headers.get('x-user-id') ?? null;

  try {
    const body = await req.json();
    if (!body.name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    if (!body.type || !VALID_TYPES.has(body.type)) {
      return NextResponse.json({ error: `type must be one of ${[...VALID_TYPES].join('|')}` }, { status: 400 });
    }
    const shapeErr = shapeIsValid(body);
    if (shapeErr) return NextResponse.json({ error: shapeErr }, { status: 400 });

    const row = await prisma.busOpsGeofence.create({
      data: {
        tenantId, // stamped from session, never from body
        name:      body.name.trim(),
        type:      body.type,
        shape:     body.shape,
        centerLat: body.shape === 'CIRCLE' ? body.centerLat : null,
        centerLng: body.shape === 'CIRCLE' ? body.centerLng : null,
        radiusM:   body.shape === 'CIRCLE' ? Math.round(body.radiusM) : null,
        polygon:   body.shape === 'POLYGON' ? body.polygon : null,
        address:   body.address?.trim() || null,
        notes:     body.notes?.trim() || null,
        active:    body.active ?? true,
        createdBy,
      },
    });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    console.error('[geofences.POST]', e);
    return NextResponse.json({ error: 'Failed to create geofence' }, { status: 500 });
  }
}
