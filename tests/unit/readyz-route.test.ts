import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/api/readyz/route';

describe('Next.js GET /api/readyz error redaction & resilience (SEC-003)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns generic 503 without backendUrl or err.message on upstream connection failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.12.34:8080'));

    const res = await GET();
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body).toEqual({
      status: 'not_ready',
      error: 'service unavailable',
    });
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(body)).not.toContain('10.0.12.34');
    expect(body).not.toHaveProperty('backendUrl');
  });

  it('returns generic 503 without raw error when upstream returns non-JSON HTML (e.g. 502 Bad Gateway)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 502,
      ok: false,
      json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0')),
    } as any);

    const res = await GET();
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body).toEqual({
      status: 'not_ready',
      error: 'upstream service unavailable',
    });
    expect(body).not.toHaveProperty('backendUrl');
  });

  it('passes through upstream status and payload when upstream returns valid JSON', async () => {
    const upstreamPayload = { status: 'ready', checks: { database: { reachable: true } } };
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: () => Promise.resolve(upstreamPayload),
    } as any);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual(upstreamPayload);
    expect(body).not.toHaveProperty('backendUrl');
  });
});
