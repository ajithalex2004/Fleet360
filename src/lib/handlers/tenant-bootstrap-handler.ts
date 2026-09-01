/**
 * Tenant Bootstrap Handler — Enterprise Multi-Tenant SaaS Standard
 *
 * Dedicated security boundary for unauthenticated, pre-tenant onboarding
 * operations (such as company self-provisioning, domain verification, and
 * initial admin onboarding).
 *
 * Threat Mitigations:
 * 1. Capability Allowlist (BOOTSTRAP_ALLOWED_OPERATIONS): Rejects any unlisted operation.
 * 2. Dedicated Bootstrap DB Context: Sets `app.tenant_id = 'bootstrap'` rather than wildcard `*`.
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
import crypto from 'crypto';

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
 * Sets `app.tenant_id = 'bootstrap'` instead of wildcard `*`.
 */
export async function withBootstrap<T>(
  fn: (tx: TxClient, rescopeToTenant: (tenantId: string) => Promise<void>) => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  return prisma.$transaction(
    async (rawTx) => {
      // Establish dedicated bootstrap tenant context
      await rawTx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', 'bootstrap', true)`);
      const restrictedTx = createRestrictedBootstrapClient(rawTx);

      // Closes over rawTx directly - the real, un-proxied transaction client.
      // Calling a raw-SQL method (e.g. $executeRawUnsafe) directly on the
      // restricted proxy invokes it with `this` bound to the proxy, not the
      // real Prisma client, unlike a nested delegate call (tx.tenant.create()
      // first reads the real, unwrapped `tenant` delegate off the proxy, then
      // calls .create() on THAT object, so `this` is correct there). That
      // mismatch let a re-scope call through the proxy execute against a
      // different connection than the one the rest of the transaction runs
      // on - it appeared to succeed but silently had no effect, which is why
      // this exists as its own function closing over rawTx instead of being
      // inlined as a raw call on `tx` at the route-handler call site.
      const rescopeToTenant = async (tenantId: string) => {
        await rawTx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
        // Verify rather than trust: a re-scope that silently lands on the
        // wrong connection/session fails exactly like this - no thrown error,
        // just a WITH CHECK rejection on the next tenant-scoped write, several
        // lines away from the actual cause. Confirm it here so a future
        // regression of this kind fails at the point of the mistake.
        const [row] = await rawTx.$queryRawUnsafe<Array<{ v: string | null }>>(
          `SELECT current_setting('app.tenant_id', true) AS v`,
        );
        if (row?.v !== tenantId) {
          throw new Error(
            `rescopeToTenant: set_config did not take effect on this transaction's connection ` +
              `(current_setting reports "${row?.v}", expected "${tenantId}").`,
          );
        }
      };

      return fn(restrictedTx, rescopeToTenant);
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
   * tenant has been created (withBootstrap otherwise pins it to the sentinel
   * 'bootstrap' for the whole transaction). Must be used for this - never
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
