/**
 * A tenant's Transport catalogue: which categories it offers to customers and
 * its changes to each category's request form (tenant_transport_categories).
 * Defaults come from ./default-forms.ts; a category without a row is not
 * offered.
 */

import { prisma } from '@/lib/prisma';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { TRANSPORT_CATEGORIES, isTransportCategory, type TransportCategory } from '@/lib/customer-portal/catalog';
import { CATEGORY_DEFINITIONS, type CategoryDefinition } from './default-forms';
import { applyOverrides, cleanOverrides, type FieldOverrides, type RequestFormDef } from './form-schema';

export interface TenantCategory extends CategoryDefinition {
  enabled: boolean;
  approvalRequired: boolean;
  fieldOverrides: FieldOverrides;
  /** The form this tenant's customers fill in (overrides applied). */
  effectiveForm: RequestFormDef;
  updatedAt: string | null;
}

interface Row {
  category: string; enabled: boolean; approval_required: boolean;
  field_overrides: FieldOverrides | null; updated_at: string | null;
}

export class CatalogError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

async function rowsFor(tx: TxClient, tenantId: string): Promise<Map<string, Row>> {
  const rows = await tx.$queryRawUnsafe<Row[]>(
    `SELECT category, enabled, approval_required, field_overrides, updated_at::text
       FROM tenant_transport_categories WHERE tenant_id = $1`,
    tenantId,
  );
  return new Map(rows.map((r) => [r.category, r]));
}

function toTenantCategory(def: CategoryDefinition, row: Row | undefined): TenantCategory {
  const overrides = cleanOverrides(def.form, row?.field_overrides ?? {}) ?? {};
  return {
    ...def,
    enabled: !!row?.enabled,
    approvalRequired: !!row?.approval_required,
    fieldOverrides: overrides,
    effectiveForm: applyOverrides(def.form, overrides),
    updatedAt: row?.updated_at ?? null,
  };
}

/** All eight categories with this tenant's settings. */
export async function getTenantCatalog(tenantId: string): Promise<TenantCategory[]> {
  const rows = await withTenantRls(prisma, tenantId, (tx) => rowsFor(tx, tenantId));
  return TRANSPORT_CATEGORIES.map((c) => toTenantCategory(CATEGORY_DEFINITIONS[c], rows.get(c)));
}

/** Categories the tenant offers to customers. */
export async function offeredCategories(tenantId: string, tx?: TxClient): Promise<TransportCategory[]> {
  const run = (t: TxClient) => rowsFor(t, tenantId);
  const rows = tx ? await run(tx) : await withTenantRls(prisma, tenantId, run);
  return TRANSPORT_CATEGORIES.filter((c) => rows.get(c)?.enabled);
}

/** One category for this tenant (e.g. to validate a request against its form). */
export async function getTenantCategory(tenantId: string, category: TransportCategory): Promise<TenantCategory> {
  const rows = await withTenantRls(prisma, tenantId, (tx) => rowsFor(tx, tenantId));
  return toTenantCategory(CATEGORY_DEFINITIONS[category], rows.get(category));
}

/**
 * Turns a category on/off, sets approval, or replaces its field overrides.
 * Turning a category off does not remove it from customers that have it;
 * onboarding just stops offering it (and 3c stops showing its form).
 */
export async function updateTenantCategory(
  tenantId: string, category: unknown,
  patch: { enabled?: unknown; approvalRequired?: unknown; fieldOverrides?: unknown },
  by: string,
): Promise<TenantCategory> {
  if (!isTransportCategory(category)) throw new CatalogError('Unknown Transport category.');
  const def = CATEGORY_DEFINITIONS[category];
  const enabled = typeof patch.enabled === 'boolean' ? patch.enabled : null;
  const approval = typeof patch.approvalRequired === 'boolean' ? patch.approvalRequired : null;
  let overrides: FieldOverrides | null = null;
  if (patch.fieldOverrides !== undefined) {
    overrides = cleanOverrides(def.form, patch.fieldOverrides);
    if (!overrides) throw new CatalogError('fieldOverrides must map known field keys to { hidden?, required? }.');
  }
  if (enabled === null && approval === null && overrides === null) throw new CatalogError('Nothing to change.');

  const rows = await withTenantRls(prisma, tenantId, async (tx) => {
    await tx.$executeRawUnsafe(
      `INSERT INTO tenant_transport_categories (tenant_id, category, enabled, approval_required, field_overrides, updated_by)
       VALUES ($1, $2, COALESCE($3, FALSE), COALESCE($4, FALSE), COALESCE($5::jsonb, '{}'::jsonb), $6)
       ON CONFLICT (tenant_id, category) DO UPDATE SET
         enabled = COALESCE($3, tenant_transport_categories.enabled),
         approval_required = COALESCE($4, tenant_transport_categories.approval_required),
         field_overrides = COALESCE($5::jsonb, tenant_transport_categories.field_overrides),
         updated_by = $6, updated_at = NOW()`,
      tenantId, category, enabled, approval, overrides ? JSON.stringify(overrides) : null, by,
    );
    return rowsFor(tx, tenantId);
  });
  return toTenantCategory(def, rows.get(category));
}
