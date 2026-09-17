import { describe, it, expect, vi } from 'vitest';
import {
  evaluateMigrationFailure,
  extractFailureDetails,
  shouldHaltOnForbiddenError,
  hasExpectedGapSignature,
  verifyDatabasePreconditions,
  buildEffectiveMigrationState,
  validateResumptionState,
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

  it('catalogues all 20 documented resolve steps in DOCUMENTED_GAPS', () => {
    expect(Object.keys(DOCUMENTED_GAPS).length).toBe(20);
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

  it('correctly handles Prisma Rust schema-engine backtrace and rejects bare 25P02 aborted transaction code', () => {
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
    expect(evalResult.canResolve).toBe(false);
    expect(evalResult.reason).toBe('ABORTED_TRANSACTION_CODE_ONLY');
    expect(evalResult.migrationName).toBe('20260816000000_route_consolidation_phase2_schema');
  });

  it('allows resolution when Prisma Rust backtrace includes the authentic causal PostgreSQL code and signature', () => {
    const mockOutput = `
      Applying migration \`20260816000000_route_consolidation_phase2_schema\`
      Error: P3018
      Database error code: 42P01
      Database error:
      ERROR: relation "bus_routes" does not exist
         0: schema_core::commands::apply_migrations::Applying migration
                 with migration_name="20260816000000_route_consolidation_phase2_schema"
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, [
      '20260816000000_route_consolidation_phase2_schema',
    ]);
    expect(evalResult.canResolve).toBe(true);
    expect(evalResult.reason).toBe('MATCHED_EXPECTED_GAP');
    expect(evalResult.errorCode).toBe('42P01');
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
    expect(evalResult.migrationName).toBe('20260818100000_fleet_routing_foundation');
    expect(evalResult.errorCode).toBe('42P01');
  });

  it('correctly matches add_tenant_constraints_and_indexes when failing on work_orders', () => {
    const mockOutput = `
      Applying migration \`20260824000000_add_tenant_constraints_and_indexes\`
      Error: P3018
      Migration name: 20260824000000_add_tenant_constraints_and_indexes
      Database error code: 42P01
      Database error:
      ERROR: relation "work_orders" does not exist
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, [
      '20260824000000_add_tenant_constraints_and_indexes',
    ]);
    expect(evalResult.canResolve).toBe(true);
    expect(evalResult.reason).toBe('MATCHED_EXPECTED_GAP');
    expect(evalResult.migrationName).toBe('20260824000000_add_tenant_constraints_and_indexes');
    expect(evalResult.errorCode).toBe('42P01');
  });

  it('correctly matches add_tenant_id_to_lease_rental_children when Postgres reports unquoted column error', () => {
    const mockOutput = `
      Applying migration \`20260904000000_add_tenant_id_to_lease_rental_children\`
      Error: P3018
      Migration name: 20260904000000_add_tenant_id_to_lease_rental_children
      Database error code: 42703
      Database error:
      ERROR: column p.tenant_id does not exist
      HINT: Perhaps you meant to reference the column "c.tenant_id".
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, [
      '20260904000000_add_tenant_id_to_lease_rental_children',
    ]);
    expect(evalResult.canResolve).toBe(true);
    expect(evalResult.reason).toBe('MATCHED_EXPECTED_GAP');
    expect(evalResult.migrationName).toBe('20260904000000_add_tenant_id_to_lease_rental_children');
    expect(evalResult.errorCode).toBe('42703');
  });

  it('correctly matches resolve_finance_payments_shadow when Postgres reports verification failed on unqualified finance_payments', () => {
    const shadowMigration = '20260910000005_resolve_finance_payments_shadow';
    const mockOutput = `
      Applying migration \`${shadowMigration}\`
      Error: P3018
      Migration name: ${shadowMigration}
      Database error code: P0001
      Database error:
      ERROR: verification failed: unqualified finance_payments resolves to <NULL>
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, [shadowMigration]);
    expect(evalResult.canResolve).toBe(true);
    expect(evalResult.reason).toBe('MATCHED_EXPECTED_GAP');
    expect(evalResult.migrationName).toBe(shadowMigration);
    expect(evalResult.errorCode).toBe('P0001');
  });

  it('correctly matches finance_schema_null_escape when Postgres reports missing tenant_id column on finance table', () => {
    const financeMigration = '20260910000006_finance_schema_null_escape';
    const mockOutput = `
      Applying migration \`${financeMigration}\`
      Error: P3018
      Migration name: ${financeMigration}
      Database error code: 42703
      Database error:
      ERROR: column "tenant_id" does not exist
      DbError { severity: "ERROR", parsed_severity: Some(Error), code: SqlState(E42703), message: "column \\"tenant_id\\" does not exist", detail: None, hint: None, position: Some(Internal { position: 59, query: "SELECT count(*) FROM finance.finance_vat_audit_logs WHERE tenant_id IS NULL" }) }
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, [financeMigration]);
    expect(evalResult.canResolve).toBe(true);
    expect(evalResult.reason).toBe('MATCHED_EXPECTED_GAP');
    expect(evalResult.migrationName).toBe(financeMigration);
    expect(evalResult.errorCode).toBe('42703');
  });

  it('correctly matches auth_security_tables_and_rls when Postgres reports missing token_hash column on tenant_invitations', () => {
    const authMigration = '20260910000024_auth_security_tables_and_rls';
    const mockOutput = `
      Applying migration \`${authMigration}\`
      Error: P3018
      Migration name: ${authMigration}
      Database error code: 42703
      Database error:
      ERROR: column "token_hash" does not exist
      DbError { severity: "ERROR", parsed_severity: Some(Error), code: SqlState(E42703), message: "column \\"token_hash\\" does not exist", detail: None, hint: None, position: None, where_: None, schema: None, table: None, column: None, datatype: None, constraint: None, file: Some("indexcmds.c"), line: Some(1907), routine: Some("ComputeIndexAttrs") }
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, [authMigration]);
    expect(evalResult.canResolve).toBe(true);
    expect(evalResult.reason).toBe('MATCHED_EXPECTED_GAP');
    expect(evalResult.migrationName).toBe(authMigration);
    expect(evalResult.errorCode).toBe('42703');
  });
  it('rejects resolution when failure message looks expected but PostgreSQL error code is missing', () => {
    const mockOutput = `
      Applying migration \`20260815140000_tenant_001_leasing_rental_isolation\`
      Error: P3018: A migration failed to apply.
      Migration name: 20260815140000_tenant_001_leasing_rental_isolation
      Database error: ERROR: relation "rental_rate_quotes" does not exist
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, [
      '20260815140000_tenant_001_leasing_rental_isolation',
    ]);
    expect(evalResult.canResolve).toBe(false);
    expect(evalResult.reason).toBe('MISSING_ERROR_CODE');
  });

  it('rejects resolution when output contains conflicting/ambiguous migration names', () => {
    const mockOutput = `
      Applying migration \`20260815140000_tenant_001_leasing_rental_isolation\`
      with migration_name="20260815140000_tenant_001_leasing_rental_isolation"
      with migration_name="20260816000000_route_consolidation_phase2_schema"
      Database error code: 42P01
      Database error: ERROR: relation "rental_rate_quotes" does not exist
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, [
      '20260815140000_tenant_001_leasing_rental_isolation',
    ]);
    expect(evalResult.canResolve).toBe(false);
    expect(evalResult.reason).toBe('AMBIGUOUS_MIGRATION_NAMES');
    expect(evalResult.conflictingNames).toEqual(
      expect.arrayContaining([
        '20260815140000_tenant_001_leasing_rental_isolation',
        '20260816000000_route_consolidation_phase2_schema',
      ])
    );
  });

  it('rejects auth_security_tables_and_rls when Postgres reports an unrelated table already exists', () => {
    const authMigration = '20260910000024_auth_security_tables_and_rls';
    const mockOutput = `
      Applying migration \`${authMigration}\`
      Error: P3018
      Migration name: ${authMigration}
      Database error code: 42P07
      Database error:
      ERROR: relation "unrelated_legacy_table" already exists
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, [authMigration]);
    expect(evalResult.canResolve).toBe(false);
    expect(evalResult.reason).toBe('UNEXPECTED_ERROR_SIGNATURE');
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

  it('rejects database if objects exist in non-public managed schemas (e.g. finance or fleet)', async () => {
    const missingTableError = new Error('relation "_prisma_migrations" does not exist');
    (missingTableError as any).code = '42P01';

    const mockPrisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ current_user: 'postgres', current_database: 'fleet360_dirty', version: 'PostgreSQL 16' }])
        .mockResolvedValueOnce([{ acquired: true }]) // advisory lock
        .mockRejectedValueOnce(missingTableError) // _prisma_migrations
        .mockResolvedValueOnce([{ table_schema: 'finance', table_name: 'invoices', table_type: 'BASE TABLE' }]) // tables
        .mockResolvedValueOnce([]) // matviews
        .mockResolvedValueOnce([]) // sequences
        .mockResolvedValueOnce([]) // routines
        .mockResolvedValueOnce([]), // types
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      verifyDatabasePreconditions({
        databaseUrl: 'postgresql://postgres:postgres@localhost:5432/fleet360_dirty',
        prismaClient: mockPrisma,
        freshInstallIntent: true,
        throwOnError: true,
      })
    ).rejects.toThrow('Database is not empty (1 application objects found in managed schemas).');
  });

  it('rejects non-fresh database with existing migrations when resumeBootstrapFrom is not specified', async () => {
    const mockPrisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ current_user: 'postgres', current_database: 'fleet360_test', version: 'PostgreSQL 16' }])
        .mockResolvedValueOnce([{ acquired: true }]) // advisory lock
        .mockResolvedValueOnce([{ migration_name: '20251207091545_init', finished_at: new Date() }]),
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

  it('allows resumption when resumeBootstrapFrom matches a verified recorded migration prefix', async () => {
    const resumePoint = '20251207132928_add_data_masters';
    const mockPrisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ current_user: 'postgres', current_database: 'fleet360_test', version: 'PostgreSQL 16' }])
        .mockResolvedValueOnce([{ acquired: true }]) // advisory lock
        .mockResolvedValueOnce([
          { migration_name: '20251207091545_init', finished_at: new Date() },
          { migration_name: resumePoint, finished_at: new Date() },
        ])
        .mockResolvedValueOnce([]) // tables
        .mockResolvedValueOnce([]) // matviews
        .mockResolvedValueOnce([]) // sequences
        .mockResolvedValueOnce([]) // routines
        .mockResolvedValueOnce([]), // types
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

  it('passes cleanly for a genuinely fresh empty database where _prisma_migrations does not exist and 0 app objects exist', async () => {
    const missingTableError = new Error('relation "_prisma_migrations" does not exist');
    (missingTableError as any).code = '42P01';

    const mockPrisma = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ current_user: 'postgres', current_database: 'fleet360_fresh', version: 'PostgreSQL 16' }])
        .mockResolvedValueOnce([{ acquired: true }]) // advisory lock
        .mockRejectedValueOnce(missingTableError) // _prisma_migrations
        .mockResolvedValueOnce([]) // tables
        .mockResolvedValueOnce([]) // matviews
        .mockResolvedValueOnce([]) // sequences
        .mockResolvedValueOnce([]) // routines
        .mockResolvedValueOnce([]), // types
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

describe('Resumption state machine & effective migration history', () => {
  it('correctly builds effective migration state accounting for resolved retries', () => {
    const attempts = [
      { migration_name: 'mig_01', started_at: new Date('2026-01-01T00:00:00Z'), finished_at: new Date('2026-01-01T00:00:01Z'), rolled_back_at: null, checksum: 'chk1' },
      { migration_name: 'mig_02', started_at: new Date('2026-01-01T00:00:02Z'), finished_at: null, rolled_back_at: null, checksum: 'chk2' }, // failed first
      { migration_name: 'mig_02', started_at: new Date('2026-01-01T00:00:03Z'), finished_at: new Date('2026-01-01T00:00:04Z'), rolled_back_at: null, checksum: 'chk2' }, // resolved!
      { migration_name: 'mig_03', started_at: new Date('2026-01-01T00:00:05Z'), finished_at: null, rolled_back_at: null, checksum: 'chk3' }, // currently unresolved
    ];

    const state = buildEffectiveMigrationState(attempts);
    expect(state.completedMigrations.map(m => m.migrationName)).toEqual(['mig_01', 'mig_02']);
    expect(state.unresolvedMigrations.map(m => m.migrationName)).toEqual(['mig_03']);
  });

  it('rejects resumption when resume point is not the immediate failed migration', () => {
    const attempts = [
      { migration_name: '20251207091545_init', started_at: new Date(), finished_at: new Date(), rolled_back_at: null },
      { migration_name: '20251207132928_add_data_masters', started_at: new Date(), finished_at: null, rolled_back_at: null }, // failed!
    ];

    // Trying to resume from '20251207091545_init' while '20251207132928_add_data_masters' is unresolved
    expect(() => validateResumptionState(attempts, '20251207091545_init')).toThrow(
      'Invalid resume point "20251207091545_init". Database has an active unresolved migration attempt for "20251207132928_add_data_masters"'
    );
  });

  it('rejects resumption when multiple unresolved migrations exist (ambiguous state)', () => {
    const attempts = [
      { migration_name: '20251207091545_init', started_at: new Date('2026-01-01T00:00:00Z'), finished_at: null, rolled_back_at: null },
      { migration_name: '20251207132928_add_data_masters', started_at: new Date('2026-01-01T00:00:01Z'), finished_at: null, rolled_back_at: null },
    ];

    expect(() => validateResumptionState(attempts, '20251207132928_add_data_masters')).toThrow(
      'Ambiguous database state: found 2 unresolved migration attempts'
    );
  });
});

