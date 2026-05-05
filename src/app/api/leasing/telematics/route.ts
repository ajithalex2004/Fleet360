import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function GET(req: NextRequest) {
  try {
    const items = await prisma.leaseTelematics.findMany({ orderBy: { lastUpdateAt: 'desc' } });
    return NextResponse.json(items);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Upsert by vehicleId
    const item = await prisma.leaseTelematics.upsert({
      where: { id: body.vehicleId }, // fallback
      create: body,
      update: { lastOdometer: body.lastOdometer, lastUpdateAt: new Date(), lastLat: body.lastLat, lastLng: body.lastLng },
    });
    return NextResponse.json(item, { status: 201 });
  } catch (e) {
    // If upsert fails on id, just create
    try {
      const item = await prisma.leaseTelematics.create({ data: req.body as any });
      return NextResponse.json(item, { status: 201 });
    } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
  }
}
