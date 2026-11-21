/**
 * M1-P1-3: Neon PostgreSQL 57P01 / E57P01 Connection-Recovery Resilience Tests
 *
 * Verifies:
 *  1. SqlState(E57P01) / 57P01 / "terminating connection due to administrator command"
 *     is classified as a primary connection error (admin_terminated).
 *  2. Read-only operations safely recover on 57P01 and transient transport drops with
 *     bounded retries.
 *  3. Write / interactive-transaction operations that fail during connection
 *     acquisition (before body execution) recover safely and execute ONCE.
 *  4. Write / interactive-transaction operations that drop AFTER execution begins
 *     (ambiguous mid-flight / commit drop) are NEVER blindly replayed — preventing
 *     duplicate transaction execution — while emitting structured observability logs.
 *  5. P2028 transaction timeout and constraint errors (P2002) are never retried.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isDbConnectionError,
  classifyConnectionError,
  isReadOnlyRawSql,
  executeWithSafeConnectionRetry,
  DbConnectionError,
} from '@/lib/prisma';

const NEON_57P01_ERROR = new Error(
  'Error in PostgreSQL connection: Error { kind: Db, cause: Some(DbError { severity: "FATAL", parsed_severity: Some(Fatal), code: SqlState(E57P01), message: "terminating connection due to administrator command", file: Some("postgres.c"), line: Some(3319), routine: Some("ProcessInterrupts") }) }',
);

const CONNECTION_RESET_ERROR = new Error(
  'Error in PostgreSQL connection: Error { kind: Io, cause: Some(Os { code: 104, kind: ConnectionReset, message: "Connection reset by peer" }) }',
);

const PRE_CONNECT_ERROR = Object.assign(new Error("Can't reach database server at `ep-calm-heart.aws.neon.tech:5432`"), {
  code: 'P1001',
});

const P2028_ERROR = Object.assign(new Error('Unable to start a transaction in the given time.'), {
  code: 'P2028',
});

const P2002_ERROR = Object.assign(new Error('Unique constraint failed'), {
  code: 'P2002',
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('M1-P1-3: Connection error classification', () => {
  it('classifies Neon SqlState(E57P01) / terminating connection due to administrator command as admin_terminated', () => {
    expect(classifyConnectionError(NEON_57P01_ERROR)).toBe('admin_terminated');
    expect(isDbConnectionError(NEON_57P01_ERROR)).toBe(true);
  });

  it('classifies bare 57P01 sqlstate errors and 57P02 crash shutdown as admin_terminated, and 57P03 as pre_execution', () => {
    expect(classifyConnectionError(Object.assign(new Error('shutdown'), { code: '57P01' }))).toBe('admin_terminated');
    expect(classifyConnectionError(new Error('FATAL: 57P02 terminating connection due to crash of another server process'))).toBe('admin_terminated');
    expect(classifyConnectionError(new Error('FATAL: SqlState(E57P03) the database system is starting up'))).toBe('pre_execution');
  });

  it('classifies P1001 as pre_execution and ConnectionReset as mid_flight_transport', () => {
    expect(classifyConnectionError(PRE_CONNECT_ERROR)).toBe('pre_execution');
    expect(classifyConnectionError(CONNECTION_RESET_ERROR)).toBe('mid_flight_transport');
  });

  it('never classifies P2028 or P2002 as connection errors', () => {
    expect(classifyConnectionError(P2028_ERROR)).toBe('none');
    expect(classifyConnectionError(P2002_ERROR)).toBe('none');
    expect(isDbConnectionError(P2028_ERROR)).toBe(false);
    expect(isDbConnectionError(P2002_ERROR)).toBe(false);
  });
});

describe('M1-P1-3: Raw SQL replay-safety classifier', () => {
  it('recognizes pure SELECT / SHOW reads as safe to replay', () => {
    expect(isReadOnlyRawSql('$queryRawUnsafe', ['SELECT id, name FROM vehicles WHERE tenant_id = $1'])).toBe(true);
    expect(isReadOnlyRawSql('$queryRawUnsafe', ['/* comment */ SELECT 1'])).toBe(true);
    expect(isReadOnlyRawSql('$queryRawUnsafe', ['WITH cte AS (SELECT id FROM trips) SELECT * FROM cte'])).toBe(true);
    expect(isReadOnlyRawSql('$queryRaw', [['SELECT 1 FROM tenants WHERE id = ', '']])).toBe(true);
  });

  it('treats writes, RETURNING queries, FOR UPDATE/SHARE locks, semicolons, nested comments, INTO, volatile/unlisted functions, Prisma.raw fragments, and $executeRaw* as mutating', () => {
    expect(isReadOnlyRawSql('$executeRawUnsafe', ['UPDATE vehicles SET status = $1'])).toBe(false);
    expect(isReadOnlyRawSql('$executeRaw', [['DELETE FROM trips WHERE id = ', '']])).toBe(false);
    expect(isReadOnlyRawSql('$queryRawUnsafe', ['INSERT INTO invoices (id) VALUES ($1) RETURNING id'])).toBe(false);
    expect(isReadOnlyRawSql('$queryRawUnsafe', ['WITH u AS (UPDATE orders SET status = $1 RETURNING *) SELECT * FROM u'])).toBe(false);
    expect(isReadOnlyRawSql('$queryRawUnsafe', ['SELECT * FROM seats WHERE id = $1 FOR UPDATE'])).toBe(false);
    expect(isReadOnlyRawSql('$queryRawUnsafe', ['SELECT * FROM seats WHERE id = $1 FOR /* comment */ SHARE'])).toBe(false);
    expect(isReadOnlyRawSql('$queryRawUnsafe', ["SELECT nextval('invoice_seq')"])).toBe(false);
    expect(isReadOnlyRawSql('$queryRawUnsafe', ['SELECT pg_advisory_lock(1)'])).toBe(false);
    expect(isReadOnlyRawSql('$queryRawUnsafe', ["SELECT set_config('app.tenant_id', 'x', true)"])).toBe(false);
    expect(isReadOnlyRawSql('$queryRawUnsafe', ["SELECT pg_notify('ch', 'hi')"])).toBe(false);
    expect(isReadOnlyRawSql('$queryRawUnsafe', ['SELECT my_mutating_func(1)'])).toBe(false);
    expect(isReadOnlyRawSql('$queryRawUnsafe', ['SELECT * INTO backup_users FROM "User"'])).toBe(false);
    expect(isReadOnlyRawSql('$queryRawUnsafe', ["SELECT 1; NOTIFY ch, 'hi'"])).toBe(false);
    expect(isReadOnlyRawSql('$queryRawUnsafe', ['EXPLAIN (ANALYZE) SELECT 1'])).toBe(false);
    expect(isReadOnlyRawSql('$queryRawUnsafe', ["/* outer /* inner */ SELECT 1 */ NOTIFY ch, 'hi'"])).toBe(false);
    expect(isReadOnlyRawSql('$queryRawUnsafe', ['SELECT "pg_advisory_lock"(1)'])).toBe(false);
    expect(isReadOnlyRawSql('$queryRawUnsafe', ["SELECT E'\\''; DELETE FROM users --'"])).toBe(false);
    // Tagged template with interpolated Prisma.raw('FOR UPDATE') fragment
    expect(
      isReadOnlyRawSql('$queryRaw', [
        ['SELECT * FROM seats WHERE id = ', ' ', ''],
        'seat-1',
        { strings: ['FOR UPDATE'], values: [] },
      ]),
    ).toBe(false);
  });

  it('never replays a mutating transaction on nested DbConnectionError or P1002 timeout after executing begins', async () => {
    let bodyCalls = 0;
    const reconnect = vi.fn().mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(
        executeWithSafeConnectionRetry(
          async (phase) => {
            phase.markExecuting();
            bodyCalls++;
            throw new DbConnectionError('nested drop', { cause: NEON_57P01_ERROR });
          },
          { replaySafety: 'mutating', operationLabel: '$transaction', maxRetries: 2, retryDelayMs: 1, ensureConnected: reconnect },
        ),
      ).rejects.toBeInstanceOf(DbConnectionError);
      expect(bodyCalls).toBe(1);

      bodyCalls = 0;
      const p1002 = Object.assign(new Error('Database server was reached but timed out'), { code: 'P1002' });
      expect(classifyConnectionError(p1002)).toBe('mid_flight_transport');
      await expect(
        executeWithSafeConnectionRetry(
          async (phase) => {
            phase.markExecuting();
            bodyCalls++;
            throw p1002;
          },
          { replaySafety: 'mutating', operationLabel: '$transaction', maxRetries: 2, retryDelayMs: 1, ensureConnected: reconnect },
        ),
      ).rejects.toBeInstanceOf(DbConnectionError);
      expect(bodyCalls).toBe(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('M1-P1-3: Safe bounded retry vs duplicate transaction prevention', () => {
  it('recovers read-only operations on Neon 57P01 with bounded retry and reconnect', async () => {
    let calls = 0;
    const reconnect = vi.fn().mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const result = await executeWithSafeConnectionRetry(
        async () => {
          calls++;
          if (calls === 1) throw NEON_57P01_ERROR;
          return { rows: 42 };
        },
        {
          replaySafety: 'read_only',
          operationLabel: 'Vehicle.findMany',
          maxRetries: 2,
          retryDelayMs: 1,
          ensureConnected: reconnect,
        },
      );

      expect(result).toEqual({ rows: 42 });
      expect(calls).toBe(2);
      expect(reconnect).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('recovers mutating operations that fail in acquire phase (before write runs) and executes the write ONCE', async () => {
    let acquireCalls = 0;
    let writeCalls = 0;
    const reconnect = vi.fn().mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const result = await executeWithSafeConnectionRetry(
        async (phase) => {
          acquireCalls++;
          // Simulate dead idle Neon socket failing on BEGIN / SET LOCAL app.tenant_id
          if (acquireCalls === 1) throw NEON_57P01_ERROR;
          phase.markExecuting();
          writeCalls++;
          return { insertedId: 'inv-001' };
        },
        {
          replaySafety: 'mutating',
          operationLabel: 'Invoice.create',
          maxRetries: 2,
          retryDelayMs: 1,
          ensureConnected: reconnect,
        },
      );

      expect(result).toEqual({ insertedId: 'inv-001' });
      expect(acquireCalls).toBe(2);
      expect(writeCalls).toBe(1); // Executed EXACTLY ONCE!
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('DOES NOT replay a mutating write or transaction when connection drops after execution/commit begins (no duplicate transactions)', async () => {
    let writeCalls = 0;
    const reconnect = vi.fn().mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(
        executeWithSafeConnectionRetry(
          async (phase) => {
            phase.markExecuting();
            writeCalls++;
            phase.markCommitting();
            // Connection vanishes while waiting for COMMIT confirmation
            throw CONNECTION_RESET_ERROR;
          },
          {
            replaySafety: 'mutating',
            operationLabel: '$transaction',
            maxRetries: 2,
            retryDelayMs: 1,
            ensureConnected: reconnect,
          },
        ),
      ).rejects.toBeInstanceOf(DbConnectionError);

      expect(writeCalls).toBe(1); // STRICTLY NEVER REPLAYED!
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('connection_retry_skipped'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('DOES NOT replay an interactive transaction if 57P01 occurs after callback execution has started', async () => {
    let bodyCalls = 0;
    const reconnect = vi.fn().mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(
        executeWithSafeConnectionRetry(
          async (phase) => {
            phase.markExecuting();
            bodyCalls++;
            throw NEON_57P01_ERROR;
          },
          {
            replaySafety: 'mutating',
            operationLabel: '$transaction',
            maxRetries: 2,
            retryDelayMs: 1,
            ensureConnected: reconnect,
          },
        ),
      ).rejects.toBeInstanceOf(DbConnectionError);

      expect(bodyCalls).toBe(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('caps retries strictly (bounded) and throws DbConnectionError when exhausted', async () => {
    let calls = 0;
    const reconnect = vi.fn().mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(
        executeWithSafeConnectionRetry(
          async () => {
            calls++;
            throw NEON_57P01_ERROR;
          },
          {
            replaySafety: 'read_only',
            operationLabel: 'Tenant.findMany',
            maxRetries: 99, // Verify hard upper bound cap (<= 3)
            retryDelayMs: 1,
            ensureConnected: reconnect,
          },
        ),
      ).rejects.toBeInstanceOf(DbConnectionError);

      expect(calls).toBe(4); // 1 initial + max 3 bounded retries
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('never retries P2028 or P2002', async () => {
    let calls = 0;
    const reconnect = vi.fn().mockResolvedValue(undefined);

    await expect(
      executeWithSafeConnectionRetry(
        async () => {
          calls++;
          throw P2028_ERROR;
        },
        { replaySafety: 'read_only', operationLabel: '$transaction', maxRetries: 2, retryDelayMs: 1, ensureConnected: reconnect },
      ),
    ).rejects.toBe(P2028_ERROR);
    expect(calls).toBe(1);

    calls = 0;
    await expect(
      executeWithSafeConnectionRetry(
        async () => {
          calls++;
          throw P2002_ERROR;
        },
        { replaySafety: 'read_only', operationLabel: 'User.create', maxRetries: 2, retryDelayMs: 1, ensureConnected: reconnect },
      ),
    ).rejects.toBe(P2002_ERROR);
    expect(calls).toBe(1);
  });
});
