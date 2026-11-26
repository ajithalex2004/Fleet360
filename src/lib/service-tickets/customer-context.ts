/**
 * Field Service request context: customers, their entities / sites, the
 * equipment installed at each site, and the request number sequence.
 *
 * Every function takes the caller's RLS transaction (withTenantRls) and also
 * filters on tenant_id explicitly. Sites live in customer_sites; equipment is
 * an asset_registry row tagged with customer_id / customer_site_id.
 */

import type { TxClient } from '@/lib/rls';

export class CustomerContextError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

// ── Request numbering ──────────────────────────────────────────────────────

export const REQUEST_CHANNELS = [
  { value: 'CUSTOMER_PORTAL', label: 'Customer Portal' },
  { value: 'WHATSAPP', label: 'WhatsApp Agent' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'IOT', label: 'IoT' },
] as const;
export type RequestChannel = typeof REQUEST_CHANNELS[number]['value'];

export const ENTITLEMENT_TYPES = [
  { value: 'AMC', label: 'AMC (Annual Maintenance Contract)' },
  { value: 'WARRANTY', label: 'Under Warranty' },
  { value: 'SLA_CONTRACT', label: 'Service Contract / SLA' },
  { value: 'CHARGEABLE', label: 'Chargeable (Time & Material)' },
  { value: 'GOODWILL', label: 'Goodwill / No Charge' },
] as const;
export type EntitlementType = typeof ENTITLEMENT_TYPES[number]['value'];

export function isRequestChannel(v: unknown): v is RequestChannel {
  return REQUEST_CHANNELS.some((c) => c.value === v);
}
export function isEntitlementType(v: unknown): v is EntitlementType {
  return ENTITLEMENT_TYPES.some((e) => e.value === v);
}

/** The customer's code for request numbers; falls back to part of its id. */
export function customerCodeOf(c: { customer_code?: string | null; id: string }): string {
  const code = (c.customer_code ?? '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
  return code || `C${c.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

/** Formats FSM-SR-<customer code>-YYXXXX. */
export function formatServiceRequestNumber(customerCode: string, year: number, seq: number): string {
  const yy = String(year % 100).padStart(2, '0');
  return `FSM-SR-${customerCode}-${yy}${String(seq).padStart(4, '0')}`;
}

/**
 * Next number in the tenant's yearly series (one series across all customers).
 * Atomic: the counter row is upserted and incremented in one statement.
 */
export async function nextServiceRequestNumber(
  tx: TxClient, tenantId: string, customerCode: string, now = new Date(),
): Promise<string> {
  const year = now.getFullYear();
  const [row] = await tx.$queryRawUnsafe<Array<{ last_seq: number }>>(
    `INSERT INTO service_request_counters (tenant_id, year, last_seq)
     VALUES ($1, $2, 1)
     ON CONFLICT (tenant_id, year) DO UPDATE SET last_seq = service_request_counters.last_seq + 1
     RETURNING last_seq`,
    tenantId, year,
  );
  return formatServiceRequestNumber(customerCode, year, Number(row.last_seq));
}

/** What the next number would be, without taking it (for the form preview). */
export async function peekServiceRequestNumber(
  tx: TxClient, tenantId: string, customerCode: string, now = new Date(),
): Promise<string> {
  const year = now.getFullYear();
  const [row] = await tx.$queryRawUnsafe<Array<{ last_seq: number }>>(
    `SELECT last_seq FROM service_request_counters WHERE tenant_id = $1 AND year = $2`,
    tenantId, year,
  ).catch(() => [] as Array<{ last_seq: number }>);
  return formatServiceRequestNumber(customerCode, year, Number(row?.last_seq ?? 0) + 1);
}

// ── Customers ──────────────────────────────────────────────────────────────

export interface FsmCustomer {
  id: string;
  code: string;
  name: string;
  contactPerson: string | null;
  contactPhone: string | null;
}

interface CustomerRow {
  id: string; customer_code: string | null; name_en: string;
  contact_person: string | null; contact_person_phone: string | null;
  mobile_country_code: string | null; mobile_number: string | null;
}

function toCustomer(r: CustomerRow): FsmCustomer {
  const mobile = r.mobile_number ? `${r.mobile_country_code ?? ''} ${r.mobile_number}`.trim() : null;
  return {
    id: r.id, code: customerCodeOf(r), name: r.name_en,
    contactPerson: r.contact_person, contactPhone: r.contact_person_phone ?? mobile,
  };
}

export async function listCustomers(tx: TxClient, tenantId: string): Promise<FsmCustomer[]> {
  const rows = await tx.$queryRawUnsafe<CustomerRow[]>(
    `SELECT id, customer_code, name_en, contact_person, contact_person_phone, mobile_country_code, mobile_number
       FROM customers
      WHERE tenant_id = $1 AND deleted_at IS NULL AND COALESCE(status, 'ACTIVE') = 'ACTIVE'
      ORDER BY name_en`,
    tenantId,
  );
  return rows.map(toCustomer);
}

export async function getCustomer(tx: TxClient, tenantId: string, customerId: string): Promise<FsmCustomer> {
  const [row] = await tx.$queryRawUnsafe<CustomerRow[]>(
    `SELECT id, customer_code, name_en, contact_person, contact_person_phone, mobile_country_code, mobile_number
       FROM customers WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    customerId, tenantId,
  );
  if (!row) throw new CustomerContextError('Customer not found.', 404);
  return toCustomer(row);
}

// ── Sites ──────────────────────────────────────────────────────────────────

export interface CustomerSite {
  id: string;
  customerId: string;
  name: string;
  code: string | null;
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  contactPerson: string | null;
  contactMobile: string | null;
  contactEmail: string | null;
}

interface SiteRow {
  id: string; customer_id: string; name: string; code: string | null; address: string | null; city: string | null;
  latitude: string | number | null; longitude: string | number | null;
  contact_person: string | null; contact_mobile: string | null; contact_email: string | null;
}

const toNum = (v: string | number | null) => (v === null || v === undefined || v === '' ? null : Number(v));

function toSite(r: SiteRow): CustomerSite {
  return {
    id: r.id, customerId: r.customer_id, name: r.name, code: r.code, address: r.address, city: r.city,
    latitude: toNum(r.latitude), longitude: toNum(r.longitude),
    contactPerson: r.contact_person, contactMobile: r.contact_mobile, contactEmail: r.contact_email,
  };
}

const SITE_COLS = `id::text, customer_id, name, code, address, city, latitude, longitude, contact_person, contact_mobile, contact_email`;

export async function listCustomerSites(tx: TxClient, tenantId: string, customerId: string): Promise<CustomerSite[]> {
  const rows = await tx.$queryRawUnsafe<SiteRow[]>(
    `SELECT ${SITE_COLS} FROM customer_sites
      WHERE tenant_id = $1 AND customer_id = $2 AND deleted_at IS NULL AND is_active
      ORDER BY name`,
    tenantId, customerId,
  );
  return rows.map(toSite);
}

export async function getCustomerSite(tx: TxClient, tenantId: string, siteId: string): Promise<CustomerSite> {
  const [row] = await tx.$queryRawUnsafe<SiteRow[]>(
    `SELECT ${SITE_COLS} FROM customer_sites WHERE id::text = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    siteId, tenantId,
  );
  if (!row) throw new CustomerContextError('Entity / site not found.', 404);
  return toSite(row);
}

const text = (v: unknown, max = 200): string | null => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};
const coord = (v: unknown, lim: number): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > lim) throw new CustomerContextError('Map location is not valid.');
  return n;
};

export async function createCustomerSite(
  tx: TxClient, tenantId: string, customerId: string, input: Record<string, unknown>,
): Promise<CustomerSite> {
  await getCustomer(tx, tenantId, customerId);
  const name = text(input.name, 120);
  if (!name) throw new CustomerContextError('Entity / site name is required.');
  const [row] = await tx.$queryRawUnsafe<SiteRow[]>(
    `INSERT INTO customer_sites
       (tenant_id, customer_id, name, code, address, city, latitude, longitude, contact_person, contact_mobile, contact_email)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${SITE_COLS}`,
    tenantId, customerId, name, text(input.code, 40), text(input.address, 300), text(input.city, 80),
    coord(input.latitude, 90), coord(input.longitude, 180),
    text(input.contactPerson, 120), text(input.contactMobile, 40), text(input.contactEmail, 120),
  );
  return toSite(row);
}

// ── Equipment (asset register rows tagged to a customer site) ─────────────

export interface CustomerAsset {
  id: string;
  assetNo: string;
  name: string;
  description: string | null;
  serialNumber: string | null;
  tagId: string | null;
  customerSiteId: string | null;
  manufacturer: string | null;
  model: string | null;
}

interface AssetRow {
  id: string; asset_no: string; name: string; description: string | null; serial_number: string | null;
  tag_id: string | null; customer_site_id: string | null; manufacturer: string | null; model: string | null;
}

const ASSET_COLS = `id::text, asset_no, name, description, serial_number, tag_id, customer_site_id::text, manufacturer, model`;

function toAsset(r: AssetRow): CustomerAsset {
  return {
    id: r.id, assetNo: r.asset_no, name: r.name, description: r.description, serialNumber: r.serial_number,
    tagId: r.tag_id, customerSiteId: r.customer_site_id, manufacturer: r.manufacturer, model: r.model,
  };
}

export async function listCustomerAssets(
  tx: TxClient, tenantId: string, customerId: string, siteId?: string | null,
): Promise<CustomerAsset[]> {
  const rows = await tx.$queryRawUnsafe<AssetRow[]>(
    `SELECT ${ASSET_COLS} FROM asset_registry
      WHERE tenant_id = $1 AND customer_id = $2 AND COALESCE(is_active, TRUE)
        AND COALESCE(asset_type, '') <> 'CONSUMABLE'
        AND ($3::text IS NULL OR customer_site_id::text = $3)
      ORDER BY asset_no`,
    tenantId, customerId, siteId ?? null,
  );
  return rows.map(toAsset);
}

export async function getCustomerAsset(tx: TxClient, tenantId: string, assetId: string): Promise<CustomerAsset & { customerId: string | null }> {
  const [row] = await tx.$queryRawUnsafe<Array<AssetRow & { customer_id: string | null }>>(
    `SELECT ${ASSET_COLS}, customer_id FROM asset_registry WHERE id::text = $1 AND tenant_id = $2`,
    assetId, tenantId,
  );
  if (!row) throw new CustomerContextError('Asset / equipment not found.', 404);
  return { ...toAsset(row), customerId: row.customer_id };
}

export async function createCustomerAsset(
  tx: TxClient, tenantId: string, customerId: string, input: Record<string, unknown>,
): Promise<CustomerAsset> {
  await getCustomer(tx, tenantId, customerId);
  const name = text(input.name, 120);
  if (!name) throw new CustomerContextError('Asset / equipment name is required.');
  const siteId = text(input.customerSiteId, 40);
  if (siteId) {
    const site = await getCustomerSite(tx, tenantId, siteId);
    if (site.customerId !== customerId) throw new CustomerContextError('That site belongs to another customer.');
  }
  let assetNo = text(input.assetNo, 40);
  if (!assetNo) {
    const [{ n }] = await tx.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int + 1 AS n FROM asset_registry WHERE tenant_id = $1 AND asset_no LIKE 'CA-%'`, tenantId,
    );
    assetNo = `CA-${String(n).padStart(5, '0')}`;
  }
  const [row] = await tx.$queryRawUnsafe<AssetRow[]>(
    `INSERT INTO asset_registry
       (tenant_id, asset_no, name, description, domain, asset_type, manufacturer, model,
        serial_number, tag_id, customer_id, customer_site_id, is_serialized, status)
     VALUES ($1, $2, $3, $4, 'CUSTOMER', 'EQUIPMENT', $5, $6, $7, $8, $9, $10::uuid, TRUE, 'INSTALLED')
     RETURNING ${ASSET_COLS}`,
    tenantId, assetNo, name, text(input.description, 500), text(input.manufacturer, 80), text(input.model, 80),
    text(input.serialNumber, 80), text(input.tagId, 80), customerId, siteId,
  );
  return toAsset(row);
}

// ── Inventory (spare parts held at a customer site) ────────────────────────

export interface CustomerInventoryItem {
  id: string;
  itemNo: string;
  name: string;
  description: string | null;
  customerSiteId: string | null;
  quantity: number;
  reorderAt: number;
  unit: string | null;
}

export async function listCustomerInventory(tx: TxClient, tenantId: string, customerId: string): Promise<CustomerInventoryItem[]> {
  const rows = await tx.$queryRawUnsafe<Array<{
    id: string; asset_no: string; name: string; description: string | null; customer_site_id: string | null;
    current_stock: string | number | null; reorder_threshold: string | number | null; unit_of_measure: string | null;
  }>>(
    `SELECT id::text, asset_no, name, description, customer_site_id::text, current_stock, reorder_threshold, unit_of_measure
       FROM asset_registry
      WHERE tenant_id = $1 AND customer_id = $2 AND COALESCE(is_active, TRUE) AND asset_type = 'CONSUMABLE'
      ORDER BY name`,
    tenantId, customerId,
  );
  return rows.map((r) => ({
    id: r.id, itemNo: r.asset_no, name: r.name, description: r.description, customerSiteId: r.customer_site_id,
    quantity: Number(r.current_stock ?? 0), reorderAt: Number(r.reorder_threshold ?? 0), unit: r.unit_of_measure,
  }));
}

export async function createCustomerInventoryItem(
  tx: TxClient, tenantId: string, customerId: string, input: Record<string, unknown>,
): Promise<CustomerInventoryItem> {
  await getCustomer(tx, tenantId, customerId);
  const name = text(input.name, 120);
  if (!name) throw new CustomerContextError('Item name is required.');
  const quantity = Number(input.quantity ?? 0);
  const reorderAt = Number(input.reorderAt ?? 0);
  if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(reorderAt) || reorderAt < 0) {
    throw new CustomerContextError('Quantity and reorder level must be zero or more.');
  }
  const siteId = text(input.customerSiteId, 40);
  if (siteId) {
    const site = await getCustomerSite(tx, tenantId, siteId);
    if (site.customerId !== customerId) throw new CustomerContextError('That site belongs to another customer.');
  }
  const [{ n }] = await tx.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT COUNT(*)::int + 1 AS n FROM asset_registry WHERE tenant_id = $1 AND asset_no LIKE 'CI-%'`, tenantId,
  );
  const [row] = await tx.$queryRawUnsafe<Array<{ id: string; asset_no: string }>>(
    `INSERT INTO asset_registry
       (tenant_id, asset_no, name, description, domain, asset_type, unit_of_measure, current_stock,
        reorder_threshold, customer_id, customer_site_id, status)
     VALUES ($1, $2, $3, $4, 'CUSTOMER', 'CONSUMABLE', $5, $6, $7, $8, $9::uuid, 'IN_STOCK')
     RETURNING id::text, asset_no`,
    tenantId, `CI-${String(n).padStart(5, '0')}`, name, text(input.description, 300), text(input.unit, 20) ?? 'UNIT',
    quantity, reorderAt, customerId, siteId,
  );
  return {
    id: row.id, itemNo: row.asset_no, name, description: text(input.description, 300), customerSiteId: siteId,
    quantity, reorderAt, unit: text(input.unit, 20) ?? 'UNIT',
  };
}

// ── Assigned technician (for the customer's request view) ──────────────────

export interface TechnicianContact { name: string; email: string | null; mobile: string | null }

/** assigned_to holds a staff user id, an email, or a name; return what we can show. */
export async function resolveTechnician(tx: TxClient, assignedTo: string | null): Promise<TechnicianContact | null> {
  const v = (assignedTo ?? '').trim();
  if (!v) return null;
  const [u] = await tx.$queryRawUnsafe<Array<{ firstName: string | null; lastName: string | null; username: string | null; email: string | null; mobileNumber: string | null }>>(
    `SELECT "firstName", "lastName", username, email, "mobileNumber" FROM "User"
      WHERE id = $1 OR lower(email) = lower($1) LIMIT 1`,
    v,
  ).catch(() => []);
  if (!u) return { name: v.includes('@') ? v.split('@')[0] : v, email: v.includes('@') ? v : null, mobile: null };
  return {
    name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || v,
    email: u.email, mobile: u.mobileNumber,
  };
}

