import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rls', () => ({ withPlatformAdmin: vi.fn() }));

const { matchDriverProfileForUser } = await import('@/lib/drivers/driver-login-user');

type Client = Parameters<typeof matchDriverProfileForUser>[0];
const db = (rows: Array<{ id: string; user_id?: string | null }>) => {
  const query = vi.fn(async (sql: string, ...params: unknown[]) => {
    void sql;
    void params;
    return rows.map((r) => ({ user_id: null, ...r }));
  });
  return { client: { $queryRawUnsafe: query } as unknown as Client, query };
};

describe('which driver profile a login may act as', () => {
  it('a non-driver account never acts as a driver: no lookup at all, whatever its details match', async () => {
    const d = db([{ id: 'drv-1', user_id: 'u1' }]);
    const matched = await matchDriverProfileForUser(d.client, 't', { id: 'u1', userType: 'ADMIN', email: 'a@x.ae', employeeId: 'E1' });
    expect(matched).toBeNull();
    expect(d.query).not.toHaveBeenCalled();
  });

  it('a driver account may also match by the same id, exact email or employee id', async () => {
    const d = db([]);
    await matchDriverProfileForUser(d.client, 't', { id: 'u1', userType: 'DRIVER', email: 'd@x.ae', employeeId: 'E1' });
    const [sql, ...params] = d.query.mock.calls[0];
    expect(params).toEqual(['t', 'u1', 'd@x.ae', 'E1']);
    expect(sql).toMatch(/tenant_id = \$1/);
    expect(sql).not.toMatch(/username|first_name|SPLIT_PART|license_number/);
  });

  it('the linked or same-id profile wins; otherwise two matches mean no match', async () => {
    expect(await matchDriverProfileForUser(db([{ id: 'drv-1', user_id: 'u1' }, { id: 'drv-2' }]).client, 't', { id: 'u1', userType: 'DRIVER' })).toBe('drv-1');
    expect(await matchDriverProfileForUser(db([{ id: 'u1' }, { id: 'drv-2' }]).client, 't', { id: 'u1', userType: 'DRIVER' })).toBe('u1');
    expect(await matchDriverProfileForUser(db([{ id: 'drv-2' }]).client, 't', { id: 'u1', userType: 'DRIVER', email: 'd@x.ae' })).toBe('drv-2');
    expect(await matchDriverProfileForUser(db([{ id: 'drv-2' }, { id: 'drv-3' }]).client, 't', { id: 'u1', userType: 'DRIVER', email: 'd@x.ae' })).toBeNull();
  });
});
