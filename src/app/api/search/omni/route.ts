import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    const tenantId = authz.tenantId;
    const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';

    if (!q || q.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const tenantFilter = tenantId ? { tenantId } : {};

    const [vehicles, bookings, customers, agreements] = await Promise.all([
      // 1. Vehicles
      prisma.vehicle.findMany({
        where: {
          ...tenantFilter,
          OR: [
            { plateNumber: { contains: q, mode: 'insensitive' } },
            { make: { contains: q, mode: 'insensitive' } },
            { model: { contains: q, mode: 'insensitive' } },
            { vin: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: 5,
        select: {
          id: true,
          plateNumber: true,
          make: true,
          model: true,
          year: true,
          status: true,
        },
      }),

      // 2. Bookings
      prisma.rentalBooking.findMany({
        where: {
          ...tenantFilter,
          OR: [
            { bookingRef: { contains: q, mode: 'insensitive' } },
            { customer: { fullName: { contains: q, mode: 'insensitive' } } },
          ],
        },
        take: 5,
        select: {
          id: true,
          bookingRef: true,
          pickupDate: true,
          dropoffDate: true,
          status: true,
          customer: { select: { fullName: true } },
        },
      }),

      // 3. Customers
      prisma.rentalCustomer.findMany({
        where: {
          ...tenantFilter,
          OR: [
            { fullName: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q, mode: 'insensitive' } },
            { companyName: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: 5,
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          companyName: true,
          customerType: true,
        },
      }),

      // 4. Agreements
      prisma.rentalAgreement.findMany({
        where: {
          ...tenantFilter,
          OR: [
            { agreementNo: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: 5,
        select: {
          id: true,
          agreementNo: true,
          startDate: true,
          endDate: true,
          status: true,
        },
      }),
    ]);

    const results = [
      ...vehicles.map(v => ({
        id: v.id,
        category: 'Vehicles',
        title: `${v.make} ${v.model} (${v.plateNumber ?? 'No Plate'})`,
        subtitle: `Status: ${v.status} · Year: ${v.year ?? 'N/A'}`,
        href: `/fleet/vehicles`,
        type: 'vehicle',
        badge: 'Vehicle',
      })),
      ...bookings.map(b => ({
        id: b.id,
        category: 'Bookings',
        title: `Booking ${b.bookingRef ?? b.id.slice(0, 8)}`,
        subtitle: `${b.customer?.fullName ?? 'Customer'} · ${b.status ?? 'PENDING'}`,
        href: `/rental/bookings`,
        type: 'booking',
        badge: 'Booking',
      })),
      ...customers.map(c => ({
        id: c.id,
        category: 'Customers',
        title: c.fullName,
        subtitle: `${c.companyName ? c.companyName + ' · ' : ''}${c.phone ?? c.email ?? ''}`,
        href: `/rental/customers`,
        type: 'customer',
        badge: 'Customer',
      })),
      ...agreements.map(a => ({
        id: a.id,
        category: 'Agreements',
        title: `Agreement ${a.agreementNo ?? a.id.slice(0, 8)}`,
        subtitle: `Status: ${a.status ?? 'ACTIVE'}`,
        href: `/rental/agreements`,
        type: 'agreement',
        badge: 'Agreement',
      })),
    ];

    return NextResponse.json({ results });
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Omni search error:', error);
    return NextResponse.json({ results: [] });
  }
}
