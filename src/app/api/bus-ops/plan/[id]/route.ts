/**
 * GET /api/bus-ops/plan/[id]
 * Get a single plan by id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireBusOpsAdminAccess } from '@/lib/bus-ops/require-admin-access';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id') ?? '';
  if (!tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 400 });
  }
  const permError = requireBusOpsAdminAccess(req, 'planning-core');
  if (permError) return permError;
  try {
    const { id } = await params;
    const plan = await withTenantRls(prisma, tenantId, async (tx) => {
      return tx.staffTransportPlan.findUnique({ where: { id } });
    });
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    return NextResponse.json({
      ...plan,
      dateFrom: plan.dateFrom.toISOString().slice(0, 10),
      dateTo:   plan.dateTo.toISOString().slice(0, 10),
      createdAt: plan.createdAt?.toISOString() ?? null,
      updatedAt: plan.updatedAt?.toISOString() ?? null,
      appliedAt: plan.appliedAt?.toISOString() ?? null,
    }, {
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=120' },
    });
  } catch (e) {
    console.error('[plan get]', e);
    return NextResponse.json({ error: 'Failed to fetch plan' }, { status: 500 });
  }
}
