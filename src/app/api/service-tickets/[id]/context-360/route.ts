export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { fetchTicketContext360 } from '@/lib/service-tickets/context-360-engine';

export const runtime = 'nodejs';

/**
 * GET /api/service-tickets/[id]/context-360
 * Returns aggregated 360 context (Vehicle, Driver, Lease Contract, 90-Day History, Lemon Risk)
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
      const data = await fetchTicketContext360(ticketId, tenantId);
      if (!data) {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
      }

      return NextResponse.json({
        ok: true,
        context360: data,
      });
    } catch (err) {
      console.error(`GET /api/service-tickets/${ticketId}/context-360 error:`, err);
      return NextResponse.json(
        { error: 'Failed to fetch 360 context' },
        { status: 500 }
      );
    }
  });
}
