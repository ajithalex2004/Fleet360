import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDangerApproval } from '@/lib/admin-policy';
import { recordOperationalChange, requireOperationalContext, requireOperationalPermission } from '@/lib/cross-module-governance';
import { assertContractBillingScope, scopedLeaseContractIds } from '@/lib/leasing-billing-reconciliation';
import { legacyLeasingBillingWriteMoved } from '@/lib/finance-leasing-billing-routing';
import { createLeasingAlert, persistPreBillingVariance, resolveServiceAlertRule } from '@/lib/leasing-runtime-approvals';

export async function GET(req: NextRequest) {
  try {
    const ctx = requireOperationalContext(req, 'leasing', { requestedTenantId: req.nextUrl.searchParams.get('tenantId') });
    if (ctx instanceof NextResponse) return ctx;
    const permission = await requireOperationalPermission(ctx, [
      { module: 'finance', action: 'view', resource: 'leasing_billing' },
      { module: 'leasing', action: 'view', resource: '*' },
    ], { message: 'You do not have access to view Leasing pre-billing' });
    if (permission) return permission;
    const { searchParams } = new URL(req.url);
    const contractId = searchParams.get('contractId');
    const status     = searchParams.get('status');
    if (contractId) {
      const boundary = await assertContractBillingScope(contractId, ctx);
      if (boundary) return boundary;
    }
    const contractIds = contractId ? [contractId] : await scopedLeaseContractIds(ctx);
    const stmts = await prisma.leasePreBillingStatement.findMany({
      where: { contractId: { in: contractIds }, ...(status ? { status } : {}) },
      include: { contract: { select: { contractNumber: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(stmts);
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function POST(req: NextRequest) {
  try {
    const moved = legacyLeasingBillingWriteMoved(req, '/api/finance/leasing-billing/pre-billing');
    if (moved) return moved;
    const ctx = requireOperationalContext(req, 'leasing', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const permission = await requireOperationalPermission(ctx, [
      { module: 'finance', action: 'create', resource: 'leasing_billing' },
      { module: 'finance', action: 'edit', resource: 'leasing_billing' },
      { module: 'leasing', action: 'create', resource: 'invoices' },
    ], { message: 'You do not have access to create Leasing pre-billing statements' });
    if (permission) return permission;
    const body = await req.json();
    if (!body.contractId) return NextResponse.json({ error: 'contractId is required' }, { status: 400 });
    const boundary = await assertContractBillingScope(String(body.contractId), ctx);
    if (boundary) return boundary;
    const contract = await prisma.leaseContract2.findUnique({
      where: { id: String(body.contractId) },
      select: { id: true, contractNumber: true, lesseeId: true, monthlyRate: true, currency: true },
    });
    if (!contract) {
      return NextResponse.json({ error: 'Lease contract not found' }, { status: 404 });
    }
    const approval = await requireDangerApproval(req, {
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      role: ctx.role,
      isSuperAdmin: ctx.isSuperAdmin,
      isTenantAdmin: ctx.role === 'TENANT_ADMIN',
    }, 'leasing.prebilling.create', {
      tenantId: ctx.tenantId,
      targetType: 'LeasePreBillingStatement',
      targetId: String(body.contractId),
      summary: 'Create manual leasing pre-billing statement',
      payload: { before: null, after: body },
      requiredApprovals: 2,
    });
    if (approval) return approval;
    const count = await prisma.leasePreBillingStatement.count();
    const statementNo = `PBS-${String(count + 1).padStart(5, '0')}`;
    // Auto-calc VAT (5%) and total
    const baseFields = ['baseRent','fuelCharges','fineCharges','maintenanceCharges','overageCharges','otherCharges'];
    const hydratedBody = {
      ...body,
      lesseeId: body.lesseeId ?? contract.lesseeId,
      currency: body.currency ?? contract.currency ?? 'AED',
      baseRent: body.baseRent ?? Number(contract.monthlyRate ?? 0),
    };
    const sub = baseFields.reduce((s, k) => s + parseFloat(hydratedBody[k] || '0'), 0);
    const vatAmount = sub * 0.05;
    const totalAmount = sub + vatAmount;
    const duplicate = await prisma.leasePreBillingStatement.findFirst({
      where: { contractId: body.contractId, billingPeriod: hydratedBody.billingPeriod, status: { not: 'CANCELLED' } },
      select: { id: true, statementNo: true },
    });
    if (duplicate) {
      return NextResponse.json({ error: 'Pre-billing already exists for this contract and period', statementId: duplicate.id, statementNo: duplicate.statementNo }, { status: 409 });
    }
    const stmt = await prisma.leasePreBillingStatement.create({
      data: { ...hydratedBody, statementNo, vatAmount, totalAmount },
    });
    const variance = await persistPreBillingVariance({
      statementId: stmt.id,
      authorizedPoAmount: body.authorizedPoAmount,
      actualCostAmount: body.actualCostAmount,
      varianceNotes: body.varianceNotes,
    });
    const alertRule = (variance?.varianceAmount ?? 0) > 0
      ? await resolveServiceAlertRule(ctx.tenantId, 'LEASING_BILLING_EXCEPTION', {
          varianceAmount: variance?.varianceAmount,
          variancePct: variance?.variancePct,
        })
      : null;
    if ((variance?.varianceAmount ?? 0) > 0) {
      await createLeasingAlert({
        tenantId: ctx.tenantId,
        entityType: 'PRE_BILLING',
        entityId: stmt.id,
        contractId: contract.id,
        alertType: 'VARIANCE',
        severity: alertRule?.severity ?? ((variance?.variancePct ?? 0) >= 10 ? 'ERROR' : 'WARNING'),
        title: alertRule?.title ?? `Billing variance on ${contract.contractNumber ?? contract.id}`,
        message: alertRule?.message ?? `Actual cost ${variance?.actual ?? 0} exceeded authorized PO ${variance?.authorized ?? 0} by ${variance?.varianceAmount ?? 0} AED (${variance?.variancePct ?? 0}%).`,
      });
    }
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'LeasePreBillingStatement',
      entityId: stmt.id,
      action: 'CREATE',
      after: stmt,
      summary: `Created manual pre-billing statement ${statementNo}`,
    });
    return NextResponse.json(stmt, { status: 201 });
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
