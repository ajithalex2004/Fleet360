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

    // Side Effects & Notifications
    const amountStr = `${quotation.currency} ${Number(quotation.totalMonthlyRate ?? 0).toLocaleString()}`;
    const customerEmail = customRecipient || (quotation as any).lessee?.email || 'customer@example.com'; 
    
    if (nextStatus === 'PENDING_APPROVAL') {
      const template = generateInternalApprovalEmail(quotation.quotationNumber, quotation.lesseeName, amountStr);
      await sendEmail({
        to: [{ email: 'approvals@xl-mobility.ai', name: 'Internal Approvers' }],
        ...template
      });
    }

    if (nextStatus === 'SENT_TO_CUSTOMER') {
      // Fetch full details for the enterprise-grade template
      const fullQuotation = await prisma.leaseQuotation.findUnique({
        where: { id: params.id },
        include: { vehicles: true, lineItems: true }
      });

      if (fullQuotation) {
        const html = quotationEmailHtml({
          quotationNumber: fullQuotation.quotationNumber,
          lesseeName: fullQuotation.lesseeName,
          leaseType: fullQuotation.leaseType as any,
          durationMonths: fullQuotation.durationMonths ?? undefined,
          startDate: fullQuotation.startDate?.toISOString(),
          endDate: fullQuotation.endDate?.toISOString(),
          validUntil: fullQuotation.validUntil?.toISOString(),
          currency: fullQuotation.currency,
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
          ? customRecipient.split(/[,;]/).map(email => ({ email: email.trim(), name: fullQuotation.lesseeName }))
          : [{ email: (fullQuotation.lessee as any)?.email || 'customer@example.com', name: fullQuotation.lesseeName }];

        await sendEmail({
          to: toRecipients,
          subject: `Lease Quotation from XL AI Smart Mobility - ${fullQuotation.quotationNumber}`,
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
      const template = generateCreditReviewEmail(quotation.quotationNumber, quotation.lesseeName);
      await sendEmail({
        to: [{ email: 'credit@xl-mobility.ai', name: 'Credit Team' }],
        ...template
      });
    }

    if (nextStatus === 'DELIVERED') {
      const template = generateHandoverEmail(quotation.quotationNumber, quotation.lesseeName);
      const toRecipients = customRecipient 
          ? customRecipient.split(/[,;]/).map(email => ({ email: email.trim(), name: quotation.lesseeName }))
          : [{ email: (quotation as any).lessee?.email || 'customer@example.com', name: quotation.lesseeName }];

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
