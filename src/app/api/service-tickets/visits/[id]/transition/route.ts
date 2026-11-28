export const dynamic = 'force-dynamic';

/**
 * POST /api/service-tickets/visits/[id]/transition
 * Field execution state machine endpoint (DISPATCHED -> EN_ROUTE -> ON_SITE -> IN_PROGRESS -> PAUSED/COMPLETED/INCOMPLETE)
 * Supports GPS geofenced check-in, override audit reason, live technician location sync,
 * automatic TRAVEL / WORK time logs, and offline idempotencyKey replay protection.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { WorkforceError } from '@/lib/service-tickets/workforce-db';
import { transitionWorkVisit } from '@/lib/service-tickets/dispatch-db';

export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function handlePOST(req: NextRequest, { params }: RouteParams) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId, userId } = authz;
  const platformRole = req.headers.get('x-user-role') || '';
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = stripTenantOwnershipFields(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const result = await transitionWorkVisit(tx, tenantId, id, userId ?? 'technician', body);
      if (!result.idempotentReplay) {
        void logAudit({
          tenantId,
          userId: userId ?? undefined,
          userRole: platformRole || undefined,
          entityType: 'FsmWorkVisit',
          entityId: result.visit.id,
          entityName: `${result.visit.ticketReadableId ?? result.visit.ticketId} Visit #${result.visit.visitNumber}`,
          action: 'UPDATE',
          details: `Transitioned visit to ${result.visit.status}${result.geofenceDistanceM !== null ? ` (${result.geofenceDistanceM}m)` : ''}`,
        });
      }
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.visits.transition', tags: { tenantId, id } });
      return NextResponse.json({ ok: false, error: 'Failed to update visit status.' }, { status: 500 });
    }
  });
}

export const POST = withAuditedAction(handlePOST);
