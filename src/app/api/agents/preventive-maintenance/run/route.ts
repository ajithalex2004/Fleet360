export const dynamic = 'force-dynamic';

/**
 * POST /api/agents/preventive-maintenance/run
 * --------------------------------------------
 * Triggers a continuous burn-down and smart slot scan across fleet vehicles.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { PREVENTIVE_MAINTENANCE_AGENT } from '@/lib/agents/preventive-maintenance/agent';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async () => {
    try {
      const body = await req.json().catch(() => ({}));
      const vehicleId = body.vehicleId;

      const result = await PREVENTIVE_MAINTENANCE_AGENT.run({
        event_id: crypto.randomUUID(),
        event_type: 'manual.trigger',
        tenant_id: tenantId,
        entity_id: vehicleId,
        timestamp: new Date().toISOString(),
      });

      return NextResponse.json({
        success: true,
        result,
      });
    } catch (err: any) {
      console.error('[PM-Agent Run API] Error:', err);
      return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
  });
}
