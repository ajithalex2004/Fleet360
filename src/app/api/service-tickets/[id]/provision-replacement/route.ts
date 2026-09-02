export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { provisionReplacementVehicle } from '@/lib/service-tickets/towing-recovery-engine';

export const runtime = 'nodejs';

/**
 * POST /api/service-tickets/[id]/provision-replacement
 * Executes 1-Click Replacement Vehicle Provisioning from fleet pool
 */
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  const { id: ticketId } = params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId, userId } = authz;

  return withTenantRls(prisma, tenantId, async () => {
    try {
      const rawBody = await req.json();
      const body = stripTenantOwnershipFields(rawBody);

      const { replacementVehicleId } = body;
      if (!replacementVehicleId) {
        return NextResponse.json(
          { error: 'replacementVehicleId is required' },
          { status: 400 }
        );
      }

      const result = await provisionReplacementVehicle({
        ticketId,
        tenantId,
        replacementVehicleId,
        actorEmail: userId || 'Fleet Dispatcher',
      });

      return NextResponse.json({ ok: true, result });
    } catch (err) {
      console.error(`POST /api/service-tickets/${ticketId}/provision-replacement error:`, err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to provision replacement vehicle' },
        { status: 500 }
      );
    }
  });
}
