import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Platform modules with metadata
const PLATFORM_MODULES = [
  { id: 'leasing',     name: 'Vehicle Leasing',      path: '/leasing',     color: 'from-violet-500 to-purple-600',  description: 'Long-term lease contract management, quotations, payments, traffic fines, fuel, insurance, mileage, renewals, early termination, remarketing, AR' },
  { id: 'rac',         name: 'Rent-a-Car',            path: '/rental',      color: 'from-emerald-500 to-teal-600',   description: 'Short-term vehicle rental bookings, customer KYC, dynamic pricing, damage claims, agreements, availability' },
  { id: 'bus_ops',     name: 'Staff Transportation',  path: '/bus-ops',     color: 'from-purple-500 to-pink-600',    description: 'Bus route management, trip scheduling, passenger boarding, GPS integration, incident logging' },
  { id: 'fleet',       name: 'Fleet Management',      path: '/fleet',       color: 'from-orange-500 to-amber-600',   description: 'Vehicle document vault, fuel management, traffic fines, TCO analysis, asset lifecycle' },
  { id: 'maintenance', name: 'Vehicle Maintenance',   path: '/maintenance', color: 'from-blue-500 to-indigo-600',    description: 'Service requests, work orders, quotations, predictive maintenance, spare parts' },
  { id: 'finance',     name: 'Finance',               path: '/finance',     color: 'from-green-500 to-emerald-600',  description: 'Invoices, payments, VAT returns, budgets, credit notes, financial reporting' },
  { id: 'drivers',     name: 'Driver Management',     path: '/driver-mgmt', color: 'from-cyan-500 to-blue-600',     description: 'Driver profiles, license tracking, shift management, performance analytics, training records' },
  { id: 'compliance',  name: 'Compliance',            path: '/compliance',  color: 'from-rose-500 to-pink-600',      description: 'Document compliance, insurance policies, vehicle registration, regulatory tracking' },
  { id: 'reports',     name: 'Reports & Analytics',   path: '/reports',     color: 'from-slate-500 to-slate-600',    description: 'Cross-module BI dashboards, scheduled reports, data exports, KPI monitoring' },
  { id: 'admin',       name: 'Platform Admin',        path: '/admin',       color: 'from-red-500 to-rose-600',       description: 'Multi-tenant management, RBAC roles and permissions, user management, system info' },
];

// API endpoint groups
const API_ENDPOINTS = [
  { module: 'Leasing',           base: '/api/leasing',           count: 55,  endpoints: ['inquiries','quotations','contracts-v2','payments','receipts','invoices','traffic-fines','fuel','insurance','mileage-readings','mileage-overages','renewals','early-terminations','pre-billing','receivables','remarketing','documents','credit-assessments','direct-debits','analytics','crm'] },
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

export async function GET(req: NextRequest) {
  try {
    // DB model counts from Prisma
    const modelCounts = await Promise.allSettled([
      prisma.lessee.count(),
      prisma.leaseContract2.count(),
      prisma.rentalBooking.count(),
      prisma.tripSchedule.count(),
      prisma.vehicle.count(),
      prisma.driver.count(),
      prisma.user.count(),
      prisma.tenant.count(),
      prisma.role.count(),
      prisma.permission.count(),
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
      { category: 'Leasing',             models: ['Lessee','LeaseContract2','LeaseQuotation','LeaseInquiry','LeasePayment2','LeaseReceipt','LeaseBranch','LeaseContractVehicle','LeaseVehicleExchange','LeaseAlert','LeaseApprovalStep','LeaseInsurancePolicy','LeaseInsuranceClaim','LeaseMileageReading','LeaseMileageOverage','LeaseTrafficFine','LeaseFuelLog','LeaseDocument','LeaseEarlyTermination','LeaseRenewal','LeasePreBillingStatement','LeaseDunningActivity','LeaseCreditAssessment','LeaseInvoice','LeaseInvoiceLine','LeaseDirectDebit','LeaseRemarketing','LeaseTelematics'] },
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
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
