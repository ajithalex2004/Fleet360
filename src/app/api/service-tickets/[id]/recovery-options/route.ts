export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { getRecoveryAndReplacementOptions } from '@/lib/service-tickets/towing-recovery-engine';

export const runtime = 'nodejs';

/**
 * GET /api/service-tickets/[id]/recovery-options
 * Returns approved recovery vendors and available matching replacement vehicles
 */
export async function GET(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  const { id: ticketId } = params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async () => {
    try {
      const data = await getRecoveryAndReplacementOptions(ticketId, tenantId);
      if (!data) {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
      }

      return NextResponse.json({ ok: true, data });
    } catch (err) {
      console.error(`GET /api/service-tickets/${ticketId}/recovery-options error:`, err);
      return NextResponse.json(
        { error: 'Failed to fetch recovery options' },
        { status: 500 }
      );
    }
  });
}
