import { NextRequest, NextResponse } from 'next/server';
import { requireOperationalContext, requireOperationalPermission } from '@/lib/cross-module-governance';
import { getLeasingBillingReconciliation, mirrorLeaseInvoiceToFinance } from '@/lib/finance-source-ledger';

export async function GET(req: NextRequest) {
  const ctx = requireOperationalContext(req, 'finance', { requestedTenantId: req.nextUrl.searchParams.get('tenantId') });
  if (ctx instanceof NextResponse) return ctx;
  const permission = await requireOperationalPermission(ctx, [
    { module: 'finance', action: 'view', resource: 'leasing_billing' },
    { module: 'leasing', action: 'view', resource: '*' },
  ], { message: 'You do not have access to view Leasing Billing reconciliation' });
  if (permission) return permission;
  const reconciliation = await getLeasingBillingReconciliation(ctx.tenantId);
  return NextResponse.json(reconciliation);
}

export async function POST(req: NextRequest) {
  const ctx = requireOperationalContext(req, 'finance', { requestedTenantId: req.nextUrl.searchParams.get('tenantId') });
  if (ctx instanceof NextResponse) return ctx;
  const permission = await requireOperationalPermission(ctx, [
    { module: 'finance', action: 'edit', resource: 'leasing_billing' },
    { module: 'finance', action: 'create', resource: 'leasing_billing' },
    { module: 'finance', action: 'approve', resource: 'leasing_billing' },
    { module: 'leasing', action: 'approve', resource: 'invoices' },
  ], { message: 'You do not have access to reconcile Leasing Billing mirrors' });
  if (permission) return permission;
  const body = await req.json().catch(() => ({}));
  const reconciliation = await getLeasingBillingReconciliation(ctx.tenantId);
  const candidates = reconciliation.rows
    .filter(row => body.invoiceId ? row.leaseInvoiceId === String(body.invoiceId) : !row.mirrored || !row.totalMatches)
    .map(row => row.leaseInvoiceId);

  const results = [];
  for (const invoiceId of candidates) {
    results.push({ invoiceId, ...(await mirrorLeaseInvoiceToFinance(invoiceId, ctx.tenantId, ctx.userId)) });
  }

  return NextResponse.json({
    sourceModule: 'LEASING',
    processed: results.length,
    results,
    reconciliation: await getLeasingBillingReconciliation(ctx.tenantId),
  });
}
