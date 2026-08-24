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
