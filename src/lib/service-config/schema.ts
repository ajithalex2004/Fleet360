/**
 * Lazy-creates the Service Configuration Engine tables (Phase 2A).
 *
 * Three tables, all tenant-scoped:
 *   service_categories       — L1 hierarchy (5 seeded defaults per tenant)
 *   service_types            — L2 hierarchy (7 seeded under Operation Support)
 *   service_module_mapping   — module dependency mapping per type
 *
 * On first access for a tenant we seed the platform defaults so every tenant
 * starts with a working catalogue. Existing modules (Service & Support
 * Ticketing) keep working unchanged — the seed is informational metadata,
 * not an authority swap. The authority swap happens in Phase 2C.
 */

import { prisma } from '@/lib/prisma';
import type { LinkedModule } from '@/types/service-config';
import { ensureServiceRulesTable, seedRulesIfAbsent, backfillRulesToScope } from './rules-schema';
import { ensureScopesTable, ensureRootScope } from './scopes-schema';
import { SYSTEM_TICKET_TYPES } from './system-types-seed';
import {
  DEFAULT_APPROVAL_RULES, DEFAULT_TICKETING_RULES, DEFAULT_FORM_FIELDS_RULES,
  DEFAULT_VEHICLE_RULES,
  type ApprovalRules, type TicketingRules, type FormFieldsRules,
  type VehicleRules,
} from '@/types/service-rules';
import type { TicketType } from '@/types/service-tickets';

let _ensured = false;

export async function ensureServiceConfigTables(): Promise<void> {
  if (_ensured) return;

  // Categories — L1
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS service_categories (
      id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id    TEXT         NOT NULL,
      key          TEXT         NOT NULL,
      name         TEXT         NOT NULL,
      description  TEXT,
      icon         TEXT,
      tone         TEXT         NOT NULL DEFAULT 'violet',
      sort_order   INTEGER      NOT NULL DEFAULT 0,
      is_system    BOOLEAN      NOT NULL DEFAULT FALSE,
      created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      deleted_at   TIMESTAMPTZ,
      UNIQUE (tenant_id, key)
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_service_categories_tenant
     ON service_categories (tenant_id) WHERE deleted_at IS NULL`,
  );

  // Types — L2
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS service_types (
      id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id         TEXT         NOT NULL,
      category_id       UUID         NOT NULL,
      key               TEXT         NOT NULL,
      name              TEXT         NOT NULL,
      description       TEXT,
      icon              TEXT,
      tone              TEXT         NOT NULL DEFAULT 'violet',
      default_priority  TEXT         NOT NULL DEFAULT 'Medium',
      sort_order        INTEGER      NOT NULL DEFAULT 0,
      is_system         BOOLEAN      NOT NULL DEFAULT FALSE,
      created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      deleted_at        TIMESTAMPTZ,
      UNIQUE (tenant_id, key)
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_service_types_tenant_category
     ON service_types (tenant_id, category_id) WHERE deleted_at IS NULL`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_service_types_tenant
     ON service_types (tenant_id) WHERE deleted_at IS NULL`,
  );

  // Module mapping — one row per service type
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS service_module_mapping (
      service_type_id              UUID         PRIMARY KEY,
      linked_module                TEXT         NOT NULL,
      sub_module                   TEXT,
      workflow_engine_enabled      BOOLEAN      NOT NULL DEFAULT FALSE,
      notification_engine_enabled  BOOLEAN      NOT NULL DEFAULT TRUE,
      approval_engine_enabled      BOOLEAN      NOT NULL DEFAULT FALSE,
      finance_engine_enabled       BOOLEAN      NOT NULL DEFAULT FALSE,
      dispatch_engine_enabled      BOOLEAN      NOT NULL DEFAULT FALSE,
      updated_at                   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  _ensured = true;
}

/**
 * Platform-default catalogue. The 7 ticket types from Phase 1A appear under
 * "Operation Support Services" so the existing module shows up in the new
 * hierarchy with no behaviour change. Other categories ship empty — the
 * tenant adds their own service types as those modules come online.
 */
interface SeedCategory {
  key: string;
  name: string;
  description: string;
  icon: string;
  tone: 'gold' | 'blue' | 'emerald' | 'amber' | 'rose' | 'slate' | 'violet' | 'cyan';
  sortOrder: number;
  types: SeedType[];
}
interface SeedType {
  key: string;
  name: string;
  description: string;
  icon: string;
  tone: 'gold' | 'blue' | 'emerald' | 'amber' | 'rose' | 'slate' | 'violet' | 'cyan';
  defaultPriority: 'Low' | 'Medium' | 'High';
  sortOrder: number;
  module: {
    linkedModule: LinkedModule;
    subModule: string | null;
    workflow: boolean;
    notification: boolean;
    approval: boolean;
    finance: boolean;
    dispatch: boolean;
  };
}

const SEED: SeedCategory[] = [
  {
    key: 'TRANSPORTATION',
    name: 'Transportation Services',
    description: 'Passenger movement — airport transfers, limousine, staff transport, school bus, rentals.',
    icon: 'Bus', tone: 'blue', sortOrder: 10,
    types: [
      {
        key: 'STAFF_TRANSPORT_REQUEST', name: 'Transport Request',
        description: 'Employee or client transport request intake for staff mobility operations.',
        icon: 'Route', tone: 'blue', defaultPriority: 'Medium', sortOrder: 10,
        module: { linkedModule: 'STAFF_TRANSPORT', subModule: 'Requests',
          workflow: true, notification: true, approval: true, finance: false, dispatch: true },
      },
      {
        key: 'STAFF_ROUTE_ASSIGNMENT', name: 'Route Assignment',
        description: 'Assign riders to a staff transport route, shift, or operating corridor.',
        icon: 'MapPinned', tone: 'cyan', defaultPriority: 'Medium', sortOrder: 20,
        module: { linkedModule: 'STAFF_TRANSPORT', subModule: 'Route Planning',
          workflow: true, notification: true, approval: false, finance: false, dispatch: true },
      },
      {
        key: 'STAFF_TRIP_SCHEDULING', name: 'Trip Scheduling',
        description: 'Schedule recurring or one-off staff transport trips and operating windows.',
        icon: 'CalendarClock', tone: 'emerald', defaultPriority: 'Medium', sortOrder: 30,
        module: { linkedModule: 'STAFF_TRANSPORT', subModule: 'Trip Scheduling',
          workflow: true, notification: true, approval: false, finance: false, dispatch: true },
      },
      {
        key: 'STAFF_ATTENDANCE_EXCEPTION', name: 'Attendance Exception',
        description: 'Track missed pickup, rider absence, or attendance reconciliation issues.',
        icon: 'ClipboardAlert', tone: 'amber', defaultPriority: 'Medium', sortOrder: 40,
        module: { linkedModule: 'STAFF_TRANSPORT', subModule: 'Attendance',
          workflow: true, notification: true, approval: false, finance: false, dispatch: false },
      },
      {
        key: 'STAFF_BILLING_EXCEPTION', name: 'Billing Exceptions',
        description: 'Review staff transport billing disputes, short charges, and invoice adjustments.',
        icon: 'ReceiptText', tone: 'rose', defaultPriority: 'High', sortOrder: 50,
        module: { linkedModule: 'STAFF_TRANSPORT', subModule: 'Billing',
          workflow: true, notification: true, approval: true, finance: true, dispatch: false },
      },
      {
        key: 'SCHOOL_TRANSPORT_REGISTRATION', name: 'Student Transport Registration',
        description: 'Onboard a student or guardian request into the school transport roster.',
        icon: 'School', tone: 'blue', defaultPriority: 'Medium', sortOrder: 60,
        module: { linkedModule: 'SCHOOL_BUS', subModule: 'Registration',
          workflow: true, notification: true, approval: true, finance: false, dispatch: false },
      },
      {
        key: 'SCHOOL_ROUTE_ALLOCATION', name: 'Route Allocation',
        description: 'Assign students to routes, buses, and stop plans for school transport.',
        icon: 'Map', tone: 'cyan', defaultPriority: 'Medium', sortOrder: 70,
        module: { linkedModule: 'SCHOOL_BUS', subModule: 'Routing',
          workflow: true, notification: true, approval: false, finance: false, dispatch: true },
      },
      {
        key: 'SCHOOL_ATTENDANCE_EXCEPTION', name: 'Attendance Exception',
        description: 'Manage absences, missed boardings, and guardian follow-up exceptions.',
        icon: 'UserRoundX', tone: 'amber', defaultPriority: 'Medium', sortOrder: 80,
        module: { linkedModule: 'SCHOOL_BUS', subModule: 'Attendance',
          workflow: true, notification: true, approval: false, finance: false, dispatch: false },
      },
      {
        key: 'SCHOOL_SAFETY_INCIDENT_REVIEW', name: 'Safety Incident Review',
        description: 'Investigate and approve follow-up actions for school transport safety events.',
        icon: 'ShieldAlert', tone: 'rose', defaultPriority: 'High', sortOrder: 90,
        module: { linkedModule: 'SCHOOL_BUS', subModule: 'Safety',
          workflow: true, notification: true, approval: true, finance: false, dispatch: true },
      },
      {
        key: 'SCHOOL_BILLING_EXCEPTION', name: 'Billing Exceptions',
        description: 'Handle fee disputes, transport plan changes, and school transport billing adjustments.',
        icon: 'BadgeDollarSign', tone: 'violet', defaultPriority: 'High', sortOrder: 100,
        module: { linkedModule: 'SCHOOL_BUS', subModule: 'Billing',
          workflow: true, notification: true, approval: true, finance: true, dispatch: false },
      },
    ],
  },
  {
    key: 'OPERATION_SUPPORT',
    name: 'Operation Support Services',
    description: 'Tickets, incidents, complaints and ad-hoc operational requests.',
    icon: 'Headphones', tone: 'violet', sortOrder: 20,
    types: [
      {
        key: 'MAINTENANCE', name: 'Maintenance Request',
        description: 'Vehicle breakdown, scheduled servicing, repairs.',
        icon: 'Wrench', tone: 'blue', defaultPriority: 'Medium', sortOrder: 10,
        module: { linkedModule: 'SERVICE_TICKETING', subModule: 'Maintenance Tickets',
          workflow: true, notification: true, approval: true, finance: false, dispatch: false },
      },
      {
        key: 'RENEWAL', name: 'Renewal Request',
        description: 'Mulkiya, RTA permit, salik, licence and document renewals.',
        icon: 'Calendar', tone: 'gold', defaultPriority: 'Low', sortOrder: 20,
        module: { linkedModule: 'SERVICE_TICKETING', subModule: 'Renewal Tickets',
          workflow: true, notification: true, approval: true, finance: false, dispatch: false },
      },
      {
        key: 'CLEANING', name: 'Vehicle Cleaning',
        description: 'Interior / exterior detailing, sanitisation, deep cleaning.',
        icon: 'Sparkles', tone: 'emerald', defaultPriority: 'Low', sortOrder: 30,
        module: { linkedModule: 'SERVICE_TICKETING', subModule: 'Cleaning Tickets',
          workflow: false, notification: true, approval: false, finance: false, dispatch: false },
      },
      {
        key: 'SUPPORT', name: 'Support Ticket',
        description: 'Platform support — login, data correction, configuration help.',
        icon: 'LifeBuoy', tone: 'blue', defaultPriority: 'Medium', sortOrder: 40,
        module: { linkedModule: 'SERVICE_TICKETING', subModule: 'Support Tickets',
          workflow: false, notification: true, approval: false, finance: false, dispatch: false },
      },
      {
        key: 'INCIDENT', name: 'Incident Report',
        description: 'Accidents, safety incidents, on-road events.',
        icon: 'Siren', tone: 'rose', defaultPriority: 'High', sortOrder: 50,
        module: { linkedModule: 'SERVICE_TICKETING', subModule: 'Incident Tickets',
          workflow: true, notification: true, approval: true, finance: false, dispatch: true },
      },
      {
        key: 'TOWING', name: 'Towing & Recovery',
        description: 'Roadside breakdown recovery and vehicle relocation.',
        icon: 'Truck', tone: 'amber', defaultPriority: 'High', sortOrder: 60,
        module: { linkedModule: 'SERVICE_TICKETING', subModule: 'Towing Tickets',
          workflow: false, notification: true, approval: false, finance: true, dispatch: true },
      },
      {
        key: 'COMPLAINT', name: 'Complaint or Suggestion',
        description: 'Customer feedback, service complaints, improvement suggestions.',
        icon: 'MessageSquareWarning', tone: 'violet', defaultPriority: 'Medium', sortOrder: 70,
        module: { linkedModule: 'SERVICE_TICKETING', subModule: 'Complaint Tickets',
          workflow: false, notification: true, approval: false, finance: false, dispatch: false },
      },
    ],
  },
  {
    key: 'FLEET_MANAGEMENT',
    name: 'Fleet Management Services',
    description: 'Lifecycle — leasing, rental, ownership, registration, telematics.',
    icon: 'Car', tone: 'emerald', sortOrder: 30,
    types: [
      {
        key: 'LEASING_ENQUIRIES', name: 'Enquiries',
        description: 'Capture and qualify new leasing prospects and customer demand signals.',
        icon: 'MessagesSquare', tone: 'blue', defaultPriority: 'Medium', sortOrder: 10,
        module: { linkedModule: 'LEASING', subModule: 'Enquiries',
          workflow: true, notification: true, approval: false, finance: false, dispatch: false },
      },
      {
        key: 'LEASING_QUOTATIONS', name: 'Quotations',
        description: 'Prepare, revise, and issue leasing quotations for prospective customers.',
        icon: 'FileText', tone: 'cyan', defaultPriority: 'Medium', sortOrder: 20,
        module: { linkedModule: 'LEASING', subModule: 'Quotations',
          workflow: true, notification: true, approval: false, finance: true, dispatch: false },
      },
      {
        key: 'LEASING_CREDIT_APPROVAL', name: 'Credit Approval',
        description: 'Run credit review, internal approval, and decision tracking for a leasing customer.',
        icon: 'ShieldCheck', tone: 'amber', defaultPriority: 'High', sortOrder: 30,
        module: { linkedModule: 'LEASING', subModule: 'Credit Approval',
          workflow: true, notification: true, approval: true, finance: true, dispatch: false },
      },
      {
        key: 'LEASING_CONTRACT_ACTIVATION', name: 'Contract Activation',
        description: 'Activate an approved lease contract and release it into operations and billing.',
        icon: 'FileSignature', tone: 'emerald', defaultPriority: 'High', sortOrder: 40,
        module: { linkedModule: 'LEASING', subModule: 'Contracts',
          workflow: true, notification: true, approval: true, finance: true, dispatch: false },
      },
      {
        key: 'LEASING_HANDOVER', name: 'Handover',
        description: 'Coordinate vehicle delivery, inspection, and customer handover for a live lease.',
        icon: 'KeyRound', tone: 'blue', defaultPriority: 'Medium', sortOrder: 50,
        module: { linkedModule: 'LEASING', subModule: 'Handover',
          workflow: true, notification: true, approval: false, finance: false, dispatch: true },
      },
      {
        key: 'LEASING_RETURN', name: 'Return',
        description: 'Manage lease return inspection, settlement, and off-hire workflow.',
        icon: 'Undo2', tone: 'violet', defaultPriority: 'High', sortOrder: 60,
        module: { linkedModule: 'LEASING', subModule: 'Return',
          workflow: true, notification: true, approval: false, finance: true, dispatch: true },
      },
      {
        key: 'LEASING_BILLING_EXCEPTION', name: 'Billing Exceptions',
        description: 'Review disputed lease charges, pro-rata issues, and contract billing adjustments.',
        icon: 'ReceiptText', tone: 'rose', defaultPriority: 'High', sortOrder: 70,
        module: { linkedModule: 'LEASING', subModule: 'Billing',
          workflow: true, notification: true, approval: true, finance: true, dispatch: false },
      },
      {
        key: 'RAC_RESERVATIONS', name: 'Reservations',
        description: 'Create and manage rental reservations across channels and customer accounts.',
        icon: 'BookOpenCheck', tone: 'blue', defaultPriority: 'Medium', sortOrder: 110,
        module: { linkedModule: 'RAC', subModule: 'Reservations',
          workflow: true, notification: true, approval: false, finance: false, dispatch: false },
      },
      {
        key: 'RAC_QUOTATIONS', name: 'Quotations',
        description: 'Prepare rental pricing offers, rate exceptions, and negotiated customer quotes.',
        icon: 'FileBadge2', tone: 'cyan', defaultPriority: 'Medium', sortOrder: 120,
        module: { linkedModule: 'RAC', subModule: 'Quotations',
          workflow: true, notification: true, approval: false, finance: true, dispatch: false },
      },
      {
        key: 'RAC_RENTAL_AGREEMENT', name: 'Rental Agreement Creation',
        description: 'Create the formal rental agreement before vehicle release and charge capture.',
        icon: 'ScrollText', tone: 'emerald', defaultPriority: 'High', sortOrder: 130,
        module: { linkedModule: 'RAC', subModule: 'Rental Agreements',
          workflow: true, notification: true, approval: true, finance: true, dispatch: false },
      },
      {
        key: 'RAC_CHECKOUT_HANDOVER', name: 'Check-Out / Handover',
        description: 'Run rental handover, pickup inspection, and customer release workflow.',
        icon: 'CarFront', tone: 'blue', defaultPriority: 'Medium', sortOrder: 140,
        module: { linkedModule: 'RAC', subModule: 'Handover',
          workflow: true, notification: true, approval: false, finance: false, dispatch: true },
      },
      {
        key: 'RAC_CHECKIN_RETURN', name: 'Check-In / Return',
        description: 'Process rental returns, closeout checks, and chargeable exception review.',
        icon: 'RotateCcwSquare', tone: 'violet', defaultPriority: 'High', sortOrder: 150,
        module: { linkedModule: 'RAC', subModule: 'Return',
          workflow: true, notification: true, approval: false, finance: true, dispatch: true },
      },
      {
        key: 'RAC_DAMAGE_INSPECTION', name: 'Damage Inspection',
        description: 'Assess damage evidence, responsibility, and downstream charge or repair actions.',
        icon: 'ShieldAlert', tone: 'amber', defaultPriority: 'High', sortOrder: 160,
        module: { linkedModule: 'RAC', subModule: 'Damage',
          workflow: true, notification: true, approval: true, finance: true, dispatch: false },
      },
      {
        key: 'RAC_BILLING_EXCEPTION', name: 'Billing Exceptions',
        description: 'Resolve rental invoice disputes, deposit issues, and post-rental financial adjustments.',
        icon: 'BadgeDollarSign', tone: 'rose', defaultPriority: 'High', sortOrder: 170,
        module: { linkedModule: 'RAC', subModule: 'Billing',
          workflow: true, notification: true, approval: true, finance: true, dispatch: false },
      },
    ],
  },
  {
    key: 'VEHICLE_MAINTENANCE',
    name: 'Vehicle Maintenance Services',
    description: 'Workshop operations — work orders, vendor management, parts.',
    icon: 'Wrench', tone: 'amber', sortOrder: 40,
    types: [
      {
        key: 'MAINTENANCE_REQUEST_APPROVAL', name: 'Maintenance Request Approval',
        description: 'Approve a maintenance request before it moves into workshop planning or vendor allocation.',
        icon: 'ClipboardCheck', tone: 'amber', defaultPriority: 'High', sortOrder: 10,
        module: { linkedModule: 'MAINTENANCE', subModule: 'Requests',
          workflow: true, notification: true, approval: true, finance: false, dispatch: false },
      },
      {
        key: 'MAINTENANCE_WORK_ORDER', name: 'Work Order',
        description: 'Create and route workshop work orders through execution planning and ownership.',
        icon: 'FileCog', tone: 'blue', defaultPriority: 'Medium', sortOrder: 20,
        module: { linkedModule: 'MAINTENANCE', subModule: 'Work Orders',
          workflow: true, notification: true, approval: false, finance: false, dispatch: false },
      },
      {
        key: 'MAINTENANCE_ESTIMATE_APPROVAL', name: 'Estimate Approval',
        description: 'Approve workshop quotations, parts estimates, and external vendor spend before execution.',
        icon: 'BadgeDollarSign', tone: 'rose', defaultPriority: 'High', sortOrder: 30,
        module: { linkedModule: 'MAINTENANCE', subModule: 'Estimates',
          workflow: true, notification: true, approval: true, finance: true, dispatch: false },
      },
      {
        key: 'MAINTENANCE_VENDOR_ASSIGNMENT', name: 'Vendor Assignment',
        description: 'Assign the job to a garage, workshop, or service vendor with routing visibility.',
        icon: 'Building2', tone: 'cyan', defaultPriority: 'Medium', sortOrder: 40,
        module: { linkedModule: 'MAINTENANCE', subModule: 'Vendors',
          workflow: true, notification: true, approval: false, finance: false, dispatch: false },
      },
      {
        key: 'MAINTENANCE_COMPLETION_REVIEW', name: 'Completion Review',
        description: 'Review completed work, validate execution, and close the maintenance workflow safely.',
        icon: 'CheckCheck', tone: 'emerald', defaultPriority: 'Medium', sortOrder: 50,
        module: { linkedModule: 'MAINTENANCE', subModule: 'Completion',
          workflow: true, notification: true, approval: true, finance: false, dispatch: false },
      },
      {
        key: 'MAINTENANCE_BILLING_EXCEPTION', name: 'Billing Exceptions',
        description: 'Handle invoice mismatches, excess charges, and maintenance spend exceptions.',
        icon: 'ReceiptText', tone: 'violet', defaultPriority: 'High', sortOrder: 60,
        module: { linkedModule: 'MAINTENANCE', subModule: 'Billing',
          workflow: true, notification: true, approval: true, finance: true, dispatch: false },
      },
    ],
  },
  {
    key: 'DRIVER_MANAGEMENT',
    name: 'Driver Management Services',
    description: 'Driver lifecycle, compliance, assignment, and performance governance.',
    icon: 'UserCog', tone: 'cyan', sortOrder: 50,
    types: [
      {
        key: 'DRIVER_ONBOARDING', name: 'Driver Onboarding',
        description: 'Onboard a new driver profile, documentation set, and readiness checklist.',
        icon: 'UserRoundPlus', tone: 'blue', defaultPriority: 'Medium', sortOrder: 10,
        module: { linkedModule: 'DRIVERS', subModule: 'Profiles',
          workflow: true, notification: true, approval: true, finance: false, dispatch: false },
      },
      {
        key: 'DRIVER_ASSIGNMENT', name: 'Driver Assignment',
        description: 'Approve or route assignment of a driver to a route, vehicle, or operating contract.',
        icon: 'ClipboardList', tone: 'emerald', defaultPriority: 'Medium', sortOrder: 20,
        module: { linkedModule: 'DRIVERS', subModule: 'Assignments',
          workflow: true, notification: true, approval: false, finance: false, dispatch: true },
      },
      {
        key: 'DRIVER_LICENSE_RENEWAL', name: 'Licence Renewal',
        description: 'Track licence and permit renewal workflow for driver compliance continuity.',
        icon: 'IdCard', tone: 'amber', defaultPriority: 'High', sortOrder: 30,
        module: { linkedModule: 'DRIVERS', subModule: 'Compliance',
          workflow: true, notification: true, approval: true, finance: false, dispatch: false },
      },
      {
        key: 'DRIVER_INCIDENT_REVIEW', name: 'Incident Review',
        description: 'Investigate driver incidents and route corrective actions through formal review.',
        icon: 'ShieldAlert', tone: 'rose', defaultPriority: 'High', sortOrder: 40,
        module: { linkedModule: 'DRIVERS', subModule: 'Incidents',
          workflow: true, notification: true, approval: true, finance: false, dispatch: false },
      },
      {
        key: 'DRIVER_COMPLIANCE_EXCEPTION', name: 'Compliance Exception',
        description: 'Escalate expiring documents, training gaps, and driver readiness exceptions.',
        icon: 'AlertTriangle', tone: 'violet', defaultPriority: 'High', sortOrder: 50,
        module: { linkedModule: 'DRIVERS', subModule: 'Compliance',
          workflow: true, notification: true, approval: true, finance: false, dispatch: false },
      },
    ],
  },
  {
    key: 'CUSTOMER_SUPPORT',
    name: 'Customer Support Services',
    description: 'Customer-facing channels — call centre, WhatsApp, chat.',
    icon: 'MessageCircle', tone: 'cyan', sortOrder: 60, types: [],
  },
  {
    key: 'FINANCE_CONTROLS',
    name: 'Finance Control Services',
    description: 'Exception-led finance workflows across billing, expenses, receivables, and budgets.',
    icon: 'WalletCards', tone: 'emerald', sortOrder: 70,
    types: [
      {
        key: 'FINANCE_BILLING_EXCEPTION', name: 'Billing Exception',
        description: 'Review billing mismatches, disputed invoices, and invoice release blockers.',
        icon: 'ReceiptText', tone: 'rose', defaultPriority: 'High', sortOrder: 10,
        module: { linkedModule: 'FINANCE', subModule: 'Billing Exceptions',
          workflow: true, notification: true, approval: true, finance: true, dispatch: false },
      },
      {
        key: 'FINANCE_EXPENSE_EXCEPTION', name: 'Expense Exception',
        description: 'Escalate out-of-policy costs, missing support, or unusual finance spend activity.',
        icon: 'BadgeAlert', tone: 'amber', defaultPriority: 'High', sortOrder: 20,
        module: { linkedModule: 'FINANCE', subModule: 'Expenses',
          workflow: true, notification: true, approval: true, finance: true, dispatch: false },
      },
      {
        key: 'FINANCE_BUDGET_EXCEPTION', name: 'Budget Exception',
        description: 'Control budget overruns, exception releases, and non-standard finance approvals.',
        icon: 'ChartNoAxesCombined', tone: 'blue', defaultPriority: 'High', sortOrder: 30,
        module: { linkedModule: 'FINANCE', subModule: 'Budget Approvals',
          workflow: true, notification: true, approval: true, finance: true, dispatch: false },
      },
      {
        key: 'FINANCE_RECEIVABLE_EXCEPTION', name: 'Receivable Exception',
        description: 'Manage collection risks, overdue disputes, and receivable escalation workflows.',
        icon: 'Landmark', tone: 'violet', defaultPriority: 'High', sortOrder: 40,
        module: { linkedModule: 'FINANCE', subModule: 'Receivables',
          workflow: true, notification: true, approval: true, finance: true, dispatch: false },
      },
    ],
  },
  {
    key: 'PLATFORM_ADMIN',
    name: 'Platform Administration Services',
    description: 'Govern platform change control, access administration, and core tenancy operations.',
    icon: 'ShieldCheck', tone: 'violet', sortOrder: 80,
    types: [
      {
        key: 'ADMIN_USER_PROVISIONING', name: 'User Provisioning',
        description: 'Create, activate, deactivate, or correct access for platform and tenant users.',
        icon: 'UserPlus', tone: 'blue', defaultPriority: 'Medium', sortOrder: 10,
        module: { linkedModule: 'ADMIN', subModule: 'Users',
          workflow: true, notification: true, approval: true, finance: false, dispatch: false },
      },
      {
        key: 'ADMIN_ROLE_PERMISSION_CHANGE', name: 'Role / Permission Change',
        description: 'Approve and manage changes to roles, permissions, and access boundaries.',
        icon: 'KeySquare', tone: 'amber', defaultPriority: 'High', sortOrder: 20,
        module: { linkedModule: 'ADMIN', subModule: 'Roles & Permissions',
          workflow: true, notification: true, approval: true, finance: false, dispatch: false },
      },
      {
        key: 'ADMIN_WORKFLOW_CHANGE', name: 'Workflow Change',
        description: 'Control changes to workflow templates, approvers, and routing policies.',
        icon: 'Workflow', tone: 'cyan', defaultPriority: 'High', sortOrder: 30,
        module: { linkedModule: 'ADMIN', subModule: 'Workflows',
          workflow: true, notification: true, approval: true, finance: false, dispatch: false },
      },
      {
        key: 'ADMIN_SERVICE_CONFIGURATION_CHANGE', name: 'Service Configuration Change',
        description: 'Govern changes to service types, mappings, rules, and notification behavior.',
        icon: 'Settings2', tone: 'violet', defaultPriority: 'High', sortOrder: 40,
        module: { linkedModule: 'ADMIN', subModule: 'Service Configuration',
          workflow: true, notification: true, approval: true, finance: false, dispatch: false },
      },
      {
        key: 'ADMIN_BILLING_PLAN_CHANGE', name: 'Billing Plan Change',
        description: 'Approve subscription, commercial plan, or billing model changes for a tenant.',
        icon: 'CreditCard', tone: 'rose', defaultPriority: 'High', sortOrder: 50,
        module: { linkedModule: 'ADMIN', subModule: 'Billing & Subscriptions',
          workflow: true, notification: true, approval: true, finance: true, dispatch: false },
      },
    ],
  },
];

const EXPECTED_SYSTEM_CATEGORY_COUNT = SEED.length;
const EXPECTED_SYSTEM_TYPE_COUNT = SEED.reduce((total, category) => total + category.types.length, 0);

/**
 * Idempotent seed — runs on first read for a tenant. Inserts only the rows
 * that don't already exist (matched by tenant_id + key). Safe to call
 * repeatedly; tenant edits to seeded rows are NOT overwritten.
 */
export async function seedServiceConfigForTenant(tenantId: string): Promise<void> {
  await ensureServiceConfigTables();
  await ensureScopesTable();
  // Phase 2E — make sure the tenant has its root scope before any
  // service_rules are seeded. Backfill any existing pre-2E rules onto it.
  const rootScopeId = await ensureRootScope(tenantId);
  await backfillRulesToScope(tenantId, rootScopeId);

  // Categories — INSERT ... ON CONFLICT DO NOTHING.
  for (const cat of SEED) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO service_categories
        (tenant_id, key, name, description, icon, tone, sort_order, is_system)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
       ON CONFLICT (tenant_id, key) DO NOTHING`,
      tenantId, cat.key, cat.name, cat.description, cat.icon, cat.tone, cat.sortOrder,
    );
  }

  // Types — need the parent category id, fetch in one shot.
  const cats = await prisma.$queryRawUnsafe<Array<{ id: string; key: string }>>(
    `SELECT id::text, key FROM service_categories WHERE tenant_id = $1 AND deleted_at IS NULL`,
    tenantId,
  );
  const catByKey = new Map(cats.map(c => [c.key, c.id]));

  for (const cat of SEED) {
    const categoryId = catByKey.get(cat.key);
    if (!categoryId) continue;
    for (const t of cat.types) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO service_types
          (tenant_id, category_id, key, name, description, icon, tone, default_priority, sort_order, is_system)
         VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, TRUE)
         ON CONFLICT (tenant_id, key) DO NOTHING`,
        tenantId, categoryId, t.key, t.name, t.description, t.icon, t.tone, t.defaultPriority, t.sortOrder,
      );

      // Mapping row, only seeded if absent.
      const newType = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text FROM service_types WHERE tenant_id = $1 AND key = $2 LIMIT 1`,
        tenantId, t.key,
      );
      const typeId = newType[0]?.id;
      if (!typeId) continue;
      await prisma.$executeRawUnsafe(
        `INSERT INTO service_module_mapping
           (service_type_id, linked_module, sub_module,
            workflow_engine_enabled, notification_engine_enabled, approval_engine_enabled,
            finance_engine_enabled, dispatch_engine_enabled)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (service_type_id) DO NOTHING`,
        typeId, t.module.linkedModule, t.module.subModule,
        t.module.workflow, t.module.notification, t.module.approval,
        t.module.finance, t.module.dispatch,
      );

      // Phase 2C — for the 7 system ticket types, seed approval + ticketing
      // rules from TICKET_TYPE_CONFIG so day-one behaviour matches the
      // hardcoded config exactly. Modules read from service_rules and get
      // identical results until an admin overrides via the UI.
      // Phase 2E — seeded rules attach to the tenant root scope.
      if (t.module.linkedModule === 'SERVICE_TICKETING') {
        await seedRulesFromTicketingConfig(typeId, t.key as TicketType, rootScopeId);
      }
    }
  }
}

/**
 * Seed approval + ticketing rules for one ticket-type-backed service type
 * from TICKET_TYPE_CONFIG. Idempotent — does not overwrite admin edits.
 */
async function seedRulesFromTicketingConfig(
  serviceTypeId: string,
  ticketType: TicketType,
  scopeId: string,
): Promise<void> {
  await ensureServiceRulesTable();
  const cfg = SYSTEM_TICKET_TYPES[ticketType];
  if (!cfg) return;

  // Approval — preserve the highPriorityOnly / always semantics by mapping
  // to the new approval rule shape.
  const approval: ApprovalRules = {
    ...DEFAULT_APPROVAL_RULES,
    approvalRequired: !!cfg.requiresApproval?.always,
    // highPriorityOnly is conveyed by emergencyBypass=false + approvalRequired
    // staying false here (the helper handles the High-priority path explicitly).
    emergencyBypassEnabled: false,
  };

  // Ticketing — prefix, priority matrix from defaultSlaHours, and the
  // MAINTENANCE-only auto-create-MR bridge flag (only true for the
  // MAINTENANCE service type).
  const sla = cfg.defaultSlaHours;
  const ticketing: TicketingRules = {
    ...DEFAULT_TICKETING_RULES,
    ticketPrefix: cfg.prefix,
    priorityMatrix: {
      Low:    Math.max(sla * 3, sla),
      Medium: sla,
      High:   Math.max(Math.round(sla / 4), 1),
    },
    autoCreatesMaintenanceRequest: !!cfg.autoCreatesMaintenanceRequest,
  };

  // Form fields — bring the per-type formFields schema into rules so
  // admins can edit without code changes (Phase 2B.formFields).
  const formFields: FormFieldsRules = {
    ...DEFAULT_FORM_FIELDS_RULES,
    fields: cfg.formFields ?? [],
  };

  // Vehicle — vehicleRequired migrates from TICKET_TYPE_CONFIG into the
  // central VehicleRules.vehicleRequired flag (Phase 2D finish-migration).
  const vehicle: VehicleRules = {
    ...DEFAULT_VEHICLE_RULES,
    vehicleRequired: !!cfg.vehicleRequired,
  };

  await seedRulesIfAbsent(serviceTypeId, 'approval',   approval,   scopeId);
  await seedRulesIfAbsent(serviceTypeId, 'ticketing',  ticketing,  scopeId);
  await seedRulesIfAbsent(serviceTypeId, 'formFields', formFields, scopeId);
  await seedRulesIfAbsent(serviceTypeId, 'vehicle',    vehicle,    scopeId);
}

/** Process-level cache so we don't re-run the COUNT(*) check on every
 *  hot-path resolver call. Tenants seeded earlier in the lifetime of
 *  this Node process skip the check entirely. */
const _seededTenants = new Set<string>();

/**
 * Used by every entry point that reads from the engine — admin GETs,
 * the public form-fields endpoint, and (transparently) every resolver
 * via loadServiceConfig. After this returns, the tenant is guaranteed
 * to have its baseline catalogue and the 7 system service-rule rows.
 */
export async function ensureSeededForTenant(tenantId: string): Promise<void> {
  if (_seededTenants.has(tenantId)) return;
  await ensureServiceConfigTables();
  const counts = await prisma.$queryRawUnsafe<Array<{ categories: bigint; types: bigint }>>(
    `SELECT
        COALESCE((SELECT COUNT(*)::bigint FROM service_categories WHERE tenant_id = $1 AND is_system = TRUE AND deleted_at IS NULL), 0::bigint) AS categories,
        COALESCE((SELECT COUNT(*)::bigint FROM service_types WHERE tenant_id = $1 AND is_system = TRUE AND deleted_at IS NULL), 0::bigint) AS types`,
    tenantId,
  ).catch(() => [{ categories: BigInt(0), types: BigInt(0) }]);

  const categoryCount = Number(counts[0]?.categories ?? BigInt(0));
  const typeCount = Number(counts[0]?.types ?? BigInt(0));
  if (categoryCount < EXPECTED_SYSTEM_CATEGORY_COUNT || typeCount < EXPECTED_SYSTEM_TYPE_COUNT) {
    await seedServiceConfigForTenant(tenantId);
  }
  _seededTenants.add(tenantId);
}
