/**
 * Request-local RLS scope marker.
 *
 * PostgreSQL's app.tenant_id setting is connection-local, so callers that
 * already opened a tenant-scoped transaction must mark that scope before they
 * issue Prisma operations. The Prisma client uses this marker to avoid opening
 * a nested transaction and, more importantly, to prevent a request's tenant
 * context from leaking into concurrent work.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RlsScope {
  tenantId: string;
  mode: 'tenant' | 'platform';
}

const storage = new AsyncLocalStorage<RlsScope>();

export function activeRlsScope(): RlsScope | undefined {
  return storage.getStore();
}

export function runWithRlsScope<T>(scope: RlsScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}
