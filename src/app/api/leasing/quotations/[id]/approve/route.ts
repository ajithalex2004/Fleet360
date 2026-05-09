import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/services/email/emailService';
import { 
  generateInternalApprovalEmail, 
  generateCreditReviewEmail, 
  generateHandoverEmail 
} from '@/services/email/leasingTemplates';
import { quotationEmailHtml } from '@/lib/email-templates/quotation';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { action, approverName, comments, targetStatus: requestedTarget, recipientEmail: customRecipient } = body;
    // action: 'APPROVE' | 'REJECT'

    const quotation = await prisma.leaseQuotation.findFirst({
      where: { id: params.id, deletedAt: null },
      include: { lessee: true }
    });
    if (!quotation) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    // Find the pending approval step for this quotation
    const pendingStep = await prisma.leaseApprovalStep.findFirst({
      where: { entityId: params.id, entityType: 'QUOTATION', status: 'PENDING' },
      orderBy: { stepOrder: 'asc' },
    });

    if (pendingStep) {
      await prisma.leaseApprovalStep.update({
        where: { id: pendingStep.id },
        data: {
          status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          approverName: approverName ?? pendingStep.approverName,
          actionAt: new Date(),
          comments: comments ?? null,
        },
      });
    }

    // Determine next status
    let nextStatus = quotation.status ?? 'NEW';
    if (action === 'APPROVE') {
      if (requestedTarget) {
        nextStatus = requestedTarget;
      } else {
        const statusMap: Record<string, string> = {
          NEW:                     'PENDING_APPROVAL',
          PENDING_APPROVAL:        'DRAFT_APPROVED',
          DRAFT_APPROVED:          'SENT_TO_CUSTOMER',
          SENT_TO_CUSTOMER:        'CUSTOMER_APPROVED',
          CUSTOMER_APPROVED:       'PENDING_CREDIT_APPROVAL',
          PENDING_CREDIT_APPROVAL: 'CREDIT_APPROVED',
          CREDIT_APPROVED:         'PO_PREPARATION',
          PO_PREPARATION:          'PO_PREPARED',
          PO_PREPARED:             'DELIVERY_IN_PROGRESS',
          DELIVERY_IN_PROGRESS:    'DELIVERED',
        };
        nextStatus = statusMap[nextStatus] ?? nextStatus;
      }
    } else {
      nextStatus = 'REJECTED';
    }

    const updated = await prisma.leaseQuotation.update({
      where: { id: params.id },
      data: { status: nextStatus, updatedAt: new Date() },
    });

    // ── Side Effects & Notifications ──
    // Customer name is now a relation field; the schema dropped the
    // denormalized 'lesseeName' column. Read through the loaded lessee
    // relation with a sensible fallback for any orphan rows.
    const lesseeName    = quotation.lessee?.name ?? 'Customer';
    const lesseeEmail   = quotation.lessee?.email ?? 'customer@example.com';
    const quotationNo   = quotation.quotationNumber ?? '(unnumbered)';
    const currency      = quotation.currency ?? 'AED';
    const amountStr     = `${currency} ${Number(quotation.totalMonthlyRate ?? 0).toLocaleString()}`;
    const customerEmail = customRecipient || lesseeEmail;

    if (nextStatus === 'PENDING_APPROVAL') {
      const template = generateInternalApprovalEmail(quotationNo, lesseeName, amountStr);
      await sendEmail({
        to: [{ email: 'approvals@fleet360.app', name: 'Internal Approvers' }],
        ...template
      });
    }

    if (nextStatus === 'SENT_TO_CUSTOMER') {
      // Fetch full details for the enterprise-grade template. Include
      // lessee so we can read the customer name + email off the relation.
      const fullQuotation = await prisma.leaseQuotation.findUnique({
        where: { id: params.id },
        include: { vehicles: true, lineItems: true, lessee: true }
      });

      if (fullQuotation) {
        const fqLesseeName  = fullQuotation.lessee?.name ?? 'Customer';
        const fqLesseeEmail = fullQuotation.lessee?.email ?? 'customer@example.com';
        const fqQuotationNo = fullQuotation.quotationNumber ?? '(unnumbered)';

        const html = quotationEmailHtml({
          quotationNumber: fqQuotationNo,
          lesseeName: fqLesseeName,
          leaseType: fullQuotation.leaseType as any,
          durationMonths: fullQuotation.durationMonths ?? undefined,
          startDate: fullQuotation.startDate?.toISOString(),
          endDate: fullQuotation.endDate?.toISOString(),
          validUntil: fullQuotation.validUntil?.toISOString(),
          currency: fullQuotation.currency ?? undefined,
          totalMonthlyRate: Number(fullQuotation.totalMonthlyRate || 0),
          totalContractValue: Number(fullQuotation.totalContractValue || 0),
          securityDeposit: Number(fullQuotation.securityDeposit || 0),
          vehicles: fullQuotation.vehicles.map(v => ({
            vehicleType: v.vehicleType,
            make: v.make || '',
            model: v.model || '',
            year: v.year || undefined,
            quantity: Number(v.quantity || 1),
            monthlyRate: Number(v.monthlyRate || 0),
          })),
          notes: fullQuotation.notes || undefined
        });

        // Handle multiple recipients
        const toRecipients = customRecipient
          ? customRecipient.split(/[,;]/).map((email: string) => ({ email: email.trim(), name: fqLesseeName }))
          : [{ email: fqLesseeEmail, name: fqLesseeName }];

        await sendEmail({
          to: toRecipients,
          subject: `Lease Quotation from Fleet360 - ${fqQuotationNo}`,
          htmlBody: html
        });
      }

      // Update inquiry status
      if (quotation.inquiryId) {
        await prisma.leaseInquiry.update({
          where: { id: quotation.inquiryId },
          data: { status: 'QUOTATION_SENT' }
        }).catch(err => console.error('Failed to sync Inquiry status:', err));
      }
    }

    if (nextStatus === 'PENDING_CREDIT_APPROVAL') {
      const template = generateCreditReviewEmail(quotationNo, lesseeName);
      await sendEmail({
        to: [{ email: 'credit@fleet360.app', name: 'Credit Team' }],
        ...template
      });
    }

    if (nextStatus === 'DELIVERED') {
      const template = generateHandoverEmail(quotationNo, lesseeName);
      const toRecipients = customRecipient
          ? customRecipient.split(/[,;]/).map((email: string) => ({ email: email.trim(), name: lesseeName }))
          : [{ email: customerEmail, name: lesseeName }];

      await sendEmail({
        to: toRecipients,
        ...template
      });
    }

    return NextResponse.json(updated);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
