import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { hasTestDatabase } from '../db-guard';

// These tests use a real database. Without one (no TEST_DATABASE_URL to a
// local database) they are skipped — they used to run against whatever
// .env pointed at, which on a developer machine is production.
const NO_TEST_DB = !hasTestDatabase();


describe('TripIncident schema and operations mapping', () => {
  it.skipIf(NO_TEST_DB)('executes count() and findFirst() on operations.incidents without 42P01 error', async () => {
    const result = await withPlatformAdmin(prisma, async (tx) => {
      const count = await tx.tripIncident.count();
      const first = await tx.tripIncident.findFirst({ select: { id: true, tenantId: true, incidentNo: true } });
      return { count, first };
    });

    expect(typeof result.count).toBe('number');
    expect(result.count).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it.skipIf(NO_TEST_DB)('executes scoped query with tenantId predicate inside withTenantRls', async () => {
    const testTenantId = '00000000-0000-0000-0000-000000000000';
    const result = await withTenantRls(prisma, testTenantId, async (tx) => {
      return tx.tripIncident.count({ where: { tenantId: testTenantId } });
    });

    expect(typeof result).toBe('number');
  }, 60_000);
});
