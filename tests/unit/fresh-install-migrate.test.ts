import { describe, it, expect } from 'vitest';

// Test the exact pattern matching and safety guards from scripts/fresh-install-migrate.cjs
const FORBIDDEN_ERROR_PATTERNS = [
  /permission denied/i,
  /must be owner of/i,
  /password authentication failed/i,
  /connection refused/i,
  /ECONNREFUSED/i,
  /P1000/i,
  /P1001/i,
  /P1002/i,
  /P1003/i,
  /FATAL:/i,
];

const EXPECTED_GAP_SIGNATURES = [
  /relation ".*" does not exist/i,
  /column ".*" does not exist/i,
  /table ".*" does not exist/i,
  /type ".*" already exists/i,
  /relation ".*" already exists/i,
  /table ".*" already exists/i,
  /cannot use .* in column generation expression/i,
  /generation expression is not immutable/i,
  /cannot drop .* because other objects depend on it/i,
  /P3006/i,
  /P3018/i,
];

function shouldHaltOnForbiddenError(output: string): boolean {
  return FORBIDDEN_ERROR_PATTERNS.some(forbidden => forbidden.test(output));
}

function hasExpectedGapSignature(output: string): boolean {
  return EXPECTED_GAP_SIGNATURES.some(sig => sig.test(output));
}

function evaluateMigrationFailure(output: string, migrationName: string): { canResolve: boolean; reason: string } {
  if (shouldHaltOnForbiddenError(output)) {
    return { canResolve: false, reason: 'FORBIDDEN_INFRASTRUCTURE_ERROR' };
  }
  if (!output.includes(migrationName)) {
    return { canResolve: false, reason: 'UNKNOWN_MIGRATION' };
  }
  if (!hasExpectedGapSignature(output)) {
    return { canResolve: false, reason: 'UNEXPECTED_ERROR_SIGNATURE' };
  }
  return { canResolve: true, reason: 'MATCHED_EXPECTED_GAP' };
}

describe('Fresh database migration runner safety guards', () => {
  const targetMigration = '20260815140000_tenant_001_leasing_rental_isolation';

  it('rejects resolution and halts when permission denied occurs', () => {
    const mockOutput = `
      Applying migration ${targetMigration}
      Database error: ERROR: permission denied for schema public
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, targetMigration);
    expect(evalResult.canResolve).toBe(false);
    expect(evalResult.reason).toBe('FORBIDDEN_INFRASTRUCTURE_ERROR');
  });

  it('rejects resolution and halts on authentication failure (P1000)', () => {
    const mockOutput = `
      Applying migration ${targetMigration}
      PrismaClientKnownRequestError: Authentication failed against database server (P1000)
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, targetMigration);
    expect(evalResult.canResolve).toBe(false);
    expect(evalResult.reason).toBe('FORBIDDEN_INFRASTRUCTURE_ERROR');
  });

  it('rejects resolution and halts on connection refused (ECONNREFUSED)', () => {
    const mockOutput = `
      Applying migration ${targetMigration}
      connect ECONNREFUSED 127.0.0.1:5432
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, targetMigration);
    expect(evalResult.canResolve).toBe(false);
    expect(evalResult.reason).toBe('FORBIDDEN_INFRASTRUCTURE_ERROR');
  });

  it('rejects resolution when error signature is unexpected (e.g. disk full or syntax error)', () => {
    const mockOutput = `
      Applying migration ${targetMigration}
      Database error: ERROR: could not write to file "base/pgsql_tmp": No space left on device
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, targetMigration);
    expect(evalResult.canResolve).toBe(false);
    expect(evalResult.reason).toBe('UNEXPECTED_ERROR_SIGNATURE');
  });

  it('allows resolution only when BOTH known migration name and expected schema gap signature match', () => {
    const mockOutput = `
      Applying migration ${targetMigration}
      Database error: ERROR: relation "rental_rate_quotes" does not exist (P3006)
    `;
    const evalResult = evaluateMigrationFailure(mockOutput, targetMigration);
    expect(evalResult.canResolve).toBe(true);
    expect(evalResult.reason).toBe('MATCHED_EXPECTED_GAP');
  });
});
