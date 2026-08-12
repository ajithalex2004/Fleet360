/**
 * /api/bus-ops/geofences/[id] — single-geofence GET / PATCH / DELETE.
 *
 * DELETE is soft-delete (sets deletedAt) so any downstream references remain
 * resolvable for audit/history. A hard-delete would need a preflight to check
 * dependent routes/stops once phase 2 wires them up.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const VALID_TYPES  = new Set(['STOP', 'GARAGE', 'ORIGIN_DESTINATION', 'BASE_CAMP', 'ACCOMMODATION']);
const VALID_SHAPES = new Set(['CIRCLE', 'POLYGON']);

async function loadOwned(id: string, tenantId: string) {
  return prisma.busOpsGeofence.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { id } = await ctx.params;

  const row = await loadOwned(id, tenantId);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { id } = await ctx.params;

  const existing = await loadOwned(id, tenantId);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    const body = await req.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: any = {};
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
    if ('address' in body) patch.address = body.address?.trim() || null;
    if ('notes'   in body) patch.notes   = body.notes?.trim()   || null;
    if (typeof body.active === 'boolean') patch.active = body.active;

    const row = await prisma.busOpsGeofence.update({
      where: { id },
      data: patch,
    });
    return NextResponse.json(row);
  } catch (e) {
    console.error('[geofences.PATCH]', e);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { id } = await ctx.params;

  const existing = await loadOwned(id, tenantId);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    await prisma.busOpsGeofence.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[geofences.DELETE]', e);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
