export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PartnerService } from '@/lib/exchange/partner-service';

export const runtime = 'nodejs';

/**
 * GET /api/exchange/partner/fleet?partnerId=...
 * POST /api/exchange/partner/fleet
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const partnerId = searchParams.get('partnerId');

  const where = partnerId ? { partnerId, isActive: true } : { isActive: true };
  const vehicles = await prisma.partnerVehicle.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ vehicles });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { partnerId, licensePlate, plateEmirate, vehicleType, seatingCapacity, make, model, year, mulkiyaExpiry } = body;

    if (!partnerId || !licensePlate || !vehicleType || !seatingCapacity) {
      return NextResponse.json({ error: 'Missing required vehicle fields' }, { status: 400 });
    }

    const vehicle = await PartnerService.registerVehicle({
      partnerId,
      licensePlate,
      plateEmirate,
      vehicleType,
      seatingCapacity: Number(seatingCapacity),
      make,
      model,
      year: year ? Number(year) : undefined,
      mulkiyaExpiry,
    });

    return NextResponse.json({ ok: true, vehicle });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to register vehicle' }, { status: 500 });
  }
}
