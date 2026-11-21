/**
 * M1-P0-1: Sanitization tests for extended health diagnostics (even for SUPER_ADMIN).
 *
 * Ensures:
 *  - getDbPoolMetrics() NEVER queries or returns raw/truncated SQL query text
 *    or database usernames from pg_stat_activity.
 *  - getGoogleMapsAndApisSpendingMetrics() NEVER exposes characters of the
 *    configured Google Maps API key (no prefix/suffix masking leak).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    $queryRawUnsafe: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}));

vi.mock('@/lib/agents/schema', () => ({
  ensureAgentSchema: vi.fn().mockResolvedValue(undefined),
}));

import {
  getDbPoolMetrics,
  getGoogleMapsAndApisSpendingMetrics,
} from '@/lib/health/extended-metrics';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('M1-P0-1: Extended health diagnostics sanitization', () => {
  it('getDbPoolMetrics never selects SQL query text or usernames from pg_stat_activity and never returns queryPreview', async () => {
    mockPrisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ active: 1, idle: 4, idle_in_tx: 0, waiting: 0, total: 5 }])
      .mockResolvedValueOnce([{ max_connections: '100' }])
      .mockResolvedValueOnce([{ commits: '500', rollbacks: '2' }])
      .mockResolvedValueOnce([{ state: 'active', duration_seconds: 8.4 }]);

    const metrics = await getDbPoolMetrics();

    // Verify none of the SQL queries issued against pg_stat_activity select `query` or `usename`
    for (const [sql] of mockPrisma.$queryRawUnsafe.mock.calls) {
      expect(String(sql)).not.toMatch(/\bLEFT\s*\(\s*query/i);
      expect(String(sql)).not.toMatch(/\bquery\b(?!_start)/i);
      expect(String(sql)).not.toMatch(/\busename\b/i);
    }

    expect(metrics.longRunningQueries).toHaveLength(1);
    const entry = metrics.longRunningQueries[0] as Record<string, unknown>;
    expect(entry.state).toBe('active');
    expect(entry.durationSeconds).toBe(8.4);
    expect(entry.queryPreview).toBeUndefined();
    expect(entry.username).toBeUndefined();
    expect(entry.pid).toBeUndefined();
  });

  it('getGoogleMapsAndApisSpendingMetrics never leaks partial API key characters', async () => {
    vi.stubEnv('GOOGLE_MAPS_API_KEY', 'AIzaSySUPERSECRETKEY123456789_oaI');
    mockPrisma.$queryRawUnsafe.mockResolvedValue([]);

    const metrics = await getGoogleMapsAndApisSpendingMetrics();
    expect(metrics.apiKeyConfigured).toBe(true);
    expect(JSON.stringify(metrics)).not.toContain('AIzaSy');
    expect(JSON.stringify(metrics)).not.toContain('_oaI');
  });
});
