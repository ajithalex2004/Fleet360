import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';

describe('TripIncident schema and operations mapping', () => {
  it('executes count() and findFirst() on operations.incidents without 42P01 error', async () => {
    const result = await withPlatformAdmin(prisma, async (tx) => {
      const count = await tx.tripIncident.count();
      const first = await tx.tripIncident.findFirst({ select: { id: true, tenantId: true, incidentNo: true } });
      return { count, first };
    });

    expect(typeof result.count).toBe('number');
    expect(result.count).toBeGreaterThanOrEqual(0);
  });

  it('executes scoped query with tenantId predicate inside withTenantRls', async () => {
    const testTenantId = '00000000-0000-0000-0000-000000000000';
    const result = await withTenantRls(prisma, testTenantId, async (tx) => {
      return tx.tripIncident.count({ where: { tenantId: testTenantId } });
    });

    expect(typeof result).toBe('number');
  });
});
