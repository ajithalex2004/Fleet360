import { describe, expect, it } from 'vitest';
import { activeRlsScope, runWithRlsScope } from '@/lib/rls-scope';

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
