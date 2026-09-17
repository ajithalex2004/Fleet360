import { describe, it, expect, vi } from 'vitest';
import {
  POSTFLIGHT_MANIFEST,
  MANAGED_SCHEMAS,
  RUNTIME_ROLE,
  verifyRolePrivileges,
  verifySchemaIntegrity,
  verifyDeterministicDualTenantRls,
} from '../../scripts/verify-fresh-install-postflight.cjs';

describe('Post-flight verification manifest and privilege audits', () => {
  it('contains exactly 20 verified steps in POSTFLIGHT_MANIFEST matching DOCUMENTED_GAPS', () => {
    expect(POSTFLIGHT_MANIFEST.length).toBe(20);
    for (let i = 0; i < 20; i++) {
      expect(POSTFLIGHT_MANIFEST[i].step).toBe(i + 1);
      expect(POSTFLIGHT_MANIFEST[i].migration).toBeTruthy();
      expect(typeof POSTFLIGHT_MANIFEST[i].check).toBe('function');
    }
  });

  it('covers all 7 managed schemas', () => {
    expect(MANAGED_SCHEMAS).toEqual([
      'public',
      'finance',
      'ai',
      'workforce',
      'fleet',
      'operations',
      'spatial',
    ]);
  });

  it('verifies Step 12 checks finance_payments object identity, absence of public shadow, and RLS', async () => {
    const step12 = POSTFLIGHT_MANIFEST.find((s: any) => s.step === 12)!;
    expect(step12).toBeTruthy();
    expect(step12.migration).toBe('20260910000005_resolve_finance_payments_shadow');

    // Case A: Unqualified OID resolves to a different relation than finance.finance_payments
    const mockMismatchedOids = {
      $queryRaw: vi.fn().mockResolvedValueOnce([
        { unqual_oid: 11111, fin_oid: 22222, pub_oid: null },
      ]),
    };
    await expect(step12.check(mockMismatchedOids as any)).rejects.toThrow(
      'Unqualified finance_payments (OID 11111) resolves to a different relation than finance.finance_payments (OID 22222)'
    );

    // Case B: Shadow public.finance_payments still exists
    const mockShadowExists = {
      $queryRaw: vi.fn().mockResolvedValueOnce([
        { unqual_oid: 22222, fin_oid: 22222, pub_oid: 33333 },
      ]),
    };
    await expect(step12.check(mockShadowExists as any)).rejects.toThrow(
      'Shadow relation "public.finance_payments" still exists'
    );

    // Case C: Success when OIDs match, public shadow is null, and RLS enabled
    const mockSuccess = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ unqual_oid: 22222, fin_oid: 22222, pub_oid: null }])
        .mockResolvedValueOnce([{ relrowsecurity: true }]),
    };
    await expect(step12.check(mockSuccess as any)).resolves.toBeUndefined();
  });

  it('verifies Step 3 asserts latest_pickup and required_arrival_time (not latest_dropoff)', async () => {
    const step3 = POSTFLIGHT_MANIFEST.find((s: any) => s.step === 3)!;
    expect(step3).toBeTruthy();

    const mockPrisma = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ 1: 1 }]) // bus_routes exists
        .mockResolvedValueOnce([
          { column_name: 'latest_pickup' },
          { column_name: 'required_arrival_time' },
        ]),
    };
    await expect(step3.check(mockPrisma as any)).resolves.toBeUndefined();
  });

  it('verifies Step 8 validates partial unique index on (tenant_id, agreement_no) with predicate', async () => {
    const step8 = POSTFLIGHT_MANIFEST.find((s: any) => s.step === 8)!;
    expect(step8).toBeTruthy();

    const mockPrisma = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ 1: 1 }]) // rental_agreements exists
        .mockResolvedValueOnce([{ 1: 1 }]) // agreement_no exists
        .mockResolvedValueOnce([
          {
            indexname: 'uniq_rental_agreements_tenant_agreement_no',
            indexdef: 'CREATE UNIQUE INDEX uniq_rental_agreements_tenant_agreement_no ON public.rental_agreements USING btree (tenant_id, agreement_no) WHERE (agreement_no IS NOT NULL)',
          },
        ]),
    };
    await expect(step8.check(mockPrisma as any)).resolves.toBeUndefined();
  });

  it('rejects runtime role if rolsuper is true', async () => {
    const mockPrisma = {
      $queryRaw: vi.fn().mockResolvedValueOnce([
        {
          rolname: RUNTIME_ROLE,
          rolsuper: true,
          rolbypassrls: false,
          rolcanlogin: true,
        },
      ]),
    };

    await expect(verifyRolePrivileges(mockPrisma as any, RUNTIME_ROLE)).rejects.toThrow(
      'CRITICAL SECURITY FAILURE: Runtime role "fleet360_app" has rolsuper=true'
    );
  });

  it('rejects runtime role if rolbypassrls is true', async () => {
    const mockPrisma = {
      $queryRaw: vi.fn().mockResolvedValueOnce([
        {
          rolname: RUNTIME_ROLE,
          rolsuper: false,
          rolbypassrls: true,
          rolcanlogin: true,
        },
      ]),
    };

    await expect(verifyRolePrivileges(mockPrisma as any, RUNTIME_ROLE)).rejects.toThrow(
      'CRITICAL SECURITY FAILURE: Runtime role "fleet360_app" has rolbypassrls=true'
    );
  });

  it('rejects runtime role if rolcanlogin is false', async () => {
    const mockPrisma = {
      $queryRaw: vi.fn().mockResolvedValueOnce([
        {
          rolname: RUNTIME_ROLE,
          rolsuper: false,
          rolbypassrls: false,
          rolcanlogin: false,
        },
      ]),
    };

    await expect(verifyRolePrivileges(mockPrisma as any, RUNTIME_ROLE)).rejects.toThrow(
      'Runtime role "fleet360_app" cannot log in'
    );
  });

  it('rejects runtime role if it inherits superuser or bypassrls through recursive role hierarchy', async () => {
    const mockPrisma = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([
          {
            rolname: RUNTIME_ROLE,
            rolsuper: false,
            rolbypassrls: false,
            rolcanlogin: true,
          },
        ]) // pg_roles query
        .mockResolvedValueOnce([
          { rolname: 'parent_role', rolsuper: false, rolbypassrls: false },
          { rolname: 'grandparent_admin', rolsuper: true, rolbypassrls: false },
        ]), // recursive role tree query
    };

    await expect(verifyRolePrivileges(mockPrisma as any, RUNTIME_ROLE)).rejects.toThrow(
      'SECURITY VIOLATION: Runtime role "fleet360_app" inherits superuser via role "grandparent_admin"'
    );
  });

  it('rejects runtime role if it owns database objects (tables, schemas, functions)', async () => {
    const mockPrisma = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([
          {
            rolname: RUNTIME_ROLE,
            rolsuper: false,
            rolbypassrls: false,
            rolcanlogin: true,
          },
        ]) // pg_roles query
        .mockResolvedValueOnce([]) // recursive role tree (clean)
        .mockResolvedValueOnce([
          { object_type: 'relation', name: 'custom_app_table', schema: 'public' },
        ]), // owned objects query
    };

    await expect(verifyRolePrivileges(mockPrisma as any, RUNTIME_ROLE)).rejects.toThrow(
      'SECURITY VIOLATION: Runtime role "fleet360_app" owns 1 database object(s)'
    );
  });

  it('rejects runtime role if it holds CREATE privilege on any schema', async () => {
    const mockPrisma = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([
          {
            rolname: RUNTIME_ROLE,
            rolsuper: false,
            rolbypassrls: false,
            rolcanlogin: true,
          },
        ]) // pg_roles
        .mockResolvedValueOnce([]) // recursive role tree
        .mockResolvedValueOnce([]) // 0 owned objects
        .mockResolvedValueOnce([{ ok: true }]) // USAGE public
        .mockResolvedValueOnce([{ ok: true }]) // USAGE finance
        .mockResolvedValueOnce([{ ok: true }]) // USAGE ai
        .mockResolvedValueOnce([{ ok: true }]) // USAGE workforce
        .mockResolvedValueOnce([{ ok: true }]) // USAGE fleet
        .mockResolvedValueOnce([{ ok: true }]) // USAGE operations
        .mockResolvedValueOnce([{ ok: true }]) // USAGE spatial
        .mockResolvedValueOnce([{ schema_name: 'public' }]), // CREATE on public!
    };

    await expect(verifyRolePrivileges(mockPrisma as any, RUNTIME_ROLE)).rejects.toThrow(
      'SECURITY VIOLATION: Runtime role "fleet360_app" has CREATE privilege on schema(s): public'
    );
  });

  it('rejects runtime role if it holds write or TRUNCATE privileges on _prisma_migrations', async () => {
    const mockPrisma = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([
          {
            rolname: RUNTIME_ROLE,
            rolsuper: false,
            rolbypassrls: false,
            rolcanlogin: true,
          },
        ]) // pg_roles
        .mockResolvedValueOnce([]) // recursive role tree
        .mockResolvedValueOnce([]) // 0 owned objects
        .mockResolvedValueOnce([{ ok: true }]) // USAGE public
        .mockResolvedValueOnce([{ ok: true }]) // USAGE finance
        .mockResolvedValueOnce([{ ok: true }]) // USAGE ai
        .mockResolvedValueOnce([{ ok: true }]) // USAGE workforce
        .mockResolvedValueOnce([{ ok: true }]) // USAGE fleet
        .mockResolvedValueOnce([{ ok: true }]) // USAGE operations
        .mockResolvedValueOnce([{ ok: true }]) // USAGE spatial
        .mockResolvedValueOnce([]) // 0 CREATE privileges
        .mockResolvedValueOnce([{ i: false, u: false, d: false, t: true }]), // TRUNCATE on _prisma_migrations!
    };

    await expect(verifyRolePrivileges(mockPrisma as any, RUNTIME_ROLE)).rejects.toThrow(
      'SECURITY VIOLATION: Runtime role "fleet360_app" has write or truncate privileges on _prisma_migrations table'
    );
  });

  it('rejects dual-tenant verification if BOOTSTRAP_RUNTIME_DATABASE_URL is missing', async () => {
    const savedEnv = process.env.BOOTSTRAP_RUNTIME_DATABASE_URL;
    delete process.env.BOOTSTRAP_RUNTIME_DATABASE_URL;

    try {
      await expect(verifyDeterministicDualTenantRls({})).rejects.toThrow(
        'BOOTSTRAP_RUNTIME_DATABASE_URL is required for post-flight runtime role verification. Refusing to fall back to owner credentials.'
      );
    } finally {
      if (savedEnv) process.env.BOOTSTRAP_RUNTIME_DATABASE_URL = savedEnv;
    }
  });

  it('executes multi-domain probe transaction and requires sentinel rollback', async () => {
    let tenantContext = '';
    const mockTx = {
      $queryRawUnsafe: vi.fn().mockImplementation(async (sql: string, ...args: any[]) => {
        if (sql.includes('current_user')) {
          return [
            {
              current_user: RUNTIME_ROLE,
              session_user: 'postgres',
              current_database: 'fleet360_ci',
              search_path: '"$user", public, finance, ai',
              bypassrls: false,
            },
          ];
        }
        if (sql.includes('FROM audit_logs')) {
          return [{ action: args[0], tenant_id: tenantContext }];
        }
        if (sql.includes('FROM rental_rate_quotes')) {
          if (!tenantContext) return [];
          const id = tenantContext === '00000000-0000-0000-0000-000000000001' ? args[0] : args[1];
          return [{ id, tenant_id: tenantContext }];
        }
        if (sql.includes('FROM finance.finance_payments')) {
          return [{ id: 'fin-1', tenant_id: tenantContext, amount: 500 }];
        }
        return [];
      }),
      $executeRawUnsafe: vi.fn().mockImplementation(async (sql: string, ...args: any[]) => {
        if (sql.includes('set_config')) {
          tenantContext = args[0] || '';
        }
        return 0;
      }),
    };

    const mockRuntimePrisma = {
      $transaction: vi.fn().mockImplementation(async (callback) => {
        await callback(mockTx);
      }),
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };

    const mockAdminPrisma = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ cnt: 0 }]) // 0 leftover audit logs
        .mockResolvedValueOnce([{ cnt: 0 }]), // 0 leftover quotes
    };

    await expect(
      verifyDeterministicDualTenantRls({
        runtimePrismaClient: mockRuntimePrisma,
        adminPrismaClient: mockAdminPrisma,
      })
    ).resolves.toBeUndefined();

    expect(mockRuntimePrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockAdminPrisma.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
