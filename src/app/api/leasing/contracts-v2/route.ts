import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAudit } from '@/lib/with-audit';

export async function GET() {
  try {
    const contracts = await (prisma as any).leaseContract.findMany({
      where: { deletedAt: null },
      include: { vehicles: true, lessee: true },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(
      contracts.map((c: any) => ({
        id: c.id,
        contractNumber: c.contractNumber,
        agreementType: c.agreementType ?? 'INDIVIDUAL',
        lessee: c.lessee?.companyName ?? c.lessee?.fullName ?? c.lesseeId ?? 'Unknown',
        leaseType: c.leaseType ?? 'LONG_TERM',
        vehicleCount: Array.isArray(c.vehicles) ? c.vehicles.length : (c.vehicleCount ?? 0),
        durationMonths: c.durationMonths ?? null,
        startDate: c.startDate ? new Date(c.startDate).toISOString().split('T')[0] : '',
        endDate: c.endDate ? new Date(c.endDate).toISOString().split('T')[0] : '',
        monthlyRate: c.monthlyRate ?? 0,
        totalValue: c.totalValue ?? 0,
        insurance: c.insuranceIncluded ?? false,
        maintenance: c.maintenanceIncluded ?? false,
        driver: c.driverIncluded ?? false,
        status: c.status ?? 'Draft',
        branch: c.branch ?? '',
        vehicles: (c.vehicles ?? []).map((v: any) => ({
          id: v.id,
          type: v.vehicleType ?? v.type ?? '',
          make: v.make ?? '',
          model: v.model ?? '',
          licensePlate: v.licensePlate ?? v.plateNumber ?? '',
          driver: v.driverName ?? v.driver ?? '',
          monthlyRate: v.monthlyRate ?? 0,
          status: v.status ?? 'Active',
        })),
      }))
    );
  } catch (e: any) {
    console.error('GET /api/leasing/contracts-v2 error:', e?.message);
    return NextResponse.json([], { status: 200 });
  }
}

export const POST = withAudit(
  async (request: NextRequest) => {
    try {
      const body = await request.json();
      const {
        lessee, lesseeId, agreementType, leaseType, durationMonths, startDate, endDate,
        monthlyRate, currency, securityDeposit, mileageCap, branch, vehicles,
        insuranceIncluded, maintenanceIncluded, driverIncluded, notes, quotationId,
      } = body;

      const contractNumber = `LC-${Date.now().toString().slice(-6)}`;

      const contract = await (prisma as any).leaseContract.create({
        data: {
          contractNumber,
          agreementType: agreementType ?? 'INDIVIDUAL',
          leaseType: leaseType ?? 'LONG_TERM',
          durationMonths: durationMonths ? parseInt(durationMonths) : null,
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          monthlyRate: monthlyRate ? parseFloat(monthlyRate) : 0,
          currency: currency ?? 'AED',
          securityDeposit: securityDeposit ? parseFloat(securityDeposit) : null,
          mileageCap: mileageCap ? parseInt(mileageCap) : null,
          branch: branch ?? null,
          insuranceIncluded: insuranceIncluded ?? false,
          maintenanceIncluded: maintenanceIncluded ?? false,
          driverIncluded: driverIncluded ?? false,
          notes: notes ?? null,
          status: 'Draft',
          lesseeId: lesseeId ?? null,
          ...(quotationId ? { quotationId } : {}),
        },
      });

      return NextResponse.json(contract, { status: 201 });
    } catch (e: any) {
      console.error('POST /api/leasing/contracts-v2 error:', e?.message);
      return NextResponse.json({ error: e?.message ?? 'Failed to create contract' }, { status: 500 });
    }
  },
  {
    entityType: 'LeaseContract',
    action: 'CREATE',
    extractEntity: (body) => ({ id: body?.id, name: body?.contractNumber }),
    describe: (_req, body) =>
      body?.contractNumber
        ? `Created lease contract ${body.contractNumber} (${body.agreementType ?? 'INDIVIDUAL'}, monthly ${body.monthlyRate ?? 0} ${body.currency ?? 'AED'})`
        : undefined,
  },
);
