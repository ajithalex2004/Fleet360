import { describe, it, expect, vi } from 'vitest';
import {
  evaluateMigrationFailure,
  shouldHaltOnForbiddenError,
  hasExpectedGapSignature,
  verifyDatabasePreconditions,
  FORBIDDEN_ERROR_PATTERNS,
  EXPECTED_GAP_SIGNATURES,
} from '../../scripts/fresh-install-migrate.cjs';

describe('Fresh database migration runner safety guards & classification', () => {
  const targetMigration = '20260815140000_tenant_001_leasing_rental_isolation';
  const candidateList = [targetMigration, '20260901000000_subsequent_migration'];

  it('deliberately excludes generic P3018 and P3006 codes from expected gap signatures', () => {
    // Ensuring P3018 and P3006 are not in the list prevents masking real crashes
    const regexStrings = EXPECTED_GAP_SIGNATURES.map((r: RegExp) => r.source);
    expect(regexStrings.some((s: string) => s.includes('P3018'))).toBe(false);
    expect(regexStrings.some((s: string) => s.includes('P3006'))).toBe(false);
  });

  it('rejects resolution and halts when permission denied occurs', () => {
    const mockOutput = `
      Applying migration ${targetMigration}
      Database error: ERROR: permission denied for schema public
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, candidateList);
    expect(evalResult.canResolve).toBe(false);
    expect(evalResult.reason).toBe('FORBIDDEN_INFRASTRUCTURE_ERROR');
  });

  it('rejects resolution and halts on authentication failure (P1000)', () => {
    const mockOutput = `
      Applying migration ${targetMigration}
      PrismaClientKnownRequestError: Authentication failed against database server (P1000)
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, candidateList);
    expect(evalResult.canResolve).toBe(false);
    expect(evalResult.reason).toBe('FORBIDDEN_INFRASTRUCTURE_ERROR');
  });

  it('rejects resolution and halts on connection refused (ECONNREFUSED)', () => {
    const mockOutput = `
      Applying migration ${targetMigration}
      connect ECONNREFUSED 127.0.0.1:5432
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, candidateList);
    expect(evalResult.canResolve).toBe(false);
    expect(evalResult.reason).toBe('FORBIDDEN_INFRASTRUCTURE_ERROR');
  });

  it('rejects resolution when P3018 wraps a generic fatal error (e.g. disk full / space left on device)', () => {
    // In real Prisma failures, Prisma prints "Error: P3018: A migration failed to apply" around fatal errors.
    // The runner must NOT consider P3018 an expected gap.
    const mockOutput = `
      Error: P3018: A migration failed to apply.
      Migration: ${targetMigration}
      Database error: ERROR: could not write to file "base/pgsql_tmp": No space left on device
      PostgreSQL error code: 53100
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, candidateList);
    expect(evalResult.canResolve).toBe(false);
    expect(evalResult.reason).toBe('UNEXPECTED_ERROR_SIGNATURE');
    expect(evalResult.migrationName).toBe(targetMigration);
  });

  it('rejects resolution when P3018 wraps a syntax or compiler error', () => {
    const mockOutput = `
      Error: P3018: A migration failed to apply.
      Migration: ${targetMigration}
      Database error: ERROR: syntax error at or near "SELCT"
      PostgreSQL error code: 42601
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, candidateList);
    expect(evalResult.canResolve).toBe(false);
    expect(evalResult.reason).toBe('UNEXPECTED_ERROR_SIGNATURE');
  });

  it('rejects resolution when failing migration is NOT in the candidate chain', () => {
    const unknownMigration = '20261010000000_unauthorized_migration';
    const mockOutput = `
      Applying migration ${unknownMigration}
      Database error: ERROR: relation "some_table" does not exist
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, candidateList);
    expect(evalResult.canResolve).toBe(false);
    expect(evalResult.reason).toBe('UNKNOWN_MIGRATION');
  });

  it('allows resolution only when BOTH known migration and specific PostgreSQL schema gap signature match', () => {
    const mockOutput = `
      Error: P3018: A migration failed to apply.
      Migration: ${targetMigration}
      Database error: ERROR: relation "rental_rate_quotes" does not exist
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, candidateList);
    expect(evalResult.canResolve).toBe(true);
    expect(evalResult.reason).toBe('MATCHED_EXPECTED_GAP');
    expect(evalResult.migrationName).toBe(targetMigration);
    expect(evalResult.index).toBe(0);
  });

  it('correctly matches other specific schema gap signatures (type exists, column generation)', () => {
    const mockTypeExists = `
      Migration: ${targetMigration}
      Database error: ERROR: type "vehicle_status" already exists
    `;
    expect(evaluateMigrationFailure(mockTypeExists, candidateList).canResolve).toBe(true);

    const mockGenExpr = `
      Migration: ${targetMigration}
      Database error: ERROR: cannot use CURRENT_DATE in column generation expression
    `;
    expect(evaluateMigrationFailure(mockGenExpr, candidateList).canResolve).toBe(true);
  });
});

describe('Database precondition & freshness checks', () => {
  it('throws error when DATABASE_URL is missing', async () => {
    await expect(
      verifyDatabasePreconditions({
        databaseUrl: '',
        throwOnError: true,
      })
    ).rejects.toThrow('DATABASE_URL environment variable is not set.');
  });

  it('rejects non-fresh database with existing migrations when freshOverride is false', async () => {
    const mockPrisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ current_user: 'postgres', current_database: 'fleet360_test', version: 'PostgreSQL 16' }])
        .mockResolvedValueOnce([{ count: 42 }]),
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      verifyDatabasePreconditions({
        databaseUrl: 'postgresql://postgres:postgres@localhost:5432/fleet360_test',
        prismaClient: mockPrisma,
        freshOverride: false,
        throwOnError: true,
      })
    ).rejects.toThrow('Database is not fresh (42 migrations found) without override.');
  });

  it('allows non-fresh database when freshOverride is true', async () => {
    const mockPrisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ current_user: 'postgres', current_database: 'fleet360_test', version: 'PostgreSQL 16' }])
        .mockResolvedValueOnce([{ count: 42 }]),
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };

    const res = await verifyDatabasePreconditions({
      databaseUrl: 'postgresql://postgres:postgres@localhost:5432/fleet360_test',
      prismaClient: mockPrisma,
      freshOverride: true,
      throwOnError: true,
    });

    expect(res.migrationCount).toBe(42);
    expect(res.database).toBe('fleet360_test');
  });

  it('passes cleanly for a fresh empty database where _prisma_migrations does not exist yet', async () => {
    const mockPrisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ current_user: 'postgres', current_database: 'fleet360_fresh', version: 'PostgreSQL 16' }])
        .mockRejectedValueOnce(new Error('relation "_prisma_migrations" does not exist')),
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };

    const res = await verifyDatabasePreconditions({
      databaseUrl: 'postgresql://postgres:postgres@localhost:5432/fleet360_fresh',
      prismaClient: mockPrisma,
      freshOverride: false,
      throwOnError: true,
    });

    expect(res.migrationCount).toBe(0);
    expect(res.database).toBe('fleet360_fresh');
  });
});
