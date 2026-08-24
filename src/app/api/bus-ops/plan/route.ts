/**
 * GET /api/bus-ops/plan            — list plans for the current tenant
 * GET /api/bus-ops/plan/[id]       — get one plan (in [id]/route.ts)
 * POST /api/bus-ops/plan/[id]/apply — write runs→drivers and blocks→vehicles
 *                                   back to trip_schedules (in [id]/apply/route.ts)
 * DELETE /api/bus-ops/plan/[id]   — archive a plan
 *
 * List endpoint here; the others live alongside under [id]/.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { cacheRead, publicCacheControl, revalidateCache } from '@/lib/server-cache';
import { requireBusOpsAdminAccess } from '@/lib/bus-ops/require-admin-access';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
const CACHE_TAG = 'staff-transport-plans';

interface PlanRow {
  id: string;
  name: string;
  description: string | null;
  dateFrom: Date;
  dateTo: Date;
  status: string | null;
  appliedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  summary: unknown;
}

const getPlanList = cacheRead(
  async (tenantId: string) => {
    return withTenantRls(prisma, tenantId, async (tx) => {
      const rows = await tx.staffTransportPlan.findMany({
        where: { tenantId },
        orderBy: [{ createdAt: 'desc' }],
        take: 50,
        select: {
          id: true, name: true, description: true,
          dateFrom: true, dateTo: true, status: true,
          appliedAt: true, createdAt: true, updatedAt: true, summary: true,
        },
      });
      return rows.map((r: PlanRow) => ({
        ...r,
        dateFrom: r.dateFrom.toISOString().slice(0, 10),
        dateTo:   r.dateTo.toISOString().slice(0, 10),
        createdAt: r.createdAt?.toISOString() ?? null,
        updatedAt: r.updatedAt?.toISOString() ?? null,
        appliedAt: r.appliedAt?.toISOString() ?? null,
      }));
    });
  },
  [CACHE_TAG],
  30,
);

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? '';
  if (!tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 400 });
  }
  const permError = requireBusOpsAdminAccess(req, 'planning-core');
  if (permError) return permError;
  try {
    const plans = await getPlanList(tenantId);
    return NextResponse.json(plans, {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
    });
  } catch (e) {
    console.error('[plan list]', e);
    return NextResponse.json({ error: 'Failed to list plans' }, { status: 500 });
  }
}

/**
 * POST /api/bus-ops/plan — save a precomputed plan.
 *
 * Body:
 *   {
 *     name: string,
 *     description?: string,
 *     dateFrom: 'YYYY-MM-DD',
 *     dateTo: 'YYYY-MM-DD',
 *     workRules: object,
 *     blockOptions: object,
 *     runs: any[],
 *     blocks: any[],
 *     rosters?: any[],
 *     summary: object,
 *   }
 *
 * The compute endpoint already supports `save: true` in the same call; this
 * separate POST exists for the what-if flow where the user tweaks the plan
 * client-side and persists the result without re-running the planner.
 */
export async function POST(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? '';
  if (!tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 400 });
  }
  const permError = requireBusOpsAdminAccess(req, 'planning-core');
  if (permError) return permError;
  try {
    const body = await req.json() as {
      name?: string;
      description?: string;
      dateFrom?: string;
      dateTo?: string;
      workRules?: unknown;
      blockOptions?: unknown;
      runs?: unknown;
      blocks?: unknown;
      rosters?: unknown;
      summary?: unknown;
    };
    if (!body.name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!body.dateFrom || !body.dateTo) {
      return NextResponse.json({ error: 'dateFrom and dateTo are required' }, { status: 400 });
    }
    const created = await withTenantRls(prisma, tenantId, (tx) =>
      tx.staffTransportPlan.create({
        data: {
          tenantId,
          name: body.name!,
          description: body.description ?? null,
          dateFrom: new Date(`${body.dateFrom!}T00:00:00Z`),
          dateTo:   new Date(`${body.dateTo!}T00:00:00Z`),
          workRules:    (body.workRules    ?? {}) as unknown as object,
          blockOptions: (body.blockOptions ?? {}) as unknown as object,
          runs:         (body.runs         ?? []) as unknown as object,
          blocks:       (body.blocks       ?? []) as unknown as object,
          rosters:      (body.rosters      ?? []) as unknown as object,
          summary:      (body.summary      ?? {}) as unknown as object,
          status: 'DRAFT',
        },
      })
    );
    revalidateCache([CACHE_TAG]);
    return NextResponse.json(
      {
        id: created.id,
        name: created.name,
        description: created.description,
        dateFrom: created.dateFrom.toISOString().slice(0, 10),
        dateTo:   created.dateTo.toISOString().slice(0, 10),
        status: created.status,
        createdAt: created.createdAt?.toISOString() ?? null,
      },
      { status: 201 },
    );
  } catch (e) {
    console.error('[plan save]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Save failed' },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? '';
  if (!tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 400 });
  }
  const permError = requireBusOpsAdminAccess(req, 'planning-core');
  if (permError) return permError;
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    await withTenantRls(prisma, tenantId, (tx) =>
      tx.staffTransportPlan.update({
        where: { id },
        data: { status: 'ARCHIVED' },
      })
    );
    revalidateCache([CACHE_TAG]);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[plan delete]', e);
    return NextResponse.json({ error: 'Failed to archive plan' }, { status: 500 });
  }
}
