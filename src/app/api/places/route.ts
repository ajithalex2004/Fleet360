/**
 * /api/places — shared geospatial CRUD.
 *
 * List + create Places from the shared `spatial.places` table. Every module
 * reads/writes through this route instead of maintaining its own geofence
 * store. Tenant scoping via the x-tenant-id header set by middleware —
 * mirrored on write (stamped from session, never from body).
 *
 * Query params (GET):
 *   type          — filter by PlaceType (repeatable, or comma-separated)
 *   sourceModule  — filter by owning module ('bus-ops', 'logistics', ...)
 *   q             — case-insensitive name/code search
 *   active        — 'true' | 'false' (defaults to any)
 *
 * Body (POST): { name, type, shape, centerLat?, centerLng?, radiusM?,
 *   polygon?, code?, description?, address?, metadata?, sourceModule?,
 *   sourceId?, active? }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isPlaceShape, isPlaceType } from '@/lib/places/types';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const runtime = 'nodejs';

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz; } : {}),
        ...(sourceModule ? { sourceModule } : {}),
        ...(activeParam === 'true'  ? { active: true }  : {}),
        ...(activeParam === 'false' ? { active: false } : {}),
        ...(q ? { OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { code: { contains: q, mode: 'insensitive' } },
        ] } : {}),
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
    return NextResponse.json(rows, { headers: { 'Cache-Control': 'private, max-age=30' } });
  } catch (e) {
    console.error('[places.GET]', e);
    return bad('Failed to load places', 500);
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;
    if (body.shape === 'POLYGON') {
      if (!Array.isArray(body.polygon) || body.polygon.length < 3) return bad('POLYGON requires at least 3 vertices');
    }
    if (body.shape === 'POINT') {
      if (typeof body.centerLat !== 'number' || typeof body.centerLng !== 'number') return bad('POINT requires numeric centerLat/centerLng');
    }

    const row = await prisma.place.create({
      data: {
        tenantId,
        name:         body.name.trim(),
        code:         body.code?.trim() || null,
        type:         body.type,
        shape:        body.shape,
        description:  body.description?.trim() || null,
        address:      body.address?.trim() || null,
        centerLat:    body.centerLat ?? null,
        centerLng:    body.centerLng ?? null,
        radiusM:      body.radiusM ?? null,
        polygon:      body.polygon ?? null,
        metadata:     body.metadata ?? null,
        sourceModule: body.sourceModule ?? null,
        sourceId:     body.sourceId ?? null,
        active:       body.active ?? true,
        createdBy,
      },
    });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    console.error('[places.POST]', e);
    return bad('Failed to create place', 500);
  }
}
