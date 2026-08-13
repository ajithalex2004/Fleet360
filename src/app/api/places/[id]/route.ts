/**
 * /api/places/[id] — single-place read / update / soft-delete.
 *
 * Delete is soft (sets deletedAt) so any downstream references — e.g. a
 * RouteStop.placeId once Phase 2 lands — still resolve for history.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isPlaceShape, isPlaceType } from '@/lib/places/types';

export const runtime = 'nodejs';

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

async function loadOwned(id: string, tenantId: string) {
  return prisma.place.findFirst({ where: { id, tenantId, deletedAt: null } });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return bad('Not authenticated', 401);
  const { id } = await ctx.params;
  const row = await loadOwned(id, tenantId);
  if (!row) return bad('Not found', 404);
  return NextResponse.json(row);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return bad('Not authenticated', 401);
  const updatedBy = req.headers.get('x-user-id') ?? null;
  const { id } = await ctx.params;

  const existing = await loadOwned(id, tenantId);
  if (!existing) return bad('Not found', 404);

  try {
    const body = await req.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: any = { updatedBy };

    if ('name'        in body) patch.name        = String(body.name).trim();
    if ('code'        in body) patch.code        = body.code?.trim() || null;
    if ('description' in body) patch.description = body.description?.trim() || null;
    if ('address'     in body) patch.address     = body.address?.trim() || null;
    if ('metadata'    in body) patch.metadata    = body.metadata ?? null;
    if ('active'      in body) patch.active      = Boolean(body.active);

    if ('type' in body) {
      if (!isPlaceType(body.type)) return bad('type is not a valid PlaceType');
      patch.type = body.type;
    }
    if ('shape' in body) {
      if (!isPlaceShape(body.shape)) return bad('shape must be POINT, CIRCLE or POLYGON');
      patch.shape = body.shape;
    }
    // Geometry fields are set together so a shape change lands its geometry
    // in the same write and we never persist a half-updated row.
    if ('centerLat' in body) patch.centerLat = body.centerLat ?? null;
    if ('centerLng' in body) patch.centerLng = body.centerLng ?? null;
    if ('radiusM'   in body) patch.radiusM   = body.radiusM ?? null;
    if ('polygon'   in body) patch.polygon   = body.polygon ?? null;

    const row = await prisma.place.update({ where: { id }, data: patch });
    return NextResponse.json(row);
  } catch (e) {
    console.error('[places.PATCH]', e);
    return bad('Failed to update place', 500);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return bad('Not authenticated', 401);
  const { id } = await ctx.params;
  const existing = await loadOwned(id, tenantId);
  if (!existing) return bad('Not found', 404);

  try {
    await prisma.place.update({ where: { id }, data: { deletedAt: new Date() } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[places.DELETE]', e);
    return bad('Failed to delete place', 500);
  }
}
