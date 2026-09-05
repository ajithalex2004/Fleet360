export const dynamic = 'force-dynamic';

/**
 * /api/agents/policy
 * ------------------
 * GET: Returns AI governance policy, autonomy limits, and budget thresholds for the tenant.
 * PUT: Updates tenant AI governance policy or resets the circuit breaker.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { policyService } from '@/lib/agents/governance';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    return await withTenantRls(prisma, tenantId, async () => {
      const policy = await policyService.getTenantPolicy(tenantId);
      return NextResponse.json({ ok: true, data: policy });
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Failed to retrieve tenant policy' },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const updates = await req.json();

    return await withTenantRls(prisma, tenantId, async () => {
      const updatedPolicy = await policyService.updateTenantPolicy(tenantId, updates);
      return NextResponse.json({
        ok: true,
        message: 'Tenant AI policy updated successfully',
        data: updatedPolicy,
      });
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Failed to update tenant policy' },
      { status: 500 },
    );
  }
}
