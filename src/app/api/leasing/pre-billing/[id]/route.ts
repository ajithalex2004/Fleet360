import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDangerApproval } from '@/lib/admin-policy';
import { recordOperationalChange, requireOperationalContext, requireOperationalPermission } from '@/lib/cross-module-governance';
import { preBillingStatementInTenant } from '@/lib/leasing-billing-reconciliation';
import { legacyLeasingBillingWriteMoved } from '@/lib/finance-leasing-billing-routing';
import { createLeasingAlert, markLeasingRuntimeActionExecuted, requireLeasingRuntimeApproval, resolveServiceAlertRule } from '@/lib/leasing-runtime-approvals';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const moved = legacyLeasingBillingWriteMoved(req, `/api/finance/leasing-billing/pre-billing/${params.id}`);
    if (moved) return moved;
    const ctx = requireOperationalContext(req, 'leasing', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const scoped = await preBillingStatementInTenant(params.id, ctx);
    if (scoped.error) return scoped.error;
    const body = await req.json();
    const data = { ...body };
    delete (data as Record<string, unknown>).contract;
    const before = scoped.statement;
    const permission = await requireOperationalPermission(ctx, data.status && data.status !== before.status
      ? [
          { module: 'finance', action: 'approve', resource: 'leasing_billing' },
          { module: 'leasing', action: 'approve', resource: 'invoices' },
        ]
      : [
          { module: 'finance', action: 'edit', resource: 'leasing_billing' },
          { module: 'finance', action: 'create', resource: 'leasing_billing' },
          { module: 'leasing', action: 'create', resource: 'invoices' },
        ], {
      message: data.status && data.status !== before.status
        ? 'You do not have access to approve Leasing pre-billing status changes'
        : 'You do not have access to edit Leasing pre-billing statements',
    });
    if (permission) return permission;
    let runtimeActionId: string | null = null;
    if (data.status && data.status !== before.status && ['SENT', 'CONFIRMED', 'FINALIZED'].includes(String(data.status).toUpperCase())) {
      const varianceRows = await prisma.$queryRawUnsafe<Array<{
        variance_amount: number | null;
        variance_pct: number | null;
        total_amount: number | null;
        currency: string | null;
      }>>(
        `SELECT variance_amount::float8, variance_pct::float8, total_amount::float8, currency
           FROM lease_pre_billing_statements
          WHERE id = $1::uuid
          LIMIT 1`,
        params.id,
      ).catch(() => []);
      const variance = varianceRows[0] ?? { variance_amount: null, variance_pct: null, total_amount: null, currency: 'AED' };
      const alertRule = await resolveServiceAlertRule(ctx.tenantId, 'LEASING_BILLING_EXCEPTION', {
        varianceAmount: variance.variance_amount,
        variancePct: variance.variance_pct,
      });
      const requiresVarianceApproval = (variance.variance_amount ?? 0) > 0 || Boolean(alertRule?.blockAction);
      if (requiresVarianceApproval) {
        const runtimeApproval = await requireLeasingRuntimeApproval(req, ctx, {
          serviceTypeKey: 'LEASING_BILLING_EXCEPTION',
          entityType: 'PRE_BILLING',
          entityId: params.id,
          actionKey: 'billing_exception_review',
          referenceNumber: before.statementNo ?? params.id,
          amount: variance.variance_amount ?? variance.total_amount ?? null,
          currency: variance.currency ?? 'AED',
          summary: `Review billing exception for pre-billing ${before.statementNo ?? params.id}`,
          payload: {
            before: { status: before.status, varianceAmount: variance.variance_amount, variancePct: variance.variance_pct },
            after: { status: data.status },
            preBillingStatementId: params.id,
            contractId: before.contractId,
          },
          contractId: before.contractId,
        });
        if (!runtimeApproval.ok) return runtimeApproval.response;
        runtimeActionId = runtimeApproval.actionId;
        if (alertRule) {
          await createLeasingAlert({
            tenantId: ctx.tenantId,
            entityType: 'PRE_BILLING',
            entityId: params.id,
            contractId: before.contractId,
            alertType: 'VARIANCE',
            severity: alertRule.severity,
            title: alertRule.title,
            message: alertRule.message ?? `Variance review completed for ${before.statementNo ?? params.id}.`,
          });
        }
      }
    }
    if (data.status && data.status !== before.status) {
      const approval = await requireDangerApproval(req, {
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        role: ctx.role,
        isSuperAdmin: ctx.isSuperAdmin,
        isTenantAdmin: ctx.role === 'TENANT_ADMIN',
      }, 'leasing.prebilling.status_change', {
        tenantId: ctx.tenantId,
        targetType: 'LeasePreBillingStatement',
        targetId: params.id,
        summary: `Change pre-billing ${before.statementNo ?? params.id} status ${before.status ?? 'UNKNOWN'} -> ${data.status}`,
        payload: { before, after: data },
        requiredApprovals: 2,
      });
      if (approval) return approval;
    }
    if (data.status === 'SENT' && !data.sentAt) data.sentAt = new Date();
    if (data.status === 'CONFIRMED' && !data.confirmedAt) data.confirmedAt = new Date();
    const stmt = await prisma.leasePreBillingStatement.update({ where: { id: params.id }, data });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'LeasePreBillingStatement',
      entityId: params.id,
      action: data.status && data.status !== before.status ? 'STATUS_CHANGE' : 'UPDATE',
      before,
      after: stmt,
      summary: `Updated pre-billing statement ${stmt.statementNo ?? params.id}`,
    });
    await markLeasingRuntimeActionExecuted(runtimeActionId);
    return NextResponse.json(stmt);
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
