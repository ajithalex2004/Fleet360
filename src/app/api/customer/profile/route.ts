export const dynamic = 'force-dynamic';

/** GET /api/customer/profile: the signed-in customer's profile and active services. */
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
    const result = await withTenantRls(prisma, tenantId, async (tx) => {
      const user = await loadPortalUser(tx, req.headers.get('x-user-id'));
      if (!user) return null;
      const bookings = await loadPortalBookings(tx, tenantId, user);
      const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username;
      return {
        name,
        email: user.email,
        phone: user.mobileNumber ?? '',
        address: '',
        memberSince: user.createdAt.toISOString(),
        totalBookings: bookings.length,
        preferredPayment: 'Not set',
        activeServices: bookings
          .filter((b) => serviceStatus(b.status) === 'active')
          .map((b) => ({
            id: b.id,
            type: serviceLabel(b.serviceType),
            reference: bookingReference(b),
            status: (b.status ?? '').toUpperCase(),
          })),
      };
    });
    if (!result) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[customer/profile] GET failed:', e);
    return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 });
  }
}
