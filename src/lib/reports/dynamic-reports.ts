import { prisma } from '@/lib/prisma';
import { ensureOperationalTenantColumn } from '@/lib/cross-module-governance';
import { normalizeModuleAccessRecord, type ModuleAccessPreset } from '@/lib/module-access-presets';

export type DynamicFieldType = 'text' | 'number' | 'money' | 'date' | 'status' | 'boolean';
export type DynamicFilterOperator =
  | 'contains'
  | 'equals'
  | 'notEquals'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'isEmpty'
  | 'isNotEmpty';

export interface DynamicReportField {
  key: string;
  label: string;
  type: DynamicFieldType;
  groupable?: boolean;
  aggregatable?: boolean;
}

export interface DynamicReportDataset {
  key: string;
  label: string;
  module: string;
  description: string;
  defaultColumns: string[];
  defaultSort?: { field: string; direction: 'asc' | 'desc' };
  fields: DynamicReportField[];
  baseSql: string;
}

export interface DynamicReportFilter {
  field: string;
  operator: DynamicFilterOperator;
  value?: string | number | boolean | null;
  valueTo?: string | number | boolean | null;
}

export interface DynamicReportDefinition {
  datasetKey: string;
  columns: string[];
  filters?: DynamicReportFilter[];
  sort?: { field: string; direction: 'asc' | 'desc' };
  groupBy?: string[];
  metric?: { field: string; aggregate: 'count' | 'sum' | 'avg' | 'min' | 'max' };
  chart?: { type: 'bar' | 'line' | 'pie' | 'area'; labelField?: string; valueField?: string };
  limit?: number;
}

export interface SavedDynamicReport {
  id: string;
  name: string;
  description: string | null;
  datasetKey: string;
  definition: DynamicReportDefinition;
  createdAt: string;
  updatedAt: string;
}

export interface DynamicReportRunResult {
  dataset: Omit<DynamicReportDataset, 'baseSql'>;
  columns: DynamicReportField[];
  rows: Record<string, unknown>[];
  chart: {
    type: string;
    labelField: string;
    valueField: string;
    points: Array<{ label: string; value: number }>;
  } | null;
}

export interface DynamicReportDatasetCatalogEntry {
  key: string;
  enabled: boolean;
  label: string;
  description: string;
  visibleFields: string[];
  defaultColumns: string[];
  allowedRoleCodes: string[];
  allowedModulePresets: ModuleAccessPreset[];
}

export type DynamicReportDatasetCatalog = Record<string, DynamicReportDatasetCatalogEntry>;
export type DynamicReportDatasetCatalogPatch = Partial<Record<string, Partial<DynamicReportDatasetCatalogEntry>>>;

export interface DynamicReportDatasetAccessContext {
  tenantId: string;
  userId: string;
  role: string;
  isSuperAdmin?: boolean;
}

const FIELD_KEY_RE = /^[a-z][a-z0-9_]*$/;
const DEFAULT_DATASET_ROLE_CODES = ['SUPER_ADMIN', 'TENANT_ADMIN'];
const DEFAULT_DATASET_MODULE_PRESETS: ModuleAccessPreset[] = ['admin', 'manager', 'operator', 'viewer'];
const DATASET_CATALOG_PLATFORM_KEY = 'dynamic_report_dataset_defaults';
const MODULE_PRESET_KEYS: ModuleAccessPreset[] = ['admin', 'manager', 'operator', 'viewer'];

let datasetCatalogEnsured = false;
let datasetCatalogEnsurePromise: Promise<void> | null = null;

const DATASETS: DynamicReportDataset[] = [
  {
    key: 'leasing_contracts',
    label: 'Leasing Contracts',
    module: 'Vehicle Leasing',
    description: 'Lease agreements, customers, values, terms, status, and vehicle counts.',
    defaultColumns: ['contract_number', 'lessee_name', 'lease_type', 'status', 'vehicle_count', 'monthly_rate', 'total_contract_value'],
    defaultSort: { field: 'start_date', direction: 'desc' },
    fields: [
      { key: 'contract_number', label: 'Contract #', type: 'text', groupable: true },
      { key: 'lessee_name', label: 'Lessee', type: 'text', groupable: true },
      { key: 'agreement_type', label: 'Agreement Type', type: 'text', groupable: true },
      { key: 'lease_type', label: 'Lease Type', type: 'text', groupable: true },
      { key: 'status', label: 'Status', type: 'status', groupable: true },
      { key: 'start_date', label: 'Start Date', type: 'date', groupable: true },
      { key: 'end_date', label: 'End Date', type: 'date', groupable: true },
      { key: 'vehicle_count', label: 'Vehicles', type: 'number', aggregatable: true },
      { key: 'monthly_rate', label: 'Monthly Rate', type: 'money', aggregatable: true },
      { key: 'total_contract_value', label: 'Contract Value', type: 'money', aggregatable: true },
      { key: 'currency', label: 'Currency', type: 'text', groupable: true },
    ],
    baseSql: `
      SELECT
        c.tenant_id::text AS tenant_id,
        c.id::text AS id,
        c.contract_number,
        COALESCE(l.name, 'Unassigned') AS lessee_name,
        c.agreement_type,
        c.lease_type,
        c.status,
        c.start_date::date AS start_date,
        c.end_date::date AS end_date,
        COALESCE(vc.vehicle_count, 0)::numeric AS vehicle_count,
        COALESCE(c.monthly_rate, 0)::numeric AS monthly_rate,
        COALESCE(c.total_contract_value, 0)::numeric AS total_contract_value,
        COALESCE(c.currency, 'AED') AS currency
      FROM lease_contracts_v2 c
      LEFT JOIN lessees l ON l.id::text = c.lessee_id::text
      LEFT JOIN (
        SELECT contract_id::text, COUNT(*) AS vehicle_count
        FROM lease_contract_vehicles
        GROUP BY contract_id::text
      ) vc ON vc.contract_id = c.id::text
      WHERE c.deleted_at IS NULL
    `,
  },
  {
    key: 'leasing_quotations',
    label: 'Leasing Quotations',
    module: 'Vehicle Leasing',
    description: 'Quotation pipeline, pricing, customer, duration, status, and approval values.',
    defaultColumns: ['quotation_number', 'lessee_name', 'lease_type', 'vehicle_count', 'duration_months', 'total_monthly_rate', 'status'],
    defaultSort: { field: 'created_at', direction: 'desc' },
    fields: [
      { key: 'quotation_number', label: 'Quotation #', type: 'text', groupable: true },
      { key: 'lessee_name', label: 'Lessee / Customer', type: 'text', groupable: true },
      { key: 'lease_type', label: 'Lease Type', type: 'text', groupable: true },
      { key: 'vehicle_type', label: 'Vehicle Type', type: 'text', groupable: true },
      { key: 'vehicle_count', label: 'Vehicle Count', type: 'number', aggregatable: true },
      { key: 'duration_months', label: 'Duration', type: 'number', aggregatable: true },
      { key: 'total_monthly_rate', label: 'Monthly Rate', type: 'money', aggregatable: true },
      { key: 'total_contract_value', label: 'Total Value', type: 'money', aggregatable: true },
      { key: 'status', label: 'Status', type: 'status', groupable: true },
      { key: 'valid_until', label: 'Valid Until', type: 'date', groupable: true },
      { key: 'created_at', label: 'Created Date', type: 'date', groupable: true },
    ],
    baseSql: `
      SELECT
        q.tenant_id::text AS tenant_id,
        q.id::text AS id,
        q.quotation_number,
        COALESCE(l.name, i.company_name, i.customer_name, 'Unassigned') AS lessee_name,
        q.lease_type,
        q.vehicle_type,
        COALESCE(q.vehicle_count, 0)::numeric AS vehicle_count,
        COALESCE(q.duration_months, 0)::numeric AS duration_months,
        COALESCE(q.total_monthly_rate, 0)::numeric AS total_monthly_rate,
        COALESCE(q.total_contract_value, 0)::numeric AS total_contract_value,
        q.status,
        q.valid_until::date AS valid_until,
        q.created_at::date AS created_at
      FROM lease_quotations q
      LEFT JOIN lessees l ON l.id::text = q.lessee_id::text
      LEFT JOIN lease_inquiries i ON i.id::text = q.inquiry_id::text
      WHERE q.deleted_at IS NULL
    `,
  },
  {
    key: 'finance_invoices',
    label: 'Finance Invoices',
    module: 'Finance',
    description: 'Customer invoices, outstanding balances, module source, due dates, and payment status.',
    defaultColumns: ['invoice_number', 'client_name', 'module', 'payment_status', 'issue_date', 'due_date', 'total_amount', 'outstanding_amount'],
    defaultSort: { field: 'issue_date', direction: 'desc' },
    fields: [
      { key: 'invoice_number', label: 'Invoice #', type: 'text', groupable: true },
      { key: 'client_name', label: 'Customer', type: 'text', groupable: true },
      { key: 'module', label: 'Module', type: 'text', groupable: true },
      { key: 'service_type', label: 'Service Type', type: 'text', groupable: true },
      { key: 'payment_status', label: 'Status', type: 'status', groupable: true },
      { key: 'issue_date', label: 'Issue Date', type: 'date', groupable: true },
      { key: 'due_date', label: 'Due Date', type: 'date', groupable: true },
      { key: 'subtotal', label: 'Subtotal', type: 'money', aggregatable: true },
      { key: 'vat_amount', label: 'VAT', type: 'money', aggregatable: true },
      { key: 'total_amount', label: 'Total', type: 'money', aggregatable: true },
      { key: 'paid_amount', label: 'Paid', type: 'money', aggregatable: true },
      { key: 'outstanding_amount', label: 'Outstanding', type: 'money', aggregatable: true },
      { key: 'currency', label: 'Currency', type: 'text', groupable: true },
    ],
    baseSql: `
      SELECT
        i.tenant_id::text AS tenant_id,
        i.id::text AS id,
        i.invoice_number,
        i.client_name,
        i.module,
        i.service_type,
        i.payment_status,
        i.issue_date::date AS issue_date,
        i.due_date::date AS due_date,
        COALESCE(i.subtotal, 0)::numeric AS subtotal,
        COALESCE(i.vat_amount, 0)::numeric AS vat_amount,
        COALESCE(i.total_amount, 0)::numeric AS total_amount,
        COALESCE(i.paid_amount, 0)::numeric AS paid_amount,
        GREATEST(COALESCE(i.total_amount, 0) - COALESCE(i.paid_amount, 0), 0)::numeric AS outstanding_amount,
        COALESCE(i.currency, 'AED') AS currency
      FROM finance_invoices i
      WHERE i.deleted_at IS NULL
    `,
  },
  {
    key: 'rac_bookings',
    label: 'RAC Bookings',
    module: 'Rent-a-Car',
    description: 'Rental bookings, customer segments, pickup/drop-off windows, value, and status.',
    defaultColumns: ['booking_ref', 'customer_name', 'customer_type', 'vehicle_category', 'status', 'pickup_date', 'dropoff_date', 'total_amount'],
    defaultSort: { field: 'pickup_date', direction: 'desc' },
    fields: [
      { key: 'booking_ref', label: 'Booking #', type: 'text', groupable: true },
      { key: 'customer_name', label: 'Customer', type: 'text', groupable: true },
      { key: 'customer_type', label: 'Customer Type', type: 'text', groupable: true },
      { key: 'vehicle_category', label: 'Vehicle Category', type: 'text', groupable: true },
      { key: 'status', label: 'Status', type: 'status', groupable: true },
      { key: 'channel', label: 'Channel', type: 'text', groupable: true },
      { key: 'pickup_date', label: 'Pickup Date', type: 'date', groupable: true },
      { key: 'dropoff_date', label: 'Drop-off Date', type: 'date', groupable: true },
      { key: 'total_days', label: 'Days', type: 'number', aggregatable: true },
      { key: 'daily_rate', label: 'Daily Rate', type: 'money', aggregatable: true },
      { key: 'total_amount', label: 'Total Amount', type: 'money', aggregatable: true },
      { key: 'currency', label: 'Currency', type: 'text', groupable: true },
    ],
    baseSql: `
      SELECT
        b.tenant_id::text AS tenant_id,
        b.id::text AS id,
        b.booking_ref,
        COALESCE(c.company_name, c.full_name, 'Unassigned') AS customer_name,
        c.customer_type,
        b.vehicle_category,
        b.status,
        b.channel,
        b.pickup_date::date AS pickup_date,
        b.dropoff_date::date AS dropoff_date,
        COALESCE(b.total_days, 0)::numeric AS total_days,
        COALESCE(b.daily_rate, 0)::numeric AS daily_rate,
        COALESCE(b.total_amount, 0)::numeric AS total_amount,
        COALESCE(b.currency, 'AED') AS currency
      FROM rental_bookings b
      LEFT JOIN rental_customers c ON c.id::text = b.customer_id::text
      WHERE b.deleted_at IS NULL
    `,
  },
];

export function listDynamicReportDatasets(catalog?: DynamicReportDatasetCatalog) {
  return DATASETS.map((dataset) => publicDataset(dataset, catalog?.[dataset.key]));
}

export function defaultDynamicReportDatasetCatalog(): DynamicReportDatasetCatalog {
  return Object.fromEntries(DATASETS.map((dataset) => {
    return [dataset.key, defaultDatasetCatalogEntry(dataset)];
  }));
}

export function listRegistryDynamicReportDatasets() {
  return DATASETS.map((dataset) => ({
    key: dataset.key,
    label: dataset.label,
    module: dataset.module,
    description: dataset.description,
    defaultColumns: dataset.defaultColumns,
    defaultSort: dataset.defaultSort,
    fields: dataset.fields,
  }));
}

export function getDynamicReportDataset(key: string) {
  return DATASETS.find((dataset) => dataset.key === key) ?? DATASETS[0];
}

export async function listVisibleDynamicReportDatasets(ctx: DynamicReportDatasetAccessContext) {
  const catalog = await loadResolvedDynamicReportDatasetCatalog(ctx.tenantId);
  const modulePreset = await resolveReportsModulePreset(ctx.userId);
  return DATASETS
    .filter((dataset) => isCatalogEntryAllowed(catalog[dataset.key], ctx.role, modulePreset, Boolean(ctx.isSuperAdmin)))
    .map((dataset) => publicDataset(dataset, catalog[dataset.key]));
}

export async function assertCanUseDynamicReportDataset(
  datasetKey: unknown,
  ctx: DynamicReportDatasetAccessContext,
) {
  if (typeof datasetKey !== 'string') {
    throw new Error('Dataset key is required');
  }
  const catalog = await loadResolvedDynamicReportDatasetCatalog(ctx.tenantId);
  const modulePreset = await resolveReportsModulePreset(ctx.userId);
  const entry = catalog[datasetKey];
  if (!entry || !isCatalogEntryAllowed(entry, ctx.role, modulePreset, Boolean(ctx.isSuperAdmin))) {
    throw new Error(`Dataset is not available for this user: ${datasetKey}`);
  }
  return catalog;
}

export async function ensureDynamicReportDatasetCatalogStorage() {
  if (datasetCatalogEnsured) return;
  if (datasetCatalogEnsurePromise) {
    await datasetCatalogEnsurePromise;
    return;
  }

  datasetCatalogEnsurePromise = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS platform_settings (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL DEFAULT '',
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS tenant_settings (
        tenant_id   TEXT PRIMARY KEY,
        settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});
    await prisma.$executeRawUnsafe(`
      ALTER TABLE tenant_settings
      ADD COLUMN IF NOT EXISTS dynamic_report_dataset_overrides JSONB NOT NULL DEFAULT '{}'::jsonb
    `).catch(() => {});
    await prisma.$executeRawUnsafe(
      `INSERT INTO platform_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO NOTHING`,
      DATASET_CATALOG_PLATFORM_KEY,
      JSON.stringify(defaultDynamicReportDatasetCatalog()),
    );
  })();

  try {
    await datasetCatalogEnsurePromise;
    datasetCatalogEnsured = true;
  } finally {
    datasetCatalogEnsurePromise = null;
  }
}

export async function loadPlatformDynamicReportDatasetCatalog(): Promise<DynamicReportDatasetCatalog> {
  await ensureDynamicReportDatasetCatalogStorage();
  const rows = await prisma.$queryRawUnsafe<Array<{ value: string }>>(
    `SELECT value FROM platform_settings WHERE key = $1 LIMIT 1`,
    DATASET_CATALOG_PLATFORM_KEY,
  ).catch(() => []);

  let parsed: unknown = {};
  if (rows[0]?.value) {
    try {
      parsed = JSON.parse(rows[0].value);
    } catch {
      parsed = {};
    }
  }

  return normalizeDatasetCatalog(parsed, defaultDynamicReportDatasetCatalog());
}

export async function loadTenantDynamicReportDatasetCatalog(tenantId: string): Promise<DynamicReportDatasetCatalogPatch> {
  await ensureDynamicReportDatasetCatalogStorage();
  const rows = await prisma.$queryRawUnsafe<Array<{ dynamic_report_dataset_overrides: unknown }>>(
    `SELECT dynamic_report_dataset_overrides
       FROM tenant_settings
      WHERE tenant_id::text = $1
      LIMIT 1`,
    tenantId,
  ).catch(() => []);
  return normalizeDatasetCatalogPatch(rows[0]?.dynamic_report_dataset_overrides);
}

export async function loadResolvedDynamicReportDatasetCatalog(tenantId: string): Promise<DynamicReportDatasetCatalog> {
  const [platformCatalog, tenantCatalog] = await Promise.all([
    loadPlatformDynamicReportDatasetCatalog(),
    loadTenantDynamicReportDatasetCatalog(tenantId),
  ]);
  return normalizeDatasetCatalog(tenantCatalog, platformCatalog);
}

export async function savePlatformDynamicReportDatasetCatalog(input: unknown) {
  const current = await loadPlatformDynamicReportDatasetCatalog();
  const next = normalizeDatasetCatalog(input, current);
  await prisma.$executeRawUnsafe(
    `INSERT INTO platform_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    DATASET_CATALOG_PLATFORM_KEY,
    JSON.stringify(next),
  );
  return next;
}

export async function saveTenantDynamicReportDatasetCatalog(tenantId: string, input: unknown) {
  await ensureDynamicReportDatasetCatalogStorage();
  const current = await loadTenantDynamicReportDatasetCatalog(tenantId);
  const currentResolved = normalizeDatasetCatalog(current, defaultDynamicReportDatasetCatalog());
  const next = normalizeDatasetCatalog(input, currentResolved);
  await prisma.$executeRawUnsafe(
    `INSERT INTO tenant_settings (tenant_id, dynamic_report_dataset_overrides, created_at, updated_at)
     VALUES ($1, $2::jsonb, NOW(), NOW())
     ON CONFLICT (tenant_id) DO UPDATE
       SET dynamic_report_dataset_overrides = $2::jsonb,
           updated_at = NOW()`,
    tenantId,
    JSON.stringify(next),
  );
  return next;
}

function publicDataset(
  dataset: DynamicReportDataset,
  catalogEntry?: DynamicReportDatasetCatalogEntry,
): Omit<DynamicReportDataset, 'baseSql'> {
  const scopedDataset = datasetForCatalog(dataset, catalogEntry);
  return {
    key: scopedDataset.key,
    label: scopedDataset.label,
    module: scopedDataset.module,
    description: scopedDataset.description,
    defaultColumns: scopedDataset.defaultColumns,
    defaultSort: scopedDataset.defaultSort,
    fields: scopedDataset.fields,
  };
}

function datasetForCatalog(
  dataset: DynamicReportDataset,
  catalogEntry?: DynamicReportDatasetCatalogEntry,
): DynamicReportDataset {
  const normalizedEntry = normalizeDatasetEntry(dataset, catalogEntry, defaultDatasetCatalogEntry(dataset));
  const visible = new Set(normalizedEntry.visibleFields);
  const fields = dataset.fields.filter((field) => visible.has(field.key));
  const defaultColumns = normalizedEntry.defaultColumns.filter((key) => visible.has(key));
  return {
    ...dataset,
    label: normalizedEntry.label,
    description: normalizedEntry.description,
    fields,
    defaultColumns: defaultColumns.length > 0 ? defaultColumns : fields.slice(0, 6).map((field) => field.key),
  };
}

function normalizeDatasetCatalog(input: unknown, base: DynamicReportDatasetCatalog): DynamicReportDatasetCatalog {
  const raw = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};

  return Object.fromEntries(DATASETS.map((dataset) => {
    const baseEntry = base[dataset.key] ?? defaultDatasetCatalogEntry(dataset);
    return [
      dataset.key,
      normalizeDatasetEntry(dataset, raw[dataset.key], baseEntry),
    ];
  })) as DynamicReportDatasetCatalog;
}

function normalizeDatasetCatalogPatch(input: unknown): DynamicReportDatasetCatalogPatch {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const raw = input as Record<string, unknown>;
  const known = new Set(DATASETS.map((dataset) => dataset.key));
  return Object.fromEntries(
    Object.entries(raw).filter(([key, value]) => known.has(key) && value && typeof value === 'object' && !Array.isArray(value)),
  ) as DynamicReportDatasetCatalogPatch;
}

function normalizeDatasetEntry(
  dataset: DynamicReportDataset,
  input: unknown,
  base: DynamicReportDatasetCatalogEntry,
): DynamicReportDatasetCatalogEntry {
  const raw = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Partial<DynamicReportDatasetCatalogEntry>
    : {};
  const visibleFields = normalizeFieldList(dataset, raw.visibleFields, base.visibleFields);
  const defaultColumns = normalizeFieldList(dataset, raw.defaultColumns, base.defaultColumns)
    .filter((key) => visibleFields.includes(key));
  const allowedRoleCodes = normalizeRoleCodes(raw.allowedRoleCodes, base.allowedRoleCodes);
  const allowedModulePresets = normalizeModulePresets(raw.allowedModulePresets, base.allowedModulePresets);

  return {
    key: dataset.key,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : base.enabled,
    label: normalizeText(raw.label, base.label, 80),
    description: normalizeText(raw.description, base.description, 240),
    visibleFields,
    defaultColumns: defaultColumns.length > 0 ? defaultColumns : visibleFields.slice(0, 6),
    allowedRoleCodes,
    allowedModulePresets,
  };
}

function defaultDatasetCatalogEntry(dataset: DynamicReportDataset): DynamicReportDatasetCatalogEntry {
  return {
    key: dataset.key,
    enabled: true,
    label: dataset.label,
    description: dataset.description,
    visibleFields: dataset.fields.map((field) => field.key),
    defaultColumns: dataset.defaultColumns,
    allowedRoleCodes: [...DEFAULT_DATASET_ROLE_CODES],
    allowedModulePresets: [...DEFAULT_DATASET_MODULE_PRESETS],
  };
}

function normalizeText(value: unknown, fallback: string, maxLength: number) {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, maxLength);
}

function normalizeFieldList(dataset: DynamicReportDataset, value: unknown, fallback: string[]) {
  const allowed = new Set(dataset.fields.map((field) => field.key));
  const fromInput = Array.isArray(value) ? value : fallback;
  const unique = Array.from(new Set(fromInput.filter((key): key is string => typeof key === 'string' && allowed.has(key))));
  if (unique.length > 0) return unique;
  return dataset.fields.map((field) => field.key);
}

function normalizeRoleCodes(value: unknown, fallback: string[]) {
  const fromInput = Array.isArray(value) ? value : fallback;
  const unique = Array.from(new Set(fromInput
    .filter((role): role is string => typeof role === 'string')
    .map((role) => role.trim().toUpperCase())
    .filter(Boolean)));
  if (Array.isArray(value)) return unique;
  return unique.length > 0 ? unique : [...DEFAULT_DATASET_ROLE_CODES];
}

function normalizeModulePresets(value: unknown, fallback: ModuleAccessPreset[]) {
  const fromInput = Array.isArray(value) ? value : fallback;
  const unique = Array.from(new Set(fromInput
    .filter((preset): preset is ModuleAccessPreset =>
      typeof preset === 'string' && MODULE_PRESET_KEYS.includes(preset as ModuleAccessPreset),
    )));
  if (Array.isArray(value)) return unique;
  return unique.length > 0 ? unique : [...DEFAULT_DATASET_MODULE_PRESETS];
}

async function resolveReportsModulePreset(userId: string): Promise<ModuleAccessPreset | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { moduleAccess: true },
  }).catch(() => null);
  const normalized = normalizeModuleAccessRecord(user?.moduleAccess);
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return null;
  const reportsAccess = (normalized as Record<string, { role?: ModuleAccessPreset }>).reports;
  return reportsAccess?.role ?? null;
}

function isCatalogEntryAllowed(
  entry: DynamicReportDatasetCatalogEntry | undefined,
  role: string,
  modulePreset: ModuleAccessPreset | null,
  isSuperAdmin: boolean,
) {
  if (!entry?.enabled) return false;
  if (isSuperAdmin) return true;
  const roleAllowed = entry.allowedRoleCodes.includes(role.toUpperCase());
  const presetAllowed = modulePreset ? entry.allowedModulePresets.includes(modulePreset) : false;
  return roleAllowed || presetAllowed;
}

export async function ensureDynamicReportTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS dynamic_reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      dataset_key TEXT NOT NULL,
      definition JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by TEXT,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_dynamic_reports_tenant
      ON dynamic_reports(tenant_id, dataset_key)
      WHERE deleted_at IS NULL
  `);

  await Promise.all([
    ensureTenantColumnIfTableExists('lease_contracts_v2'),
    ensureTenantColumnIfTableExists('lease_quotations'),
    ensureTenantColumnIfTableExists('lease_inquiries'),
    ensureTenantColumnIfTableExists('finance_invoices'),
    ensureTenantColumnIfTableExists('rental_bookings'),
  ]);
}

export async function listSavedDynamicReports(tenantId: string): Promise<SavedDynamicReport[]> {
  await ensureDynamicReportTables();
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    name: string;
    description: string | null;
    dataset_key: string;
    definition: DynamicReportDefinition;
    created_at: string;
    updated_at: string;
  }>>(
    `SELECT id::text, name, description, dataset_key, definition, created_at::text, updated_at::text
       FROM dynamic_reports
      WHERE tenant_id = $1 AND deleted_at IS NULL
      ORDER BY updated_at DESC`,
    tenantId,
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    datasetKey: row.dataset_key,
    definition: normalizeDefinition(row.definition),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function saveDynamicReport(args: {
  tenantId: string;
  userId: string;
  id?: string | null;
  name: string;
  description?: string | null;
  definition: DynamicReportDefinition;
  catalog?: DynamicReportDatasetCatalog;
}) {
  await ensureDynamicReportTables();
  const baseDataset = getDynamicReportDataset(args.definition?.datasetKey ?? '');
  const dataset = datasetForCatalog(baseDataset, args.catalog?.[baseDataset.key]);
  const definition = normalizeDefinition(args.definition, dataset);
  validateDefinition(definition, dataset);

  if (args.id) {
    const rows = await prisma.$queryRawUnsafe<SavedDynamicReport[]>(
      `UPDATE dynamic_reports
          SET name = $1,
              description = $2,
              dataset_key = $3,
              definition = $4::jsonb,
              updated_by = $5,
              updated_at = NOW()
        WHERE id::text = $6 AND tenant_id = $7 AND deleted_at IS NULL
        RETURNING id::text, name, description, dataset_key AS "datasetKey", definition, created_at::text AS "createdAt", updated_at::text AS "updatedAt"`,
      args.name,
      args.description ?? null,
      dataset.key,
      JSON.stringify(definition),
      args.userId,
      args.id,
      args.tenantId,
    );
    return rows[0] ?? null;
  }

  const rows = await prisma.$queryRawUnsafe<SavedDynamicReport[]>(
    `INSERT INTO dynamic_reports (tenant_id, name, description, dataset_key, definition, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $6)
     RETURNING id::text, name, description, dataset_key AS "datasetKey", definition, created_at::text AS "createdAt", updated_at::text AS "updatedAt"`,
    args.tenantId,
    args.name,
    args.description ?? null,
    dataset.key,
    JSON.stringify(definition),
    args.userId,
  );
  return rows[0] ?? null;
}

export async function runDynamicReport(
  definitionInput: DynamicReportDefinition,
  tenantId: string,
  catalog?: DynamicReportDatasetCatalog,
): Promise<DynamicReportRunResult> {
  await ensureDynamicReportTables();
  const baseDataset = getDynamicReportDataset(definitionInput?.datasetKey ?? '');
  const dataset = datasetForCatalog(baseDataset, catalog?.[baseDataset.key]);
  const definition = normalizeDefinition(definitionInput, dataset);
  validateDefinition(definition, dataset);

  const fields = fieldMap(dataset);
  const values: unknown[] = [tenantId];
  const where = [`source.${quoteIdent('tenant_id')} = $1`];

  for (const filter of definition.filters ?? []) {
    const field = fields.get(filter.field);
    if (!field) continue;
    const clause = filterClause(field, filter, values);
    if (clause) where.push(clause);
  }

  const limit = Math.max(1, Math.min(1000, Number(definition.limit ?? 200)));
  const groupBy = (definition.groupBy ?? []).filter((key) => fields.has(key));
  const metric = definition.metric ?? { field: 'id', aggregate: 'count' as const };
  let selectedFields: DynamicReportField[];
  let sql: string;

  if (groupBy.length > 0) {
    const groupFields = groupBy.map((key) => fields.get(key)!);
    const metricField = fields.get(metric.field);
    const metricAlias = 'metric_value';
    const selectGroups = groupFields.map((field) => `source.${quoteIdent(field.key)} AS ${quoteIdent(field.key)}`);
    const aggregate = metric.aggregate === 'count'
      ? `COUNT(*)::numeric AS ${quoteIdent(metricAlias)}`
      : `${metric.aggregate.toUpperCase()}(COALESCE(source.${quoteIdent(metricField?.key ?? groupFields[0].key)}::numeric, 0))::numeric AS ${quoteIdent(metricAlias)}`;
    const groupList = groupFields.map((field) => `source.${quoteIdent(field.key)}`).join(', ');
    sql = `
      SELECT ${[...selectGroups, aggregate].join(', ')}
      FROM (${dataset.baseSql}) source
      WHERE ${where.join(' AND ')}
      GROUP BY ${groupList}
      ORDER BY ${quoteIdent(metricAlias)} DESC
      LIMIT ${limit}
    `;
    selectedFields = [
      ...groupFields,
      { key: metricAlias, label: metric.aggregate === 'count' ? 'Count' : `${titleCase(metric.aggregate)} ${metricField?.label ?? 'Value'}`, type: 'number', aggregatable: true },
    ];
  } else {
    const selectedKeys = definition.columns.length > 0 ? definition.columns : dataset.defaultColumns;
    selectedFields = selectedKeys.map((key) => fields.get(key)).filter(Boolean) as DynamicReportField[];
    if (selectedFields.length === 0) selectedFields = dataset.defaultColumns.map((key) => fields.get(key)).filter(Boolean) as DynamicReportField[];
    const selectList = selectedFields.map((field) => `source.${quoteIdent(field.key)} AS ${quoteIdent(field.key)}`).join(', ');
    const sort = definition.sort ?? dataset.defaultSort;
    const sortClause = sort && fields.has(sort.field)
      ? `ORDER BY source.${quoteIdent(sort.field)} ${sort.direction === 'asc' ? 'ASC' : 'DESC'}`
      : '';
    sql = `
      SELECT ${selectList}
      FROM (${dataset.baseSql}) source
      WHERE ${where.join(' AND ')}
      ${sortClause}
      LIMIT ${limit}
    `;
  }

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values);
  const serializableRows = rows.map(normalizeRow);
  const datasetPayload = publicDataset(baseDataset, catalog?.[baseDataset.key]);

  return {
    dataset: datasetPayload,
    columns: selectedFields,
    rows: serializableRows,
    chart: buildChart(definition, selectedFields, serializableRows),
  };
}

function normalizeDefinition(definition: DynamicReportDefinition, datasetOverride?: DynamicReportDataset): DynamicReportDefinition {
  const dataset = datasetOverride ?? getDynamicReportDataset(definition?.datasetKey ?? '');
  return {
    datasetKey: dataset.key,
    columns: Array.isArray(definition?.columns) ? definition.columns.filter(isFieldKey) : dataset.defaultColumns,
    filters: Array.isArray(definition?.filters) ? definition.filters : [],
    sort: definition?.sort && isFieldKey(definition.sort.field)
      ? { field: definition.sort.field, direction: definition.sort.direction === 'asc' ? 'asc' : 'desc' }
      : dataset.defaultSort,
    groupBy: Array.isArray(definition?.groupBy) ? definition.groupBy.filter(isFieldKey) : [],
    metric: definition?.metric && isFieldKey(definition.metric.field)
      ? { field: definition.metric.field, aggregate: ['count', 'sum', 'avg', 'min', 'max'].includes(definition.metric.aggregate) ? definition.metric.aggregate : 'count' }
      : { field: 'id', aggregate: 'count' },
    chart: definition?.chart ?? { type: 'bar' },
    limit: Math.max(1, Math.min(1000, Number(definition?.limit ?? 200))),
  };
}

function validateDefinition(definition: DynamicReportDefinition, dataset: DynamicReportDataset) {
  const fields = fieldMap(dataset);
  const validateKey = (key: string) => {
    if (!fields.has(key)) throw new Error(`Invalid report field: ${key}`);
  };
  definition.columns.forEach(validateKey);
  (definition.groupBy ?? []).forEach(validateKey);
  if (definition.metric?.field && definition.metric.field !== 'id') validateKey(definition.metric.field);
  (definition.filters ?? []).forEach((filter) => validateKey(filter.field));
}

function filterClause(field: DynamicReportField, filter: DynamicReportFilter, values: unknown[]) {
  const column = `source.${quoteIdent(field.key)}`;
  const push = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (filter.operator === 'isEmpty') return `(${column} IS NULL OR ${column}::text = '')`;
  if (filter.operator === 'isNotEmpty') return `(${column} IS NOT NULL AND ${column}::text <> '')`;
  if (filter.value === undefined || filter.value === null || filter.value === '') return null;

  if (filter.operator === 'contains') return `${column}::text ILIKE ${push(`%${filter.value}%`)}`;
  if (filter.operator === 'equals') return `${column}::text = ${push(String(filter.value))}`;
  if (filter.operator === 'notEquals') return `${column}::text <> ${push(String(filter.value))}`;
  if (filter.operator === 'between') {
    if (filter.valueTo === undefined || filter.valueTo === null || filter.valueTo === '') return null;
    return `${column} BETWEEN ${push(filter.value)} AND ${push(filter.valueTo)}`;
  }
  if (filter.operator === 'gt') return `${column} > ${push(filter.value)}`;
  if (filter.operator === 'gte') return `${column} >= ${push(filter.value)}`;
  if (filter.operator === 'lt') return `${column} < ${push(filter.value)}`;
  if (filter.operator === 'lte') return `${column} <= ${push(filter.value)}`;
  return null;
}

function buildChart(definition: DynamicReportDefinition, columns: DynamicReportField[], rows: Record<string, unknown>[]) {
  const chartType = definition.chart?.type ?? 'bar';
  const labelField = definition.chart?.labelField && columns.some((col) => col.key === definition.chart?.labelField)
    ? definition.chart.labelField
    : columns[0]?.key;
  const valueField = definition.chart?.valueField && columns.some((col) => col.key === definition.chart?.valueField)
    ? definition.chart.valueField
    : columns.find((column) => column.type === 'number' || column.type === 'money')?.key;
  if (!labelField || !valueField) return null;

  return {
    type: chartType,
    labelField,
    valueField,
    points: rows.slice(0, 24).map((row) => ({
      label: String(row[labelField] ?? 'Unassigned'),
      value: Number(row[valueField] ?? 0),
    })),
  };
}

function normalizeRow(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) out[key] = value.toISOString().slice(0, 10);
    else if (typeof value === 'bigint') out[key] = Number(value);
    else if (value && typeof value === 'object' && 'toString' in value) out[key] = String(value);
    else out[key] = value;
  }
  return out;
}

function fieldMap(dataset: DynamicReportDataset) {
  return new Map(dataset.fields.map((field) => [field.key, field]));
}

function quoteIdent(value: string) {
  if (!isFieldKey(value)) throw new Error(`Unsafe field key: ${value}`);
  return `"${value}"`;
}

function isFieldKey(value: unknown): value is string {
  return typeof value === 'string' && FIELD_KEY_RE.test(value);
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

async function ensureTenantColumnIfTableExists(table: string) {
  try {
    await ensureOperationalTenantColumn(table);
  } catch {
    // Some modules are optional in smaller deployments. Dataset queries will
    // surface an empty/error state only if the user picks a missing module.
  }
}
