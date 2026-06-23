import { prisma } from '@/lib/prisma';
import { buildLesseeDisplayName } from '@/lib/leasing-lessee-display';
import { nextLeaseQuotationNumber } from '@/lib/leasing-numbering';
import { NextRequest, NextResponse } from 'next/server';
import { requireOperationalContext, requireOperationalPermission } from '@/lib/cross-module-governance';

type LeaseQuotationRouteRecord = Record<string, unknown>;

type LeaseQuotationVehicleInput = {
  vehicleType?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | string | null;
  quantity?: number | string | null;
  monthlyRate?: number | string | null;
};

type LeaseQuotationLineItemInput = {
  itemType?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  unitRate?: number | string | null;
  monthlyAmount?: number | string | null;
  totalAmount?: number | string | null;
  currency?: string | null;
  notes?: string | null;
};

function amount(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET() {
  try {
    const quotations = await prisma.leaseQuotation.findMany({
      where: { deletedAt: null },
      include: {
        lineItems: true,
        vehicles:  true,
        lessee:    true,
        inquiry:   true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const safe = quotations.map((q) => ({
      ...q,
      lesseeName: buildLesseeDisplayName(q),
      vehicles:  Array.isArray(q.vehicles)  ? q.vehicles  : [],
      lineItems: Array.isArray(q.lineItems) ? q.lineItems : [],
    }));

    return NextResponse.json(safe);
  } catch (error) {
    console.error('GET /api/leasing/quotations error:', error);
    return NextResponse.json({ error: 'Failed to fetch quotations' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = requireOperationalContext(request, 'leasing', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const permission = await requireOperationalPermission(ctx, [
      { module: 'leasing', action: 'create', resource: 'quotations' },
      { module: 'leasing', action: 'edit', resource: 'quotations' },
    ], { message: 'You do not have access to create Leasing quotations' });
    if (permission) return permission;

    const body = (await request.json()) as LeaseQuotationRouteRecord & {
      status?: string;
      vehicles?: LeaseQuotationVehicleInput[];
      lineItems?: LeaseQuotationLineItemInput[];
    };
    const quotationNumber = await nextLeaseQuotationNumber({
      leaseType: typeof body.leaseType === 'string' ? body.leaseType : null,
    });


    // Strip relational/extra fields that aren't on the LeaseQuotation model
    const { vehicles, lineItems, ...quotationData } = body;
    delete quotationData.lessee;
    delete quotationData.inquiry;
    delete quotationData.approvalSteps;
    delete quotationData.contracts;
    const quotationCurrency = typeof quotationData.currency === 'string' ? quotationData.currency : 'AED';

    const normalizedVehicles = Array.isArray(vehicles) ? vehicles.map((v) => ({
      vehicleType: v.vehicleType ?? 'SEDAN',
      make:        v.make        ?? null,
      model:       v.model       ?? null,
      year:        Number(v.year) || new Date().getFullYear(),
      quantity:    Number(v.quantity)    || 1,
      monthlyRate: amount(v.monthlyRate),
    })) : [];
    const normalizedLineItems = Array.isArray(lineItems) ? lineItems
      .filter(item => String(item.description ?? '').trim())
      .map((item) => {
        const quantity = Number(item.quantity) || 1;
        const unitRate = amount(item.unitRate);
        const monthlyAmount = amount(item.monthlyAmount) || unitRate * quantity;
        const totalAmount = amount(item.totalAmount) || monthlyAmount;
        return {
          itemType: item.itemType ?? 'OTHER',
          description: String(item.description ?? '').trim(),
          quantity,
          unitRate,
          monthlyAmount,
          totalAmount,
          currency: item.currency ?? quotationCurrency,
          notes: item.notes ?? null,
        };
      }) : [];

    const vehicleMonthly = normalizedVehicles.reduce((sum, vehicle) => sum + vehicle.monthlyRate * vehicle.quantity, 0);
    const lineMonthly = normalizedLineItems.reduce((sum, item) => sum + item.monthlyAmount, 0);
    const durationMonths = Number(quotationData.durationMonths) || 1;
    const computedMonthlyRate =
      amount(quotationData.totalMonthlyRate)
      || vehicleMonthly
      || lineMonthly
      || amount(quotationData.baseMonthlyRate)
      || 0;
    const computedContractValue =
      amount(quotationData.totalContractValue)
      || computedMonthlyRate * durationMonths;

    const quotation = await prisma.leaseQuotation.create({
      data: {
        ...quotationData,
        quotationNumber,
        status: quotationData.status ?? 'NEW',
        totalMonthlyRate: computedMonthlyRate,
        totalContractValue: computedContractValue,
        ...(normalizedVehicles.length > 0 ? {
          vehicles: {
            create: normalizedVehicles,
          },
        } : {}),
        ...(normalizedLineItems.length > 0 ? {
          lineItems: { create: normalizedLineItems },
        } : {}),
      },
      include: { lineItems: true, vehicles: true, lessee: true, inquiry: true },
    });

    return NextResponse.json({
      ...quotation,
      lesseeName: buildLesseeDisplayName(quotation),
      vehicles:  Array.isArray(quotation.vehicles)  ? quotation.vehicles  : [],
      lineItems: Array.isArray(quotation.lineItems) ? quotation.lineItems : [],
    }, { status: 201 });
  } catch (error: unknown) {
    console.error('POST /api/leasing/quotations error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create quotation' },
      { status: 500 }
    );
  }
}
