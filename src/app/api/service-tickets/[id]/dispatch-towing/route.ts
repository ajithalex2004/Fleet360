export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { dispatchTowingVendor } from '@/lib/service-tickets/towing-recovery-engine';

export const runtime = 'nodejs';

/**
 * POST /api/service-tickets/[id]/dispatch-towing
 * Executes 1-Click Towing Dispatch to the selected approved recovery vendor
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

      const { vendorId, vendorName, breakdownNotes } = body;
      if (!vendorId || !vendorName) {
        return NextResponse.json(
          { error: 'vendorId and vendorName are required' },
          { status: 400 }
        );
      }

      const result = await dispatchTowingVendor({
        ticketId,
        tenantId,
        vendorId,
        vendorName,
        actorEmail: userId || 'Fleet Dispatcher',
        breakdownNotes,
      });

      return NextResponse.json({ ok: true, result });
    } catch (err) {
      console.error(`POST /api/service-tickets/${ticketId}/dispatch-towing error:`, err);
      return NextResponse.json(
        { error: 'Failed to dispatch towing recovery' },
        { status: 500 }
      );
    }
  });
}
