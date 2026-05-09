/**
 * POST /api/leasing/inquiries/[id]/activities/[activityId]/done
 *
 * Mark a follow-up as done. Refuses if the activity has no follow-up scheduled
 * or it's already marked done.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; activityId: string } },
) {
  const a = await prisma.leaseInquiryActivity.findUnique({ where: { id: params.activityId } });
  if (!a || a.inquiryId !== params.id) {
    return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
  }
  if (!a.followUpAt) {
    return NextResponse.json({ error: 'No follow-up scheduled on this activity' }, { status: 400 });
  }
  if (a.followUpDone) {
    return NextResponse.json({ error: 'Follow-up already marked done' }, { status: 409 });
  }

  const updated = await prisma.leaseInquiryActivity.update({
    where: { id: params.activityId },
    data: { followUpDone: true },
  });

  void logAudit({
    tenantId: req.headers.get('x-tenant-id') ?? undefined,
    userId: req.headers.get('x-user-id') ?? 'system',
    userRole: req.headers.get('x-user-role') ?? 'STAFF',
    entityType: 'LeaseInquiry',
    entityId: params.id,
    action: 'UPDATE',
    details: `Follow-up marked done on activity ${a.activityType} (${a.subject ?? '—'})`,
  });

  return NextResponse.json(updated);
}
