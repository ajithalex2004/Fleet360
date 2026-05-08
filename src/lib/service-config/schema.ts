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
    icon: 'Bus', tone: 'blue', sortOrder: 10, types: [],
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
    icon: 'Car', tone: 'emerald', sortOrder: 30, types: [],
  },
  {
    key: 'VEHICLE_MAINTENANCE',
    name: 'Vehicle Maintenance Services',
    description: 'Workshop operations — work orders, vendor management, parts.',
    icon: 'Wrench', tone: 'amber', sortOrder: 40, types: [],
  },
  {
    key: 'CUSTOMER_SUPPORT',
    name: 'Customer Support Services',
    description: 'Customer-facing channels — call centre, WhatsApp, chat.',
    icon: 'MessageCircle', tone: 'cyan', sortOrder: 50, types: [],
  },
];

/**
 * Idempotent seed — runs on first read for a tenant. Inserts only the rows
 * that don't already exist (matched by tenant_id + key). Safe to call
 * repeatedly; tenant edits to seeded rows are NOT overwritten.
 */
export async function seedServiceConfigForTenant(tenantId: string): Promise<void> {
  await ensureServiceConfigTables();

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
    }
  }
}

/** Used by the admin GET to make sure the tenant has its baseline catalogue. */
export async function ensureSeededForTenant(tenantId: string): Promise<void> {
  await ensureServiceConfigTables();
  // Cheap existence check — if the tenant has zero rows, seed once.
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM service_categories WHERE tenant_id = $1`,
    tenantId,
  ).catch(() => [{ count: BigInt(0) }]);
  const count = Number(rows[0]?.count ?? BigInt(0));
  if (count === 0) await seedServiceConfigForTenant(tenantId);
}
