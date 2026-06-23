/**
 * Leasing Service Catalog Master.
 *
 * Tenant-scoped quotation add-ons used by Vehicle Leasing quotations. This
 * replaces hardcoded UI presets with configurable data-master rows that can
 * be edited from Admin > Service Configuration.
 */

import { prisma } from '@/lib/prisma';

export const LEASING_QUOTATION_SERVICE_TYPE_KEY = 'LEASING_QUOTATIONS';

export const LEASING_CATALOG_ITEM_TYPES = ['ACCESSORY', 'SERVICE', 'OTHER'] as const;
export type LeasingCatalogItemType = typeof LEASING_CATALOG_ITEM_TYPES[number];

export interface LeasingServiceCatalogItem {
  id: string;
  tenantId: string;
  serviceTypeKey: string;
  code: string;
  itemType: LeasingCatalogItemType;
  name: string;
  description: string | null;
  unitRate: number;
  currency: string;
  pricingBasis: 'MONTHLY';
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  tenant_id: string;
  service_type_key: string;
  code: string;
  item_type: string;
  name: string;
  description: string | null;
  unit_rate: string | number | null;
  currency: string | null;
  pricing_basis: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const SELECT = `id::text, tenant_id, service_type_key, code, item_type, name,
  description, unit_rate, currency, pricing_basis, is_active, sort_order,
  created_at::text, updated_at::text`;

const DEFAULT_LEASING_QUOTATION_CATALOG: Array<Omit<LeasingServiceCatalogItem, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>> = [
  { serviceTypeKey: LEASING_QUOTATION_SERVICE_TYPE_KEY, code: 'GPS_TRACKER', itemType: 'ACCESSORY', name: 'GPS tracker', description: 'Monthly GPS tracking device/service for leased vehicles.', unitRate: 75, currency: 'AED', pricingBasis: 'MONTHLY', isActive: true, sortOrder: 10 },
  { serviceTypeKey: LEASING_QUOTATION_SERVICE_TYPE_KEY, code: 'CHILD_SEAT', itemType: 'ACCESSORY', name: 'Child seat', description: 'Child seat accessory billed monthly per unit.', unitRate: 120, currency: 'AED', pricingBasis: 'MONTHLY', isActive: true, sortOrder: 20 },
  { serviceTypeKey: LEASING_QUOTATION_SERVICE_TYPE_KEY, code: 'DASH_CAMERA', itemType: 'ACCESSORY', name: 'Dash camera', description: 'Dash camera accessory billed monthly per unit.', unitRate: 95, currency: 'AED', pricingBasis: 'MONTHLY', isActive: true, sortOrder: 30 },
  { serviceTypeKey: LEASING_QUOTATION_SERVICE_TYPE_KEY, code: 'ROADSIDE_ASSISTANCE', itemType: 'SERVICE', name: 'Roadside assistance', description: 'Monthly roadside support coverage.', unitRate: 150, currency: 'AED', pricingBasis: 'MONTHLY', isActive: true, sortOrder: 40 },
  { serviceTypeKey: LEASING_QUOTATION_SERVICE_TYPE_KEY, code: 'REPLACEMENT_COVER', itemType: 'SERVICE', name: 'Replacement vehicle cover', description: 'Replacement vehicle support during eligible downtime.', unitRate: 250, currency: 'AED', pricingBasis: 'MONTHLY', isActive: true, sortOrder: 50 },
  { serviceTypeKey: LEASING_QUOTATION_SERVICE_TYPE_KEY, code: 'DETAILING_PACKAGE', itemType: 'SERVICE', name: 'Monthly detailing package', description: 'Monthly interior/exterior detailing service.', unitRate: 180, currency: 'AED', pricingBasis: 'MONTHLY', isActive: true, sortOrder: 60 },
];

let ensured = false;
const seededTenants = new Set<string>();

function normalizeType(value: unknown): LeasingCatalogItemType {
  const normalized = String(value ?? '').toUpperCase();
  return LEASING_CATALOG_ITEM_TYPES.includes(normalized as LeasingCatalogItemType)
    ? normalized as LeasingCatalogItemType
    : 'OTHER';
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function rowToApi(row: Row): LeasingServiceCatalogItem {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    serviceTypeKey: row.service_type_key,
    code: row.code,
    itemType: normalizeType(row.item_type),
    name: row.name,
    description: row.description,
    unitRate: Number(row.unit_rate ?? 0),
    currency: row.currency ?? 'AED',
    pricingBasis: 'MONTHLY',
    isActive: row.is_active,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function ensureLeasingServiceCatalogTable(): Promise<void> {
  if (ensured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS leasing_service_catalog_items (
      id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id         TEXT         NOT NULL,
      service_type_key  TEXT         NOT NULL DEFAULT 'LEASING_QUOTATIONS',
      code              TEXT         NOT NULL,
      item_type         TEXT         NOT NULL DEFAULT 'OTHER',
      name              TEXT         NOT NULL,
      description       TEXT,
      unit_rate         DECIMAL(18,4) NOT NULL DEFAULT 0,
      currency          TEXT         NOT NULL DEFAULT 'AED',
      pricing_basis     TEXT         NOT NULL DEFAULT 'MONTHLY',
      is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
      sort_order        INTEGER      NOT NULL DEFAULT 100,
      created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      deleted_at        TIMESTAMPTZ,
      UNIQUE (tenant_id, service_type_key, code)
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_leasing_service_catalog_tenant_service
      ON leasing_service_catalog_items (tenant_id, service_type_key)
      WHERE deleted_at IS NULL
  `);
  ensured = true;
}

export async function ensureLeasingServiceCatalogSeeded(
  tenantId: string,
  serviceTypeKey = LEASING_QUOTATION_SERVICE_TYPE_KEY,
): Promise<void> {
  const cacheKey = `${tenantId}:${serviceTypeKey}`;
  if (seededTenants.has(cacheKey)) return;
  await ensureLeasingServiceCatalogTable();

  if (serviceTypeKey === LEASING_QUOTATION_SERVICE_TYPE_KEY) {
    for (const item of DEFAULT_LEASING_QUOTATION_CATALOG) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO leasing_service_catalog_items
           (tenant_id, service_type_key, code, item_type, name, description,
            unit_rate, currency, pricing_basis, is_active, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (tenant_id, service_type_key, code) DO NOTHING`,
        tenantId,
        item.serviceTypeKey,
        item.code,
        item.itemType,
        item.name,
        item.description,
        item.unitRate,
        item.currency,
        item.pricingBasis,
        item.isActive,
        item.sortOrder,
      );
    }
  }

  seededTenants.add(cacheKey);
}

export async function listLeasingServiceCatalog(
  tenantId: string,
  opts: { serviceTypeKey?: string; activeOnly?: boolean } = {},
): Promise<LeasingServiceCatalogItem[]> {
  const serviceTypeKey = opts.serviceTypeKey || LEASING_QUOTATION_SERVICE_TYPE_KEY;
  await ensureLeasingServiceCatalogSeeded(tenantId, serviceTypeKey);
  const where = ['tenant_id = $1', 'service_type_key = $2', 'deleted_at IS NULL'];
  if (opts.activeOnly) where.push('is_active = TRUE');
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT ${SELECT}
       FROM leasing_service_catalog_items
      WHERE ${where.join(' AND ')}
      ORDER BY sort_order, name`,
    tenantId,
    serviceTypeKey,
  );
  return rows.map(rowToApi);
}

export async function getLeasingServiceCatalogItem(
  tenantId: string,
  id: string,
): Promise<LeasingServiceCatalogItem | null> {
  await ensureLeasingServiceCatalogTable();
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT ${SELECT}
       FROM leasing_service_catalog_items
      WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL
      LIMIT 1`,
    id,
    tenantId,
  );
  return rows[0] ? rowToApi(rows[0]) : null;
}

export async function createLeasingServiceCatalogItem(
  tenantId: string,
  data: {
    serviceTypeKey?: string;
    code?: string;
    itemType?: string;
    name: string;
    description?: string | null;
    unitRate?: number | string | null;
    currency?: string | null;
    isActive?: boolean;
    sortOrder?: number | string | null;
  },
): Promise<LeasingServiceCatalogItem> {
  await ensureLeasingServiceCatalogTable();
  const serviceTypeKey = data.serviceTypeKey || LEASING_QUOTATION_SERVICE_TYPE_KEY;
  const code = normalizeCode(data.code || data.name);
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `INSERT INTO leasing_service_catalog_items
       (tenant_id, service_type_key, code, item_type, name, description,
        unit_rate, currency, pricing_basis, is_active, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'MONTHLY',$9,$10)
     RETURNING ${SELECT}`,
    tenantId,
    serviceTypeKey,
    code,
    normalizeType(data.itemType),
    data.name.trim(),
    data.description ?? null,
    Number(data.unitRate ?? 0),
    data.currency || 'AED',
    data.isActive ?? true,
    Number(data.sortOrder ?? 100),
  );
  if (!rows[0]) throw new Error('createLeasingServiceCatalogItem returned no row');
  return rowToApi(rows[0]);
}

export async function updateLeasingServiceCatalogItem(
  tenantId: string,
  id: string,
  patch: Partial<{
    serviceTypeKey: string;
    code: string;
    itemType: string;
    name: string;
    description: string | null;
    unitRate: number | string | null;
    currency: string | null;
    isActive: boolean;
    sortOrder: number | string | null;
  }>,
): Promise<LeasingServiceCatalogItem | null> {
  await ensureLeasingServiceCatalogTable();
  const sets: string[] = [];
  const args: unknown[] = [];
  let p = 1;
  const setIf = (col: string, value: unknown) => {
    if (value === undefined) return;
    sets.push(`${col} = $${p}`);
    args.push(value);
    p++;
  };
  if (patch.serviceTypeKey !== undefined) setIf('service_type_key', patch.serviceTypeKey);
  if (patch.code !== undefined) setIf('code', normalizeCode(patch.code));
  if (patch.itemType !== undefined) setIf('item_type', normalizeType(patch.itemType));
  if (patch.name !== undefined) setIf('name', patch.name.trim());
  if ('description' in patch) setIf('description', patch.description ?? null);
  if ('unitRate' in patch) setIf('unit_rate', Number(patch.unitRate ?? 0));
  if ('currency' in patch) setIf('currency', patch.currency || 'AED');
  if (patch.isActive !== undefined) setIf('is_active', patch.isActive);
  if ('sortOrder' in patch) setIf('sort_order', Number(patch.sortOrder ?? 100));
  if (sets.length === 0) return getLeasingServiceCatalogItem(tenantId, id);

  sets.push('updated_at = NOW()');
  args.push(id, tenantId);
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `UPDATE leasing_service_catalog_items
        SET ${sets.join(', ')}
      WHERE id = $${p}::uuid AND tenant_id = $${p + 1} AND deleted_at IS NULL
      RETURNING ${SELECT}`,
    ...args,
  );
  return rows[0] ? rowToApi(rows[0]) : null;
}

export async function deleteLeasingServiceCatalogItem(tenantId: string, id: string): Promise<boolean> {
  await ensureLeasingServiceCatalogTable();
  const result = await prisma.$executeRawUnsafe(
    `UPDATE leasing_service_catalog_items
        SET deleted_at = NOW(), updated_at = NOW(), is_active = FALSE
      WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
    id,
    tenantId,
  );
  return Number(result) > 0;
}
