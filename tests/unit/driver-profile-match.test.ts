import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rls', () => ({ withPlatformAdmin: vi.fn() }));

const { matchDriverProfileForUser } = await import('@/lib/drivers/driver-login-user');

type Client = Parameters<typeof matchDriverProfileForUser>[0];
const db = (rows: Array<{ id: string }>) => {
  const query = vi.fn(async () => rows);
  return { client: { $queryRawUnsafe: query } as unknown as Client, query };
};

describe('which driver profile a login may act as', () => {
  it('none for an account that is not DRIVER-type', async () => {
    const d = db([{ id: 'drv-1' }]);
    expect(await matchDriverProfileForUser(d.client, 't', { id: 'u1', userType: 'ADMIN', email: 'a@x.ae' })).toBeNull();
    expect(d.query).not.toHaveBeenCalled();
  });

  it('the profile with the same id, else a single email / employee-id match', async () => {
    expect(await matchDriverProfileForUser(db([{ id: 'u1' }, { id: 'drv-2' }]).client, 't', { id: 'u1', userType: 'DRIVER' })).toBe('u1');
    expect(await matchDriverProfileForUser(db([{ id: 'drv-2' }]).client, 't', { id: 'u1', userType: 'DRIVER', email: 'd@x.ae' })).toBe('drv-2');
  });

  it('none when the details match two other profiles', async () => {
    expect(await matchDriverProfileForUser(db([{ id: 'drv-2' }, { id: 'drv-3' }]).client, 't', { id: 'u1', userType: 'DRIVER', email: 'd@x.ae' })).toBeNull();
  });
});
