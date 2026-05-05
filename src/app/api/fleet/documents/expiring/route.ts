import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const rowToCamel = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const days = parseInt(sp.get('days') ?? '30', 10);
    const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '10', 10)));

    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT vd.*,
              COALESCE(v.make || ' ' || v.model, v.license_plate, 'Unknown') AS vehicle,
              v.license_plate,
              v.vehicle_code,
              GREATEST(0, EXTRACT(DAY FROM (vd.expiry_date - NOW()))::int) AS days_remaining
       FROM vehicle_documents vd
       LEFT JOIN vehicles v ON v.id = vd.vehicle_id
       WHERE vd.expiry_date BETWEEN NOW() AND NOW() + ($1 || ' days')::interval
       ORDER BY vd.expiry_date ASC
       LIMIT $2`,
      String(days),
      limit,
    );

    return NextResponse.json(rows.map(rowToCamel));
  } catch (error) {
    console.error('Error fetching expiring documents:', error);
    return NextResponse.json({ error: 'Failed to fetch expiring documents' }, { status: 500 });
  }
}
