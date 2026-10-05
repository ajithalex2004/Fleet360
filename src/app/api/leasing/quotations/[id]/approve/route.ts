export const dynamic = 'force-dynamic';

/**
 * POST /api/leasing/quotations/[id]/approve
 *
 * Approves (or rejects) a LeaseQuotation. Tenant scoping: the quotation and
 * its pending approval step must belong to the caller's tenant; updates are
 * refused otherwise.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { appUrl, sendTemplatedEmail } from '@/lib/email-templates';
import { sendQuotationEmail, type QuotationForEmail } from '@/lib/leasing/quotation-email';
import { staffRecipients } from '@/lib/leasing/staff-recipients';
import { parseEmailList } from '@/lib/workflow-db';
import { sessionUser } from '@/lib/session-user';
import { approvalGate, withApprovalStart } from '@/lib/workflow/approvals';
import { quotationApprovalStage } from '@/lib/workflow/subjects';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const bodyRaw = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(bodyRaw);
    const { action = 'APPROVE', approverName, comments, targetStatus: requestedTarget, recipientEmail: customRecipient } = body;
    // action: 'APPROVE' | 'REJECT'

    // While the company's workflow for the quotation's approval stage
    // (Admin > Workflows: Quotation / Credit Approval, PO Request) decides
    // it, approve / reject go to the level that is waiting; the quotation
    // moves on when the last level approves, or is rejected.
    const gated = await approvalGate({
      headers: req.headers, tenantId, referenceType: 'LEASE_QUOTATION', referenceId: params.id,
      action: action === 'REJECT' ? 'REJECT' : 'APPROVE', comments: typeof comments === 'string' ? comments : '',
    });
    if (gated) return gated;

    const { updated, quotation, nextStatus } = await withTenantRls(prisma, tenantId, async (tx) => {
      const quotation = await tx.leaseQuotation.findFirst({
        where: { id: params.id, tenantId, deletedAt: null },
        include: { lessee: true, vehicles: true, lineItems: true },
      });
      if (!quotation) {
        throw Object.assign(new Error('Quotation not found'), { status: 404 });
      }

      // Find the pending approval step for this quotation — scoped by tenant.
      const pendingStep = await tx.leaseApprovalStep.findFirst({
        where: {
          entityId: params.id,
          entityType: 'QUOTATION',
          status: 'PENDING',
          tenantId,
        },
        orderBy: { stepOrder: 'asc' },
      });

      if (pendingStep) {
        await tx.leaseApprovalStep.update({
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
            DRAFT:                   'APPROVED',
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

      const updated = await tx.leaseQuotation.update({
        where: { id: params.id },
        data: { status: nextStatus, updatedAt: new Date() },
      });

      if (nextStatus === 'SENT_TO_CUSTOMER' && quotation.inquiryId) {
        await tx.leaseInquiry.updateMany({
          where: { id: quotation.inquiryId, tenantId },
          data: { status: 'QUOTATION_SENT' },
        }).catch((err) => console.error('Failed to sync Inquiry status:', err));
      }

      return { updated, quotation, nextStatus };
    });

    // ── Side Effects & Notifications ──
    // Through the tenant's email templates (Admin > Email templates) and the
    // platform email sender; best-effort, never failing the status change.
    // These used to go to made-up @fleet360.app team addresses and, with no
    // lessee email, to customer@example.com, through a sender that read
    // settings no screen fills in.
    const quotationNo = quotation.quotationNumber ?? '(unnumbered)';
    const lesseeName  = quotation.lessee?.name ?? '';
    const currency    = quotation.currency ?? 'AED';
    const monthlyRate = `${currency} ${Number(quotation.totalMonthlyRate ?? 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    // An explicit recipient list from the approver, else the lessee's email.
    const customerTo = customRecipient
      ? parseEmailList(String(customRecipient))
      : parseEmailList(quotation.lessee?.email ?? '');
    const reviewUrl = appUrl('/leasing/quotations');

    try {
      if (nextStatus === 'PENDING_APPROVAL') {
        const to = await staffRecipients(tenantId, 'LEASING_MANAGER');
        if (to.length) {
          await sendTemplatedEmail({
            tenantId, key: 'leasing.quotation_internal_approval', to,
            values: { quotationNumber: quotationNo, lesseeName, monthlyRate, reviewUrl },
          });
        }
      }

      if (nextStatus === 'SENT_TO_CUSTOMER' && customerTo.length) {
        await sendQuotationEmail({
          tenantId, quotation: quotation as unknown as QuotationForEmail,
          to: customerTo, sender: await sessionUser(req.headers),
        });
      }

      if (nextStatus === 'PENDING_CREDIT_APPROVAL') {
        const to = await staffRecipients(tenantId, 'FINANCE_MANAGER');
        if (to.length) {
          await sendTemplatedEmail({
            tenantId, key: 'leasing.quotation_credit_review', to,
            values: { quotationNumber: quotationNo, lesseeName, reviewUrl },
          });
        }
      }

      if (nextStatus === 'DELIVERED' && customerTo.length) {
        await sendTemplatedEmail({
          tenantId, key: 'leasing.vehicle_handover', to: customerTo,
          values: { lesseeName, quotationNumber: quotationNo, portalUrl: appUrl('/leasing-portal') },
        });
      }
    } catch (emailErr) {
      console.error('Quotation notification failed:', emailErr instanceof Error ? emailErr.message : emailErr);
    }

    // Entering an approval stage: the company's workflow for it, if any, starts.
    const response = NextResponse.json(updated);
    return quotationApprovalStage(nextStatus)
      ? withApprovalStart(response, { headers: req.headers, tenantId, referenceType: 'LEASE_QUOTATION', referenceId: params.id })
      : response;
  } catch (e: any) {
    console.error(e);
    const status = e?.status || 500;
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status });
  }
}
