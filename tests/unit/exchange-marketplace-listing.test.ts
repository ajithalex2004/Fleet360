/**
 * MarketplaceService.listOpportunitiesForPartner: cross-tenant discovery in
 * platform context, filtered by the partner's visibility rules, returning the
 * sanitized pre-award view only (no buyer tenant_id or created_by).
 */
import { describe, it, expect, vi } from 'vitest';

const findMany = vi.hoisted(() => vi.fn(async () => []));
const partner = vi.hoisted(() => ({
  id: 'p1',
  marketplaceStatus: 'APPROVED',
  operationalStatus: 'ACTIVE',
  capabilities: [{ domain: 'PASSENGER_TRANSPORT' }],
  serviceAreas: [],
  tenantRelationships: [
    { tenantId: 'tenant-network', status: 'APPROVED' },
    { tenantId: 'tenant-blocked', status: 'BLOCKED' },
  ],
}));
const scopes = vi.hoisted(() => [] as string[]);

vi.mock('@/lib/prisma', () => ({
  prisma: {
    transportPartner: { findUnique: vi.fn(async () => partner) },
    marketplaceOpportunity: { findMany },
  },
}));
vi.mock('@/lib/rls', async () => {
  const { prisma } = await import('@/lib/prisma');
  return { withPlatformAdmin: vi.fn(async (_p: unknown, fn: (tx: unknown) => unknown) => { scopes.push('*'); return fn(prisma); }) };
});
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/alerts/raise', () => ({ raiseAlert: vi.fn() }));
vi.mock('@/lib/exchange/outsource-engine', () => ({ OutsourceEngine: {} }));

import { MarketplaceService } from '@/lib/exchange/marketplace-service';

describe('listOpportunitiesForPartner', () => {
  it('reads in platform context with the partner visibility rules and a pre-award field set', async () => {
    const res = await MarketplaceService.listOpportunitiesForPartner('p1');
    expect(res).toMatchObject({ opportunities: [], partnerDomains: ['PASSENGER_TRANSPORT'] });
    expect(scopes).toEqual(['*']);

    const args = (findMany.mock.calls[0] as unknown[])[0] as { where: Record<string, unknown>; select: Record<string, unknown> };
    expect(args.where).toMatchObject({
      status: 'OPEN',
      domain: { in: ['PASSENGER_TRANSPORT'] },
      tenantId: { notIn: ['tenant-blocked'] },
      OR: [
        { visibility: 'EXCHANGE_NETWORK' },
        { visibility: 'TENANT_NETWORK', tenantId: { in: ['tenant-network'] } },
        { request: { invitedPartners: { some: { partnerId: 'p1' } } } },
      ],
    });
    expect(args.select).toMatchObject({ id: true, outsourceRequestId: true, disclosurePayload: true });
    expect(args.select).not.toHaveProperty('tenantId');
    expect(args.select).not.toHaveProperty('createdBy');
  });
});
