import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/services/email/emailService';
import { 
  generateInternalApprovalEmail, 
  generateCreditReviewEmail, 
  generateHandoverEmail 
} from '@/services/email/leasingTemplates';
import { quotationEmailHtml } from '@/lib/email-templates/quotation';
import { requireOperationalContext, requireOperationalPermission, recordOperationalChange } from '@/lib/cross-module-governance';
import { markLeasingRuntimeActionExecuted, requireLeasingRuntimeApproval } from '@/lib/leasing-runtime-approvals';
import { creditGateResponse, evaluateLeasingCreditGate } from '@/lib/leasing-credit-policy';
import { buildLesseeDisplayName } from '@/lib/leasing-lessee-display';

const CREDIT_GATED_QUOTATION_STATUSES = new Set([
  'CREDIT_APPROVED',
]);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = requireOperationalContext(req, 'leasing', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const permission = await requireOperationalPermission(ctx, [
      { module: 'leasing', action: 'approve', resource: 'quotations' },
      { module: 'leasing', action: 'edit', resource: 'quotations' },
    ], { message: 'You do not have access to approve Leasing quotations' });
    if (permission) return permission;

    const body = await req.json();
    const { action, approverName, comments, targetStatus: requestedTarget, recipientEmail: customRecipient } = body;
    // action: 'APPROVE' | 'REJECT'

    const quotation = await prisma.leaseQuotation.findFirst({
      where: { id: params.id, deletedAt: null },
      include: { lessee: true, inquiry: true }
    });
    if (!quotation) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const currentUser = await prisma.userTenant.findUnique({
      where: { userId_tenantId: { userId: ctx.userId, tenantId: ctx.tenantId } },
      include: { role: true, user: { select: { email: true, firstName: true, lastName: true } } },
    });
    const actorRole = currentUser?.role?.code ?? ctx.role;
    const resolvedActorName = [currentUser?.user?.firstName, currentUser?.user?.lastName].filter(Boolean).join(' ').trim();
    const actorName = approverName
      ?? (resolvedActorName || currentUser?.user?.email || 'Workflow Manager');

    // Find the pending approval step for this quotation
    const pendingStep = await prisma.leaseApprovalStep.findFirst({
      where: { entityId: params.id, entityType: 'QUOTATION', status: 'PENDING' },
      orderBy: { stepOrder: 'asc' },
    });

    if (pendingStep) {
      if (!ctx.isSuperAdmin && pendingStep.approverRole && pendingStep.approverRole !== actorRole) {
        return NextResponse.json({
          error: 'This approval step is assigned to a different approver role.',
          requiredRole: pendingStep.approverRole,
          actorRole,
        }, { status: 403 });
      }

      await prisma.leaseApprovalStep.update({
        where: { id: pendingStep.id },
        data: {
          status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          approverName: actorName || pendingStep.approverName,
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

    if (action === 'APPROVE' && CREDIT_GATED_QUOTATION_STATUSES.has(nextStatus)) {
      const proposedExposure = Number(quotation.totalContractValue ?? 0)
        || Number(quotation.totalMonthlyRate ?? 0) * Number(quotation.durationMonths ?? 1);
      const gate = await evaluateLeasingCreditGate({
        lesseeId: quotation.lesseeId,
        proposedExposure,
        currency: quotation.currency,
      });
      const blocked = creditGateResponse(gate);
      if (blocked) return blocked;

      const isCompletingExistingCreditApproval =
        quotation.status === 'PENDING_CREDIT_APPROVAL'
        && nextStatus === 'CREDIT_APPROVED'
        && pendingStep?.status === 'APPROVED';

      if (isCompletingExistingCreditApproval) {
        // Legacy approval-step rows do not store the runtime action id; the
        // quotation status transition below completes the user-facing action.
      } else {
        const approvalGate = await requireLeasingRuntimeApproval(req, ctx, {
          serviceTypeKey: 'LEASING_CREDIT_APPROVAL',
          entityType: 'QUOTATION',
          entityId: params.id,
          actionKey: 'credit_approval',
          referenceNumber: quotation.quotationNumber ?? params.id,
          amount: proposedExposure,
          currency: quotation.currency ?? 'AED',
          summary: `Approve credit gate for quotation ${quotation.quotationNumber ?? params.id}`,
          payload: {
            before: { status: quotation.status ?? 'NEW' },
            after: { status: nextStatus, totalContractValue: proposedExposure },
            quotationId: quotation.id,
            lesseeId: quotation.lesseeId,
          },
          quotationId: quotation.id,
        });
        if (!approvalGate.ok) return approvalGate.response;
        await markLeasingRuntimeActionExecuted(approvalGate.actionId);
      }
    }

    const updatedQuotation = await prisma.leaseQuotation.update({
      where: { id: params.id },
      data: { status: nextStatus, updatedAt: new Date() },
    });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'LeaseQuotation',
      entityId: quotation.id,
      action: 'STATUS_CHANGE',
      before: quotation,
      after: updatedQuotation,
      summary: `Updated quotation ${quotation.quotationNumber ?? quotation.id} to ${nextStatus}`,
      riskSeverity: nextStatus === 'CREDIT_APPROVED' ? 'medium' : 'low',
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
        include: { vehicles: true, lineItems: true, lessee: true, inquiry: true }
      });

      if (fullQuotation) {
        const fqLesseeName  = fullQuotation.lessee?.name ?? 'Customer';
        const fqLesseeEmail = fullQuotation.lessee?.email ?? 'customer@example.com';
        const fqQuotationNo = fullQuotation.quotationNumber ?? '(unnumbered)';

        const html = quotationEmailHtml({
          quotationNumber: fqQuotationNo,
          lesseeName: fqLesseeName,
          leaseType: fullQuotation.leaseType ?? 'LONG_TERM',
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

    const updated = await prisma.leaseQuotation.findUnique({
      where: { id: params.id },
      include: { vehicles: true, lineItems: true, lessee: true, inquiry: true },
    });
    if (!updated) {
      return NextResponse.json({ error: 'Quotation not found after update' }, { status: 404 });
    }

    return NextResponse.json({
      ...updated,
      lesseeName: buildLesseeDisplayName(updated),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
