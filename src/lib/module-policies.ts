/**
 * Storage of module availability policies (rules: @/lib/module-policy-rules).
 *
 * One JSON value in platform_settings under the key 'module_policies':
 *   { "<moduleKey>": { "availability": "ALWAYS_ON" | "PER_TENANT" | "TIER", "minPlan"?: "<PLAN>" } }
 * Cached per process for 30 s; saving drops the cache. A read failure keeps
 * the last good value, or registry defaults, so sign-in never breaks over it.
 */
import { prisma } from '@/lib/prisma';
import { listPlans } from '@/lib/plans';
import { MODULES } from '@/lib/modules';
import {
  effectiveTenantModules, resolvePolicies, type ModulePolicies, type ModulePolicy,
} from '@/lib/module-policy-rules';

const KEY = 'module_policies';
const TTL_MS = 30_000;
let cache: { policies: ModulePolicies; at: number } | null = null;

export async function getModulePolicies(): Promise<ModulePolicies> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.policies;
  try {
    const rows = await prisma.$queryRawUnsafe<{ value: string | null }[]>(
      `SELECT value FROM platform_settings WHERE key = $1`, KEY,
    );
    let saved: unknown = null;
    try { saved = rows[0]?.value ? JSON.parse(rows[0].value) : null; } catch { saved = null; }
    cache = { policies: resolvePolicies(saved), at: Date.now() };
  } catch (e) {
    console.error('[module-policies] load failed, using last good value or defaults:', e);
    cache = { policies: cache?.policies ?? resolvePolicies(null), at: Date.now() };
  }
  return cache.policies;
}

/** Plan code -> rank (platform_plans.sort_order). */
export async function getPlanRank(): Promise<Record<string, number>> {
  try {
    const plans = await listPlans();
    return Object.fromEntries(plans.map((p) => [p.code, p.sortOrder]));
  } catch {
    return {};
  }
}

/**
 * Validate and store policies for every module given (others keep theirs).
 * TIER needs a known, active plan code.
 */
export async function saveModulePolicies(
  input: unknown,
): Promise<{ ok: true; policies: ModulePolicies } | { ok: false; error: string }> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Expected { moduleKey: policy }' };
  const plans = new Set((await listPlans({ activeOnly: true })).map((p) => p.code));
  const current = await getModulePolicies();
  const next: Record<string, ModulePolicy> = { ...current };
  const known = new Set(MODULES.map((m) => m.key as string));
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!known.has(key)) return { ok: false, error: `Unknown module: ${key}` };
    const p = raw as Partial<ModulePolicy> | null;
    if (!p || !['ALWAYS_ON', 'PER_TENANT', 'TIER'].includes(String(p.availability))) {
      return { ok: false, error: `${key}: availability must be ALWAYS_ON, PER_TENANT or TIER` };
    }
    if (p.availability === 'TIER') {
      if (typeof p.minPlan !== 'string' || !plans.has(p.minPlan)) {
        return { ok: false, error: `${key}: choose an active plan for a tier-gated module` };
      }
      next[key] = { availability: 'TIER', minPlan: p.minPlan };
    } else {
      next[key] = { availability: p.availability as ModulePolicy['availability'] };
    }
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO platform_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    KEY, JSON.stringify(next),
  );
  cache = null;
  return { ok: true, policies: await getModulePolicies() };
}

/** Effective modules for a tenant from its stored switches and plan (see effectiveTenantModules). */
export async function tenantModulesFor(stored: readonly string[], plan: string | null | undefined): Promise<string[]> {
  const [policies, rank] = await Promise.all([getModulePolicies(), getPlanRank()]);
  return effectiveTenantModules(stored, plan, policies, rank);
}
