import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/api/readyz/route';

describe('Next.js GET /api/readyz error redaction & allowlist filtering (SEC-003)', () => {
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
      error: 'service unavailable',
    });
    expect(body).not.toHaveProperty('backendUrl');
  });

  it('returns generic 503 even when upstream returns valid JSON 503 with internal hostnames and errors', async () => {
    // Upstream returns valid JSON containing internal diagnostics, hostnames, and URLs
    const upstreamLeakingPayload = {
      status: 'not_ready',
      error: 'database ping failed: dial tcp 10.0.4.15:5432: connection refused',
      backendUrl: 'http://fleet360-backend.railway.internal:8080',
      internalHost: 'ip-10-0-4-15.ec2.internal',
      checks: {
        database: { reachable: false, dsn: 'postgres://app:password@localhost:5432/fleet' },
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      status: 503,
      ok: false,
      json: () => Promise.resolve(upstreamLeakingPayload),
    } as any);

    const res = await GET();
    expect(res.status).toBe(503);

    const body = await res.json();
    // Must be completely sanitized to generic error
    expect(body).toEqual({
      status: 'not_ready',
      error: 'service unavailable',
    });
    expect(body).not.toHaveProperty('backendUrl');
    expect(body).not.toHaveProperty('internalHost');
    expect(body).not.toHaveProperty('checks');
    expect(JSON.stringify(body)).not.toContain('railway.internal');
    expect(JSON.stringify(body)).not.toContain('10.0.4.15');
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('returns strictly allowlisted fields on upstream 200 OK and strips arbitrary extra keys', async () => {
    const upstreamSuccessPayload = {
      status: 'ready',
      version: 'v2.4.1-rc1',
      checks: { database: { reachable: true } },
      internalIp: '10.0.99.12',
      metricsPort: 9090,
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
    // Ensure all non-allowlisted fields are stripped
    expect(body).not.toHaveProperty('checks');
    expect(body).not.toHaveProperty('internalIp');
    expect(body).not.toHaveProperty('metricsPort');
  });
});
