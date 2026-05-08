/**
 * Read-side helper for the Service Configuration Engine.
 *
 * Modules call loadServiceConfig(tenantId, serviceTypeKey, scopeId?) to
 * get a fully merged rule snapshot — base type record, module mapping,
 * and all 9 rule sets (each merged with its category default so missing
 * keys are filled).
 *
 * Phase 2E — multi-tenant inheritance. The optional `scopeId` arg picks
 * the leaf scope; the resolver walks up the parent_scope_id chain via
 * loadScopeChain and the first matching service_rules row wins. Without
 * a scopeId, the tenant's root scope is used (current behaviour).
 *
 * Authority semantics:
 *   - For each category we look for an active row at any scope in the
 *     leaf-to-root chain. Closest scope wins.
 *   - If no row exists anywhere, the category resolves to RULE_DEFAULTS.
 *   - configuredAtScope[category] tells callers WHICH scope owns the
 *     resolved value (null when running on defaults). The admin UI uses
 *     this to render an "inherited from {scope}" indicator.
 *
 * This helper is read-only and idempotent — safe to call on hot paths.
 */

import { prisma } from '@/lib/prisma';
import { ensureServiceConfigTables, ensureSeededForTenant } from './schema';
import { ensureServiceRulesTable, loadRulesForChain } from './rules-schema';
import { ensureRootScope, loadScopeChain } from './scopes-schema';
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
  /** Lucide icon name (string) — resolved client-side via getServiceIcon. */
  icon: string | null;
  tone: ServiceTone;
  defaultPriority: DefaultPriority;
  sortOrder: number;
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
  /** True for categories that have a saved row anywhere in the scope chain. */
  configured: { [K in RuleCategory]: boolean };
  /** The scope_id whose row was selected for each category. null when running
   *  on RULE_DEFAULTS. Used by the admin UI to badge "inherited from {scope}". */
  configuredAtScope: { [K in RuleCategory]: string | null };
  /** The scope chain walked, leaf → root. Length 1 == only the root scope. */
  scopeChain: { id: string; name: string; level: string; isRoot: boolean }[];
}

interface TypeRow {
  id: string; tenant_id: string; category_id: string; key: string; name: string;
  description: string | null; icon: string | null; tone: string;
  default_priority: string; sort_order: number; is_system: boolean;
}
interface MappingRow {
  linked_module: string; sub_module: string | null;
  workflow_engine_enabled: boolean; notification_engine_enabled: boolean;
  approval_engine_enabled: boolean; finance_engine_enabled: boolean;
  dispatch_engine_enabled: boolean;
}

/**
 * Resolve a service config snapshot by `(tenantId, serviceTypeKey)`,
 * optionally at a specific scope. When scopeId is omitted, the tenant
 * root scope is used (so existing callers continue working unchanged).
 *
 * Returns null when the tenant doesn't have that service type.
 */
export async function loadServiceConfig(
  tenantId: string,
  serviceTypeKey: string,
  scopeId?: string,
): Promise<ResolvedServiceConfig | null> {
  await ensureServiceConfigTables();
  await ensureServiceRulesTable();
  // Auto-seed the tenant on first call. ensureSeededForTenant also creates
  // the root scope and backfills any pre-2E rules to it.
  await ensureSeededForTenant(tenantId);

  // Default to the tenant root when no scope given.
  const leafScopeId = scopeId ?? await ensureRootScope(tenantId);
  const chain = await loadScopeChain(tenantId, leafScopeId);
  if (chain.length === 0) return null;
  const chainIds = chain.map(s => s.id);

  const typeRows = await prisma.$queryRawUnsafe<TypeRow[]>(
    `SELECT id::text, tenant_id, category_id::text, key, name, description, icon, tone,
            default_priority, sort_order, is_system
     FROM service_types
     WHERE tenant_id = $1 AND key = $2 AND deleted_at IS NULL
     LIMIT 1`,
    tenantId, serviceTypeKey,
  ).catch(() => []);
  const t = typeRows[0];
  if (!t) return null;

  const mappingRows = await prisma.$queryRawUnsafe<MappingRow[]>(
    `SELECT linked_module, sub_module,
            workflow_engine_enabled, notification_engine_enabled,
            approval_engine_enabled, finance_engine_enabled, dispatch_engine_enabled
     FROM service_module_mapping
     WHERE service_type_id = $1::uuid`,
    t.id,
  ).catch(() => []);

  // Resolve every category against the chain.
  const rules: Record<string, unknown> = {};
  const configured = {} as { [K in RuleCategory]: boolean };
  const configuredAtScope = {} as { [K in RuleCategory]: string | null };

  await Promise.all(RULE_CATEGORIES.map(async (cat) => {
    const hit = await loadRulesForChain<Record<string, unknown>>(t.id, cat, chainIds);
    configured[cat] = hit !== null;
    configuredAtScope[cat] = hit?.scopeId ?? null;
    rules[cat] = {
      ...(RULE_DEFAULTS[cat] as object),
      ...((hit?.rules ?? {}) as object),
    };
  }));

  const m = mappingRows[0];
  return {
    type: {
      id: t.id, tenantId: t.tenant_id, categoryId: t.category_id,
      key: t.key, name: t.name, description: t.description, icon: t.icon,
      tone: t.tone as ServiceTone,
      defaultPriority: t.default_priority as DefaultPriority,
      sortOrder: t.sort_order ?? 0,
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
    configuredAtScope,
    scopeChain: chain.map(s => ({ id: s.id, name: s.name, level: s.level, isRoot: s.isRoot })),
  };
}
