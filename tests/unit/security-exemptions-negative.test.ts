import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── 1. Webhook Authentication Negative Tests ─────────────────────────────────
import { POST as telematicsWebhookPOST } from '@/app/api/telematics/webhook/route';
import { POST as enterpriseWebhookPOST } from '@/app/api/integrations/enterprise/webhook/[id]/route';

// ── 2. Capability Token Negative Tests ───────────────────────────────────────
import { GET as trackTicketGET } from '@/app/api/service-tickets/track/[token]/route';

// ── 3. Portal Isolation Negative Tests ──────────────────────────────────────
import { requireLeasingPortal } from '@/lib/leasing-portal/auth';

// ── 4. Scheduler Authentication Negative Tests ──────────────────────────────
import { isJobAuthorized } from '@/lib/jobs/registry';
import { GET as jobsRunGET, POST as jobsRunPOST } from '@/app/api/jobs/run/route';

describe('Executable Security Exemption & Negative Assertion Suite', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.TELEMATICS_WEBHOOK_SECRET = 'super-secret-telematics-token';
    process.env.CRON_SECRET = 'valid-cron-secret-12345';
  });

  // ───────────────────────────────────────────────────────────────────────────
  // A. Inbound Webhook Security
  // ───────────────────────────────────────────────────────────────────────────
  describe('Inbound Webhook Security', () => {
    it('rejects telematics webhook when invalid secret is supplied', async () => {
      const req = new NextRequest('http://localhost:3000/api/telematics/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-secret': 'attacker-wrong-secret',
        },
        body: JSON.stringify([{ imei: '123456789012345', lat: 25.2, lng: 55.3 }]),
      });

      const res = await telematicsWebhookPOST(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized webhook secret');
    });

    it('rejects enterprise webhook when connection ID does not exist in database', async () => {
      // Mock prisma to return empty array for non-existent connection
      vi.mock('@/lib/prisma', () => ({
        prisma: {
          $executeRawUnsafe: vi.fn().mockResolvedValue(0),
          $queryRawUnsafe: vi.fn().mockImplementation(async (sql: string) => {
            if (typeof sql === 'string' && sql.includes('set_config')) {
              return [{ v: '*' }];
            }
            return [];
          }),
          $transaction: vi.fn(async (cb: (tx: any) => any) => cb({
            $executeRawUnsafe: vi.fn().mockResolvedValue(0),
            $queryRawUnsafe: vi.fn().mockImplementation(async (sql: string) => {
              if (typeof sql === 'string' && sql.includes('set_config')) {
                return [{ v: '*' }];
              }
              return [];
            }),
          })),
        },
      }));

      const req = new NextRequest('http://localhost:3000/api/integrations/enterprise/webhook/00000000-0000-0000-0000-000000000099', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityType: 'ROSTER', tenantId: 'attacker-injected-tenant' }),
      });

      const res = await enterpriseWebhookPOST(req, { params: { id: '00000000-0000-0000-0000-000000000099' } });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe('Invalid or inactive enterprise connection');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // B. Capability-Token Tracking Security
  // ───────────────────────────────────────────────────────────────────────────
  describe('Capability-Token Tracking Security (/api/service-tickets/track/[token])', () => {
    it('rejects sequential IDs and short tokens with 404 to prevent enumeration', async () => {
      const sequentialTokens = ['ST2026-MNT-0001', '123', 'admin', 'abc-123-short'];

      for (const token of sequentialTokens) {
        const req = new NextRequest(`http://localhost:3000/api/service-tickets/track/${token}`, {
          method: 'GET',
        });
        const res = await trackTicketGET(req, { params: Promise.resolve({ token }) });
        expect(res.status).toBe(404);
        const json = await res.json();
        expect(json.error).toBe('Service ticket not found or link has expired');
      }
    });

    it('rejects non-hex and malformed tokens with 404', async () => {
      // 32 chars but invalid characters (SQL injection attempt, special chars)
      const malformed = 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
      const req = new NextRequest(`http://localhost:3000/api/service-tickets/track/${malformed}`, {
        method: 'GET',
      });
      const res = await trackTicketGET(req, { params: Promise.resolve({ token: malformed }) });
      expect(res.status).toBe(404);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C. Customer Portal Lessee Isolation Security
  // ───────────────────────────────────────────────────────────────────────────
  describe('Customer Portal Lessee Isolation Security', () => {
    it('rejects portal requests with missing session cookie with 401', async () => {
      const req = new NextRequest('http://localhost:3000/api/leasing-portal/contracts', {
        method: 'GET',
      });

      const res = await requireLeasingPortal(req);
      // requireLeasingPortal returns NextResponse on auth failure
      expect('status' in res).toBe(true);
      if ('status' in res) {
        expect(res.status).toBe(401);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // D. Job Scheduler Authentication Security
  // ───────────────────────────────────────────────────────────────────────────
  describe('Job Scheduler Authorization Security (/api/jobs/run)', () => {
    it('isJobAuthorized rejects requests with missing or wrong CRON_SECRET and no tenant session', () => {
      const unauthReq = new NextRequest('http://localhost:3000/api/jobs/run?job=dunning-sweep', {
        method: 'POST',
      });
      expect(isJobAuthorized(unauthReq)).toBe(false);

      const wrongSecretReq = new NextRequest('http://localhost:3000/api/jobs/run?job=dunning-sweep', {
        method: 'POST',
        headers: { authorization: 'Bearer wrong-secret-token' },
      });
      expect(isJobAuthorized(wrongSecretReq)).toBe(false);
    });

    it('isJobAuthorized accepts valid CRON_SECRET Bearer token', () => {
      const validReq = new NextRequest('http://localhost:3000/api/jobs/run?job=dunning-sweep', {
        method: 'POST',
        headers: { authorization: 'Bearer valid-cron-secret-12345' },
      });
      expect(isJobAuthorized(validReq)).toBe(true);
    });

    it('isJobAuthorized accepts authenticated operator with x-tenant-id', () => {
      const operatorReq = new NextRequest('http://localhost:3000/api/jobs/run?job=dunning-sweep', {
        method: 'POST',
        headers: { 'x-tenant-id': 'tenant-acme-fleet' },
      });
      expect(isJobAuthorized(operatorReq)).toBe(true);
    });

    it('POST /api/jobs/run returns 401 for unauthorized callers', async () => {
      const unauthReq = new NextRequest('http://localhost:3000/api/jobs/run?job=dunning-sweep', {
        method: 'POST',
      });
      const res = await jobsRunPOST(unauthReq);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('GET /api/jobs/run returns 401 for unauthorized callers', async () => {
      const unauthReq = new NextRequest('http://localhost:3000/api/jobs/run', {
        method: 'GET',
      });
      const res = await jobsRunGET(unauthReq);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });
  });
});
