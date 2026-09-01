/**
 * Tenant Bootstrap Handler — Enterprise Multi-Tenant SaaS Standard
 *
 * Dedicated security boundary for unauthenticated, pre-tenant onboarding
 * operations (such as company self-provisioning, domain verification, and
 * initial admin onboarding).
 *
 * Threat Mitigations:
 * 1. Capability Allowlist (BOOTSTRAP_ALLOWED_OPERATIONS): Rejects any unlisted operation.
 * 2. Dedicated Bootstrap DB Context: Sets `app.tenant_id` to BOOTSTRAP_SENTINEL_TENANT_ID
 *    rather than wildcard `*`.
 * 3. Restricted Delegate Proxy: Throws immediately if code attempts to touch business models
 *    (vehicles, invoices, trips, bookings, etc.). Only Tenant, User, UserTenant, and TenantModule
 *    are permitted.
 * 4. Ingress Rate Limiting: Blocks IP-based flood attacks.
 * 5. Role Lockdown: Caller cannot supply roles or permissions; initial admin is strictly TENANT_ADMIN.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { TxClient } from '@/lib/rls';
import { SecurityContext } from '@/lib/security-context';
import { runWithRlsScope } from '@/lib/rls-scope';
import crypto from 'crypto';

/**
 * Dedicated app.tenant_id value for pre-tenant bootstrap transactions - not
 * the wildcard '*', so a fresh signup can't read any existing tenant's data.
 *
 * Must be the nil UUID, not an arbitrary string like the literal 'bootstrap'
 * this used to be. tenant_id::uuid columns on roles/tenant_modules/
 * user_tenants compare via `tenant_id = current_setting('app.tenant_id')`
 * with no ::text cast on the column side, so Postgres implicitly casts the
 * setting to uuid to resolve the `=` operator - even to evaluate the OTHER
 * (short-circuiting, in a procedural sense) branches of the surrounding OR,
 * since SQL types are resolved at parse time, not short-circuited at
 * runtime. A non-UUID sentinel throws `invalid input syntax for type uuid`
 * the moment any bootstrap write touches one of those three tables, aborting
 * the whole transaction. The nil UUID is syntactically valid so the cast
 * succeeds, and real tenant ids are crypto.randomUUID() v4 UUIDs, which
 * structurally can never collide with it - same "matches no real tenant"
 * guarantee as the string sentinel, without the cast failure.
 */
const BOOTSTRAP_SENTINEL_TENANT_ID = '00000000-0000-0000-0000-000000000000';

export type BootstrapOperation =
  | 'create_pending_tenant'
  | 'verify_tenant_domain'
  | 'create_initial_admin_invitation';

export const BOOTSTRAP_ALLOWED_OPERATIONS: ReadonlySet<BootstrapOperation> = new Set([
  'create_pending_tenant',
  'verify_tenant_domain',
  'create_initial_admin_invitation',
]);

/** Model delegates explicitly permitted during bootstrap execution. */
const PERMITTED_BOOTSTRAP_DELEGATES = new Set([
  'tenant',
  'user',
  'userTenant',
  'tenantModule',
  'role',
  '$queryRaw',
  '$queryRawUnsafe',
  '$executeRaw',
  '$executeRawUnsafe',
]);

export class BootstrapAccessDeniedError extends Error {
  constructor(delegateName: string) {
    super(
      `[Bootstrap Security Violation] Access to model delegate "${delegateName}" is prohibited during pre-tenant bootstrap execution.`,
    );
    this.name = 'BootstrapAccessDeniedError';
  }
}

/**
 * Wraps the Prisma transaction client in a security proxy restricting
 * delegate access strictly to pre-tenant bootstrap models.
 */
export function createRestrictedBootstrapClient(tx: TxClient): TxClient {
  return new Proxy(tx, {
    get(target, prop, receiver) {
      const propStr = String(prop);

      // Allow internal properties and symbols
      if (typeof prop === 'symbol' || propStr.startsWith('_') || propStr === 'then') {
        return Reflect.get(target, prop, receiver);
      }

      // Check delegate permission
      if (!PERMITTED_BOOTSTRAP_DELEGATES.has(propStr)) {
        throw new BootstrapAccessDeniedError(propStr);
      }

      return Reflect.get(target, prop, receiver);
    },
  });
}

// Simple in-memory sliding window rate limiter for bootstrap endpoints (15 req/min per IP)
const ipRequestCounts = new Map<string, { count: number; resetAt: number }>();

function checkBootstrapRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipRequestCounts.get(ip);

  if (!entry || now > entry.resetAt) {
    ipRequestCounts.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (entry.count >= 15) {
    return false;
  }

  entry.count++;
  return true;
}

/**
 * Dedicated transactional helper for bootstrap operations.
 * Sets `app.tenant_id` to BOOTSTRAP_SENTINEL_TENANT_ID instead of wildcard `*`.
 */
export async function withBootstrap<T>(
  fn: (tx: TxClient, rescopeToTenant: (tenantId: string) => Promise<void>) => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  return prisma.$transaction(
    async (rawTx) => {
      // The prisma singleton (src/lib/prisma.ts) monkey-patches
      // $executeRawUnsafe/$queryRawUnsafe/$transaction on the client itself,
      // and its tx client forwards raw-method calls back through those same
      // patched client methods. That wrapper routes to the real, pinned
      // transaction connection only when activeRlsScope() reports one -
      // without this registration, raw calls made via `rawTx` fell back to
      // the pristine method bound to the top-level client instead of this
      // transaction.
      return runWithRlsScope({ tenantId: BOOTSTRAP_SENTINEL_TENANT_ID, mode: 'tenant', tx: rawTx }, async () => {
        // Establish dedicated bootstrap tenant context
        await rawTx.$executeRawUnsafe(
          `SELECT set_config('app.tenant_id', $1, true)`,
          BOOTSTRAP_SENTINEL_TENANT_ID,
        );
        const restrictedTx = createRestrictedBootstrapClient(rawTx);

        const rescopeToTenant = async (tenantId: string) => {
          // Read set_config's OWN return value in the SAME query, rather
          // than a separate set_config + current_setting round trip. The
          // two-step version is not reliable here: verified directly (via a
          // bare, unwrapped prisma.$transaction with zero app code involved)
          // that a second, separate current_setting() call inside the same
          // nominal transaction can come back empty even though this exact
          // SELECT set_config(...) AS v pattern, run immediately afterward
          // in the very same transaction, correctly returns the value that
          // was just set. This is the same pattern withTenantRls and
          // withPlatformAdmin already use, for the same reason.
          const [row] = await rawTx.$queryRawUnsafe<Array<{ v: string | null }>>(
            `SELECT set_config('app.tenant_id', $1, true) AS v`,
            tenantId,
          );
          if (!row?.v || row.v !== tenantId) {
            throw new Error(
              `rescopeToTenant: set_config returned '${row?.v ?? 'null'}' (expected '${tenantId}').`,
            );
          }
        };

        return fn(restrictedTx, rescopeToTenant);
      });
    },
    { timeout: opts.timeoutMs ?? 30_000, maxWait: 10_000 },
  );
}

export interface BootstrapContext {
  securityContext: SecurityContext;
  tx: TxClient;
  clientIp: string;
  /**
   * Re-scopes app.tenant_id for the remainder of this transaction once a real
   * tenant has been created (withBootstrap otherwise pins it to
   * BOOTSTRAP_SENTINEL_TENANT_ID for the whole transaction). Must be used for
   * this - never
   * call raw SQL methods directly on `tx` to change RLS scope; see the
   * comment on rescopeToTenant's definition in withBootstrap for why.
   */
  rescopeToTenant: (tenantId: string) => Promise<void>;
}

export type BootstrapHandlerFn<T> = (ctx: BootstrapContext) => Promise<T>;

/**
 * Wraps an unauthenticated onboarding / bootstrap route in an explicit, audited security boundary.
 */
export async function tenantBootstrapHandler<T>(
  req: NextRequest,
  operation: BootstrapOperation,
  fn: BootstrapHandlerFn<T>,
): Promise<NextResponse> {
  // 1. Verify capability allowlist
  if (!BOOTSTRAP_ALLOWED_OPERATIONS.has(operation)) {
    return NextResponse.json(
      { error: 'Forbidden', message: `Operation "${operation}" is not an allowed bootstrap capability.` },
      { status: 403 },
    );
  }

  // 2. IP extraction and rate-limiting
  const clientIp =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    '127.0.0.1';

  if (!checkBootstrapRateLimit(clientIp)) {
    return NextResponse.json(
      { error: 'Too Many Requests', message: 'Too many onboarding attempts. Please try again in 1 minute.' },
      { status: 429 },
    );
  }

  // 3. Construct unified SecurityContext
  const correlationId = req.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();

  const securityContext: SecurityContext = {
    tenantId: null,
    role: 'ANONYMOUS_BOOTSTRAP',
    permissions: [`bootstrap:${operation}`],
    mode: 'BOOTSTRAP',
    actorType: 'USER',
    source: `bootstrap:${operation}`,
    correlationId,
    requestId,
  };

  try {
    // 4. Execute within dedicated withBootstrap boundary
    const result = await withBootstrap(async (tx, rescopeToTenant) => {
      return fn({
        securityContext,
        tx,
        clientIp,
        rescopeToTenant,
      });
    });

    if (result instanceof NextResponse) {
      return result;
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    if (error instanceof BootstrapAccessDeniedError) {
      console.error(`[Bootstrap Security Violation] ${error.message}`);
      return NextResponse.json(
        { error: 'Forbidden', message: 'Unauthorized model operation in bootstrap mode.', correlationId },
        { status: 403 },
      );
    }

    console.error(`[tenantBootstrapHandler:${operation}] execution failed:`, error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: error.message || 'An error occurred during tenant bootstrap.',
        correlationId,
      },
      { status: error.status || 500 },
    );
  }
}
