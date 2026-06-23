import { prisma } from '@/lib/prisma';
import { customerContextForUser, type CorporateCustomerMatch } from '@/lib/corporate-customer-identity';

export interface CustomerPortalProfile {
  name: string;
  customerName: string;
  email: string;
  phone: string;
  address: string;
  memberSince: string;
  totalBookings: number;
  preferredPayment: string;
  activeServices: CustomerPortalService[];
}

export interface CustomerPortalService {
  id: string;
  type: string;
  status: 'active' | 'inactive' | 'pending';
  description: string;
  startDate?: string;
  endDate?: string;
  reference: string;
}

export interface CustomerPortalBooking {
  id: string;
  reference: string;
  serviceType: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'completed' | 'cancelled' | 'upcoming';
}

export async function requireCustomerPortalContext(
  tenantId: string,
  userId: string,
  sessionCustomer?: { customerId?: string | null; role?: string | null },
): Promise<CorporateCustomerMatch | null> {
  if (!tenantId || !userId) return null;
  const linked = await customerContextForUser(tenantId, userId);
  if (linked) return linked;
  if (!sessionCustomer?.customerId) return null;

  const rows = await prisma.$queryRawUnsafe<Array<{
    customer_id: string;
    customer_name: string;
    domain: string | null;
  }>>(
    `SELECT c.id::text AS customer_id, c.name_en AS customer_name, MIN(cd.domain) AS domain
       FROM customers c
       LEFT JOIN customer_domains cd
         ON cd.tenant_id = c.tenant_id::text AND cd.customer_id = c.id::text AND cd.is_verified = TRUE
      WHERE c.id::text = $1
        AND c.tenant_id::text = $2
        AND c.deleted_at IS NULL
      GROUP BY c.id, c.name_en
      LIMIT 1`,
    sessionCustomer.customerId,
    tenantId,
  ).catch(() => []);
  const row = rows[0];
  return row ? {
    tenantId,
    customerId: row.customer_id,
    customerName: row.customer_name,
    domain: row.domain ?? '',
    role: (sessionCustomer.role ?? 'CUSTOMER_USER') as CorporateCustomerMatch['role'],
  } : null;
}

export async function getCustomerPortalProfile(tenantId: string, userId: string, context: CorporateCustomerMatch): Promise<CustomerPortalProfile> {
  const [user, customerRows, services] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true, mobileNumber: true, createdAt: true },
    }).catch(() => null),
    prisma.$queryRawUnsafe<Array<{
      name_en: string;
      email: string | null;
      mobile_number: string | null;
      address_line1: string | null;
      city: string | null;
      country: string | null;
      default_payment_method: string | null;
      billing_cycle: string | null;
    }>>(
      `SELECT name_en, email, mobile_number, address_line1, city, country, default_payment_method, billing_cycle
         FROM customers
        WHERE id::text = $1 AND tenant_id::text = $2 AND deleted_at IS NULL
        LIMIT 1`,
      context.customerId,
      tenantId,
    ).catch(() => []),
    getCustomerPortalServices(tenantId, context),
  ]);

  const customer = customerRows[0];
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || context.customerName;
  const address = [customer?.address_line1, customer?.city, customer?.country].filter(Boolean).join(', ');
  const bookings = await getCustomerPortalBookings(tenantId, context);

  return {
    name,
    customerName: customer?.name_en ?? context.customerName,
    email: user?.email ?? customer?.email ?? '',
    phone: user?.mobileNumber ?? customer?.mobile_number ?? '',
    address,
    memberSince: user?.createdAt?.toISOString() ?? new Date().toISOString(),
    totalBookings: bookings.length,
    preferredPayment: customer?.default_payment_method ?? customer?.billing_cycle ?? 'Corporate account',
    activeServices: services.filter(service => service.status === 'active'),
  };
}

export async function getCustomerPortalServices(tenantId: string, context: CorporateCustomerMatch): Promise<CustomerPortalService[]> {
  const leaseRows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    lease_number: string | null;
    status: string | null;
    start_date: Date | null;
    end_date: Date | null;
  }>>(
    `SELECT id::text, lease_number, status, start_date, end_date
       FROM lease_agreements
      WHERE tenant_id::text = $1
        AND customer_id::text = $2
        AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 5`,
    tenantId,
    context.customerId,
  ).catch(() => []);

  const rentalRows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    agreement_number: string | null;
    status: string | null;
    start_date: Date | null;
    end_date: Date | null;
  }>>(
    `SELECT id::text, agreement_no AS agreement_number, status, start_date, end_date
       FROM rental_agreements
      WHERE tenant_id::text = $1
        AND customer_id::text = $2
      ORDER BY created_at DESC
      LIMIT 5`,
    tenantId,
    context.customerId,
  ).catch(() => []);

  const services: CustomerPortalService[] = [
    ...leaseRows.map(row => ({
      id: row.id,
      type: 'Vehicle Lease',
      status: normalizeServiceStatus(row.status),
      description: 'Corporate lease agreement',
      startDate: row.start_date?.toISOString(),
      endDate: row.end_date?.toISOString(),
      reference: row.lease_number ?? row.id,
    })),
    ...rentalRows.map(row => ({
      id: row.id,
      type: 'Rental Agreement',
      status: normalizeServiceStatus(row.status),
      description: 'Rental service agreement',
      startDate: row.start_date?.toISOString(),
      endDate: row.end_date?.toISOString(),
      reference: row.agreement_number ?? row.id,
    })),
  ];

  if (services.length > 0) return services;

  return [{
    id: context.customerId,
    type: 'Corporate Transport Account',
    status: 'active',
    description: `${context.customerName} is linked to this tenant portal.`,
    reference: context.domain || 'Corporate customer',
  }];
}

export async function getCustomerPortalBookings(tenantId: string, context: CorporateCustomerMatch): Promise<CustomerPortalBooking[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    booking_number: string | null;
    status: string | null;
    pickup_date: Date | null;
    return_date: Date | null;
  }>>(
    `SELECT id::text, booking_ref AS booking_number, status, pickup_date, dropoff_date AS return_date
       FROM rental_bookings
      WHERE tenant_id::text = $1
        AND customer_id::text = $2
        AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 25`,
    tenantId,
    context.customerId,
  ).catch(() => []);

  return rows.map(row => ({
    id: row.id,
    reference: row.booking_number ?? row.id,
    serviceType: 'Rental Booking',
    startDate: (row.pickup_date ?? new Date()).toISOString(),
    endDate: (row.return_date ?? row.pickup_date ?? new Date()).toISOString(),
    status: normalizeBookingStatus(row.status),
  }));
}

function normalizeServiceStatus(status?: string | null): CustomerPortalService['status'] {
  const value = (status ?? '').toLowerCase();
  if (['active', 'approved', 'confirmed', 'running'].includes(value)) return 'active';
  if (['pending', 'draft', 'submitted'].includes(value)) return 'pending';
  return 'inactive';
}

function normalizeBookingStatus(status?: string | null): CustomerPortalBooking['status'] {
  const value = (status ?? '').toLowerCase();
  if (['completed', 'closed'].includes(value)) return 'completed';
  if (['cancelled', 'canceled', 'void'].includes(value)) return 'cancelled';
  if (['active', 'in_progress', 'ongoing'].includes(value)) return 'active';
  return 'upcoming';
}
