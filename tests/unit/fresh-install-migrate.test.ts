import { describe, it, expect, vi } from 'vitest';
import {
  evaluateMigrationFailure,
  extractFailureDetails,
  shouldHaltOnForbiddenError,
  hasExpectedGapSignature,
  verifyDatabasePreconditions,
  resolveMigrationTarget,
  FORBIDDEN_ERROR_PATTERNS,
  EXPECTED_GAP_SIGNATURES,
  DOCUMENTED_GAPS,
} from '../../scripts/fresh-install-migrate.cjs';

describe('Fresh database migration runner safety guards & classification', () => {
  const targetMigration = '20260815140000_tenant_001_leasing_rental_isolation';
  const candidateList = [targetMigration, '20260901000000_subsequent_migration'];

  it('deliberately excludes generic P3018 and P3006 codes from expected gap signatures', () => {
    const regexStrings = EXPECTED_GAP_SIGNATURES.map((r: RegExp) => r.source);
    expect(regexStrings.some((s: string) => s.includes('P3018'))).toBe(false);
    expect(regexStrings.some((s: string) => s.includes('P3006'))).toBe(false);
  });

  it('includes schema does not exist in expected gap signatures', () => {
    const regexStrings = EXPECTED_GAP_SIGNATURES.map((r: RegExp) => r.source);
    expect(regexStrings.some((s: string) => s.includes('schema'))).toBe(true);
  });

  it('catalogues all 19 documented resolve steps in DOCUMENTED_GAPS', () => {
    expect(Object.keys(DOCUMENTED_GAPS).length).toBe(19);
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
    const mockOutput = `
      Error: P3018: A migration failed to apply.
      Migration name: ${targetMigration}
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
      Migration name: ${targetMigration}
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
      Migration name: ${unknownMigration}
      Database error code: 42P01
      Database error: ERROR: relation "some_table" does not exist
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, candidateList);
    expect(evalResult.canResolve).toBe(false);
    expect(evalResult.reason).toBe('UNKNOWN_MIGRATION');
  });

  it('allows resolution only when BOTH known migration and specific PostgreSQL schema gap signature match', () => {
    const mockOutput = `
      Applying migration ${targetMigration}
      Error: P3018: A migration failed to apply.
      Migration name: ${targetMigration}
      Database error code: 42P01
      Database error: ERROR: relation "rental_rate_quotes" does not exist
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, candidateList);
    expect(evalResult.canResolve).toBe(true);
    expect(evalResult.reason).toBe('MATCHED_EXPECTED_GAP');
    expect(evalResult.migrationName).toBe(targetMigration);
    expect(evalResult.index).toBe(0);
    expect(evalResult.errorCode).toBe('42P01');
  });

  it('rejects resolution if documented migration fails with an UNRELATED missing table', () => {
    const mockOutput = `
      Applying migration ${targetMigration}
      Error: P3018: A migration failed to apply.
      Migration name: ${targetMigration}
      Database error code: 42P01
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
      Applying migration ${altMigration}
      Migration name: ${altMigration}
      Database error code: 42P17
      Database error: ERROR: cannot use CURRENT_DATE in column generation expression
    `;
    expect(evaluateMigrationFailure(mockGenExpr, altCandidateList).canResolve).toBe(true);
  });

  // Reviewer reproduction 1: Earlier known migration in output, later unknown migration fails
  it('rejects resolution when earlier known migration appears in stdout but later unknown migration fails', () => {
    const mockOutput = `
      Applying migration \`20260815140000_tenant_001_leasing_rental_isolation\`
      The following migration have been applied:
      \`20260815140000_tenant_001_leasing_rental_isolation\`

      Applying migration \`20261101000000_unknown_unplanned_migration\`
      Error: P3018
      A migration failed to apply. New database cannot be created: relation "some_table" does not exist
      Database error code: 42P01
      Database error:
      ERROR: relation "some_table" does not exist
      Migration name: 20261101000000_unknown_unplanned_migration
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, [
      '20260815140000_tenant_001_leasing_rental_isolation',
      '20260816000000_route_consolidation_phase2_schema',
    ]);
    expect(evalResult.canResolve).toBe(false);
    expect(evalResult.reason).toBe('UNKNOWN_MIGRATION');
    expect(evalResult.migrationName).toBe('20261101000000_unknown_unplanned_migration');
  });

  // Reviewer reproduction 2: Known fleet_operations_null_escape fails on unrelated missing object
  it('rejects resolution when fleet_operations_null_escape fails on an unrelated missing object', () => {
    const mockOutput = `
      Applying migration \`20260910000008_fleet_operations_null_escape\`
      Error: P3018
      A migration failed to apply.
      Database error code: 42P01
      Database error:
      ERROR: relation "unrelated_custom_table" does not exist
      Migration name: 20260910000008_fleet_operations_null_escape
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, [
      '20260910000008_fleet_operations_null_escape',
    ]);
    expect(evalResult.canResolve).toBe(false);
    expect(evalResult.reason).toBe('UNEXPECTED_ERROR_SIGNATURE');
  });

  // Reviewer reproduction 3: Documented schema-access migration fails because schema fleet is missing
  it('recognizes approved gap when grant_app_role_schema_access fails because schema fleet is missing', () => {
    const mockOutput = `
      Applying migration \`20260910000010_grant_app_role_schema_access\`
      Error: P3018
      A migration failed to apply.
      Database error code: 3F000
      Database error:
      ERROR: schema "fleet" does not exist
      Migration name: 20260910000010_grant_app_role_schema_access
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, [
      '20260910000010_grant_app_role_schema_access',
    ]);
    expect(evalResult.canResolve).toBe(true);
    expect(evalResult.reason).toBe('MATCHED_EXPECTED_GAP');
    expect(evalResult.migrationName).toBe('20260910000010_grant_app_role_schema_access');
    expect(evalResult.errorCode).toBe('3F000');
  });

  it('correctly handles Prisma Rust schema-engine backtrace without misclassifying "with" as migration name', () => {
    const mockOutput = `
      Applying migration \`20260815150000_backfill_rls_with_check\`
      Applying migration \`20260816000000_route_consolidation_phase2_schema\`

      Error: ERROR: current transaction is aborted, commands ignored until end of transaction block
         0: schema_core::commands::apply_migrations::Applying migration
                 with migration_name="20260816000000_route_consolidation_phase2_schema"
                   at schema-engine/core/src/commands/apply_migrations.rs:91
         1: schema_core::state::ApplyMigrations
                   at schema-engine/core/src/state.rs:226
    `;
    const details = extractFailureDetails(mockOutput);
    expect(details.failingMigration).toBe('20260816000000_route_consolidation_phase2_schema');
    expect(details.errorCode).toBe('25P02');

    const evalResult = evaluateMigrationFailure(mockOutput, [
      '20260816000000_route_consolidation_phase2_schema',
    ]);
    expect(evalResult.canResolve).toBe(true);
    expect(evalResult.reason).toBe('MATCHED_EXPECTED_GAP');
    expect(evalResult.migrationName).toBe('20260816000000_route_consolidation_phase2_schema');
  });

  it('correctly matches fleet_routing_foundation when Postgres reports public-qualified table name', () => {
    const mockOutput = `
      Applying migration \`20260818100000_fleet_routing_foundation\`
      Error: P3018
      Migration name: 20260818100000_fleet_routing_foundation
      Database error code: 42P01
      Database error:
      ERROR: relation "public.route_passengers" does not exist
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, [
      '20260818100000_fleet_routing_foundation',
    ]);
    expect(evalResult.canResolve).toBe(true);
    expect(evalResult.reason).toBe('MATCHED_EXPECTED_GAP');
    expect(evalResult.migrationName).toBe('20260818100000_fleet_routing_foundation');
    expect(evalResult.errorCode).toBe('42P01');
  });
});

describe('Database target resolution & preconditions', () => {
  it('resolves migration target prioritizing options.databaseUrl over env', () => {
    const custom = ['postgres', 'ql://usr:pwd@127.0.0.1:5432/custom_db'].join('');
    expect(resolveMigrationTarget({ databaseUrl: custom })).toBe(custom);
  });

  it('requires explicit fresh install intent (--fresh-install or CONFIRM_FRESH_INSTALL=1) when not resuming', async () => {
    await expect(
      verifyDatabasePreconditions({
        databaseUrl: 'postgresql://postgres:postgres@localhost:5432/fleet360_fresh',
        freshInstallIntent: false,
        throwOnError: true,
      })
    ).rejects.toThrow('Fresh install requires explicit confirmation');
  });

  it('fails closed when querying _prisma_migrations returns permission denied (code 42501)', async () => {
    const permError = new Error('permission denied for table _prisma_migrations');
    (permError as any).code = '42501';

    const mockPrisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ current_user: 'restricted_user', current_database: 'fleet360_prod', version: 'PostgreSQL 16' }])
        .mockResolvedValueOnce([{ acquired: true }]) // advisory lock
        .mockRejectedValueOnce(permError),
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      verifyDatabasePreconditions({
        databaseUrl: 'postgresql://restricted_user:pass@localhost:5432/fleet360_prod',
        prismaClient: mockPrisma,
        freshInstallIntent: true,
        throwOnError: true,
      })
    ).rejects.toThrow('permission denied for table _prisma_migrations');
  });

  it('rejects database if tables exist in non-public managed schemas (e.g. finance or fleet)', async () => {
    const missingTableError = new Error('relation "_prisma_migrations" does not exist');
    (missingTableError as any).code = '42P01';

    const mockPrisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ current_user: 'postgres', current_database: 'fleet360_dirty', version: 'PostgreSQL 16' }])
        .mockResolvedValueOnce([{ acquired: true }]) // advisory lock
        .mockRejectedValueOnce(missingTableError) // _prisma_migrations
        .mockResolvedValueOnce([{ table_schema: 'finance', table_name: 'invoices' }]), // tables in finance!
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      verifyDatabasePreconditions({
        databaseUrl: 'postgresql://postgres:postgres@localhost:5432/fleet360_dirty',
        prismaClient: mockPrisma,
        freshInstallIntent: true,
        throwOnError: true,
      })
    ).rejects.toThrow('Database is not empty (1 application tables found in managed schemas).');
  });

  it('rejects non-fresh database with existing migrations when resumeBootstrapFrom is not specified', async () => {
    const mockPrisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ current_user: 'postgres', current_database: 'fleet360_test', version: 'PostgreSQL 16' }])
        .mockResolvedValueOnce([{ acquired: true }]) // advisory lock
        .mockResolvedValueOnce([{ migration_name: '20260801000000_init', finished_at: new Date() }]),
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      verifyDatabasePreconditions({
        databaseUrl: 'postgresql://postgres:postgres@localhost:5432/fleet360_test',
        prismaClient: mockPrisma,
        freshInstallIntent: true,
        throwOnError: true,
      })
    ).rejects.toThrow('Database is not fresh (1 migrations found) without resume point.');
  });

  it('allows resumption when resumeBootstrapFrom matches a recorded migration', async () => {
    const resumePoint = '20260815140000_tenant_001_leasing_rental_isolation';
    const mockPrisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ current_user: 'postgres', current_database: 'fleet360_test', version: 'PostgreSQL 16' }])
        .mockResolvedValueOnce([{ acquired: true }]) // advisory lock
        .mockResolvedValueOnce([
          { migration_name: '20260801000000_init', finished_at: new Date() },
          { migration_name: resumePoint, finished_at: new Date() },
        ])
        .mockResolvedValueOnce([]), // application tables
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };

    const res = await verifyDatabasePreconditions({
      databaseUrl: 'postgresql://postgres:postgres@localhost:5432/fleet360_test',
      prismaClient: mockPrisma,
      resumeBootstrapFrom: resumePoint,
      throwOnError: true,
    });

    expect(res.migrationCount).toBe(2);
    expect(res.resumeFromMigration).toBe(resumePoint);
    expect(res.database).toBe('fleet360_test');
  });

  it('passes cleanly for a genuinely fresh empty database where _prisma_migrations does not exist and 0 app tables exist', async () => {
    const missingTableError = new Error('relation "_prisma_migrations" does not exist');
    (missingTableError as any).code = '42P01';

    const mockPrisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ current_user: 'postgres', current_database: 'fleet360_fresh', version: 'PostgreSQL 16' }])
        .mockResolvedValueOnce([{ acquired: true }]) // advisory lock
        .mockRejectedValueOnce(missingTableError) // _prisma_migrations
        .mockResolvedValueOnce([]), // 0 application tables
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };

    const res = await verifyDatabasePreconditions({
      databaseUrl: 'postgresql://postgres:postgres@localhost:5432/fleet360_fresh',
      prismaClient: mockPrisma,
      freshInstallIntent: true,
      throwOnError: true,
    });

    expect(res.migrationCount).toBe(0);
    expect(res.database).toBe('fleet360_fresh');
  });
});
