export const dynamic = 'force-dynamic';

/** GET /api/customer/bookings: the signed-in customer's own bookings (My bookings). */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import {
  bookingReference, bookingTabStatus, loadPortalBookings, loadPortalUser, serviceLabel,
} from '@/lib/customer/portal';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const bookings = await withTenantRls(prisma, tenantId, async (tx) => {
      const user = await loadPortalUser(tx, req.headers.get('x-user-id'));
      const rows = await loadPortalBookings(tx, tenantId, user);
      return rows.map((b) => ({
        id: b.id,
        reference: bookingReference(b),
        serviceType: serviceLabel(b.serviceType),
        startDate: b.startDate.toISOString(),
        endDate: (b.endDate ?? b.startDate).toISOString(),
        status: bookingTabStatus(b.status),
      }));
    });
    return NextResponse.json({ bookings }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[customer/bookings] GET failed:', e);
    return NextResponse.json({ error: 'Failed to load bookings' }, { status: 500 });
  }
}
