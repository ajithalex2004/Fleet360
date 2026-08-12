import { PrismaClient, Prisma } from '@prisma/client';
import { headers } from 'next/headers';
import { MirrorCircuitBreaker } from '@/lib/mirror-circuit-breaker';
import { activeRlsScope, runWithRlsScope } from '@/lib/rls-scope';

// Fix BigInt serialization for JSON responses
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

// ── Write operations that should be mirrored to local DB ─────────────────────
const WRITE_ACTIONS: Prisma.PrismaAction[] = [
  'create', 'createMany', 'createManyAndReturn',
  'update', 'updateMany',
  'upsert',
  'delete', 'deleteMany',
];

const DB_CONNECT_TIMEOUT_MS = Number(process.env.DB_CONNECT_TIMEOUT_MS ?? 3_000);
const DB_CONNECT_RETRIES = Number(process.env.DB_CONNECT_RETRIES ?? 1);
const DB_OPERATION_RETRIES = Number(process.env.DB_OPERATION_RETRIES ?? 1);
const DB_KEEPALIVE_INTERVAL_MS = Number(process.env.DB_KEEPALIVE_INTERVAL_MS ?? 0);
const DB_CONNECT_RETRY_BASE_DELAY_MS = Number(process.env.DB_CONNECT_RETRY_BASE_DELAY_MS ?? 500);

let primaryConnected = false;
let primaryConnectPromise: Promise<void> | null = null;
let keepAliveStarted = false;

export class DbConnectionError extends Error {
  readonly cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'DbConnectionError';
    this.cause = options?.cause;
  }
}

// ── Circuit breaker for local DB mirror ──────────────────────────────────────
// After 3 consecutive failures, stop attempting for 60 seconds. Prevents
// a dead local DB from filling the event loop with hundreds of rejected
// promises. See src/lib/mirror-circuit-breaker.ts for the design rationale.
const mirrorBreaker = new MirrorCircuitBreaker({
  threshold: 3,
  cooldownMs: 60_000,
  onOpen: () => {
    console.warn('[Local Sync] Circuit open — pausing local DB mirror for 60 s');
  },
});

// ── Cached local Prisma import (resolved once, reused forever) ───────────────
// Using a module-level promise avoids the repeated `await import()` overhead
// on every write and prevents duplicate PrismaClient instances on hot-reload.
let _localPrismaPromise: Promise<import('@/lib/prisma-local').LocalPrismaType> | null = null;

function getLocalPrismaPromise() {
  if (!process.env.LOCAL_DATABASE_URL) return null;
  if (!_localPrismaPromise) {
    _localPrismaPromise = import('@/lib/prisma-local')
      .then(m => m.localPrisma)
      .catch(err => {
        console.error('[Local Sync] Failed to import prisma-local:', err?.message);
        _localPrismaPromise = null; // allow retry on next write
        return null;
      }) as Promise<import('@/lib/prisma-local').LocalPrismaType>;
  }
  return _localPrismaPromise;
}

export async function ensureDbConnected(options: {
  timeoutMs?: number;
  retries?: number;
  force?: boolean;
} = {}): Promise<void> {
  if (primaryConnected && !options.force) return;
  if (primaryConnectPromise) return primaryConnectPromise;

  const timeoutMs = options.timeoutMs ?? DB_CONNECT_TIMEOUT_MS;
  const retries = options.retries ?? DB_CONNECT_RETRIES;

  primaryConnectPromise = connectWithRetry(prisma, timeoutMs, retries)
    .then(() => {
      primaryConnected = true;
    })
    .catch((err) => {
      primaryConnected = false;
      throw new DbConnectionError('Database connection unavailable', { cause: err });
    })
    .finally(() => {
      primaryConnectPromise = null;
    });

  return primaryConnectPromise;
}

function isPrimaryConnectionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if (err instanceof DbConnectionError) return true;
  const code = 'code' in err ? String((err as { code?: unknown }).code ?? '') : '';
  const message = err instanceof Error ? err.message : String(err);
  const cause = 'cause' in err ? (err as { cause?: unknown }).cause : undefined;
  return (
    ['P1000', 'P1001', 'P1002', 'P1017'].includes(code) ||
    message.includes("Can't reach database server") ||
    message.includes('Server has closed the connection') ||
    message.includes('Connection terminated') ||
    message.includes('connection timed out') ||
    message.includes('Database connect timed out') ||
    // Prisma's Rust engine emits socket-level errors from the pg driver with a
    // `kind: <Variant>` marker (e.g. "Error { kind: Closed, cause: None }"
    // when Neon idle-closes the connection). None of those match the
    // human-readable strings above, so they slipped past the retry loop and
    // surfaced as raw 500s. Match the tokens we know are recoverable —
    // socket closed / read-write failures / connection aborted / timeout.
    /\bkind:\s*(Closed|TimedOut|ConnectionAborted|ConnectionReset|BrokenPipe|Io)\b/.test(message) ||
    // Some driver messages just say "connection closed" without the kind: prefix.
    /\b[Cc]onnection.*(closed|reset|aborted)\b/.test(message) ||
    (cause !== err && isPrimaryConnectionError(cause))
  );
}

export function isDbConnectionError(err: unknown): boolean {
  return err instanceof DbConnectionError || isPrimaryConnectionError(err);
}

export function startDbKeepAlive(): void {
  if (keepAliveStarted || DB_KEEPALIVE_INTERVAL_MS <= 0) return;
  keepAliveStarted = true;

  const tick = async () => {
    try {
      // Real round-trip ping. Prisma's $connect() is idempotent — calling it
      // while the client thinks it's connected returns immediately without
      // touching the network, so the previous ensureDbConnected() tick never
      // actually detected a Neon idle-close. SELECT 1 goes through
      // withPrimaryConnectionRetry (see below), so a dropped connection is
      // caught by the retry loop and the pool is refreshed BEFORE the next
      // user request touches Prisma.
      await prisma.$queryRawUnsafe('SELECT 1');
    } catch (err) {
      primaryConnected = false;
      console.warn('[DB KeepAlive] Neon ping failed:', err instanceof Error ? err.message : String(err));
    }
  };

  const interval = setInterval(() => {
    void tick();
  }, DB_KEEPALIVE_INTERVAL_MS);
  interval.unref?.();
  void tick();
}

async function connectWithRetry(client: PrismaClient, timeoutMs: number, retries: number): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await connectWithTimeout(client, timeoutMs);
      return;
    } catch (err) {
      lastError = err;
      primaryConnected = false;
      if (attempt < retries) {
        // Reset Prisma's engine between Neon cold-start / pooler blips so the
        // next attempt is a fresh socket instead of reusing a bad state.
        await client.$disconnect().catch(() => undefined);
        await wait(DB_CONNECT_RETRY_BASE_DELAY_MS * (attempt + 1));
      }
    }
  }
  throw lastError;
}

async function connectWithTimeout(client: PrismaClient, timeoutMs: number): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.$connect(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Database connect timed out after ${timeoutMs} ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isValidTenantId(value: string | null): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value);
}

/**
 * Resolve only middleware-injected request context. This intentionally does
 * not accept query/body tenant IDs and returns null for jobs, migrations and
 * other non-request code, which must use the explicit RLS helpers instead.
 */
async function requestTenantId(): Promise<string | null> {
  try {
    const requestHeaders = await headers();
    const tenantId = requestHeaders.get('x-tenant-id');
    return isValidTenantId(tenantId) ? tenantId : null;
  } catch {
    return null;
  }
}

async function withPrimaryConnectionRetry<T>(run: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= DB_OPERATION_RETRIES; attempt++) {
    try {
      await ensureDbConnected({
        force: attempt > 0,
        retries: attempt > 0 ? Math.max(1, DB_CONNECT_RETRIES) : DB_CONNECT_RETRIES,
        timeoutMs: DB_CONNECT_TIMEOUT_MS,
      });
      return await run();
    } catch (err) {
      lastError = err;
      if (!isPrimaryConnectionError(err) || attempt >= DB_OPERATION_RETRIES) break;
      primaryConnected = false;
      await wait(250 * (attempt + 1));
    }
  }

  if (isPrimaryConnectionError(lastError)) {
    throw new DbConnectionError('Database connection unavailable', { cause: lastError });
  }
  throw lastError;
}

// ── Primary Prisma client (Neon) ──────────────────────────────────────────────
const prismaClientSingleton = () => {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

  const originalTransaction = client.$transaction.bind(client);

  /**
   * Every ORM/raw query originating from an authenticated operator request is
   * run in a transaction that sets app.tenant_id with SET LOCAL semantics.
   * Explicit withTenantRls/withPlatformAdmin calls install an AsyncLocalStorage
   * marker and bypass this wrapper, retaining their one-transaction atomicity.
   */
  async function withRequestRls<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const active = activeRlsScope();
    if (active) {
      // A caller already owns a transaction whose app.tenant_id was set by
      // rls.ts. Transaction clients use the same pinned connection.
      return operation(client as unknown as Prisma.TransactionClient);
    }

    const tenantId = await requestTenantId();
    if (!tenantId) {
      // Background jobs and migrations have no request storage. They must use
      // withTenantRls/withSystemJob/withPlatformAdmin explicitly.
      return operation(client as unknown as Prisma.TransactionClient);
    }

    return originalTransaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
      return runWithRlsScope({ tenantId, mode: 'tenant' }, () => operation(tx));
    }, { timeout: 30_000, maxWait: 5_000 });
  }

  // Dual-write middleware — mirrors every write to local DB automatically.
  // Fire-and-forget: local DB errors NEVER block the primary (Neon) response.
  client.$use(async (params, next) => {
    // Prisma model delegates are normally not transaction-bound. For an
    // authenticated request, pin each operation to a tenant-scoped
    // transaction. The inner call reaches this middleware again, sees the
    // scope marker, and executes `next` on the pinned transaction client.
    if (params.model && !activeRlsScope()) {
      const tenantId = await requestTenantId();
      if (tenantId) {
        return withRequestRls(async (tx) => {
          const delegate = (tx as unknown as Record<string, Record<string, (args: unknown) => Promise<unknown>>>)[params.model!];
          return delegate[params.action](params.args);
        });
      }
    }

    // Execute on Neon first. Connection errors are retried; validation and
    // constraint errors still fail immediately and honestly.
    const result = await withPrimaryConnectionRetry(() => next(params));

    // Mirror write operations to local DB in the background
    if (params.model && WRITE_ACTIONS.includes(params.action as Prisma.PrismaAction)) {
      mirrorToLocal(params).catch(() => { /* already handled inside */ });
    }

    return result;
  });

  // ── Raw-query / transaction connection retry ─────────────────────────────────
  // The $use middleware above force-reconnects + retries once on a dropped
  // connection, but Prisma only routes ORM *model* operations through $use — it
  // does NOT see $queryRaw*/$executeRaw*/$transaction. Every logistics write path
  // is raw SQL, so Neon's "kind: Closed" idle-connection drops slipped straight
  // through and surfaced as request failures. Give the raw + transaction methods
  // the SAME single force-reconnect retry. A dropped connection means the
  // statement never executed (or the transaction rolled back), so replaying it is
  // safe; only genuine connection errors are retried — constraint/SQL/validation
  // errors rethrow immediately. If it still fails as a connection error, throw a
  // clear DbConnectionError instead of a raw driver string.
  for (const method of ['$queryRawUnsafe', '$executeRawUnsafe', '$queryRaw', '$executeRaw', '$transaction'] as const) {
    const original = (client[method] as (...args: unknown[]) => Promise<unknown>).bind(client);
    (client as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[method] =
      (...args: unknown[]) => withPrimaryConnectionRetry(async () => {
        if (method === '$transaction') {
          const callback = args[0];
          if (typeof callback !== 'function' || activeRlsScope()) return original(...args);
          const tenantId = await requestTenantId();
          if (!tenantId) return original(...args);
          const options = args[1] as { timeout?: number; maxWait?: number } | undefined;
          return originalTransaction(async (tx) => {
            await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
            return runWithRlsScope({ tenantId, mode: 'tenant' }, () =>
              (callback as (transaction: Prisma.TransactionClient) => Promise<unknown>)(tx),
            );
          }, options);
        }

        if (activeRlsScope()) return original(...args);
        const tenantId = await requestTenantId();
        if (!tenantId) return original(...args);

        return originalTransaction(async (tx) => {
          await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
          return runWithRlsScope({ tenantId, mode: 'tenant' }, () => {
            const txMethod = tx[method] as unknown as (...innerArgs: unknown[]) => Promise<unknown>;
            return txMethod(...args);
          });
        }, { timeout: 30_000, maxWait: 5_000 });
      });
  }

  return client;
};

// ── Local mirror writer ───────────────────────────────────────────────────────
async function mirrorToLocal(params: Prisma.MiddlewareParams) {
  // Skip if circuit is open (local DB has been failing repeatedly)
  if (mirrorBreaker.isOpen()) return;

  const promise = getLocalPrismaPromise();
  if (!promise) return; // LOCAL_DATABASE_URL not set

  const localPrisma = await promise;
  if (!localPrisma) return;

  const model    = params.model as keyof typeof localPrisma;
  const delegate = localPrisma[model] as unknown as Record<string, (args: unknown) => Promise<unknown>>;
  if (!delegate || typeof delegate[params.action] !== 'function') return;

  // Race against a 5-second timeout — local DB must respond promptly
  const writePromise = delegate[params.action](params.args) as Promise<unknown>;
  const timeout      = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Local DB write timed out after 5 s')), 5_000)
  );

  try {
    await Promise.race([writePromise, timeout]);
    mirrorBreaker.recordSuccess();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Local Sync] ${params.model}.${params.action} failed:`, msg);
    mirrorBreaker.recordFailure();
  }
}

// ── Singleton pattern (prevents hot-reload from creating multiple clients) ───
type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientSingleton | undefined;
};

export const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
