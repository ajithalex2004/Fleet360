/**
 * Customer portal (/customer/*): the signed-in user's own profile and
 * bookings.
 *
 * A customer sees only bookings they requested, matched by requestor id or
 * requestor email within their tenant. The general /api/bookings list is an
 * operator view of every booking in the tenant and must not back these
 * screens.
 */
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export type PortalBooking = {
  id: string;
  bookingRef: string | null;
  serviceType: string;
  vehicleCategory: string | null;
  startDate: Date;
  endDate: Date | null;
  status: string | null;
  createdAt: Date | null;
};

const SERVICE_LABELS: Record<string, string> = {
  RENTAL: 'Car Rental',
  LEASING: 'Vehicle Lease',
  STAFF_TRANSPORT: 'Staff Shuttle',
  EXECUTIVE: 'Executive Transport',
  LOGISTICS: 'Logistics',
  SCHOOL_BUS: 'School Bus',
  AMBULANCE: 'Ambulance',
};

export function serviceLabel(serviceType: string): string {
  return SERVICE_LABELS[serviceType?.toUpperCase()] ?? serviceType;
}

export function bookingReference(b: Pick<PortalBooking, 'id' | 'bookingRef'>): string {
  return b.bookingRef ?? b.id.slice(0, 8).toUpperCase();
}

export async function loadPortalUser(tx: Tx, userId: string | null) {
  if (!userId) return null;
  return tx.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, firstName: true, lastName: true, username: true, mobileNumber: true, createdAt: true },
  });
}

export async function loadPortalBookings(
  tx: Tx,
  tenantId: string,
  user: { id: string; email: string } | null,
): Promise<PortalBooking[]> {
  if (!user) return [];
  return tx.booking.findMany({
    where: {
      tenantId,
      OR: [{ requestorId: user.id }, { requestorEmail: { equals: user.email, mode: 'insensitive' } }],
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true, bookingRef: true, serviceType: true, vehicleCategory: true,
      startDate: true, endDate: true, status: true, createdAt: true,
    },
  });
}

/** My bookings tab: upcoming | active | completed | cancelled. */
export function bookingTabStatus(status: string | null): 'upcoming' | 'active' | 'completed' | 'cancelled' {
  switch ((status ?? '').toUpperCase()) {
    case 'ACTIVE': return 'active';
    case 'COMPLETED': return 'completed';
    case 'CANCELLED':
    case 'REJECTED': return 'cancelled';
    default: return 'upcoming';
  }
}

/** Services tab: active | pending | inactive. */
export function serviceStatus(status: string | null): 'active' | 'pending' | 'inactive' {
  switch ((status ?? '').toUpperCase()) {
    case 'ACTIVE':
    case 'CONFIRMED':
    case 'APPROVED': return 'active';
    case 'PENDING': return 'pending';
    default: return 'inactive';
  }
}
