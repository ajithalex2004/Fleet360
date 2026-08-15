/**
 * Unit tests for TENANT-001 identity helpers in src/lib/tenant-context.ts.
 *
 * No database required. Proves:
 *   - fail-closed when tenant context is missing
 *   - session-derived tenant is accepted
 *   - non-SUPER_ADMIN cannot switch tenant via request header/query
 *   - body ownership fields are stripped
 */

import { describe, it, expect } from 'vitest';
import {
  resolveAuthorizedTenant,
  requireAuthorizedTenant,
  stripTenantOwnershipFields,
} from '@/lib/tenant-context';

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe('resolveAuthorizedTenant', () => {
  it('fails closed with 401 when no identity headers', () => {
    const result = resolveAuthorizedTenant({ headers: headers({}) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it('fails closed with 403 when user present but tenant missing', () => {
    const result = resolveAuthorizedTenant({
      headers: headers({ 'x-user-id': 'user-1' }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it('accepts session-derived x-tenant-id from middleware', () => {
    const result = resolveAuthorizedTenant({
      headers: headers({
        'x-tenant-id': 'tenant-a',
        'x-user-id': 'user-1',
        'x-user-role': 'TENANT_ADMIN',
      }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tenantId).toBe('tenant-a');
      expect(result.userId).toBe('user-1');
    }
  });

  it('rejects tenant switch for non-SUPER_ADMIN', () => {
    const result = resolveAuthorizedTenant(
      {
        headers: headers({
          'x-tenant-id': 'tenant-a',
          'x-user-id': 'user-1',
          'x-user-role': 'TENANT_ADMIN',
          'x-requested-tenant-id': 'tenant-b',
        }),
      },
      { allowPlatformSwitch: true },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it('allows SUPER_ADMIN switch when allowPlatformSwitch is true', () => {
    const result = resolveAuthorizedTenant(
      {
        headers: headers({
          'x-tenant-id': 'tenant-a',
          'x-user-id': 'admin-1',
          'x-user-role': 'SUPER_ADMIN',
          'x-requested-tenant-id': 'tenant-b',
        }),
      },
      { allowPlatformSwitch: true },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tenantId).toBe('tenant-b');
  });

  it('sanitizes tenant id characters', () => {
    const result = resolveAuthorizedTenant({
      headers: headers({
        'x-tenant-id': 'tenant-a; DROP TABLE',
        'x-user-id': 'u1',
      }),
    });
    // sanitize should strip unsafe chars; exact shape depends on sanitizeTenantId
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tenantId).not.toMatch(/[; ]/);
    }
  });
});

describe('requireAuthorizedTenant', () => {
  it('is an alias for the sync resolver', () => {
    const result = requireAuthorizedTenant({
      headers: headers({ 'x-tenant-id': 't1', 'x-user-id': 'u1' }),
    });
    expect(result.ok).toBe(true);
  });
});

describe('stripTenantOwnershipFields', () => {
  it('removes tenantId and tenant_id from body', () => {
    const cleaned = stripTenantOwnershipFields({
      tenantId: 'evil-tenant',
      tenant_id: 'evil-tenant',
      lesseeId: 'L1',
      notes: 'ok',
    });
    expect(cleaned).toEqual({ lesseeId: 'L1', notes: 'ok' });
    expect('tenantId' in cleaned).toBe(false);
    expect('tenant_id' in cleaned).toBe(false);
  });

  it('does not mutate the original object', () => {
    const raw = { tenantId: 'x', name: 'y' };
    const cleaned = stripTenantOwnershipFields(raw);
    expect(raw.tenantId).toBe('x');
    expect(cleaned).toEqual({ name: 'y' });
  });
});
