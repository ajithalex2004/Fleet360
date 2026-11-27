import { PrismaClient, Prisma } from '@prisma/client';
import { MirrorCircuitBreaker } from '@/lib/mirror-circuit-breaker';
import {
  activeRlsScope,
  activeTransactionClient,
  actingTenantId,
  backgroundTenantId,
  runWithActiveTx,
  runWithRlsScope,
} from '@/lib/rls-scope';

// `next/headers` is Server-Component-only. A static top-level import of it
// contaminates every transitive importer — any 'use client' page that
// imports something that imports something that imports prisma fails to
// compile with "You're importing a component that needs next/headers".
// This module is legitimately used from both Server Components and Server
// Actions, and its exported *types* are widely referenced from client
// code (via `@prisma/client` re-exports of the Prisma namespace).
//
// Dynamic-import guarantees the header lookup only runs when a caller
// actually invokes it (inside requestTenantId below). Client-side
// bundles never see the import so webpack never trips its rule.
async function readRequestHeaders(): Promise<Headers | null> {
  try {
    const mod = await import('next/headers');
    return await mod.headers();
  } catch {
    return null;
  }
}

// Fix BigInt serialization for JSON responses
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

// ── Write vs Read-Only ORM operations ────────────────────────────────────────
const WRITE_ACTIONS: Prisma.PrismaAction[] = [
  'create', 'createMany', 'createManyAndReturn',
  'update', 'updateMany',
  'upsert',
  'delete', 'deleteMany',
];

const READ_ONLY_ORM_ACTIONS = new Set<string>([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

export type ConnectionErrorClass =
  | 'none'
  | 'pre_execution'
  | 'admin_terminated'
  | 'mid_flight_transport';

export type ReplaySafety = 'read_only' | 'mutating';

export type ExecutionPhase = 'acquire' | 'executing' | 'committing';

export interface PhaseTracker {
  readonly current: ExecutionPhase;
  markExecuting(): void;
  markCommitting(): void;
}

const MAX_BOUNDED_OPERATION_RETRIES = 3;
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

/**
 * Classify a database error for safe, duplicate-free connection recovery (M1-P1-3):
 *  - 'pre_execution':    connection never established / server unreachable / starting up (57P03, P1000, P1001).
 *  - 'admin_terminated': PostgreSQL FATAL 57P01 / E57P01 (terminating connection due to administrator command)
 *                        or 57P02 crash shutdown (emitted by Neon compute recycles / PgBouncer terminations).
 *  - 'mid_flight_transport': ambiguous socket/timeout drop (P1002, P1017, Closed, ConnectionReset, ECONNRESET,
 *                        ETIMEDOUT, EPIPE, Io) that may have occurred AFTER a write committed on the server.
 *  - 'none':             non-connection error (including P2028 transaction timeout, P2002 constraint, etc.).
 */
export function classifyConnectionError(
  err: unknown,
  seen: Set<unknown> = new Set(),
): ConnectionErrorClass {
  if (!err || typeof err !== 'object' || seen.has(err)) return 'none';
  seen.add(err);

  if (err instanceof DbConnectionError) {
    if (err.cause && err.cause !== err) {
      const inner = classifyConnectionError(err.cause, seen);
      return inner !== 'none' ? inner : 'mid_flight_transport';
    }
    return 'mid_flight_transport';
  }

  const record = err as { code?: unknown; message?: unknown; cause?: unknown; meta?: { code?: unknown; message?: unknown } };
  const code = String(record.code ?? '').trim();
  const metaCode = String(record.meta?.code ?? '').trim();
  // P2028 is a Prisma Transaction API timeout, NOT a connection failure.
  // Retrying amplifies pool contention — always fail fast.
  if (code === 'P2028') return 'none';

  const message = [
    err instanceof Error ? err.message : String(err),
    typeof record.meta?.message === 'string' ? record.meta.message : '',
  ]
    .filter(Boolean)
    .join(' ');
  const upperCode = code.toUpperCase();
  const upperMetaCode = metaCode.toUpperCase();

  // 1. Explicit PostgreSQL administrator/crash termination (Neon compute recycle)
  if (
    ['57P01', 'E57P01', '57P02', 'E57P02'].includes(upperCode) ||
    ['57P01', 'E57P01', '57P02', 'E57P02'].includes(upperMetaCode) ||
    /SqlState\(E?57P0[12]\)/i.test(message) ||
    /\bE?57P0[12]\b/i.test(message) ||
    /terminating connection due to administrator command/i.test(message) ||
    /terminating connection due to crash of another server process/i.test(message) ||
    /the database system is shutting down/i.test(message)
  ) {
    return 'admin_terminated';
  }

  // 2. Pre-execution / server unreachable / starting up
  if (
    ['P1000', 'P1001', '57P03', 'E57P03'].includes(upperCode) ||
    ['57P03', 'E57P03'].includes(upperMetaCode) ||
    message.includes("Can't reach database server") ||
    message.includes('Database connect timed out') ||
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND') ||
    /SqlState\(E?57P03\)/i.test(message) ||
    /the database system is starting up/i.test(message)
  ) {
    return 'pre_execution';
  }

  // 3. Ambiguous mid-flight socket/transport or query timeout drop
  if (
    ['P1002', 'P1017'].includes(upperCode) ||
    message.includes('Server has closed the connection') ||
    message.includes('Connection terminated') ||
    message.includes('connection timed out') ||
    message.includes('ETIMEDOUT') ||
    message.includes('ECONNRESET') ||
    message.includes('EPIPE') ||
    /\bkind:\s*(Closed|TimedOut|ConnectionAborted|ConnectionReset|BrokenPipe|Io)\b/.test(message) ||
    /\b[Cc]onnection.*(closed|reset|aborted)\b/i.test(message)
  ) {
    return 'mid_flight_transport';
  }

  if (record.cause && record.cause !== err) {
    return classifyConnectionError(record.cause, seen);
  }
  return 'none';
}

function isPrimaryConnectionError(err: unknown): boolean {
  return classifyConnectionError(err) !== 'none';
}

export function isDbConnectionError(err: unknown): boolean {
  return err instanceof DbConnectionError || isPrimaryConnectionError(err);
}

export function isReadOnlyOrmAction(action: string): boolean {
  return READ_ONLY_ORM_ACTIONS.has(action);
}

const MUTATING_OR_UNSAFE_SQL_RE =
  /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|LOCK|INTO|ANALYZE|SHARE|NOTIFY|LISTEN|UNLISTEN|SET|RESET|EXECUTE|PREPARE|DEALLOCATE|REFRESH|VACUUM|REINDEX|CLUSTER|CHECKPOINT|DISCARD|NEXTVAL|SETVAL|CURRVAL)\b/i;

const SQL_CLAUSE_KEYWORDS = new Set([
  'SELECT', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'VALUES', 'WITH', 'AS',
  'ON', 'USING', 'OVER', 'PARTITION', 'FILTER', 'CASE', 'WHEN', 'THEN', 'ELSE',
  'CAST', 'EXTRACT', 'SUBSTRING', 'TRIM', 'POSITION', 'OVERLAY', 'TREAT', 'ANY',
  'SOME', 'ALL', 'LATERAL', 'FROM', 'JOIN', 'HAVING', 'GROUP', 'ORDER', 'DISTINCT',
  'ROW', 'ARRAY', 'INTERVAL', 'BETWEEN', 'NULL', 'TRUE', 'FALSE',
]);

const SAFE_READ_ONLY_SQL_FUNCTIONS = new Set([
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NULLIF', 'GREATEST', 'LEAST',
  'LOWER', 'UPPER', 'INITCAP', 'LENGTH', 'CHAR_LENGTH', 'CHARACTER_LENGTH', 'OCTET_LENGTH',
  'LEFT', 'RIGHT', 'LPAD', 'RPAD', 'BTRIM', 'LTRIM', 'RTRIM', 'REPLACE', 'CONCAT', 'CONCAT_WS',
  'SPLIT_PART', 'REGEXP_REPLACE', 'ABS', 'CEIL', 'CEILING', 'FLOOR', 'ROUND', 'TRUNC',
  'MOD', 'POWER', 'SQRT', 'NOW', 'CURRENT_TIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME',
  'CURRENT_DATABASE', 'CURRENT_SCHEMA', 'CURRENT_SETTING', 'CLOCK_TIMESTAMP',
  'STATEMENT_TIMESTAMP', 'DATE_TRUNC', 'DATE_PART', 'AGE', 'TO_CHAR', 'TO_DATE',
  'TO_TIMESTAMP', 'TO_NUMBER', 'JSON_AGG', 'JSONB_AGG', 'JSON_BUILD_OBJECT',
  'JSONB_BUILD_OBJECT', 'JSON_OBJECT_AGG', 'JSONB_OBJECT_AGG', 'JSON_ARRAY_ELEMENTS',
  'JSONB_ARRAY_ELEMENTS', 'JSONB_ARRAY_ELEMENTS_TEXT', 'JSON_EXTRACT_PATH',
  'JSON_EXTRACT_PATH_TEXT', 'JSONB_EXTRACT_PATH', 'JSONB_EXTRACT_PATH_TEXT',
  'ARRAY_AGG', 'ARRAY_LENGTH', 'UNNEST', 'STRING_AGG', 'BOOL_OR', 'BOOL_AND', 'EVERY',
  'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE',
  'NTILE', 'PG_BACKEND_PID', 'VERSION', 'ISFINITE',
]);

/**
 * Strip PostgreSQL comments (including nested block comments) and single-quoted
 * string literals so keyword/semicolon/function checks cannot be bypassed by
 * comment splitting or nested comments, nor confused by string literal contents.
 */
function stripSqlCommentsAndStrings(sql: string): string | null {
  let out = '';
  let i = 0;
  let blockDepth = 0;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (blockDepth > 0) {
      if (ch === '/' && next === '*') {
        blockDepth++;
        i += 2;
      } else if (ch === '*' && next === '/') {
        blockDepth--;
        i += 2;
        if (blockDepth === 0) out += ' ';
      } else {
        i++;
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      blockDepth = 1;
      i += 2;
      continue;
    }

    if (ch === '-' && next === '-') {
      i += 2;
      while (i < sql.length && sql[i] !== '\n') i++;
      out += ' ';
      continue;
    }

    // Fail closed on PostgreSQL C-escape strings (E'...') to prevent backslash-quote desync.
    if ((ch === 'e' || ch === 'E') && next === "'") {
      const prev = i > 0 ? sql[i - 1] : '';
      if (!/[a-zA-Z0-9_$]/.test(prev)) return null;
    }

    if (ch === "'") {
      // Replace single-quoted string literal with a safe placeholder token;
      // fail closed on unclosed quotes.
      i++;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
        } else if (sql[i] === "'") {
          i++;
          closed = true;
          break;
        } else {
          i++;
        }
      }
      if (!closed) return null;
      out += " '' ";
      continue;
    }

    // Dollar-quoted strings ($tag$...$tag$) are uncommon in simple read queries; fail closed.
    if (ch === '$' && (next === '$' || /[a-zA-Z_]/.test(next ?? ''))) {
      const m = /^\$[a-zA-Z_0-9]*\$/.exec(sql.slice(i));
      if (m) return null;
    }

    out += ch;
    i++;
  }

  if (blockDepth !== 0) return null; // unclosed comment -> fail closed
  return out;
}

function isSqlFragmentObject(v: unknown): v is { strings?: unknown; values?: unknown; sql?: unknown } {
  return Boolean(v && typeof v === 'object' && ('strings' in v || 'sql' in v));
}

function collectRawSqlChunks(args: readonly unknown[], out: string[], depth = 0): boolean {
  if (depth > 8 || args.length === 0) return false;
  const first = args[0];

  if (typeof first === 'string') {
    out.push(first);
    return true;
  }

  if (Array.isArray(first) && first.every((s) => typeof s === 'string')) {
    // Interleave template string parts with any interpolated Prisma.Sql /
    // Prisma.raw fragments at their exact position so adjacent tokens stay adjacent.
    for (let i = 0; i < first.length; i++) {
      out.push(first[i]);
      if (i + 1 < args.length) {
        const val = args[i + 1];
        if (isSqlFragmentObject(val)) {
          if (Array.isArray(val.strings) && val.strings.every((s) => typeof s === 'string')) {
            const nestedValues = Array.isArray(val.values) ? val.values : [];
            if (!collectRawSqlChunks([val.strings, ...nestedValues], out, depth + 1)) return false;
          } else if (typeof val.sql === 'string') {
            out.push(val.sql);
          } else {
            return false; // unknown SQL fragment -> fail closed
          }
        } else {
          out.push(' $PARAM ');
        }
      }
    }
    return true;
  }

  if (isSqlFragmentObject(first)) {
    if (Array.isArray(first.strings) && first.strings.every((s) => typeof s === 'string')) {
      const nestedValues = Array.isArray(first.values) ? first.values : [];
      return collectRawSqlChunks([first.strings, ...nestedValues], out, depth + 1);
    }
    if (typeof first.sql === 'string') {
      out.push(first.sql);
      return true;
    }
  }

  return false;
}

/**
 * Conservatively determine whether a raw Prisma SQL call is strictly read-only
 * and safe to replay on a dropped connection. Fails closed on semicolons,
 * mutating/locking keywords, unallowlisted function calls, dollar-quoting, and
 * unknown SQL fragments.
 */
export function isReadOnlyRawSql(method: string, args: readonly unknown[]): boolean {
  if (method === '$executeRaw' || method === '$executeRawUnsafe') return false;

  const chunks: string[] = [];
  if (!collectRawSqlChunks(args, chunks) || chunks.length === 0) return false;

  const combined = chunks.join(' ');
  const sanitized = stripSqlCommentsAndStrings(combined);
  if (!sanitized) return false;

  const trimmed = sanitized.trim();
  if (!trimmed) return false;

  // Reject multi-statement SQL outright
  if (trimmed.includes(';')) return false;

  if (!/^(?:SELECT|SHOW|VALUES|WITH|EXPLAIN)\b/i.test(trimmed)) {
    return false;
  }

  if (MUTATING_OR_UNSAFE_SQL_RE.test(trimmed)) {
    return false;
  }

  // Fail closed on double-quoted function identifiers like SELECT "pg_advisory_lock"(1)
  if (/"\s*\(/.test(trimmed)) {
    return false;
  }

  // Reject any function invocation not in our explicit pure read-only allowlist
  // (blocks pg_advisory_lock, set_config, pg_notify, lo_create, and custom volatile functions).
  const fnRe = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = fnRe.exec(trimmed)) !== null) {
    const fnName = match[1].toUpperCase();
    // Skip column/CTE definitions like `WITH cte(col) AS (...)` or table aliases
    if (SQL_CLAUSE_KEYWORDS.has(fnName)) continue;
    if (!SAFE_READ_ONLY_SQL_FUNCTIONS.has(fnName)) {
      return false;
    }
  }

  return true;
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
 * Resolve the tenant for automatic RLS scoping: a tenant set with
 * runAsTenant first, then the middleware-injected request context, else a tenant established with runWithTenantContext
 * (event consumers, token-authenticated public flows). This intentionally
 * does not accept query/body tenant IDs and returns null for jobs, migrations
 * and other code with neither, which must use the explicit RLS helpers.
 */
async function requestTenantId(): Promise<string | null> {
  // An explicit runAsTenant() (set by server code after an authorization
  // check) wins over the request's own tenant; '*' is the platform context.
  const acting = actingTenantId() ?? null;
  if (acting === '*' || isValidTenantId(acting)) return acting;
  const requestHeaders = await readRequestHeaders();
  const fromRequest = requestHeaders?.get('x-tenant-id') ?? null;
  if (isValidTenantId(fromRequest)) return fromRequest;
  const background = backgroundTenantId() ?? null;
  return isValidTenantId(background) ? background : null;
}

export interface SafeRetryOptions {
  replaySafety: ReplaySafety;
  operationLabel: string;
  maxRetries?: number;
  retryDelayMs?: number;
  ensureConnected?: (opts: { force: boolean; retries: number; timeoutMs: number }) => Promise<void>;
  onDisconnect?: () => void;
}

/**
 * Bounded, replay-safe connection recovery wrapper (M1-P1-3).
 *
 * Prevents duplicate transaction execution:
 *  - Read-only operations (`replaySafety === 'read_only'`) may retry on any
 *    classified connection error (`pre_execution`, `admin_terminated` / 57P01,
 *    `mid_flight_transport`).
 *  - Mutating operations and interactive transactions may ONLY retry when the
 *    failure happened in `acquire` phase (before the write or callback started —
 *    e.g., idle Neon socket dying on connect, BEGIN, or SET LOCAL). Once a write
 *    or interactive transaction enters `executing` or `committing`, connection
 *    drops are NEVER silently replayed.
 */
export async function executeWithSafeConnectionRetry<T>(
  run: (phase: PhaseTracker) => Promise<T>,
  options: SafeRetryOptions,
): Promise<T> {
  const rawMax = options.maxRetries ?? DB_OPERATION_RETRIES;
  const maxRetries = Math.min(Math.max(0, Number.isFinite(rawMax) ? Math.floor(rawMax) : 0), MAX_BOUNDED_OPERATION_RETRIES);
  const baseDelayMs = options.retryDelayMs ?? 250;
  const ensureConnectedFn = options.ensureConnected ?? ensureDbConnected;
  const onDisconnectFn = options.onDisconnect ?? (() => { primaryConnected = false; });

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let currentPhase: ExecutionPhase = 'acquire';
    const phase: PhaseTracker = {
      get current() {
        return currentPhase;
      },
      markExecuting() {
        currentPhase = 'executing';
      },
      markCommitting() {
        currentPhase = 'committing';
      },
    };

    try {
      await ensureConnectedFn({
        force: attempt > 0,
        retries: attempt > 0 ? Math.max(1, DB_CONNECT_RETRIES) : DB_CONNECT_RETRIES,
        timeoutMs: DB_CONNECT_TIMEOUT_MS,
      });
      return await run(phase);
    } catch (err) {
      lastError = err;

      // Defense in depth: P2028 is a Prisma Transaction API timeout, never a
      // connection drop. Fail fast to avoid compounding pool contention.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2028'
      ) {
        throw err;
      }

      const classification = classifyConnectionError(err);
      if (classification === 'none') {
        throw err;
      }

      // Reset connection flag so subsequent traffic opens a fresh socket.
      onDisconnectFn();

      // Strictly forbid replaying a mutating operation or transaction once it
      // has entered executing or committing — even if a nested error looks like
      // pre_execution or DbConnectionError. Prevents duplicate transaction writes.
      const safeToReplay =
        options.replaySafety === 'read_only' ||
        phase.current === 'acquire';

      if (!safeToReplay) {
        console.warn(JSON.stringify({
          component: 'prisma',
          event: 'connection_retry_skipped',
          reason: 'unsafe_to_replay_after_dispatch',
          classification,
          phase: phase.current,
          replaySafety: options.replaySafety,
          operation: options.operationLabel,
          attempt,
        }));
        break;
      }

      if (attempt >= maxRetries) {
        console.warn(JSON.stringify({
          component: 'prisma',
          event: 'connection_retry_exhausted',
          classification,
          phase: phase.current,
          replaySafety: options.replaySafety,
          operation: options.operationLabel,
          attempts: attempt + 1,
          maxRetries,
        }));
        break;
      }

      console.warn(JSON.stringify({
        component: 'prisma',
        event: 'connection_retry',
        classification,
        phase: phase.current,
        replaySafety: options.replaySafety,
        operation: options.operationLabel,
        attempt: attempt + 1,
        maxRetries,
      }));
      await wait(baseDelayMs * (attempt + 1));
    }
  }

  if (isPrimaryConnectionError(lastError)) {
    throw new DbConnectionError('Database connection unavailable', { cause: lastError });
  }
  throw lastError;
}

async function withPrimaryConnectionRetry<T>(
  run: (phase: PhaseTracker) => Promise<T>,
  replaySafety: ReplaySafety,
  operationLabel: string,
): Promise<T> {
  return executeWithSafeConnectionRetry(run, { replaySafety, operationLabel });
}

// ── Primary Prisma client (Neon) ──────────────────────────────────────────────
//
// Log config uses event-based error emission so we can filter Neon's noisy
// idle-pool `kind: Closed` errors while keeping 57P01 admin terminations
// observable via compact structured warnings instead of raw Rust stack dumps.
const RECOVERABLE_PRISMA_ERROR_PATTERNS: RegExp[] = [
  /\bkind:\s*(Closed|TimedOut|ConnectionAborted|ConnectionReset|BrokenPipe|Io)\b/,
  /\bconnection.*(closed|reset|aborted)\b/i,
  /Server has closed the connection/,
];

const ADMIN_TERMINATION_PRISMA_PATTERN =
  /SqlState\(E?57P0[123]\)|terminating connection due to administrator command|terminating connection due to crash/i;

const prismaClientSingleton = () => {
  // Connection strings come only from the environment. A hard-coded
  // production owner URL that replaced certain DATABASE_URLs was removed here
  // (it leaked the owner credential and silently pointed dev machines at
  // production with DDL rights).
  let customDbUrl = process.env.DATABASE_URL;
  if (customDbUrl && customDbUrl.startsWith('postgresql+psycopg://')) {
    customDbUrl = customDbUrl.replace('postgresql+psycopg://', 'postgresql://');
    process.env.DATABASE_URL = customDbUrl;
  }

  const client = new PrismaClient({
    datasources: customDbUrl ? { db: { url: customDbUrl } } : undefined,
    log: [
      { level: 'error', emit: 'event' },
      ...(process.env.NODE_ENV === 'development'
        ? ([{ level: 'warn', emit: 'stdout' }] as const)
        : []),
    ],
  });

  // Silence known-recoverable idle socket blips; surface 57P01 admin
  // terminations as structured warnings so Neon recycles remain observable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).$on('error', (e: { message?: string; timestamp?: Date }) => {
    const msg = e.message ?? '';
    if (ADMIN_TERMINATION_PRISMA_PATTERN.test(msg)) {
      primaryConnected = false;
      console.warn(JSON.stringify({
        component: 'prisma',
        event: 'engine_admin_terminated',
        classification: 'admin_terminated',
      }));
      return;
    }
    if (RECOVERABLE_PRISMA_ERROR_PATTERNS.some(p => p.test(msg))) return;
    console.error('[prisma]', msg);
  });

  const originalTransaction = client.$transaction.bind(client);
  // Capture pristine references BEFORE the raw-method monkey-patch below.
  // Prisma's tx client forwards $executeRawUnsafe/$queryRawUnsafe through the
  // main client instance, so assigning a wrapper to `client.$executeRawUnsafe`
  // also intercepts `tx.$executeRawUnsafe`. If the wrapper's own SET LOCAL
  // (issued to set app.tenant_id) hits its own wrapper, we recurse: another
  // originalTransaction opens, needs another pool slot, times out with P2028,
  // and every layer adds ~10s. Use these pristine references (called with
  // .call(tx, ...) so Prisma routes through the tx-bound engine) for every
  // internal SET LOCAL below.
  const originalExecuteRawUnsafe = client.$executeRawUnsafe as (
    this: unknown,
    ...args: unknown[]
  ) => Promise<unknown>;
  const originalRawMethods: Record<string, (this: unknown, ...args: unknown[]) => Promise<unknown>> = {
    $executeRawUnsafe: client.$executeRawUnsafe as never,
    $queryRawUnsafe: client.$queryRawUnsafe as never,
    $queryRaw: client.$queryRaw as never,
    $executeRaw: client.$executeRaw as never,
  };

  /**
   * Every ORM/raw query originating from an authenticated operator request is
   * run in a transaction that sets app.tenant_id with SET LOCAL semantics.
   * Explicit withTenantRls/withPlatformAdmin calls install an AsyncLocalStorage
   * marker and bypass this wrapper, retaining their one-transaction atomicity.
   */
  async function withRequestRls<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
    replaySafety: ReplaySafety,
    operationLabel: string,
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

    return withPrimaryConnectionRetry(
      (phase) =>
        originalTransaction(async (tx) => {
          // Remains in 'acquire' phase during BEGIN + SET LOCAL: a dead idle
          // Neon socket (57P01/ConnectionReset) fails here BEFORE operation runs,
          // so retrying executes the write at most once.
          await originalExecuteRawUnsafe.call(tx, `SELECT set_config('app.tenant_id', $1, true)`, tenantId);
          // Enforce durable session revocation on bare-prisma routes too (Track C).
          // Must run INSIDE runWithActiveTx + runWithRlsScope so tx.$queryRawUnsafe
          // binds to this tx instead of re-entering the raw wrapper recursively.
          const res = await runWithActiveTx(tx, () =>
            runWithRlsScope({ tenantId, mode: 'tenant', tx }, async () => {
              const { enforceRequestSessionRevocation } = await import('@/lib/rls');
              await enforceRequestSessionRevocation(tx as never, tenantId);
              phase.markExecuting();
              return operation(tx);
            }),
          );
          phase.markCommitting();
          return res;
        }, { maxWait: 10_000, timeout: 15_000 }),
      replaySafety,
      operationLabel,
    );
  }

  // Dual-write middleware — mirrors every write to local DB automatically.
  // Fire-and-forget: local DB errors NEVER block the primary (Neon) response.
  client.$use(async (params, next) => {
    const replaySafety: ReplaySafety = isReadOnlyOrmAction(params.action) ? 'read_only' : 'mutating';
    const operationLabel = params.model ? `${params.model}.${params.action}` : params.action;

    // Prisma model delegates are normally not transaction-bound. For an
    // authenticated request, pin each operation to a tenant-scoped
    // transaction. The inner call reaches this middleware again, sees the
    // scope marker, and executes `next` on the pinned transaction client.
    const scope = activeRlsScope();
    if (params.model && !scope) {
      const tenantId = await requestTenantId();
      if (tenantId) {
        return withRequestRls(
          async (tx) => {
            const delegate = (tx as unknown as Record<string, Record<string, (args: unknown) => Promise<unknown>>>)[params.model!];
            return delegate[params.action](params.args);
          },
          replaySafety,
          operationLabel,
        );
      }
    }

    // A model operation on the global client inside withTenantRls /
    // withPlatformAdmin (a service helper that takes no tx). Raw queries were
    // already forwarded to the scope's transaction below; model operations
    // ran on a fresh pooled connection with app.tenant_id unset, so RLS
    // returned only NULL-tenant rows and rejected tenant writes — and outside
    // the caller's transaction, so they were not rolled back with it either.
    // Re-issue it on the scope's tx: that call comes back through here with
    // runInTransaction set and runs on the pinned connection.
    //
    // Consequence: such a call now lives and dies with the scope's
    // transaction. Fire-and-forget work must use runOutsideRlsScope, or it
    // can reach the transaction after it has closed (P2028).
    const activeTx = scope?.tx ?? activeTransactionClient();
    if (params.model && activeTx && !params.runInTransaction) {
      const delegate = (activeTx as unknown as Record<string, Record<string, (args: unknown) => Promise<unknown>>>)[params.model];
      return delegate[params.action](params.args);
    }

    // Inside an already-open transaction, do not open a nested retry loop on
    // individual statements — let the outer transaction wrapper manage safety.
    const result = params.runInTransaction
      ? await next(params)
      : await withPrimaryConnectionRetry(
          async (phase) => {
            phase.markExecuting();
            return next(params);
          },
          replaySafety,
          operationLabel,
        );

    // Mirror write operations to local DB in the background
    if (params.model && WRITE_ACTIONS.includes(params.action as Prisma.PrismaAction)) {
      mirrorToLocal(params).catch(() => { /* already handled inside */ });
    }

    return result;
  });

  // ── Raw-query / transaction connection retry ─────────────────────────────────
  // Gives raw SQL and interactive transactions the same classified, replay-safe
  // recovery policy as ORM operations:
  //  - Pure read-only $queryRaw* recovers transparently on 57P01 & socket drops.
  //  - Interactive transactions bind their tx client in AsyncLocalStorage even
  //    when no tenant RLS scope is set, preventing raw calls inside $transaction
  //    from escaping onto a second pool connection or triggering nested retries.
  //  - Writes / $transaction recover ONLY if the socket failed in the acquire
  //    phase (connect / BEGIN / SET LOCAL), NEVER after execution or commit starts.
  for (const method of ['$queryRawUnsafe', '$executeRawUnsafe', '$queryRaw', '$executeRaw', '$transaction'] as const) {
    const original = (client[method] as (...args: unknown[]) => Promise<unknown>).bind(client);
    (client as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[method] =
      (...args: unknown[]) => {
        if (method === '$transaction') {
          const callback = args[0];
          const scope = activeRlsScope();
          const existingTx = scope?.tx ?? activeTransactionClient();
          // Nested $transaction inside an active scope/transaction: reuse the
          // existing tx client directly without adding a nested retry layer.
          if (typeof callback === 'function' && existingTx) {
            return (callback as (transaction: Prisma.TransactionClient) => Promise<unknown>)(existingTx);
          }
          return withPrimaryConnectionRetry(
            async (phase) => {
              if (typeof callback !== 'function') {
                phase.markExecuting();
                return original(...args);
              }
              const tenantId = await requestTenantId();
              const options = args[1] as { timeout?: number; maxWait?: number } | undefined;
              if (!tenantId) {
                return originalTransaction(async (tx) => {
                  phase.markExecuting();
                  const res = await runWithActiveTx(tx, () =>
                    (callback as (transaction: Prisma.TransactionClient) => Promise<unknown>)(tx),
                  );
                  phase.markCommitting();
                  return res;
                }, options);
              }
              return originalTransaction(async (tx) => {
                await originalExecuteRawUnsafe.call(tx, `SELECT set_config('app.tenant_id', $1, true)`, tenantId);
                phase.markExecuting();
                const res = await runWithActiveTx(tx, () =>
                  runWithRlsScope({ tenantId, mode: 'tenant', tx }, () =>
                    (callback as (transaction: Prisma.TransactionClient) => Promise<unknown>)(tx),
                  ),
                );
                phase.markCommitting();
                return res;
              }, options);
            },
            'mutating',
            '$transaction',
          );
        }

        // Raw $queryRaw* / $executeRaw* inside an active RLS scope OR active
        // interactive $transaction: run directly on that tx client so neither
        // atomicity nor SET LOCAL app.tenant_id is lost, and no nested retry runs.
        const scope = activeRlsScope();
        const activeTx = scope?.tx ?? activeTransactionClient();
        if (activeTx) {
          return originalRawMethods[method].call(activeTx, ...args);
        }

        const replaySafety: ReplaySafety = isReadOnlyRawSql(method, args) ? 'read_only' : 'mutating';

        return withPrimaryConnectionRetry(
          async (phase) => {
            const tenantId = await requestTenantId();
            if (!tenantId) {
              phase.markExecuting();
              return original(...args);
            }
            return originalTransaction(async (tx) => {
              await originalExecuteRawUnsafe.call(tx, `SELECT set_config('app.tenant_id', $1, true)`, tenantId);
              // Must run INSIDE runWithActiveTx + runWithRlsScope so tx.$queryRawUnsafe
              // binds to this tx instead of re-entering this raw wrapper recursively.
              const res = await runWithActiveTx(tx, () =>
                runWithRlsScope({ tenantId, mode: 'tenant', tx }, async () => {
                  const { enforceRequestSessionRevocation } = await import('@/lib/rls');
                  await enforceRequestSessionRevocation(tx as never, tenantId);
                  phase.markExecuting();
                  return originalRawMethods[method].call(tx, ...args);
                }),
              );
              phase.markCommitting();
              return res;
            }, { maxWait: 10_000, timeout: 15_000 });
          },
          replaySafety,
          method,
        );
      };
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
