import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/api/readyz/route';
import { schemaReport } from '@/lib/db/schema-registry';
import { ensureDbConnected } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';

vi.mock('@/lib/prisma', () => ({
  ensureDbConnected: vi.fn(),
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

vi.mock('@/lib/rls', () => ({
  withPlatformAdmin: vi.fn(),
}));

vi.mock('@/lib/db/schema-registry', () => ({
  schemaReport: vi.fn(),
}));

describe('Next.js GET /api/readyz Decoupled Readiness (F34)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(schemaReport).mockResolvedValue({
      status: 'ok',
      missing: {},
      missingCount: 0,
      checkedAt: new Date().toISOString(),
    });
    vi.mocked(ensureDbConnected).mockResolvedValue(undefined);
    vi.mocked(withPlatformAdmin).mockImplementation(async (...args: any[]) => {
      const fn = args.length === 2 ? args[1] : args[0];
      return fn({ $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]) });
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns 200 ready when DB & schema are healthy even if upstream Go is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.12.34:8080'));

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ready');
    expect(typeof body.timestamp).toBe('string');
  });

  it('returns 200 ready when upstream Go returns non-JSON 502', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 502,
      ok: false,
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    } as any);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ready');
  });

  it('returns 200 ready and strips upstream diagnostics on 503 from Go', async () => {
    const upstreamLeakingPayload = {
      status: 'not_ready',
      error: 'database ping failed: dial tcp 10.0.4.15:5432: connection refused',
      backendUrl: 'http://fleet360-backend.railway.internal:8080',
    };

    global.fetch = vi.fn().mockResolvedValue({
      status: 503,
      ok: false,
      json: () => Promise.resolve(upstreamLeakingPayload),
    } as any);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ready');
    expect(body).not.toHaveProperty('backendUrl');
    expect(body).not.toHaveProperty('internalHost');
  });

  it('returns strictly allowlisted fields and optional upstream version when available', async () => {
    const upstreamSuccessPayload = {
      status: 'ready',
      version: 'v2.4.1-rc1',
      checks: { database: { reachable: true } },
      internalIp: '10.0.99.12',
    };

    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: () => Promise.resolve(upstreamSuccessPayload),
    } as any);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ready');
    expect(body.version).toBe('v2.4.1-rc1');
    expect(typeof body.timestamp).toBe('string');
    expect(body).not.toHaveProperty('checks');
    expect(body).not.toHaveProperty('internalIp');
  });
});
