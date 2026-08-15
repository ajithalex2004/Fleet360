/**
 * POST /api/bus-ops/route-consolidation/analyze
 *
 * Read-only ranking analysis over the tenant's active routes. Returns
 * consolidation recommendations sorted best-first, plus the reasons
 * pairs were skipped so operators can debug why an expected pair
 * didn't show up.
 *
 * Body (all optional):
 *   {
 *     routeIds?: string[],           // subset to analyse; defaults to all active
 *     objective?: {
 *       penaltyLambda?, costPerVehicleDay?, operatingDaysPerWeek?,
 *       fallbackKm?: { pickup?, dropoff? }
 *     }
 *   }
 *
 * Response 200:
 *   { objective, recommendations[], skipped[], totals }
 *
 * Nothing is written. Applying a recommendation is Phase 2 (needs
 * schema for merged-route lineage + enrollment migration write path).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { loadConsolidationFacts } from '@/lib/planning/route-consolidation-facts';
import { analyzeConsolidations, type ConsolidationObjective } from '@/lib/planning/route-consolidation';

export async function POST(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: unknown = {};
  try {
    // Body is optional — an empty POST is a valid "analyse everything".
    const text = await req.text();
    body = text.trim().length > 0 ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'body must be an object' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  let routeIds: string[] | undefined;
  if (b.routeIds !== undefined) {
    if (!Array.isArray(b.routeIds) || b.routeIds.some((v) => typeof v !== 'string')) {
      return NextResponse.json({ error: 'routeIds must be an array of strings' }, { status: 400 });
    }
    routeIds = b.routeIds as string[];
  }

  const objective = parseObjective(b.objective);
  if (typeof objective === 'string') {
    return NextResponse.json({ error: objective }, { status: 400 });
  }

  try {
    const facts = await loadConsolidationFacts(prisma, { tenantId, routeIds });
    const result = analyzeConsolidations(facts, objective);
    return NextResponse.json(result);
  } catch (e) {
    console.error('[route-consolidation.analyze]', e);
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 });
  }
}

function parseObjective(raw: unknown): ConsolidationObjective | string {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'objective must be an object';
  const o = raw as Record<string, unknown>;
  const out: ConsolidationObjective = {};

  for (const key of ['penaltyLambda', 'costPerVehicleDay', 'operatingDaysPerWeek'] as const) {
    if (o[key] === undefined) continue;
    if (typeof o[key] !== 'number' || !Number.isFinite(o[key])) {
      return `objective.${key} must be a finite number`;
    }
    out[key] = o[key] as number;
  }

  if (o.fallbackKm !== undefined) {
    if (typeof o.fallbackKm !== 'object' || Array.isArray(o.fallbackKm) || o.fallbackKm === null) {
      return 'objective.fallbackKm must be an object';
    }
    const f = o.fallbackKm as Record<string, unknown>;
    const fallback: NonNullable<ConsolidationObjective['fallbackKm']> = {};
    for (const key of ['pickup', 'dropoff'] as const) {
      if (f[key] === undefined) continue;
      if (typeof f[key] !== 'number' || !Number.isFinite(f[key])) {
        return `objective.fallbackKm.${key} must be a finite number`;
      }
      fallback[key] = f[key] as number;
    }
    out.fallbackKm = fallback;
  }

  return out;
}
