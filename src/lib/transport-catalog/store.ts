/**
 * A tenant's Transport catalogue: which categories it offers to customers and
 * internal Booking Portal staff, custom categories, dynamic module mapping
 * (SERVICE_MODULE_MAP), custom sections/fields, and per-field overrides +
 * default values (tenant_transport_categories).
 *
 * Defaults for the 8 built-in categories come from ./default-forms.ts.
 */

import { prisma } from '@/lib/prisma';
import { withTenantRls, type TxClient } from '@/lib/rls';
import {
  TRANSPORT_CATEGORIES,
  categoryLabel,
  isTransportCategory,
  isValidCategoryCode,
  normalizeCategoryCode,
  type TransportCategoryCode,
} from '@/lib/customer-portal/catalog';
import {
  CATEGORY_ACCENTS,
  VALID_MODULE_KEYS,
  resolveBookingServiceType,
  resolveRequiredModule,
  type CategoryAccent,
} from '@/lib/booking-portal/service-module-map';
import {
  BUILTIN_VISUAL_DEFAULTS,
  CATEGORY_DEFINITIONS,
  cloneTemplateToCustomForm,
  type CategoryDefinition,
  type CustomCategoryTemplate,
} from './default-forms';
import {
  applyOverrides,
  cleanCustomFormConfig,
  cleanOverrides,
  extractDefaultValues,
  type CustomFormConfig,
  type FieldOverrides,
  type RequestFormDef,
  type RequestValues,
} from './form-schema';

export interface TenantCategory extends CategoryDefinition {
  /** Corresponding serviceType key used by Internal Booking Portal (/api/bookings). */
  bookingServiceType: string;
  isCustom: boolean;
  icon: string;
  badge: string;
  accent: CategoryAccent;
  /** Resolved module gate (`null` = accessible to all Booking Portal staff). */
  moduleKey: string | null;
  /** Raw stored override (`null` = inherit built-in SERVICE_MODULE_MAP; `''` = explicitly unlocked). */
  customModuleKey: string | null;
  /** Offered in external Customer Portal. */
  enabled: boolean;
  /** Shown in internal Booking Portal (/booking-portal & /booking-portal/new). */
  bookingPortalEnabled: boolean;
  approvalRequired: boolean;
  sortOrder: number;
  fieldOverrides: FieldOverrides;
  customFormConfig: CustomFormConfig;
  /** The form users fill in (custom sections/fields + overrides + defaults applied). */
  effectiveForm: RequestFormDef;
  /** Default field values resolved from effectiveForm. */
  defaultValues: RequestValues;
  updatedAt: string | null;
}

interface Row {
  category: string;
  enabled: boolean;
  approval_required: boolean;
  field_overrides: FieldOverrides | null;
  updated_at: string | null;
  is_custom: boolean;
  title: string | null;
  description: string | null;
  vehicle_usage: string | null;
  icon: string | null;
  badge: string | null;
  accent: string | null;
  module_key: string | null;
  booking_portal_enabled: boolean | null;
  sort_order: number | null;
  custom_form_config: CustomFormConfig | null;
}

export class CatalogError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const VALID_ACCENTS = new Set<string>(CATEGORY_ACCENTS.map((a) => a.key));

const ROW_COLS = `category, enabled, approval_required, field_overrides, updated_at::text,
  is_custom, title, description, vehicle_usage, icon, badge, accent, module_key,
  booking_portal_enabled, sort_order, custom_form_config`;

async function rowsListFor(tx: TxClient, tenantId: string): Promise<Row[]> {
  return tx.$queryRawUnsafe<Row[]>(
    `SELECT ${ROW_COLS}
       FROM tenant_transport_categories
      WHERE tenant_id = $1
      ORDER BY sort_order ASC, created_at ASC, category ASC`,
    tenantId,
  );
}

async function rowsFor(tx: TxClient, tenantId: string): Promise<Map<string, Row>> {
  const rows = await rowsListFor(tx, tenantId);
  return new Map(rows.map((r) => [r.category, r]));
}

function baseDefinitionFor(category: string, row: Row | undefined): CategoryDefinition {
  if (isTransportCategory(category)) {
    const def = CATEGORY_DEFINITIONS[category];
    return {
      ...def,
      title: row?.title?.trim() || def.title,
      description: row?.description?.trim() || def.description,
      vehicleUsage: row?.vehicle_usage?.trim() || def.vehicleUsage,
    };
  }
  const rawCfg = (row?.custom_form_config && typeof row.custom_form_config === 'object')
    ? row.custom_form_config
    : {};
  const template = (typeof rawCfg.baseTemplate === 'string' ? rawCfg.baseTemplate : 'BLANK') as CustomCategoryTemplate;
  return {
    category,
    title: row?.title?.trim() || categoryLabel(category),
    description: row?.description?.trim() || 'Custom transport service category',
    vehicleUsage: row?.vehicle_usage?.trim() || row?.title?.trim() || categoryLabel(category),
    menu: [],
    form: cloneTemplateToCustomForm(template),
  };
}

function toTenantCategory(category: string, row: Row | undefined): TenantCategory {
  const builtin = isTransportCategory(category);
  const def = baseDefinitionFor(category, row);
  const visual = builtin ? BUILTIN_VISUAL_DEFAULTS[category] : null;
  const customFormConfig = cleanCustomFormConfig(def.form, row?.custom_form_config) ?? {};
  const fieldOverrides = cleanOverrides(def.form, row?.field_overrides ?? {}, customFormConfig) ?? {};
  const effectiveForm = applyOverrides(def.form, fieldOverrides, customFormConfig);
  const defaultValues = extractDefaultValues(effectiveForm);
  const accentRaw = row?.accent ?? visual?.accent ?? 'blue';
  const accent = (VALID_ACCENTS.has(accentRaw) ? accentRaw : 'blue') as CategoryAccent;
  const customModuleKey = row?.module_key !== undefined && row?.module_key !== null ? row.module_key : null;
  const bookingPortalEnabled =
    typeof row?.booking_portal_enabled === 'boolean'
      ? row.booking_portal_enabled
      : visual
        ? visual.defaultBookingPortalEnabled
        : true;

  return {
    ...def,
    category: category as TransportCategoryCode,
    bookingServiceType: resolveBookingServiceType(category),
    isCustom: !builtin || !!row?.is_custom,
    icon: row?.icon?.trim() || visual?.icon || '🚐',
    badge: row?.badge?.trim() || visual?.badge || category.slice(0, 12),
    accent,
    moduleKey: resolveRequiredModule(category, customModuleKey),
    customModuleKey,
    enabled: !!row?.enabled,
    bookingPortalEnabled,
    approvalRequired: !!row?.approval_required,
    sortOrder: Number(row?.sort_order ?? (builtin ? TRANSPORT_CATEGORIES.indexOf(category) * 10 : 200)),
    fieldOverrides,
    customFormConfig,
    effectiveForm,
    defaultValues,
    updatedAt: row?.updated_at ?? null,
  };
}

/** All built-in categories plus any tenant-defined custom categories. */
export async function getTenantCatalog(tenantId: string): Promise<TenantCategory[]> {
  const rowsList = await withTenantRls(prisma, tenantId, (tx) => rowsListFor(tx, tenantId));
  const byCode = new Map(rowsList.map((r) => [r.category, r]));
  const builtIns = TRANSPORT_CATEGORIES.map((c) => toTenantCategory(c, byCode.get(c)));
  const customs = rowsList
    .filter((r) => !isTransportCategory(r.category))
    .map((r) => toTenantCategory(r.category, r));
  return [...builtIns, ...customs];
}

/** Categories the tenant offers to Customer Portal customers (built-in + custom). */
export async function offeredCategories(tenantId: string, tx?: TxClient): Promise<string[]> {
  const run = (t: TxClient) => rowsListFor(t, tenantId);
  const rowsList = tx ? await run(tx) : await withTenantRls(prisma, tenantId, run);
  const byCode = new Map(rowsList.map((r) => [r.category, r]));
  const builtIns = TRANSPORT_CATEGORIES.filter((c) => byCode.get(c)?.enabled);
  const customs = rowsList
    .filter((r) => !isTransportCategory(r.category) && r.enabled)
    .map((r) => r.category);
  return [...builtIns, ...customs];
}

/** Lookup map of category code → display title for both built-in and tenant custom categories. */
export async function tenantCategoryTitleMap(tenantId: string, tx?: TxClient): Promise<Record<string, string>> {
  const run = (t: TxClient) => rowsListFor(t, tenantId);
  const rowsList = tx ? await run(tx) : await withTenantRls(prisma, tenantId, run);
  const map: Record<string, string> = {};
  for (const c of TRANSPORT_CATEGORIES) {
    map[c] = CATEGORY_DEFINITIONS[c].title;
  }
  for (const r of rowsList) {
    if (r.title?.trim()) map[r.category] = r.title.trim();
    else if (!map[r.category]) map[r.category] = categoryLabel(r.category);
  }
  return map;
}

/** One category for this tenant (built-in or custom). */
export async function getTenantCategory(tenantId: string, category: string): Promise<TenantCategory> {
  if (!isValidCategoryCode(category)) throw new CatalogError('Unknown Transport category.', 404);
  const rows = await withTenantRls(prisma, tenantId, (tx) => rowsFor(tx, tenantId));
  const row = rows.get(category);
  if (!isTransportCategory(category) && !row) {
    throw new CatalogError('Unknown Transport category.', 404);
  }
  return toTenantCategory(category, row);
}

function parseModuleKeyPatch(raw: unknown): { set: boolean; value: string | null } {
  if (raw === undefined) return { set: false, value: null };
  if (raw === null) return { set: true, value: null };
  if (typeof raw !== 'string') throw new CatalogError('moduleKey must be a string or null.');
  const trimmed = raw.trim();
  if (trimmed === '') return { set: true, value: '' };
  if (!VALID_MODULE_KEYS.has(trimmed)) throw new CatalogError(`Unknown module "${trimmed}".`);
  return { set: true, value: trimmed };
}

function parseAccentPatch(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !VALID_ACCENTS.has(raw.trim())) {
    throw new CatalogError('Invalid accent color.');
  }
  return raw.trim();
}

export interface UpdateCategoryPatch {
  enabled?: unknown;
  bookingPortalEnabled?: unknown;
  approvalRequired?: unknown;
  moduleKey?: unknown;
  title?: unknown;
  description?: unknown;
  vehicleUsage?: unknown;
  icon?: unknown;
  badge?: unknown;
  accent?: unknown;
  sortOrder?: unknown;
  fieldOverrides?: unknown;
  customFormConfig?: unknown;
}

/**
 * Updates a built-in or custom category: toggles Customer Portal / Booking Portal
 * availability, approval, module mapping, metadata, custom sections/fields, and
 * field overrides (including defaultValue).
 */
export async function updateTenantCategory(
  tenantId: string,
  category: unknown,
  patch: UpdateCategoryPatch,
  by: string,
): Promise<TenantCategory> {
  if (!isValidCategoryCode(category)) throw new CatalogError('Unknown Transport category.');

  const existing = await withTenantRls(prisma, tenantId, (tx) => rowsFor(tx, tenantId));
  const curRow = existing.get(category);
  const builtin = isTransportCategory(category);
  if (!builtin && !curRow) throw new CatalogError('Unknown Transport category.', 404);

  const def = baseDefinitionFor(category, curRow);
  const enabled = typeof patch.enabled === 'boolean' ? patch.enabled : null;
  const bookingPortalEnabled = typeof patch.bookingPortalEnabled === 'boolean' ? patch.bookingPortalEnabled : null;
  const approval = typeof patch.approvalRequired === 'boolean' ? patch.approvalRequired : null;
  const moduleKeyPatch = parseModuleKeyPatch(patch.moduleKey);
  const accent = parseAccentPatch(patch.accent);
  const title = typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim().slice(0, 60) : null;
  const description = typeof patch.description === 'string' ? patch.description.trim().slice(0, 200) : null;
  const vehicleUsage = typeof patch.vehicleUsage === 'string' && patch.vehicleUsage.trim() ? patch.vehicleUsage.trim().slice(0, 60) : null;
  const icon = typeof patch.icon === 'string' && patch.icon.trim() ? patch.icon.trim().slice(0, 12) : null;
  const badge = typeof patch.badge === 'string' && patch.badge.trim() ? patch.badge.trim().toUpperCase().slice(0, 16) : null;
  const sortOrder = typeof patch.sortOrder === 'number' && Number.isFinite(patch.sortOrder)
    ? Math.max(0, Math.min(9999, Math.round(patch.sortOrder)))
    : null;

  const existingCustomConfig = cleanCustomFormConfig(def.form, curRow?.custom_form_config) ?? {};
  let nextCustomConfig: CustomFormConfig | null = null;
  if (patch.customFormConfig !== undefined) {
    // Preserve baseTemplate for custom categories if caller omits it.
    const rawCustom = patch.customFormConfig && typeof patch.customFormConfig === 'object' && !Array.isArray(patch.customFormConfig)
      ? {
          ...(existingCustomConfig.baseTemplate ? { baseTemplate: existingCustomConfig.baseTemplate } : {}),
          ...(patch.customFormConfig as Record<string, unknown>),
        }
      : patch.customFormConfig;
    nextCustomConfig = cleanCustomFormConfig(def.form, rawCustom);
    if (!nextCustomConfig) {
      throw new CatalogError('customFormConfig contains invalid sections, fields, options, or default values.');
    }
  }

  const effectiveCustomConfig = nextCustomConfig ?? existingCustomConfig;

  let overrides: FieldOverrides | null = null;
  if (patch.fieldOverrides !== undefined) {
    overrides = cleanOverrides(def.form, patch.fieldOverrides, effectiveCustomConfig);
    if (!overrides) {
      throw new CatalogError('fieldOverrides must map known field keys to valid { hidden?, required?, defaultValue? }.');
    }
  }

  const hasAnyChange =
    enabled !== null ||
    bookingPortalEnabled !== null ||
    approval !== null ||
    moduleKeyPatch.set ||
    accent !== undefined ||
    title !== null ||
    description !== null ||
    vehicleUsage !== null ||
    icon !== null ||
    badge !== null ||
    sortOrder !== null ||
    overrides !== null ||
    nextCustomConfig !== null;

  if (!hasAnyChange) throw new CatalogError('Nothing to change.');

  const rows = await withTenantRls(prisma, tenantId, async (tx) => {
    await tx.$executeRawUnsafe(
      `INSERT INTO tenant_transport_categories (
         tenant_id, category, enabled, approval_required, field_overrides, updated_by,
         is_custom, title, description, vehicle_usage, icon, badge, accent,
         module_key, booking_portal_enabled, sort_order, custom_form_config
       )
       VALUES (
         $1, $2, COALESCE($3, FALSE), COALESCE($4, FALSE), COALESCE($5::jsonb, '{}'::jsonb), $6,
         $7, $8, $9, $10, $11, $12, $13,
         CASE WHEN $14 THEN $15 ELSE NULL END,
         $16, COALESCE($17, 100), COALESCE($18::jsonb, '{}'::jsonb)
       )
       ON CONFLICT (tenant_id, category) DO UPDATE SET
         enabled = COALESCE($3, tenant_transport_categories.enabled),
         approval_required = COALESCE($4, tenant_transport_categories.approval_required),
         field_overrides = COALESCE($5::jsonb, tenant_transport_categories.field_overrides),
         updated_by = $6,
         title = COALESCE($8, tenant_transport_categories.title),
         description = COALESCE($9, tenant_transport_categories.description),
         vehicle_usage = COALESCE($10, tenant_transport_categories.vehicle_usage),
         icon = COALESCE($11, tenant_transport_categories.icon),
         badge = COALESCE($12, tenant_transport_categories.badge),
         accent = COALESCE($13, tenant_transport_categories.accent),
         module_key = CASE WHEN $14 THEN $15 ELSE tenant_transport_categories.module_key END,
         booking_portal_enabled = COALESCE($16, tenant_transport_categories.booking_portal_enabled),
         sort_order = COALESCE($17, tenant_transport_categories.sort_order),
         custom_form_config = COALESCE($18::jsonb, tenant_transport_categories.custom_form_config),
         updated_at = NOW()`,
      tenantId,
      category,
      enabled,
      approval,
      overrides ? JSON.stringify(overrides) : null,
      by,
      !builtin,
      title,
      description,
      vehicleUsage,
      icon,
      badge,
      accent ?? null,
      moduleKeyPatch.set,
      moduleKeyPatch.value,
      bookingPortalEnabled,
      sortOrder,
      nextCustomConfig ? JSON.stringify(nextCustomConfig) : null,
    );
    return rowsFor(tx, tenantId);
  });
  return toTenantCategory(category, rows.get(category));
}

export interface CreateCustomCategoryInput {
  category?: unknown;
  title?: unknown;
  description?: unknown;
  vehicleUsage?: unknown;
  icon?: unknown;
  badge?: unknown;
  accent?: unknown;
  moduleKey?: unknown;
  template?: unknown;
  enabled?: unknown;
  bookingPortalEnabled?: unknown;
  approvalRequired?: unknown;
}

/** Creates a brand-new tenant custom category with optional starter template and module mapping. */
export async function createCustomTenantCategory(
  tenantId: string,
  input: CreateCustomCategoryInput,
  by: string,
): Promise<TenantCategory> {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title.length < 2 || title.length > 60) {
    throw new CatalogError('Category title must be between 2 and 60 characters.');
  }
  const rawCode = typeof input.category === 'string' && input.category.trim() ? input.category : title;
  const code = normalizeCategoryCode(rawCode);
  if (!isValidCategoryCode(code)) {
    throw new CatalogError('Category code must start with a letter and contain only A-Z, 0-9, and underscores.');
  }
  if (isTransportCategory(code) || code === 'RENTAL') {
    throw new CatalogError(`"${code}" is a reserved built-in category code. Choose a different code.`, 409);
  }

  const description = typeof input.description === 'string' && input.description.trim()
    ? input.description.trim().slice(0, 200)
    : `Custom ${title} transport requests`;
  const vehicleUsage = typeof input.vehicleUsage === 'string' && input.vehicleUsage.trim()
    ? input.vehicleUsage.trim().slice(0, 60)
    : title;
  const icon = typeof input.icon === 'string' && input.icon.trim() ? input.icon.trim().slice(0, 12) : '🚐';
  const badge = typeof input.badge === 'string' && input.badge.trim()
    ? input.badge.trim().toUpperCase().slice(0, 16)
    : code.slice(0, 12);
  const accent = parseAccentPatch(input.accent) ?? 'cyan';
  const moduleKeyPatch = parseModuleKeyPatch(input.moduleKey === undefined ? '' : input.moduleKey);
  const templateRaw = typeof input.template === 'string' ? input.template.trim().toUpperCase() : 'BLANK';
  const baseTemplate: CustomCategoryTemplate =
    templateRaw === 'BLANK' || isTransportCategory(templateRaw) ? (templateRaw as CustomCategoryTemplate) : 'BLANK';
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : true;
  const bookingPortalEnabled = typeof input.bookingPortalEnabled === 'boolean' ? input.bookingPortalEnabled : true;
  const approvalRequired = typeof input.approvalRequired === 'boolean' ? input.approvalRequired : false;

  const customFormConfig: CustomFormConfig = { baseTemplate };

  const rows = await withTenantRls(prisma, tenantId, async (tx) => {
    const existing = await rowsFor(tx, tenantId);
    if (existing.has(code)) {
      throw new CatalogError(`Category "${code}" already exists.`, 409);
    }
    const maxSort = Math.max(200, ...[...existing.values()].map((r) => Number(r.sort_order ?? 100)));
    await tx.$executeRawUnsafe(
      `INSERT INTO tenant_transport_categories (
         tenant_id, category, enabled, approval_required, field_overrides, updated_by,
         is_custom, title, description, vehicle_usage, icon, badge, accent,
         module_key, booking_portal_enabled, sort_order, custom_form_config
       )
       VALUES ($1, $2, $3, $4, '{}'::jsonb, $5, TRUE, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)`,
      tenantId,
      code,
      enabled,
      approvalRequired,
      by,
      title,
      description,
      vehicleUsage,
      icon,
      badge,
      accent,
      moduleKeyPatch.value,
      bookingPortalEnabled,
      maxSort + 10,
      JSON.stringify(customFormConfig),
    );
    return rowsFor(tx, tenantId);
  });

  return toTenantCategory(code, rows.get(code));
}

/** Deletes a tenant-defined custom category (built-in categories cannot be deleted). */
export async function deleteCustomTenantCategory(tenantId: string, category: unknown): Promise<{ category: string; title: string }> {
  if (!isValidCategoryCode(category)) throw new CatalogError('Unknown Transport category.', 404);
  if (isTransportCategory(category)) {
    throw new CatalogError('Built-in categories cannot be deleted; toggle them off instead.', 400);
  }
  return withTenantRls(prisma, tenantId, async (tx) => {
    const [deleted] = await tx.$queryRawUnsafe<Array<{ category: string; title: string | null }>>(
      `DELETE FROM tenant_transport_categories
        WHERE tenant_id = $1 AND category = $2 AND is_custom = TRUE
      RETURNING category, title`,
      tenantId,
      category,
    );
    if (!deleted) throw new CatalogError('Custom category not found.', 404);
    return { category: deleted.category, title: deleted.title ?? categoryLabel(deleted.category) };
  });
}

/**
 * The Transport categories a customer can request: given to the customer in
 * onboarding (customer_portal_access.categories) and still offered by the
 * tenant. Empty when the customer has no Transport portal.
 */
export async function customerTransportCategories(tenantId: string, customerId: string): Promise<TenantCategory[]> {
  return withTenantRls(prisma, tenantId, async (tx) => {
    const [access] = await tx.$queryRawUnsafe<Array<{ categories: string[] }>>(
      `SELECT categories FROM customer_portal_access
        WHERE tenant_id = $1 AND customer_id = $2 AND portal = 'TRANSPORT'`,
      tenantId,
      customerId,
    );
    if (!access) return [];
    const rowsList = await rowsListFor(tx, tenantId);
    const byCode = new Map(rowsList.map((r) => [r.category, r]));
    const allowedSet = new Set(access.categories);
    const builtIns = TRANSPORT_CATEGORIES
      .filter((c) => allowedSet.has(c) && byCode.get(c)?.enabled)
      .map((c) => toTenantCategory(c, byCode.get(c)));
    const customs = rowsList
      .filter((r) => !isTransportCategory(r.category) && allowedSet.has(r.category) && r.enabled)
      .map((r) => toTenantCategory(r.category, r));
    return [...builtIns, ...customs];
  });
}
