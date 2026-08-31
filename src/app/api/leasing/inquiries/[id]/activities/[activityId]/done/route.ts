export const dynamic = 'force-dynamic';

/**
 * POST /api/leasing/inquiries/[id]/activities/[activityId]/done
 *
 * Mark a follow-up as done. Refuses if the activity has no follow-up scheduled
 * or it's already marked done.
 *
 * Tenant scoping: requires x-tenant-id. The activity must belong to the
 * caller's tenant (via inquiry ownership).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string; activityId: string }> },
) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const a = await prisma.leaseInquiryActivity.findFirst({
    where: { id: params.activityId, tenantId, inquiryId: params.id },
  });
  if (!a) {
    return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
  }
  if (!a.followUpAt) {
    return NextResponse.json({ error: 'No follow-up scheduled on this activity' }, { status: 400 });
  }
  if (a.followUpDone) {
    return NextResponse.json({ error: 'Follow-up already marked done' }, { status: 409 });
  }

  const updated = await withTenantRls(prisma, tenantId, async (tx) =>
    tx.leaseInquiryActivity.update({
    where: { id: params.activityId },
    data: { followUpDone: true },
  }),
  );

  void logAudit({
    tenantId,
    userId: req.headers.get('x-user-id') ?? 'system',
    userRole: req.headers.get('x-user-role') ?? 'STAFF',
    entityType: 'LeaseInquiry',
    entityId: params.id,
    action: 'UPDATE',
    details: `Follow-up marked done on activity ${a.activityType} (${a.subject ?? '—'})`,
  });

  return NextResponse.json(updated);
}
