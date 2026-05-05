/**
 * GET  /api/leasing/inquiries/[id]/activities — full activity log for an inquiry
 * POST /api/leasing/inquiries/[id]/activities — append a new activity entry
 *   Body: { activityType, subject?, body?, outcome?, followUpAt?, performedAt?, performedByName? }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const ALLOWED_TYPES = ['NOTE', 'CALL', 'EMAIL', 'MEETING', 'SMS', 'WHATSAPP', 'FOLLOW_UP_DUE'];

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const activities = await prisma.leaseInquiryActivity.findMany({
    where: { inquiryId: params.id },
    orderBy: { performedAt: 'desc' },
  });
  return NextResponse.json(activities);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const activityType = String(body.activityType ?? '').toUpperCase();
    if (!ALLOWED_TYPES.includes(activityType)) {
      return NextResponse.json({ error: `activityType must be one of: ${ALLOWED_TYPES.join(', ')}` }, { status: 400 });
    }

    const inquiry = await prisma.leaseInquiry.findUnique({
      where: { id: params.id },
      select: { id: true, deletedAt: true, status: true },
    });
    if (!inquiry || inquiry.deletedAt) {
      return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 });
    }

    const activity = await prisma.leaseInquiryActivity.create({
      data: {
        inquiryId: params.id,
        activityType,
        subject: body.subject ?? null,
        body: body.body ?? null,
        outcome: body.outcome ?? null,
        performedAt: body.performedAt ? new Date(body.performedAt) : new Date(),
        performedById: req.headers.get('x-user-id') ?? null,
        performedByName: body.performedByName ?? null,
        followUpAt: body.followUpAt ? new Date(body.followUpAt) : null,
      },
    });

    // Auto-bump pipeline status NEW → CONTACTED on first outbound contact.
    if (inquiry.status === 'NEW' && ['CALL', 'EMAIL', 'SMS', 'WHATSAPP', 'MEETING'].includes(activityType)) {
      await prisma.leaseInquiry.update({
        where: { id: params.id },
        data: { status: 'CONTACTED' },
      });
    }

    void logAudit({
      tenantId: req.headers.get('x-tenant-id') ?? undefined,
      userId: req.headers.get('x-user-id') ?? 'system',
      userRole: req.headers.get('x-user-role') ?? 'STAFF',
      entityType: 'LeaseInquiry',
      entityId: params.id,
      action: 'UPDATE',
      details: `Activity logged: ${activityType}${activity.outcome ? ` (${activity.outcome})` : ''}${activity.followUpAt ? ` — follow-up ${activity.followUpAt.toISOString().slice(0,10)}` : ''}`,
    });

    return NextResponse.json(activity, { status: 201 });
  } catch (err) {
    captureException(err, { context: 'leasing.inquiries.activities.create', tags: { inquiryId: params.id } });
    return NextResponse.json({ error: 'Failed to log activity' }, { status: 500 });
  }
}
