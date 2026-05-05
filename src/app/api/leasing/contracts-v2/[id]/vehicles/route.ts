import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const vehicles = await (prisma as any).leaseContractVehicle.findMany({
      where: { contractId: params.id },
    });
    return NextResponse.json(vehicles.map((v: any) => ({
      id: v.id,
      type: v.vehicleType ?? v.type ?? '',
      make: v.make ?? '',
      model: v.model ?? '',
      licensePlate: v.licensePlate ?? v.plateNumber ?? '',
      driver: v.driverName ?? v.driver ?? '',
      monthlyRate: v.monthlyRate ?? 0,
      status: v.status ?? 'Active',
    })));
  } catch (e: any) {
    console.error('GET vehicles error:', e?.message);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const { type, make, model, licensePlate, driver, monthlyRate } = body;

    if (!type) return NextResponse.json({ error: 'Vehicle type is required' }, { status: 400 });
    if (!licensePlate) return NextResponse.json({ error: 'License plate is required' }, { status: 400 });

    // Try to create with Prisma model; fall back to raw SQL if model not found
    let vehicle: any;
    try {
      vehicle = await (prisma as any).leaseContractVehicle.create({
        data: {
          contractId: params.id,
          vehicleType: type,
          make: make ?? null,
          model: model ?? null,
          licensePlate,
          driverName: driver ?? null,
          monthlyRate: parseFloat(monthlyRate) || 0,
          status: 'Active',
        },
      });
    } catch (prismaErr: any) {
      // If model doesn't exist in Prisma client, fall back to raw SQL
      const result = await prisma.$queryRawUnsafe(`
        INSERT INTO "LeaseContractVehicle" 
          (id, "contractId", "vehicleType", make, model, "licensePlate", "driverName", "monthlyRate", status, "createdAt", "updatedAt")
        VALUES 
          (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 'Active', NOW(), NOW())
        RETURNING *
      `, params.id, type, make ?? null, model ?? null, licensePlate, driver ?? null, parseFloat(monthlyRate) || 0);
      vehicle = Array.isArray(result) ? result[0] : result;
    }

    return NextResponse.json({
      id: vehicle.id,
      type: vehicle.vehicleType ?? vehicle.type ?? type,
      make: vehicle.make ?? make ?? '',
      model: vehicle.model ?? model ?? '',
      licensePlate: vehicle.licensePlate ?? licensePlate,
      driver: vehicle.driverName ?? vehicle.driver ?? driver ?? '',
      monthlyRate: vehicle.monthlyRate ?? parseFloat(monthlyRate) || 0,
      status: vehicle.status ?? 'Active',
    }, { status: 201 });
  } catch (e: any) {
    console.error('POST /api/leasing/contracts-v2/[id]/vehicles error:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Failed to add vehicle' }, { status: 500 });
  }
}
