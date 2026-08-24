import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { MODULES, MODULE_BY_KEY } from '@/lib/modules';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
// Platform modules — derived from the canonical registry so the admin info
// endpoint stays in sync with the platform home, the admin tenants matrix,
// the access-control layer, and the RBAC permission matrix. Editing the
// registry now updates all five surfaces at once.
//
// Fields projected here match what /api/admin/info historically returned;
// consumers depend on `id`, `name`, `path`, `color` (= Tailwind gradient
// classes from the registry), and `description`.
const PLATFORM_MODULES = MODULES.map(m => ({
  id:          m.key,
  name:        m.name,
  path:        m.href,
  color:       m.gradient,
  description: m.description,
}));

// Reference used below so linter doesn't drop the MODULE_BY_KEY import.
// (Not currently needed for data, but kept as a hint that consumers can
//  look up any module by key — see portal/onboarding below.)
void MODULE_BY_KEY;

// API endpoint groups
const API_ENDPOINTS = [
  { module: 'Leasing',           base: '/api/leasing',           count: 45,  endpoints: ['inquiries','quotations','contracts-v2','traffic-fines','fuel','insurance','mileage-readings','mileage-overages','renewals','early-terminations','pre-billing','documents','credit-assessments','analytics','crm'] },
  { module: 'Rent-a-Car',        base: '/api/rental',            count: 17,  endpoints: ['bookings','customers','damage-claims','pricing','availability','agreements','inspections'] },
  { module: 'Staff Transport',   base: '/api/bus-ops',           count: 18,  endpoints: ['routes','schedules','staff','passengers','trip-logs','incidents','transport-requests'] },
  { module: 'Fleet',             base: '/api/fleet',             count: 10,  endpoints: ['vehicles','documents','fuel','fines','tco'] },
  { module: 'Maintenance',       base: '/api/maintenance-*',     count: 12,  endpoints: ['maintenance-requests','service-requests','work-orders','quotations'] },
  { module: 'Finance',           base: '/api/finance',           count: 8,   endpoints: ['invoices','payments','budgets','vat-returns','credit-notes'] },
  { module: 'Drivers',           base: '/api/drivers',           count: 8,   endpoints: ['drivers','documents','shifts','training','performance'] },
  { module: 'Admin / RBAC',      base: '/api/admin',             count: 14,  endpoints: ['tenants','roles','permissions','users','session','seed','info'] },
  { module: 'Vehicles (Go)',      base: '/api/vehicles',          count: 5,   endpoints: ['GET /api/vehicles','POST /api/vehicles','GET /api/vehicles/:id','PATCH /api/vehicles/:id','DELETE /api/vehicles/:id'] },
  { module: 'Notifications',     base: '/api/notifications',     count: 6,   endpoints: ['notifications','alert-configs','alerts','notification-templates','notification-rules'] },
];

// Notification channels
const NOTIFICATION_CHANNELS = [
  { id: 'email',    name: 'Email',          icon: 'E', description: 'SMTP email notifications for contract expiry, overdue payments, lease renewals, insurance alerts', status: 'configurable', configPath: '/admin/settings/notifications' },
  { id: 'sms',      name: 'SMS',            icon: 'S', description: 'SMS alerts via Twilio/AWS SNS for critical events: accidents, large overdue amounts, insurance lapses', status: 'configurable', configPath: '/admin/settings/notifications' },
  { id: 'whatsapp', name: 'WhatsApp',       icon: 'W', description: 'WhatsApp Business API for customer-facing notifications: booking confirmations, payment receipts', status: 'configurable', configPath: '/admin/settings/notifications' },
  { id: 'push',     name: 'In-App Alerts',  icon: 'A', description: 'Real-time in-app alerts and notification bell - built into the platform via the alerts system', status: 'active', configPath: '/leasing/alerts' },
  { id: 'webhook',  name: 'Webhooks',       icon: 'H', description: 'HTTP POST webhooks for external system integration - trigger on contract events, payment events', status: 'configurable', configPath: '/admin/settings/integrations' },
  { id: 'erp',      name: 'ERP / Accounting', icon: 'P', description: 'Accounting system integration: SAP, Oracle, Sage, Navision, QuickBooks - invoice and payment sync', status: 'configurable', configPath: '/admin/settings/integrations' },
];

export async function GET() {
  try {
    return await withPlatformAdmin(prisma, async (tx) => {
      // DB model counts from Prisma. The 'tx' client is the same
      // connection as `prisma` for the duration of the wrap, so
      // model counts run inside the '*' wildcard — they reflect
      // all tenants.
      const modelCounts = await Promise.allSettled([
        tx.lessee.count(),
        tx.leaseContract2.count(),
        tx.rentalBooking.count(),
        tx.tripSchedule.count(),
        tx.vehicle.count(),
        tx.driver.count(),
        tx.user.count(),
        tx.tenant.count(),
        tx.role.count(),
        tx.permission.count(),
      ]);

    const safeCount = (r: PromiseSettledResult<number>) => r.status === 'fulfilled' ? r.value : 0;

    const dbStats = {
      lessees:        safeCount(modelCounts[0]),
      leaseContracts: safeCount(modelCounts[1]),
      racBookings:    safeCount(modelCounts[2]),
      trips:          safeCount(modelCounts[3]),
      vehicles:       safeCount(modelCounts[4]),
      drivers:        safeCount(modelCounts[5]),
      users:          safeCount(modelCounts[6]),
      tenants:        safeCount(modelCounts[7]),
      roles:          safeCount(modelCounts[8]),
      permissions:    safeCount(modelCounts[9]),
    };

    // DB model inventory (from schema - static list)
    const DB_MODELS = [
      { category: 'Core / Fleet',        models: ['Vehicle','Driver','Garage','WorkOrder','MaintenanceRequest','ServiceRequest','WorkLog','ChecklistItem','PartUsage','FuelLog','FuelCard','TrafficFine','VehicleDocument','FuelCard'] },
      { category: 'Leasing',             models: ['Lessee','LeaseContract2','LeaseQuotation','LeaseInquiry','LeaseBranch','LeaseContractVehicle','LeaseVehicleExchange','LeaseAlert','LeaseApprovalStep','LeaseInsurancePolicy','LeaseInsuranceClaim','LeaseMileageReading','LeaseMileageOverage','LeaseTrafficFine','LeaseFuelLog','LeaseDocument','LeaseEarlyTermination','LeaseRenewal','LeasePreBillingStatement','LeaseCreditAssessment','LeaseTelematics'] },
      { category: 'Rent-a-Car',          models: ['RentalCustomer','RentalBooking','RentalAgreement','RentalExtension','RentalPayment','RentalAdditionalCharge','VehicleInspection','DamageClaim','PricingRule'] },
      { category: 'Staff Transport',     models: ['BusRoute','RouteStop','TripSchedule','TripPassenger','TripLog','StaffMember','StaffTransportRequest','TripIncident'] },
      { category: 'Finance',             models: ['Invoice','InvoiceLineItem','PaymentTransaction','CreditNote','FinanceBudget','VatReturn'] },
      { category: 'Compliance',          models: ['ComplianceDocument','InsurancePolicy','SalikAccount','DriverDocument','DriverShift','DriverTraining','DriverPerformance'] },
      { category: 'RBAC / Admin',        models: ['User','Tenant','TenantModule','Role','Permission','RolePermission','UserTenant'] },
      { category: 'Notifications',       models: ['AlertConfig','Alert','NotificationLog','NotificationTemplate','NotificationRule'] },
      { category: 'Reporting',           models: ['ReportSchedule','IntegrationConfig'] },
      { category: 'Bookings',            models: ['Booking'] },
    ];

    const totalModels = DB_MODELS.reduce((s, g) => s + g.models.length, 0);
    const totalEndpoints = API_ENDPOINTS.reduce((s, g) => s + g.count, 0);

    return NextResponse.json({
      platform: {
        name: 'Fleet360',
        version: '2.0.0',
        stack: 'Next.js 15 + Go + PostgreSQL + Prisma',
        modules: PLATFORM_MODULES.length,
        totalApiEndpoints: totalEndpoints,
        totalDbModels: totalModels,
        notificationChannels: NOTIFICATION_CHANNELS.length,
      },
      modules: PLATFORM_MODULES,
      apiEndpoints: API_ENDPOINTS,
      dbModels: DB_MODELS,
      notificationChannels: NOTIFICATION_CHANNELS,
      dbStats,
    });
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
