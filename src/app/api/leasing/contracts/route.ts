import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';
import {
  attachTenantToEntity,
  recordOperationalChange,
  requireOperationalContext,
} from '@/lib/cross-module-governance';
import { ensureLeaseContractTenantColumn, leaseContractIdsForTenant } from '@/lib/leasing-governance';

export async function GET(req: NextRequest) {
  try {
    const ctx = requireOperationalContext(req, 'leasing', { requestedTenantId: req.nextUrl.searchParams.get('tenantId') });
    if (ctx instanceof NextResponse) return ctx;
    const sp = req.nextUrl.searchParams;
    const status = sp.get('status');
    const lesseeId = sp.get('lesseeId');
    const { take, skip, page, limit } = paginate(sp);
    const ids = await leaseContractIdsForTenant(ctx.tenantId, { activeOnly: true });
    const where = { id: { in: ids }, deletedAt: null, ...(status ? { status } : {}), ...(lesseeId ? { lesseeId } : {}) };
    const [data, total] = await Promise.all([
      prisma.leaseContract2.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.leaseContract2.count({ where }),
    ]);
    return NextResponse.json(paginatedResponse(data, total, page, limit));
  } catch (error) {
    console.error('Error fetching contracts:', error);
    return NextResponse.json({ error: 'Failed to fetch contracts' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requireOperationalContext(req, 'leasing', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    await ensureLeaseContractTenantColumn();
    const body = await req.json();
    const monthlyRate = Number(body.monthlyRate ?? body.monthly_rate ?? 0);
    if (!body.lesseeId || !body.startDate || !body.endDate || !monthlyRate) {
      return NextResponse.json({ error: 'lesseeId, startDate, endDate, and monthlyRate are required' }, { status: 400 });
    }
    const durationMonths = Number(body.durationMonths ?? body.duration_months ?? 0) || null;
    const contract = await prisma.leaseContract2.create({
      data: {
        contractNumber: body.contractNumber ?? `LC-${Date.now().toString().slice(-6)}`,
        agreementType: body.agreementType ?? 'INDIVIDUAL',
        leaseType: body.leaseType ?? 'LONG_TERM',
        startDate: new Date(body.startDate),
        endDate: new Date(body.endDate),
        monthlyRate,
        totalContractValue: durationMonths ? monthlyRate * durationMonths : body.totalContractValue ?? null,
        currency: body.currency ?? 'AED',
        securityDeposit: body.securityDeposit ?? null,
        mileageCap: body.mileageCap ? Number(body.mileageCap) : null,
        insuranceIncluded: body.insuranceIncluded ?? false,
        maintenanceIncluded: body.maintenanceIncluded ?? false,
        driverIncluded: body.driverIncluded ?? false,
        notes: body.notes ?? null,
        status: body.status ?? 'DRAFT',
        lesseeId: body.lesseeId,
        ...(body.quotationId ? { quotationId: body.quotationId } : {}),
      },
    });
    await attachTenantToEntity('lease_contracts_v2', contract.id, ctx.tenantId);
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'LeaseContract',
      entityId: contract.id,
      action: 'CREATE',
      after: contract,
      summary: `Created lease contract ${contract.contractNumber ?? contract.id} via canonical contract API`,
    });
    return NextResponse.json(contract, { status: 201 });
  } catch (error) {
    console.error('Error creating contract:', error);
    return NextResponse.json({ error: 'Failed to create contract' }, { status: 500 });
  }
}
