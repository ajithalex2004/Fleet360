export const dynamic = 'force-dynamic';

/** GET /api/customer/services: the signed-in customer's services (their bookings). */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import {
  bookingReference, loadPortalBookings, loadPortalUser, serviceLabel, serviceStatus,
} from '@/lib/customer/portal';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const services = await withTenantRls(prisma, tenantId, async (tx) => {
      const user = await loadPortalUser(tx, req.headers.get('x-user-id'));
      const bookings = await loadPortalBookings(tx, tenantId, user);
      return bookings.map((b) => ({
        id: b.id,
        type: serviceLabel(b.serviceType),
        status: serviceStatus(b.status),
        description: [bookingReference(b), b.vehicleCategory].filter(Boolean).join(' · '),
        startDate: b.startDate.toISOString(),
        endDate: b.endDate?.toISOString(),
      }));
    });
    return NextResponse.json({ services }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[customer/services] GET failed:', e);
    return NextResponse.json({ error: 'Failed to load services' }, { status: 500 });
  }
}
