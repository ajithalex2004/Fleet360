export const dynamic = 'force-dynamic';

/**
 * POST /api/leasing/quotations/[id]/submit
 *
 * Marks a LeaseQuotation as SENT_TO_CUSTOMER and (best-effort) emails the
 * lessee through the platform email sender (src/lib/email.ts: SMTP under
 * Admin > Settings > Notifications, or SendGrid), worded by the tenant's
 * "Lease quotation" email template (Admin > Email templates, English or
 * Arabic). Replies go to the user who sent it. Tenant scoping: the quotation must belong to the caller's tenant.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { sessionUser } from '@/lib/session-user';
import { sendQuotationEmail, type QuotationForEmail } from '@/lib/leasing/quotation-email';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}


export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    // 1. Fetch full quotation with lessee (tenant-scoped).
    const quotation = await prisma.leaseQuotation.findFirst({
      where: { id: params.id, tenantId },
      include: {
        lessee:   true,
        vehicles: true,
        lineItems: true,
      },
    });
    if (!quotation) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });

    const bodyRaw = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(bodyRaw);
    const recipientEmail = body.recipientEmail
      || (quotation.lessee as any)?.email
      || null;

    // 2. Update status to SENT_TO_CUSTOMER (tenant-scoped via updateMany so
    //    we refuse to flip a row that doesn't belong to this tenant).
    const upd = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseQuotation.updateMany({
      where: { id: params.id, tenantId },
      data:  { status: 'SENT_TO_CUSTOMER', updatedAt: new Date() },
    }),
    );
    if (upd.count === 0) {
      return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    }

    // 3. Email the lessee, best-effort. This used to read an EMAIL row of
    //    "IntegrationConfig", which no admin screen creates, so quotations
    //    were never actually emailed.
    let emailResult: { sent: boolean; message: string; recipient?: string } = {
      sent: false,
      message: 'No customer email address. Quotation status updated to SENT_TO_CUSTOMER.',
    };

    if (recipientEmail) {
      try {
        const sent = await sendQuotationEmail({
          tenantId,
          quotation: quotation as unknown as QuotationForEmail,
          to: recipientEmail,
          sender: await sessionUser(req.headers),
        });

        emailResult = sent.sent
          ? { sent: true, message: `Quotation emailed successfully to ${recipientEmail}`, recipient: recipientEmail }
          : {
              sent: false,
              message: sent.reason === 'smtp_not_configured' || sent.reason === 'not_configured'
                ? 'Email is not set up. Configure SMTP in Admin > Settings > Notifications. Quotation status updated.'
                : `Quotation status updated but email failed: ${sent.error ?? sent.reason ?? 'send error'}`,
            };
      } catch (e) {
        console.error('Email send error:', e);
        emailResult = {
          sent:    false,
          message: `Quotation status updated but email failed: ${e instanceof Error ? e.message : 'SMTP error'}`,
        };
      }
    }

    return NextResponse.json({
      success:       true,
      quotationId:   params.id,
      status:        'SENT_TO_CUSTOMER',
      email:         emailResult,
    });
    } catch (e) {
    console.error('Submit quotation error:', e);
    return NextResponse.json({ error: errorMessage(e, 'Failed to submit quotation') }, { status: 500 });
  }
}
