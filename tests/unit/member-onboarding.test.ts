/**
 * tests/unit/member-onboarding.test.ts
 *
 * The New User form posts one shape for every way a user is added
 * (src/lib/admin/member-onboarding.ts). These cover reading it, and how a
 * requested module access is narrowed to the chosen role before it is
 * stored (src/lib/admin/member-access.ts). No database.
 */
import { describe, it, expect, vi } from 'vitest';

// No database: only the pure parts are exercised.
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
import { parseNewMember } from '@/lib/admin/member-onboarding';
import { accessModuleRows, narrowToRole } from '@/lib/admin/member-access';

const base = { email: '  Rania@Example.COM ', roleId: 'role-1' };

describe('parseNewMember', () => {
  it('normalises the email and defaults the username and user type', () => {
    const r = parseNewMember(base, { requireName: false });
    expect(r).toMatchObject({ ok: true, value: { email: 'rania@example.com', username: 'rania@example.com', userType: 'STAFF', moduleAccess: null } });
  });

  it('needs a valid email and a role', () => {
    expect(parseNewMember({ ...base, email: 'nope' }, { requireName: false })).toMatchObject({ ok: false, status: 400 });
    expect(parseNewMember({ ...base, roleId: '' }, { requireName: false })).toMatchObject({ ok: false, error: 'Choose a role' });
  });

  it('needs first and last name only when the account is created now', () => {
    expect(parseNewMember(base, { requireName: true })).toMatchObject({ ok: false, error: 'First and last name are required' });
    expect(parseNewMember({ ...base, firstName: 'R', lastName: 'I' }, { requireName: true }).ok).toBe(true);
  });

  it('rejects a malformed department id and module access', () => {
    expect(parseNewMember({ ...base, departmentId: "x'; drop" }, { requireName: false })).toMatchObject({ ok: false, status: 400 });
    expect(parseNewMember({ ...base, moduleAccess: { fleet: ['manager'] } }, { requireName: false })).toMatchObject({ ok: false, status: 400 });
    expect(parseNewMember({ ...base, moduleAccess: { fleet: ['delete'] } }, { requireName: false }))
      .toMatchObject({ ok: true, value: { moduleAccess: { fleet: ['view', 'delete'] } } });
  });
});

describe('narrowToRole', () => {
  const role = { 'bus-ops': ['view', 'create', 'edit', 'delete'] as const, fleet: ['view'] as const };
  const roleAccess = { 'bus-ops': [...role['bus-ops']], fleet: [...role.fleet] };

  it('stores only what narrows the role', () => {
    expect(narrowToRole({ 'bus-ops': ['view'], fleet: ['view'] }, roleAccess)).toEqual({ 'bus-ops': ['view'] });
  });

  it('drops access the role does not grant: it cannot widen it', () => {
    expect(narrowToRole({ logistics: ['view', 'create'], fleet: ['view', 'edit'] }, roleAccess)).toBeNull();
  });

  it('keeps a module given no access', () => {
    expect(narrowToRole({ fleet: [] }, roleAccess)).toEqual({ fleet: [] });
  });

  it('never stores Admin', () => {
    expect(narrowToRole({ admin: [] }, { ...roleAccess, admin: ['view'] })).toBeNull();
  });
});

describe('accessModuleRows', () => {
  it('offers the company modules and the role modules, not Admin, with what the company has', () => {
    const rows = accessModuleRows(['fleet', 'logistics', 'admin', 'rac'], { fleet: ['view'], dispatch: ['view', 'edit'], admin: ['view'] });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(Object.keys(byKey).sort()).toEqual(['dispatch', 'fleet', 'logistics', 'rental']);
    expect(byKey.logistics).toMatchObject({ enabledForTenant: true, roleAccess: [] });
    expect(byKey.dispatch).toMatchObject({ enabledForTenant: false, roleAccess: ['view', 'edit'] });
    expect(byKey.rental.enabledForTenant).toBe(true); // legacy "rac"
  });
});
