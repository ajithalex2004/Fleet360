import { describe, expect, it } from 'vitest';
import { canonicalRoleCode, canonicalRoleLabel } from '@/lib/role-canonicalization';

describe('role canonicalization', () => {
  it('maps tenant admin aliases to the canonical role code and label', () => {
    expect(canonicalRoleCode({ code: 'TENANT_ADMIN', name: 'Tenant Admin' })).toBe('TENANT_ADMIN');
    expect(canonicalRoleCode({ code: 'Tenant_Admin' })).toBe('TENANT_ADMIN');
    expect(canonicalRoleLabel('TENANT_ADMIN', 'Tenant Admin')).toBe('Tenant Administrator');
  });

  it('maps super admin aliases to the canonical role code and label', () => {
    expect(canonicalRoleCode({ code: 'SUPER_ADMIN', name: 'Super Admin' })).toBe('SUPER_ADMIN');
    expect(canonicalRoleLabel('SUPER_ADMIN', 'Super Admin')).toBe('Super Administrator');
  });
});

