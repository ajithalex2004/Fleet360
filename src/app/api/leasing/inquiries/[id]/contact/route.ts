/**
 * POST /api/leasing/inquiries/[id]/contact
 *
 * Sales rep triggers an outbound message to the customer (WhatsApp or email).
 * Auto-creates a LeaseInquiryActivity entry of type CALL/EMAIL/SMS/WHATSAPP
 * so the timeline shows the contact happened.
 *
 * Tenant scoping: requires x-tenant-id. The inquiry must belong to the
 * caller's tenant; the new LeaseInquiryActivity row is stamped with the
 * same tenantId.
 *
 * Body:
 *   {
 *     channel: 'WHATSAPP' | 'EMAIL',
 *     subject?: string,             // email only
 *     body: string,
 *     followUpAt?: ISO,             // optional next follow-up to schedule
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { sendEmail } from '@/lib/email';
import { sendWhatsApp } from '@/lib/whatsapp';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const body = await req.json();
    const channel = String(body?.channel ?? '').toUpperCase();
    const message = String(body?.body ?? '').trim();
    const subject = body?.subject ? String(body.subject).trim() : null;

    if (!['WHATSAPP', 'EMAIL'].includes(channel)) {
      return NextResponse.json({ error: 'channel must be WHATSAPP or EMAIL' }, { status: 400 });
    }
    if (!message) {
      return NextResponse.json({ error: 'body is required' }, { status: 400 });
    }

    const inquiry = await prisma.leaseInquiry.findFirst({
      where: { id: params.id, tenantId },
    });
    if (!inquiry || inquiry.deletedAt) {
      return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 });
    }

    let sendResult: { sent: boolean; reason?: string; error?: string };
    if (channel === 'WHATSAPP') {
      if (!inquiry.customerPhone) {
        return NextResponse.json({ error: 'Inquiry has no customerPhone' }, { status: 400 });
      }
      sendResult = await sendWhatsApp({ to: inquiry.customerPhone, body: message });
    } else {
      if (!inquiry.customerEmail) {
        return NextResponse.json({ error: 'Inquiry has no customerEmail' }, { status: 400 });
      }
      sendResult = await sendEmail({
        to: inquiry.customerEmail,
        subject: subject ?? 'Following up on your enquiry',
        text: message,
      });
    }

    if (!sendResult.sent) {
      return NextResponse.json({
        ok: false,
        sent: false,
        reason: sendResult.reason,
        error: sendResult.error,
      }, { status: sendResult.reason === 'not_configured' ? 503 : 502 });
    }

    // Append a timeline entry — outbound contact is part of the audit trail.
    const activity = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseInquiryActivity.create({
      data: {
        inquiryId: params.id,
        activityType: channel === 'WHATSAPP' ? 'WHATSAPP' : 'EMAIL',
        subject,
        body: message,
        outcome: 'SENT',
        performedAt: new Date(),
        performedById: req.headers.get('x-user-id') ?? null,
        performedByName: req.headers.get('x-user-name') ?? null,
        followUpAt: body?.followUpAt ? new Date(body.followUpAt) : null,
        tenantId,
      },
    }),
    );

    // Auto-bump status NEW → CONTACTED on first outbound contact.
    if (inquiry.status === 'NEW') {
      await withTenantRls(prisma, tenantId, async (tx) =>
        tx.leaseInquiry.update({
        where: { id: params.id },
        data: { status: 'CONTACTED' },
      }),
      );
    }

    void logAudit({
      tenantId,
      userId: req.headers.get('x-user-id') ?? 'system',
      userRole: req.headers.get('x-user-role') ?? 'STAFF',
      entityType: 'LeaseInquiry',
      entityId: params.id,
      action: 'UPDATE',
      details: `Outbound ${channel} sent to ${channel === 'WHATSAPP' ? inquiry.customerPhone : inquiry.customerEmail}.${activity.followUpAt ? ` Follow-up scheduled ${activity.followUpAt.toISOString().slice(0, 10)}.` : ''}`,
    });

    return NextResponse.json({ ok: true, sent: true, activityId: activity.id });
  } catch (err) {
    captureException(err, { context: 'leasing.inquiries.contact', tags: { inquiryId: params.id } });
    return NextResponse.json({ error: 'Send failed' }, { status: 500 });
  }
}
