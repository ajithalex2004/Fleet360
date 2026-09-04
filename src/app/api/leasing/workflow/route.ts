export const dynamic = 'force-dynamic';

/**
 * GET /api/leasing/workflow — read-only dashboard aggregation for the
 * leasing Workflow Management page: pipeline stage counts, the live
 * LeaseApprovalStep queue (pending + history), sourced from the same
 * tables the quotation/contract approve flows already write to.
 *
 * Status vocabulary note: LeaseQuotation.status here follows what
 * /api/leasing/quotations/[id]/approve actually writes (NEW ->
 * PENDING_APPROVAL -> DRAFT_APPROVED -> SENT_TO_CUSTOMER -> ...), which
 * differs from an older doc-comment on the Prisma model — the route code
 * is ground truth, not the comment.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

function timeAgo(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const [inquiries, quotations, contracts, pendingSteps, historySteps] = await Promise.all([
        tx.leaseInquiry.count({ where: { tenantId, deletedAt: null, status: { in: ['NEW', 'CONTACTED', 'QUOTATION_SENT'] } } }),
        tx.leaseQuotation.findMany({ where: { tenantId, deletedAt: null }, select: { status: true } }),
        tx.leaseContract2.findMany({ where: { tenantId, deletedAt: null }, select: { status: true } }),
        tx.leaseApprovalStep.findMany({
          where: { tenantId, status: 'PENDING' },
          orderBy: { createdAt: 'asc' },
          take: 100,
        }),
        tx.leaseApprovalStep.findMany({
          where: { tenantId, status: { not: 'PENDING' } },
          orderBy: { actionAt: 'desc' },
          take: 50,
        }),
      ]);

      const qCount = (statuses: string[]) => quotations.filter(q => statuses.includes(q.status ?? '')).length;
      const cCount = (statuses: string[]) => contracts.filter(c => statuses.includes(c.status ?? '')).length;

      const workflowSteps = [
        { number: 1, label: 'Inquiry', count: inquiries },
        { number: 2, label: 'Quotation', count: qCount(['NEW']) },
        { number: 3, label: 'Internal Approval', count: qCount(['PENDING_APPROVAL', 'DRAFT_APPROVED']) },
        { number: 4, label: 'Sent to Customer', count: qCount(['SENT_TO_CUSTOMER']) },
        { number: 5, label: 'Customer Approval', count: qCount(['CUSTOMER_APPROVED']) },
        { number: 6, label: 'Credit Approval', count: qCount(['PENDING_CREDIT_APPROVAL']) },
        { number: 7, label: 'PO Prepared', count: qCount(['CREDIT_APPROVED', 'PO_PREPARATION', 'PO_PREPARED']) },
        { number: 8, label: 'Contract Generated', count: cCount(['DRAFT', 'PENDING_APPROVAL', 'APPROVED']) },
        { number: 9, label: 'Active', count: cCount(['ACTIVE']) },
      ];

      // Resolve entity numbers/requestor names for both queues in two
      // batched lookups rather than per-row queries.
      const allSteps = [...pendingSteps, ...historySteps];
      const quotationIds = allSteps.filter(s => s.entityType === 'QUOTATION').map(s => s.entityId);
      const contractIds = allSteps.filter(s => s.entityType === 'CONTRACT').map(s => s.entityId);

      const [quotationRows, contractRows] = await Promise.all([
        quotationIds.length
          ? tx.leaseQuotation.findMany({
              where: { id: { in: quotationIds }, tenantId },
              select: { id: true, quotationNumber: true, status: true, lessee: { select: { name: true } } },
            })
          : [],
        contractIds.length
          ? tx.leaseContract2.findMany({
              where: { id: { in: contractIds }, tenantId },
              select: { id: true, contractNumber: true, status: true, lessee: { select: { name: true } } },
            })
          : [],
      ]);
      const quotationById = new Map(quotationRows.map(q => [q.id, q]));
      const contractById = new Map(contractRows.map(c => [c.id, c]));

      const resolveEntity = (entityType: string, entityId: string) => {
        if (entityType === 'QUOTATION') {
          const q = quotationById.get(entityId);
          return { number: q?.quotationNumber ?? entityId, status: q?.status ?? 'Unknown', requestor: q?.lessee?.name ?? 'Unknown' };
        }
        const c = contractById.get(entityId);
        return { number: c?.contractNumber ?? entityId, status: c?.status ?? 'Unknown', requestor: c?.lessee?.name ?? 'Unknown' };
      };

      const pendingActions = pendingSteps.map(step => {
        const entity = resolveEntity(step.entityType, step.entityId);
        return {
          id: step.id,
          entityType: step.entityType.toLowerCase() as 'quotation' | 'contract',
          entityId: step.entityId,
          entityNumber: entity.number,
          currentStatus: entity.status,
          actionNeeded: `Awaiting ${step.stepName}`,
          requestor: entity.requestor,
          createdDate: step.createdAt ? step.createdAt.toISOString() : new Date().toISOString(),
          timeElapsed: step.createdAt ? timeAgo(step.createdAt) : 'just now',
        };
      });

      const statusLabel: Record<string, 'Approved' | 'Rejected' | 'Pending'> = {
        APPROVED: 'Approved', REJECTED: 'Rejected', SKIPPED: 'Rejected', PENDING: 'Pending',
      };

      const approvalHistory = historySteps.map(step => {
        const entity = resolveEntity(step.entityType, step.entityId);
        return {
          id: step.id,
          entityType: step.entityType === 'QUOTATION' ? 'Quotation' : 'Contract',
          entityId: entity.number,
          stepName: step.stepName,
          approver: step.approverName ?? 'Unknown',
          status: statusLabel[step.status ?? ''] ?? 'Pending',
          actionDate: (step.actionAt ?? step.createdAt ?? new Date()).toISOString(),
          comments: step.comments ?? '',
        };
      });

      return NextResponse.json({ workflowSteps, pendingActions, approvalHistory });
    } catch (e) {
      console.error('Failed to build leasing workflow dashboard:', e);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  });
}
