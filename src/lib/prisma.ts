import { PrismaClient, Prisma } from '@prisma/client';

function isNeonDatabaseUrl(url?: string | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('.neon.tech') || parsed.searchParams.get('options')?.includes('endpoint=') === true;
  } catch {
    return false;
  }
}

export function getDatabaseTarget() {
  try {
    const parsed = new URL(process.env.DATABASE_URL ?? '');
    return {
      host: parsed.hostname,
      database: parsed.pathname.replace(/^\//, ''),
      neon: isNeonDatabaseUrl(parsed.toString()),
    };
  } catch {
    return { host: 'invalid', database: '', neon: false };
  }
}

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

// ── Circuit breaker for local DB mirror ──────────────────────────────────────
// After LOCAL_FAIL_THRESHOLD consecutive failures, stop attempting for
// LOCAL_COOLDOWN_MS milliseconds.  Prevents a dead local DB from filling the
// event loop with hundreds of rejected promises.
const LOCAL_FAIL_THRESHOLD = 3;
const LOCAL_COOLDOWN_MS    = 60_000; // 1 minute

let localFailCount   = 0;
let localCircuitOpen = false;  // true = stop trying
let localCooldownEnd = 0;

function recordLocalSuccess() {
  localFailCount   = 0;
  localCircuitOpen = false;
}

function recordLocalFailure() {
  localFailCount++;
  if (localFailCount >= LOCAL_FAIL_THRESHOLD) {
    localCircuitOpen = true;
    localCooldownEnd = Date.now() + LOCAL_COOLDOWN_MS;
    console.warn('[Local Sync] Circuit open — pausing local DB mirror for 60 s');
  }
}

function isLocalCircuitOpen(): boolean {
  if (!localCircuitOpen) return false;
  if (Date.now() > localCooldownEnd) {
    // Half-open: allow one probe attempt
    localCircuitOpen = false;
    localFailCount   = 0;
    return false;
  }
  return true;
}

// ── Cached local Prisma import (resolved once, reused forever) ───────────────
// Using a module-level promise avoids the repeated `await import()` overhead
// on every write and prevents duplicate PrismaClient instances on hot-reload.
let _localPrismaPromise: Promise<import('@/lib/prisma-local').LocalPrismaType> | null = null;

function getLocalPrismaPromise() {
  if (process.env.FLEET360_ENABLE_LOCAL_MIRROR !== 'true') return null;
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

// ── Primary Prisma client (Neon) ──────────────────────────────────────────────
const prismaClientSingleton = () => {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn'] : ['error'],
  });

  // Dual-write middleware — mirrors every write to local DB automatically.
  // Fire-and-forget: local DB errors NEVER block the primary (Neon) response.
  client.$use(async (params, next) => {
    // Execute the operation on Neon first — always awaited
    const result = await next(params);

    // Mirror write operations to local DB in the background
    if (params.model && WRITE_ACTIONS.includes(params.action as Prisma.PrismaAction)) {
      mirrorToLocal(params).catch(() => { /* already handled inside */ });
    }

    return result;
  });

  return client;
};

// ── Local mirror writer ───────────────────────────────────────────────────────
async function mirrorToLocal(params: Prisma.MiddlewareParams) {
  // Skip if circuit is open (local DB has been failing repeatedly)
  if (isLocalCircuitOpen()) return;

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
    recordLocalSuccess();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Local Sync] ${params.model}.${params.action} failed:`, msg);
    recordLocalFailure();
  }
}

// ── Singleton pattern (prevents hot-reload from creating multiple clients) ───
type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientSingleton | undefined;
};

export const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
