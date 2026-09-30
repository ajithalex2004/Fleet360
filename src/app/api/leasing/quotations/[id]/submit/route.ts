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
import { sendEmail } from '@/lib/email';
import { sessionUser } from '@/lib/session-user';
import { quotationDetailsBlock } from '@/lib/email-templates/quotation';
import { renderEmail, tenantEmailContext } from '@/lib/email-templates';

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
        const [sender, context] = await Promise.all([sessionUser(req.headers), tenantEmailContext(tenantId)]);
        const q = quotation as typeof quotation & { lessee: { name?: string } | null; vehicles: Array<Record<string, unknown>> };
        const currency = quotation.currency ?? 'AED';
        const money = (n: unknown) => `${currency} ${Number(n ?? 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const details = {
          quotationNumber:    quotation.quotationNumber ?? params.id,
          lesseeName:         q.lessee?.name ?? '',
          leaseType:          quotation.leaseType ?? 'LONG_TERM',
          durationMonths:     quotation.durationMonths ?? undefined,
          startDate:          quotation.startDate?.toISOString(),
          endDate:            quotation.endDate?.toISOString(),
          validUntil:         quotation.validUntil?.toISOString(),
          currency,
          totalMonthlyRate:   Number(quotation.totalMonthlyRate ?? 0),
          totalContractValue: Number(quotation.totalContractValue ?? 0),
          securityDeposit:    Number(quotation.securityDeposit ?? 0),
          mileageCap:         quotation.mileageCap ?? undefined,
          insuranceIncluded:  quotation.insuranceIncluded ?? false,
          maintenanceIncluded: quotation.maintenanceIncluded ?? false,
          driverIncluded:     quotation.driverIncluded ?? false,
          vehicles:           q.vehicles.map(v => ({
            vehicleType: String(v.vehicleType ?? ''),
            make:        v.make ? String(v.make) : undefined,
            model:       v.model ? String(v.model) : undefined,
            year:        v.year ? Number(v.year) : undefined,
            quantity:    Number(v.quantity ?? 1),
            monthlyRate: Number(v.monthlyRate ?? 0),
          })),
          notes:        quotation.notes ?? undefined,
        };
        const email = await renderEmail({
          tenantId, key: 'leasing.quotation_sent', context,
          values: {
            lesseeName:         details.lesseeName,
            quotationNumber:    details.quotationNumber,
            validUntil:         quotation.validUntil
              ? quotation.validUntil.toLocaleDateString(context.locale === 'ar' ? 'ar-AE' : 'en-AE', { day: '2-digit', month: 'long', year: 'numeric' })
              : '-',
            totalMonthlyRate:   money(quotation.totalMonthlyRate),
            totalContractValue: money(quotation.totalContractValue),
            senderName:         sender?.name ?? '',
            senderEmail:        sender?.email ?? '',
          },
          blocks: { quotationDetails: quotationDetailsBlock(details, context.locale) },
        });

        const sent = await sendEmail({
          to:      recipientEmail,
          subject: email.subject,
          text:    email.text,
          html:    email.html,
          ...(sender?.email ? { replyTo: sender.email } : {}),
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
