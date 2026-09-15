/**
 * Request-local RLS scope marker.
 *
 * PostgreSQL's app.tenant_id setting is connection-local, so callers that
 * already opened a tenant-scoped transaction must mark that scope before they
 * issue Prisma operations. The Prisma client uses this marker to avoid opening
 * a nested transaction and, more importantly, to prevent a request's tenant
 * context from leaking into concurrent work.
 */
import 'server-only';
import { AsyncLocalStorage } from 'async_hooks';
import type { Prisma } from '@prisma/client';

export interface RlsScope {
  tenantId: string;
  mode: 'tenant' | 'platform';
  // The interactive tx client owning this scope. Nested $transaction /
  // $queryRaw / $executeRaw calls made through the client-level monkey-patch
  // must reuse THIS tx — starting a new one competes for a fresh pool slot,
  // deadlocks the current tx, and (when app.tenant_id is set with SET LOCAL)
  // cannot see the tenant scope, so RLS filters everything out.
  tx?: Prisma.TransactionClient;
}

const storage = new AsyncLocalStorage<RlsScope>();

export function activeRlsScope(): RlsScope | undefined {
  return storage.getStore();
}

export function runWithRlsScope<T>(scope: RlsScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

/**
 * Run `fn` with no active RLS scope, even when called from inside one.
 *
 * For fire-and-forget work (audit logging, best-effort side writes) that
 * must never inherit the caller's transaction: `activeRlsScope()` still
 * returns the caller's scope for any code that starts executing
 * synchronously before the caller's own transaction callback returns —
 * AsyncLocalStorage propagates a request's context into everything spawned
 * during it, whether or not the caller awaits it. An unawaited call issued
 * that way picks up `scope.tx`, a transaction client whose underlying
 * transaction can commit before the unawaited write's own statement
 * reaches the connection — "Transaction already closed" (P2028), racy
 * because it depends on how much work the caller does after the
 * fire-and-forget call before returning.
 *
 * `AsyncLocalStorage.exit()` is Node's built-in escape hatch for exactly
 * this: run `fn` as if no `storage.run()` were ever entered, regardless of
 * nesting depth. Anything `fn` does — including opening its own transaction
 * via withTenantRls/withPlatformAdmin — gets a connection whose lifetime is
 * entirely its own.
 */
export function runOutsideRlsScope<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    storage.exit(() => {
      fn().then(resolve, reject);
    });
  });
}
