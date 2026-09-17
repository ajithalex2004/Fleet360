import { describe, it, expect, vi } from 'vitest';
import {
  POSTFLIGHT_MANIFEST,
  MANAGED_SCHEMAS,
  RUNTIME_ROLE,
  verifyRolePrivileges,
  verifySchemaIntegrity,
} from '../../scripts/verify-fresh-install-postflight.cjs';

describe('Post-flight verification manifest and privilege audits', () => {
  it('contains exactly 19 verified steps in POSTFLIGHT_MANIFEST', () => {
    expect(POSTFLIGHT_MANIFEST.length).toBe(19);
    for (let i = 0; i < 19; i++) {
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

  it('rejects runtime role if member of forbidden group (superuser / write_server_files)', async () => {
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
        .mockResolvedValueOnce([{ group_name: 'pg_write_server_files' }]), // pg_auth_members query
    };

    await expect(verifyRolePrivileges(mockPrisma as any, RUNTIME_ROLE)).rejects.toThrow(
      'Runtime role "fleet360_app" is member of forbidden privileged group "pg_write_server_files"'
    );
  });

  it('rejects runtime role if it lacks USAGE on any managed schema', async () => {
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
        .mockResolvedValueOnce([]) // memberships
        .mockResolvedValueOnce([{ ok: true }]) // public USAGE
        .mockResolvedValueOnce([{ ok: false }]), // finance USAGE missing!
    };

    await expect(verifyRolePrivileges(mockPrisma as any, RUNTIME_ROLE)).rejects.toThrow(
      'Runtime role "fleet360_app" lacks USAGE privilege on schema "finance"'
    );
  });

  it('rejects runtime role if it holds write permissions on _prisma_migrations', async () => {
    let call = 0;
    const mockPrisma = {
      $queryRaw: vi.fn().mockImplementation(async () => {
        call++;
        if (call === 1) {
          return [
            {
              rolname: RUNTIME_ROLE,
              rolsuper: false,
              rolbypassrls: false,
              rolcanlogin: true,
            },
          ]; // pg_roles
        }
        if (call === 2) {
          return []; // memberships
        }
        if (call >= 3 && call <= 9) {
          return [{ ok: true }]; // 7 managed schemas USAGE
        }
        if (call === 10) {
          return [{ i: true, u: false, d: false }]; // write on _prisma_migrations!
        }
        return [];
      }),
    };

    await expect(verifyRolePrivileges(mockPrisma as any, RUNTIME_ROLE)).rejects.toThrow(
      'SECURITY VIOLATION: Runtime role "fleet360_app" has write privileges on _prisma_migrations table'
    );
  });
});
