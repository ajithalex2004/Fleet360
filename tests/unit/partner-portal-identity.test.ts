/**
 * The partner portal names the signed-in user's real partner: memberships
 * carry the partner code and city, and the header avatar uses the partner's
 * initials.
 */
import { describe, it, expect, vi } from 'vitest';

const findMany = vi.hoisted(() => vi.fn());
vi.mock('@/lib/prisma', () => ({ prisma: { partnerUser: { findMany } } }));
vi.mock('@/lib/rls', () => ({ withPlatformAdmin: vi.fn(), withTenantRls: vi.fn() }));

import { partnerMembershipsForUser } from '@/lib/exchange/partner-auth';
import { partnerInitials, partnerRoleLabel } from '@/components/exchange/PartnerMembershipContext';

describe('partnerMembershipsForUser', () => {
  it('returns the partner code and city with each membership', async () => {
    findMany.mockResolvedValue([{
      role: 'PARTNER_OPERATIONS',
      partner: { id: 'p1', legalName: 'Gulf Coaches LLC', partnerCode: 'GULF-DXB', city: 'Dubai', marketplaceStatus: 'APPROVED', operationalStatus: 'ACTIVE' },
    }]);
    expect(await partnerMembershipsForUser('u1')).toEqual([{
      partnerId: 'p1', role: 'PARTNER_OPERATIONS', legalName: 'Gulf Coaches LLC', partnerCode: 'GULF-DXB', city: 'Dubai',
      marketplaceStatus: 'APPROVED', operationalStatus: 'ACTIVE',
    }]);
    expect(findMany.mock.calls[0][0].select.partner.select).toMatchObject({ partnerCode: true, city: true });
  });
});

describe('partner portal header', () => {
  it('uses up to two initials, ignoring the legal form', () => {
    expect(partnerInitials('Gulf Coaches LLC')).toBe('GC');
    expect(partnerInitials('Desert Shuttle Services L.L.C.')).toBe('DS');
    expect(partnerInitials('Emirates FZE')).toBe('E');
  });

  it('labels partner roles', () => {
    expect(partnerRoleLabel('PARTNER_FINANCE')).toBe('Finance');
    expect(partnerRoleLabel('SOMETHING_ELSE')).toBe('SOMETHING_ELSE');
  });
});
