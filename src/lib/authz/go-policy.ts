/**
 * The authorization policy as data for the Go backend.
 *
 * backend/authz/policy.json is generated from this (the matrix, the admin
 * route levels, the permission catalogue and its version, module aliases,
 * trial rules), and backend/authz/testdata/vectors.json from decide():
 * requests with the decision Next.js makes for each. The Go backend embeds
 * the policy and its tests require the same decision for every vector, so
 * both sides enforce one policy. tests/unit/authz-go-policy.test.ts fails
 * when either file is out of date (regenerate with UPDATE_AUTHZ_GO_POLICY=1).
 */
import { ALL_PERMISSIONS } from '@/lib/permissions';
import { LEGACY_MODULE_ALIASES } from '@/lib/modules';
import { TRIAL_FREE_MODULES } from '@/lib/access-control';
import { ADMIN_ROUTE_POLICY, SUPER_ADMIN, TENANT_ADMIN } from '@/lib/admin-access';
import { CATALOGUE_VERSION } from '@/lib/authz/permission-claim';
import { AREAS, POLICY_VERSION, type Rule } from '@/lib/authz/policy-matrix';
import { GO_STEP_UP_ROUTES, STEP_UP_ROUTES } from '@/lib/auth/step-up-policy';

export interface GoPolicyDocument {
  policyVersion: string;
  catalogueVersion: string;
  /** module:action:resource, in claim bit order. */
  catalogue: string[];
  /** Canonical module → legacy module keys also honoured. */
  moduleAliases: Record<string, string[]>;
  trialFreeModules: string[];
  superAdminRole: string;
  tenantAdminRole: string;
  /** Path prefix under /api → rule for reads and for writes. */
  areas: Array<{ prefix: string; read: Rule; write: Rule }>;
  /** /api/admin/ templates in match order → level per method (unlisted: platform). */
  adminRoutes: Array<{ template: string; methods: Record<string, string> }>;
  /** /api/admin/ templates → methods needing a passkey step-up (Next.js and Go-only). */
  stepUpRoutes: Array<{ template: string; methods: string[] }>;
}

export function goPolicyDocument(): GoPolicyDocument {
  const aliases: Record<string, string[]> = {};
  for (const [alias, canonical] of Object.entries(LEGACY_MODULE_ALIASES)) {
    (aliases[canonical] ??= []).push(alias);
  }
  return {
    policyVersion: POLICY_VERSION,
    catalogueVersion: CATALOGUE_VERSION,
    catalogue: ALL_PERMISSIONS.map((p) => `${p.module}:${p.action}:${p.resource}`),
    moduleAliases: aliases,
    trialFreeModules: [...TRIAL_FREE_MODULES],
    superAdminRole: SUPER_ADMIN,
    tenantAdminRole: TENANT_ADMIN,
    areas: Object.entries(AREAS)
      .map(([prefix, r]) => ('kind' in r ? { prefix, read: r, write: r } : { prefix, read: r.read, write: r.write }))
      .sort((a, b) => a.prefix.localeCompare(b.prefix)),
    adminRoutes: Object.entries(ADMIN_ROUTE_POLICY).map(([template, methods]) => ({
      template,
      methods: methods as Record<string, string>,
    })),
    stepUpRoutes: Object.entries({ ...STEP_UP_ROUTES, ...GO_STEP_UP_ROUTES })
      .map(([template, methods]) => ({ template, methods: [...methods] }))
      .sort((a, b) => a.template.localeCompare(b.template)),
  };
}
