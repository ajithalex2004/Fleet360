import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDangerApproval } from '@/lib/admin-policy';
import { recordOperationalChange, requireOperationalContext, requireOperationalPermission } from '@/lib/cross-module-governance';
import { leaseInvoiceInTenant } from '@/lib/leasing-billing-reconciliation';
import { getFinanceMirrorById, mirrorLeaseInvoiceToFinance } from '@/lib/finance-source-ledger';
import { legacyLeasingBillingWriteMoved } from '@/lib/finance-leasing-billing-routing';

const DANGEROUS_INVOICE_STATUSES = new Set(['PAID', 'CANCELLED', 'WAIVED', 'WRITE_OFF', 'WRITTEN_OFF']);

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const ctx = requireOperationalContext(req, 'leasing');
  if (ctx instanceof NextResponse) return ctx;
  const permission = await requireOperationalPermission(ctx, [
    { module: 'finance', action: 'view', resource: 'leasing_billing' },
    { module: 'leasing', action: 'view', resource: '*' },
  ], { message: 'You do not have access to view this Leasing invoice' });
  if (permission) return permission;
  const scoped = await leaseInvoiceInTenant(id, ctx);
  if (scoped.error) return scoped.error;
  return NextResponse.json(scoped.invoice);
}
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const moved = legacyLeasingBillingWriteMoved(req, `/api/finance/leasing-billing/invoices/${id}`);
    if (moved) return moved;
    const ctx = requireOperationalContext(req, 'leasing', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const scoped = await leaseInvoiceInTenant(id, ctx);
    if (scoped.error) return scoped.error;
    const body = await req.json();
    const { lines: _ignoredLines, lessee: _ignoredLessee, ...data } = body;
    void _ignoredLines;
    void _ignoredLessee;
    const before = scoped.invoice;
    const requestedStatus = typeof data.status === 'string' ? data.status : null;
    const permission = await requireOperationalPermission(ctx, requestedStatus && requestedStatus !== before.status
      ? [
          { module: 'finance', action: 'approve', resource: 'leasing_billing' },
          { module: 'leasing', action: 'approve', resource: 'invoices' },
        ]
      : [
          { module: 'finance', action: 'edit', resource: 'leasing_billing' },
          { module: 'finance', action: 'create', resource: 'leasing_billing' },
          { module: 'leasing', action: 'create', resource: 'invoices' },
        ], {
      message: requestedStatus && requestedStatus !== before.status
        ? 'You do not have access to approve or change Leasing invoice status'
        : 'You do not have access to edit Leasing invoices',
    });
    if (permission) return permission;
    if (requestedStatus && requestedStatus !== before.status && DANGEROUS_INVOICE_STATUSES.has(requestedStatus)) {
      const approval = await requireDangerApproval(req, {
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        role: ctx.role,
        isSuperAdmin: ctx.isSuperAdmin,
        isTenantAdmin: ctx.role === 'TENANT_ADMIN',
      }, 'leasing.invoice.status_change', {
        tenantId: ctx.tenantId,
        targetType: 'LeaseInvoice',
        targetId: id,
        summary: `Change invoice ${before.invoiceNo ?? id} status ${before.status ?? 'UNKNOWN'} -> ${requestedStatus}`,
        payload: { before, after: { ...data, id } },
        requiredApprovals: 2,
      });
      if (approval) return approval;
    }
    if (data.status === 'SENT'  && !data.sentAt)  data.sentAt  = new Date();
    if (data.status === 'PAID'  && !data.paidAt)  data.paidAt  = new Date();
    const inv = await prisma.leaseInvoice.update({ where: { id }, data: { ...data, updatedAt: new Date() }, include: { lines: true, lessee: true } });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'LeaseInvoice',
      entityId: id,
      action: requestedStatus && requestedStatus !== before.status ? 'STATUS_CHANGE' : 'UPDATE',
      before,
      after: inv,
      summary: requestedStatus && requestedStatus !== before.status
        ? `Changed invoice ${inv.invoiceNo ?? id} status ${before.status ?? 'UNKNOWN'} -> ${requestedStatus}`
        : `Updated invoice ${inv.invoiceNo ?? id}`,
    });
    const mirror = await mirrorLeaseInvoiceToFinance(inv.id, ctx.tenantId, ctx.userId).catch(err => {
      console.error('[leasing/invoices/:id] Finance mirror failed', err);
      return null;
    });
    if (mirror?.mirrored && mirror.financeInvoiceId) {
      const financeMirror = await getFinanceMirrorById(mirror.financeInvoiceId);
      await recordOperationalChange({
        req,
        ctx,
        entityType: 'FinanceInvoice',
        entityId: mirror.financeInvoiceId,
        action: mirror.mode === 'created' ? 'CREATE' : 'UPDATE',
        before: mirror.mode === 'updated' ? { sourceLeaseInvoiceId: inv.id } : null,
        after: financeMirror,
        summary: `Synced Finance mirror for leasing invoice ${inv.invoiceNo ?? inv.id}`,
        sourceModule: 'LEASING',
        sourceEntityType: 'LeaseInvoice',
        sourceEntityId: inv.id,
        relatedEntityType: 'LeaseInvoice',
        relatedEntityId: inv.id,
        riskSeverity: requestedStatus && requestedStatus !== before.status ? 'medium' : 'low',
      });
    }
    return NextResponse.json(inv);
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
