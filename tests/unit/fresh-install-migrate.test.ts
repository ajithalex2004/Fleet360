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

  it('rejects resolution if documented migration fails with an UNRELATED missing table', () => {
    const mockOutput = `
      Error: P3018: A migration failed to apply.
      Migration: ${targetMigration}
      Database error: ERROR: relation "unrelated_custom_table" does not exist
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, candidateList);
    expect(evalResult.canResolve).toBe(false);
    expect(evalResult.reason).toBe('UNEXPECTED_ERROR_SIGNATURE');
  });

  it('correctly matches other specific schema gap signatures (type exists, column generation)', () => {
    const altMigration = '20260910000016_finance_deposits_recurring_tables_and_rls';
    const altCandidateList = [altMigration];

    const mockGenExpr = `
      Migration: ${altMigration}
      Database error: ERROR: cannot use CURRENT_DATE in column generation expression
    `;
    expect(evaluateMigrationFailure(mockGenExpr, altCandidateList).canResolve).toBe(true);
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

  it('fails closed when querying _prisma_migrations returns permission denied (code 42501)', async () => {
    const permError = new Error('permission denied for table _prisma_migrations');
    (permError as any).code = '42501';

    const mockPrisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ current_user: 'restricted_user', current_database: 'fleet360_prod', version: 'PostgreSQL 16' }])
        .mockRejectedValueOnce(permError),
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      verifyDatabasePreconditions({
        databaseUrl: 'postgresql://restricted_user:pass@localhost:5432/fleet360_prod',
        prismaClient: mockPrisma,
        throwOnError: true,
      })
    ).rejects.toThrow('permission denied for table _prisma_migrations');
  });

  it('rejects database if _prisma_migrations is missing but application tables already exist in public schema', async () => {
    const missingTableError = new Error('relation "_prisma_migrations" does not exist');
    (missingTableError as any).code = '42P01';

    const mockPrisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ current_user: 'postgres', current_database: 'fleet360_dirty', version: 'PostgreSQL 16' }])
        .mockRejectedValueOnce(missingTableError) // _prisma_migrations count query
        .mockResolvedValueOnce([{ table_name: 'vehicles' }, { table_name: 'users' }]), // information_schema.tables query
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      verifyDatabasePreconditions({
        databaseUrl: 'postgresql://postgres:postgres@localhost:5432/fleet360_dirty',
        prismaClient: mockPrisma,
        throwOnError: true,
      })
    ).rejects.toThrow('Database is not empty (2 application tables found in public schema).');
  });

  it('rejects non-fresh database with existing migrations when resumeBootstrapFrom is not specified', async () => {
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
        throwOnError: true,
      })
    ).rejects.toThrow('Database is not fresh (42 migrations found) without resume point.');
  });

  it('allows resumption when resumeBootstrapFrom matches a recorded migration', async () => {
    const resumePoint = '20260815140000_tenant_001_leasing_rental_isolation';
    const mockPrisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ current_user: 'postgres', current_database: 'fleet360_test', version: 'PostgreSQL 16' }])
        .mockResolvedValueOnce([{ count: 5 }]) // count query
        .mockResolvedValueOnce([
          { migration_name: '20260801000000_init' },
          { migration_name: resumePoint },
        ]), // history query
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };

    const res = await verifyDatabasePreconditions({
      databaseUrl: 'postgresql://postgres:postgres@localhost:5432/fleet360_test',
      prismaClient: mockPrisma,
      resumeBootstrapFrom: resumePoint,
      throwOnError: true,
    });

    expect(res.migrationCount).toBe(5);
    expect(res.resumeFromMigration).toBe(resumePoint);
    expect(res.database).toBe('fleet360_test');
  });

  it('rejects resumption when resumeBootstrapFrom is not found in recorded migrations', async () => {
    const invalidResumePoint = '20260999999999_non_existent';
    const mockPrisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ current_user: 'postgres', current_database: 'fleet360_test', version: 'PostgreSQL 16' }])
        .mockResolvedValueOnce([{ count: 2 }])
        .mockResolvedValueOnce([
          { migration_name: '20260801000000_init' },
          { migration_name: '20260815140000_tenant_001_leasing_rental_isolation' },
        ]),
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      verifyDatabasePreconditions({
        databaseUrl: 'postgresql://postgres:postgres@localhost:5432/fleet360_test',
        prismaClient: mockPrisma,
        resumeBootstrapFrom: invalidResumePoint,
        throwOnError: true,
      })
    ).rejects.toThrow(`Resume migration "${invalidResumePoint}" not found in applied migrations.`);
  });

  it('passes cleanly for a genuinely fresh empty database where _prisma_migrations does not exist and 0 app tables exist', async () => {
    const missingTableError = new Error('relation "_prisma_migrations" does not exist');
    (missingTableError as any).code = '42P01';

    const mockPrisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ current_user: 'postgres', current_database: 'fleet360_fresh', version: 'PostgreSQL 16' }])
        .mockRejectedValueOnce(missingTableError) // _prisma_migrations count
        .mockResolvedValueOnce([]), // information_schema.tables returns []
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };

    const res = await verifyDatabasePreconditions({
      databaseUrl: 'postgresql://postgres:postgres@localhost:5432/fleet360_fresh',
      prismaClient: mockPrisma,
      throwOnError: true,
    });

    expect(res.migrationCount).toBe(0);
    expect(res.database).toBe('fleet360_fresh');
  });
});
