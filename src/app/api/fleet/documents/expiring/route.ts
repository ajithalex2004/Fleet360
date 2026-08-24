import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cacheRead, privateCacheControl, revalidateCache } from '@/lib/server-cache';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
const CACHE_TAG = 'fleet:documents-expiring';

const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const rowToCamel = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));

// Expiry window is hourly granularity. Caching for 60s cuts the JOIN+SORT
// from every page load to once per minute. Per-tenant key keeps responses
// isolated. `revalidateCache([CACHE_TAG])` busts the cache on any document
// write — see the documents POST/PATCH/DELETE handlers.
const getExpiringDocs = cacheRead(
  async (tenantId: string, days: number, limit: number) => {
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
    return rows.map(rowToCamel);
  },
  [CACHE_TAG],
  60,
);

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const sp = req.nextUrl.searchParams;
    const days = parseInt(sp.get('days') ?? '30', 10);
    const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '10', 10)));
    const tenantId = req.headers.get('x-tenant-id') ?? 'unknown';

    const data = await getExpiringDocs(tenantId, days, limit);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': privateCacheControl(60, 300) },
    });
  } catch (error) {
    console.error('Error fetching expiring documents:', error);
    return NextResponse.json({ error: 'Failed to fetch expiring documents' }, { status: 500 });
  }
}
