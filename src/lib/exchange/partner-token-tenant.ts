/**
 * Tenant context for the public partner-driver links (/api/public/partner-driver/[token]).
 *
 * These routes have no session: the per-trip link token is the credential.
 * The tenant is the tenant of the outsource award the token's assignment
 * belongs to. Resolving it needs one platform-level lookup, because the award
 * table is tenant-isolated by RLS and nothing else about the request names a
 * tenant. The handler then runs in that tenant's context (runWithTenantContext),
 * so its reads and writes are RLS-scoped to the award's tenant.
 *
 * The lookup only maps the token hash to a tenant id; revocation and expiry
 * are still checked by the handlers, which return their own responses for an
 * unknown, revoked or expired link.
 */
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { runWithTenantContext } from '@/lib/rls-scope';
import { hashDriverToken } from '@/lib/exchange/outsource-engine';

export async function tenantForPartnerToken(rawToken: string): Promise<string | null> {
  if (!rawToken || rawToken.length < 16) return null;
  const rows = await withPlatformAdmin(prisma, (tx) =>
    tx.$queryRawUnsafe<Array<{ tenant_id: string }>>(
      `SELECT a.tenant_id::text AS tenant_id
         FROM partner_assignments pa
         JOIN outsource_awards a ON a.id = pa.award_id
        WHERE pa.driver_token_hash = $1
        LIMIT 1`,
      hashDriverToken(rawToken),
    ),
  );
  return rows[0]?.tenant_id ?? null;
}

/** Runs `fn` in the tenant of the token's award; unchanged when the token resolves to nothing. */
export async function withPartnerTokenTenant<T>(rawToken: string | undefined, fn: () => Promise<T>): Promise<T> {
  const tenantId = rawToken ? await tenantForPartnerToken(rawToken) : null;
  return tenantId ? runWithTenantContext(tenantId, fn) : fn();
}
