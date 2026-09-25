import { describe, expect, it } from 'vitest';
import { activeRlsScope, backgroundTenantId, runWithRlsScope, runWithTenantContext } from '@/lib/rls-scope';

describe('request-local RLS scopes', () => {
  it('does not expose a tenant scope outside its callback', async () => {
    expect(activeRlsScope()).toBeUndefined();
    await runWithRlsScope({ tenantId: 'tenant-a', mode: 'tenant' }, async () => {
      expect(activeRlsScope()).toEqual({ tenantId: 'tenant-a', mode: 'tenant' });
    });
    expect(activeRlsScope()).toBeUndefined();
  });

  it('keeps concurrent tenant scopes isolated', async () => {
    const seen = await Promise.all([
      runWithRlsScope({ tenantId: 'tenant-a', mode: 'tenant' }, async () => {
        await Promise.resolve();
        return activeRlsScope()?.tenantId;
      }),
      runWithRlsScope({ tenantId: 'tenant-b', mode: 'tenant' }, async () => {
        await Promise.resolve();
        return activeRlsScope()?.tenantId;
      }),
    ]);
    expect(seen).toEqual(['tenant-a', 'tenant-b']);
  });
});

describe('background tenant context (runWithTenantContext)', () => {
  it('exposes the tenant only inside its callback', async () => {
    expect(backgroundTenantId()).toBeUndefined();
    await runWithTenantContext('tenant-a', async () => {
      await Promise.resolve();
      expect(backgroundTenantId()).toBe('tenant-a');
    });
    expect(backgroundTenantId()).toBeUndefined();
  });

  it('keeps concurrent background tenants isolated', async () => {
    const seen = await Promise.all(['tenant-a', 'tenant-b'].map((t) =>
      runWithTenantContext(t, async () => {
        await new Promise((r) => setTimeout(r, 1));
        return backgroundTenantId();
      }),
    ));
    expect(seen).toEqual(['tenant-a', 'tenant-b']);
  });

  it('refuses a malformed tenant id', async () => {
    await expect(runWithTenantContext("a'; DROP TABLE x;--", async () => 1)).rejects.toThrow(/invalid tenantId/);
  });
});
