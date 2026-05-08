/**
 * Read-side helper for the Service Configuration Engine (Phase 2C).
 *
 * Modules call loadServiceConfig(tenantId, serviceTypeKey) to get a fully
 * merged rule snapshot — base type record, module mapping, and all 8 rule
 * sets (each merged with its category default so missing keys are filled).
 *
 * Authority semantics:
 *   - If a (service_type, category) row exists in service_rules, that
 *     row wins. Anything missing from the row falls back to RULE_DEFAULTS.
 *   - If no row exists, the entire category resolves to RULE_DEFAULTS.
 *   - The returned `configured` map tells callers which categories were
 *     actually saved by an admin vs. running on defaults — useful for
 *     fall-back logic (e.g. "use TICKET_TYPE_CONFIG.requiresApproval if
 *     approval rules were never configured").
 *
 * This helper is read-only and idempotent — safe to call on hot paths.
 */

import { prisma } from '@/lib/prisma';
import { ensureServiceConfigTables } from './schema';
import { ensureServiceRulesTable } from './rules-schema';
import {
  RULE_CATEGORIES, RULE_DEFAULTS,
  type RuleCategory, type RuleShapes,
} from '@/types/service-rules';
import type {
  ServiceTone, DefaultPriority, LinkedModule,
} from '@/types/service-config';

export interface ResolvedServiceType {
  id: string;
  tenantId: string;
  categoryId: string;
  key: string;
  name: string;
  description: string | null;
  tone: ServiceTone;
  defaultPriority: DefaultPriority;
  isSystem: boolean;
}

export interface ResolvedModuleMapping {
  linkedModule: LinkedModule;
  subModule: string | null;
  workflowEngineEnabled: boolean;
  notificationEngineEnabled: boolean;
  approvalEngineEnabled: boolean;
  financeEngineEnabled: boolean;
  dispatchEngineEnabled: boolean;
}

export interface ResolvedServiceConfig {
  type: ResolvedServiceType;
  mapping: ResolvedModuleMapping | null;
  rules: RuleShapes;
  /** True for categories that have a saved row; false when defaults are returned. */
  configured: { [K in RuleCategory]: boolean };
}

interface TypeRow {
  id: string; tenant_id: string; category_id: string; key: string; name: string;
  description: string | null; tone: string; default_priority: string; is_system: boolean;
}
interface MappingRow {
  linked_module: string; sub_module: string | null;
  workflow_engine_enabled: boolean; notification_engine_enabled: boolean;
  approval_engine_enabled: boolean; finance_engine_enabled: boolean;
  dispatch_engine_enabled: boolean;
}
interface RuleRow {
  category: string;
  rules: unknown;
}

/**
 * Resolve a service config snapshot by `(tenantId, serviceTypeKey)`.
 *
 * Returns null when the tenant doesn't have that service type — callers
 * should treat this as "no centralised config; use module defaults".
 */
export async function loadServiceConfig(
  tenantId: string,
  serviceTypeKey: string,
): Promise<ResolvedServiceConfig | null> {
  await ensureServiceConfigTables();
  await ensureServiceRulesTable();

  const typeRows = await prisma.$queryRawUnsafe<TypeRow[]>(
    `SELECT id::text, tenant_id, category_id::text, key, name, description, tone,
            default_priority, is_system
     FROM service_types
     WHERE tenant_id = $1 AND key = $2 AND deleted_at IS NULL
     LIMIT 1`,
    tenantId, serviceTypeKey,
  ).catch(() => []);
  const t = typeRows[0];
  if (!t) return null;

  const [mappingRows, ruleRows] = await Promise.all([
    prisma.$queryRawUnsafe<MappingRow[]>(
      `SELECT linked_module, sub_module,
              workflow_engine_enabled, notification_engine_enabled,
              approval_engine_enabled, finance_engine_enabled, dispatch_engine_enabled
       FROM service_module_mapping
       WHERE service_type_id = $1::uuid`,
      t.id,
    ).catch(() => []),
    prisma.$queryRawUnsafe<RuleRow[]>(
      // Phase 2D — only the currently-active version per category.
      `SELECT category, rules
       FROM service_rules
       WHERE service_type_id = $1::uuid AND effective_to IS NULL`,
      t.id,
    ).catch(() => []),
  ]);

  // Merge each saved category's rules over its default. Missing categories
  // resolve to defaults. configured[category] flags whether a row existed.
  const ruleByCat = new Map(ruleRows.map(r => [r.category, r.rules]));
  // Build with a loose record then assert at the boundary — RuleShapes is
  // a discriminated map and TS can't follow the cat-keyed assignment.
  const rules: Record<string, unknown> = {};
  const configured = {} as { [K in RuleCategory]: boolean };
  for (const cat of RULE_CATEGORIES) {
    const saved = ruleByCat.get(cat);
    configured[cat] = saved !== undefined;
    rules[cat] = {
      ...(RULE_DEFAULTS[cat] as object),
      ...((saved ?? {}) as object),
    };
  }

  const m = mappingRows[0];
  return {
    type: {
      id: t.id, tenantId: t.tenant_id, categoryId: t.category_id,
      key: t.key, name: t.name, description: t.description,
      tone: t.tone as ServiceTone,
      defaultPriority: t.default_priority as DefaultPriority,
      isSystem: t.is_system,
    },
    mapping: m
      ? {
          linkedModule: m.linked_module as LinkedModule,
          subModule: m.sub_module,
          workflowEngineEnabled: m.workflow_engine_enabled,
          notificationEngineEnabled: m.notification_engine_enabled,
          approvalEngineEnabled: m.approval_engine_enabled,
          financeEngineEnabled: m.finance_engine_enabled,
          dispatchEngineEnabled: m.dispatch_engine_enabled,
        }
      : null,
    rules: rules as unknown as RuleShapes,
    configured,
  };
}
