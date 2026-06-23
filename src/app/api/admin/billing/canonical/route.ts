import { NextRequest, NextResponse } from 'next/server';
import { requireAdminPermission, resolveTenantBoundary } from '@/lib/admin-policy';
import { getCanonicalBillingAccount, listCanonicalBillingAccounts } from '@/lib/canonical-billing';

export async function GET(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'view', 'billing');
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const requestedTenantId = searchParams.get('tenantId');
  if (requestedTenantId || !auth.ctx.isSuperAdmin) {
    const tenantId = resolveTenantBoundary(auth.ctx, requestedTenantId);
    if (tenantId instanceof NextResponse) return tenantId;
    const account = await getCanonicalBillingAccount(tenantId);
    if (!account) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    return NextResponse.json({ account });
  }

  const accounts = await listCanonicalBillingAccounts();
  const summary = accounts.reduce(
    (acc, account) => {
      acc.moduleMrr += account.moduleMrr;
      acc.moduleArr += account.moduleArr;
      acc.activeModuleSubscriptions += account.activeModuleSubscriptions;
      acc.billingModels[account.billingModel] = (acc.billingModels[account.billingModel] ?? 0) + 1;
      acc.plans[account.effectivePlan] = (acc.plans[account.effectivePlan] ?? 0) + 1;
      return acc;
    },
    {
      tenants: accounts.length,
      moduleMrr: 0,
      moduleArr: 0,
      activeModuleSubscriptions: 0,
      billingModels: {} as Record<string, number>,
      plans: {} as Record<string, number>,
    },
  );
  summary.moduleMrr = Math.round(summary.moduleMrr * 100) / 100;
  summary.moduleArr = Math.round(summary.moduleArr * 100) / 100;

  return NextResponse.json({ summary, accounts });
}

