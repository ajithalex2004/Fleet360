import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const contractId = searchParams.get('contractId');
    const readings = await prisma.leaseMileageReading.findMany({
      where: contractId ? { contractId } : {},
      include: { contract: { select: { contractNumber: true, mileageCap: true } } },
      orderBy: { readingDate: 'desc' },
    });
    return NextResponse.json(readings);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const reading = await prisma.leaseMileageReading.create({ data: body });
    // After a RETURN or MONTHLY reading, auto-calculate overage if mileageCap set
    if (['RETURN','MONTHLY'].includes(body.readingType)) {
      const contract = await prisma.leaseContract2.findUnique({ where: { id: body.contractId } });
      if (contract?.mileageCap) {
        const delivery = await prisma.leaseMileageReading.findFirst({
          where: { contractId: body.contractId, readingType: 'DELIVERY' }, orderBy: { readingDate: 'asc' },
        });
        if (delivery) {
          const months = body.readingType === 'RETURN'
            ? Math.ceil((new Date(contract.endDate).getTime() - new Date(contract.startDate).getTime()) / (30.44 * 86400000))
            : 1;
          const allowedKm = contract.mileageCap * months;
          const actualKm  = body.mileage - delivery.mileage;
          if (actualKm > allowedKm) {
            const overageKm = actualKm - allowedKm;
            const ratePerKm = 0.50; // default AED 0.50/km - should come from contract
            await prisma.leaseMileageOverage.create({
              data: {
                contractId: body.contractId,
                vehicleId: body.vehicleId ?? null,
                periodFrom: contract.startDate,
                periodTo: new Date(body.readingDate),
                allowedKm, actualKm, overageKm,
                ratePerKm, overageAmount: overageKm * ratePerKm,
                status: 'PENDING',
              },
            });
          }
        }
      }
    }
    return NextResponse.json(reading, { status: 201 });
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
