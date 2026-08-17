/**
 * GET /api/bus-ops/route-consolidations
 *
 * Lists RouteConsolidation rows for the tenant — the read side needed
 * by the Route Consolidation History UI (PR 3). Sorted by appliedAt
 * desc (most recent first).
 *
 * Query params (optional):
 *   status: 'APPLIED' | 'REVERTED'      filter by lifecycle state
 *   limit:  number (default 50, max 200)
 *
 * Response 200:
 *   { items: RouteConsolidationRow[] }
 *
 * Each row includes source route names + merged route name so the
 * history table can render without a second round-trip.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const ALLOWED_STATUS = new Set(['APPLIED', 'REVERTED']);

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const status = sp.get('status');
  const limitRaw = sp.get('limit');
  const limit = clampInt(limitRaw, 50, 1, 200);
  if (status && !ALLOWED_STATUS.has(status)) {
    return NextResponse.json({ error: `status must be one of ${[...ALLOWED_STATUS].join('|')}` }, { status: 400 });
  }

  try {
    const rows = await prisma.routeConsolidation.findMany({
      where: {
        tenantId,
        ...(status ? { status } : {}),
      },
      orderBy: { appliedAt: 'desc' },
      take: limit,
      include: {
        sources: {
          select: { sourceRouteId: true, sequence: true },
          orderBy: { sequence: 'asc' },
        },
      },
    });

    // Resolve merged + source route names in a single batch — the
    // history view shows names, not ids.
    const routeIds = new Set<string>();
    for (const r of rows) {
      if (r.mergedRouteId) routeIds.add(r.mergedRouteId);
      for (const s of r.sources) routeIds.add(s.sourceRouteId);
    }
    const routeNames = routeIds.size === 0
      ? []
      : await prisma.busRoute.findMany({
          where: { id: { in: [...routeIds] }, tenantId },
          select: { id: true, name: true, isActive: true, retiredReason: true },
        });
    const nameById = new Map(routeNames.map((r) => [r.id, r]));

    const items = rows.map((r) => ({
      id: r.id,
      status: r.status,
      recommendationId: r.recommendationId,
      appliedAt: r.appliedAt,
      appliedBy: r.appliedBy,
      revertedAt: r.revertedAt,
      revertedBy: r.revertedBy,
      revertReason: r.revertReason,
      mergedRoute: r.mergedRouteId
        ? { id: r.mergedRouteId, name: nameById.get(r.mergedRouteId)?.name ?? null, retiredReason: nameById.get(r.mergedRouteId)?.retiredReason ?? null }
        : null,
      sources: r.sources.map((s) => ({
        id: s.sourceRouteId,
        name: nameById.get(s.sourceRouteId)?.name ?? null,
        sequence: s.sequence,
      })),
    }));

    return NextResponse.json({ items });
  } catch (e) {
    console.error('[route-consolidations.list]', e);
    return NextResponse.json({ error: 'List failed' }, { status: 500 });
  }
}

function clampInt(raw: string | null, def: number, min: number, max: number): number {
  if (!raw) return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}
