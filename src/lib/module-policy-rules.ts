/**
 * Module availability policy: how each registry module reaches tenants.
 *
 *   ALWAYS_ON   default module: on for every tenant, cannot be switched off
 *   PER_TENANT  switched on or off per tenant (Create Tenant / Manage)
 *   TIER        included automatically for tenants on `minPlan` or a higher
 *               plan, and unavailable below it
 *
 * Platform admins set policies in Admin > Module Policies (stored by
 * @/lib/module-policies). A module without a saved policy keeps its
 * registry default: `always-on` modules are ALWAYS_ON, all others
 * PER_TENANT (so `enterprise-only` modules stay switchable until a tier is
 * chosen for them, as before).
 *
 * Pure and client-safe: used by the server (sessions, tenant APIs) and by
 * the module picker.
 */
import { MODULES, MODULE_BY_KEY, SYSTEM_MODULE_KEYS, resolveModuleKey, type ModuleKey } from '@/lib/modules';

export type ModuleAvailability = 'ALWAYS_ON' | 'PER_TENANT' | 'TIER';

export interface ModulePolicy {
  availability: ModuleAvailability;
  /** Plan code required when availability is TIER (e.g. 'PROFESSIONAL'). */
  minPlan?: string;
}

export type ModulePolicies = Record<ModuleKey, ModulePolicy>;

/** Canonical plan order, lowest first; plans not listed rank by this fallback. */
export const PLAN_ORDER = ['TRIAL', 'STANDARD', 'PROFESSIONAL', 'ENTERPRISE'] as const;

export function registryDefaultPolicy(key: ModuleKey): ModulePolicy {
  return MODULE_BY_KEY[key].subscription === 'always-on' ? { availability: 'ALWAYS_ON' } : { availability: 'PER_TENANT' };
}

/** Saved policies over registry defaults; unknown modules and malformed entries are ignored. */
export function resolvePolicies(saved: unknown): ModulePolicies {
  const out = {} as ModulePolicies;
  const src = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
  for (const m of MODULES) {
    const p = src[m.key] as Partial<ModulePolicy> | undefined;
    const ok = p && (p.availability === 'ALWAYS_ON' || p.availability === 'PER_TENANT'
      || (p.availability === 'TIER' && typeof p.minPlan === 'string' && p.minPlan.length > 0));
    out[m.key] = ok
      ? (p!.availability === 'TIER' ? { availability: 'TIER', minPlan: p!.minPlan } : { availability: p!.availability! })
      : registryDefaultPolicy(m.key);
  }
  return out;
}

/**
 * `true` when `plan` is `minPlan` or higher. `rank` maps plan codes to their
 * order (platform_plans.sort_order on the server); codes it does not know
 * fall back to PLAN_ORDER.
 */
export function planMeets(plan: string | null | undefined, minPlan: string, rank?: Record<string, number>): boolean {
  const r = (code: string) => rank?.[code] ?? PLAN_ORDER.indexOf(code as typeof PLAN_ORDER[number]);
  const have = r(plan ?? 'TRIAL');
  const need = r(minPlan);
  return need < 0 ? false : have >= need;
}

/** Whether a tenant on `plan` with these stored switches has module `key`. */
export function moduleEnabledFor(
  key: ModuleKey,
  policy: ModulePolicy,
  switchedOn: ReadonlySet<string>,
  plan: string | null | undefined,
  rank?: Record<string, number>,
): boolean {
  if (policy.availability === 'ALWAYS_ON') return true;
  if (policy.availability === 'TIER') return planMeets(plan, policy.minPlan ?? 'ENTERPRISE', rank);
  return switchedOn.has(key);
}

/**
 * The modules a tenant actually has: its stored tenant_modules switches
 * (legacy aliases resolved), with ALWAYS_ON modules added, TIER modules
 * following the plan, plus the system keys ('admin', 'platform').
 */
export function effectiveTenantModules(
  stored: readonly string[],
  plan: string | null | undefined,
  policies: ModulePolicies,
  rank?: Record<string, number>,
): string[] {
  const switchedOn = new Set<string>();
  for (const raw of stored) {
    const key = resolveModuleKey(raw);
    if (key) switchedOn.add(key);
  }
  const out: string[] = [...SYSTEM_MODULE_KEYS];
  for (const m of MODULES) {
    if (moduleEnabledFor(m.key, policies[m.key] ?? registryDefaultPolicy(m.key), switchedOn, plan, rank)) out.push(m.key);
  }
  return out;
}

/** Short label for a policy, e.g. "Default", "Per tenant", "Professional+". */
export function policyLabel(policy: ModulePolicy, planNames?: Record<string, string>): string {
  if (policy.availability === 'ALWAYS_ON') return 'Default';
  if (policy.availability === 'PER_TENANT') return 'Per tenant';
  const code = policy.minPlan ?? 'ENTERPRISE';
  const name = planNames?.[code] ?? code.charAt(0) + code.slice(1).toLowerCase();
  return `${name}+`;
}
