import { NextRequest, NextResponse } from 'next/server';
import { getCustomerPortalBookings, requireCustomerPortalContext } from '@/lib/customer-portal';

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? '';
  const userId = req.headers.get('x-user-id') ?? '';
  const context = await requireCustomerPortalContext(tenantId, userId, {
    customerId: req.headers.get('x-customer-id'),
    role: req.headers.get('x-customer-role'),
  });

  if (!context) {
    return NextResponse.json({ error: 'Customer portal access required' }, { status: 403 });
  }

  const bookings = await getCustomerPortalBookings(tenantId, context);
  return NextResponse.json({ bookings });
}
