import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireOperationalContext, requireOperationalPermission } from '@/lib/cross-module-governance';
import { legacyLeasingBillingWriteMoved } from '@/lib/finance-leasing-billing-routing';
export async function GET(req: NextRequest) {
  try {
    const ctx = requireOperationalContext(req, 'leasing', { requestedTenantId: req.nextUrl.searchParams.get('tenantId') });
    if (ctx instanceof NextResponse) return ctx;
    const permission = await requireOperationalPermission(ctx, [
      { module: 'finance', action: 'view', resource: 'leasing_billing' },
      { module: 'leasing', action: 'view', resource: 'receivables' },
      { module: 'leasing', action: 'view', resource: '*' },
    ], { message: 'You do not have access to view Leasing dunning activity' });
    if (permission) return permission;
    const { searchParams } = new URL(req.url);
    const contractId = searchParams.get('contractId');
    const activities = await prisma.leaseDunningActivity.findMany({
      where: contractId ? { contractId } : {},
      include: { contract: { select: { contractNumber: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(activities);
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function POST(req: NextRequest) {
  try {
    const moved = legacyLeasingBillingWriteMoved(req, '/api/finance/leasing-billing/receivables/dunning');
    if (moved) return moved;
    const ctx = requireOperationalContext(req, 'leasing', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const permission = await requireOperationalPermission(ctx, [
      { module: 'finance', action: 'edit', resource: 'leasing_billing' },
      { module: 'finance', action: 'create', resource: 'leasing_billing' },
      { module: 'leasing', action: 'create', resource: 'dunning' },
    ], { message: 'You do not have access to log Leasing dunning activity' });
    if (permission) return permission;
    const body = await req.json();
    const activity = await prisma.leaseDunningActivity.create({ data: body });
    return NextResponse.json(activity, { status: 201 });
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
