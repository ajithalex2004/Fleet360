import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── 1. Webhook Authentication Negative Tests ─────────────────────────────────
import { POST as telematicsWebhookPOST } from '@/app/api/telematics/webhook/route';
import { POST as enterpriseWebhookPOST } from '@/app/api/integrations/enterprise/webhook/[id]/route';

// ── 2. Capability Token Negative & Resource Boundary Tests ───────────────────
import { GET as trackTicketGET } from '@/app/api/service-tickets/track/[token]/route';

// ── 3. Portal Isolation Negative & Cross-Lessee Tests ────────────────────────
import { requireLeasingPortal, signPortalSession } from '@/lib/leasing-portal/auth';
import { GET as portalContractsGET } from '@/app/api/leasing-portal/contracts/route';

// ── 4. Scheduler Authentication & Authorization Tests ────────────────────────
import { isJobAuthorized, verifyJobAuthorization } from '@/lib/jobs/registry';
import { GET as jobsRunGET, POST as jobsRunPOST } from '@/app/api/jobs/run/route';
import { signSession } from '@/lib/tenant-session';

// ── 5. Notification Quarantine Tests ─────────────────────────────────────────
import { sendSms } from '@/lib/sms';
import { sendWhatsApp } from '@/lib/whatsapp';
import { sendEmail } from '@/lib/email';

// Dynamic mock store for enterprise connections, service tickets, and portal users
let mockEnterpriseConnections: any[] = [];
let mockServiceTickets: any[] = [];
let mockPortalUsers: any[] = [];
let mockLeaseContracts: any[] = [];

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    $queryRawUnsafe: vi.fn().mockImplementation(async (sql: string, ...args: any[]) => {
      if (typeof sql === 'string' && sql.includes('set_config')) {
        const match = sql.match(/set_config\('app\.tenant_id',\s*'([^']+)'/);
        return [{ v: match ? match[1] : (args[0] || '*') }];
      }
      if (typeof sql === 'string' && sql.includes('FROM enterprise_connections')) {
        const idArg = args[0];
        return mockEnterpriseConnections.filter((c) => c.id === idArg && c.is_active);
      }
      if (typeof sql === 'string' && sql.includes('FROM service_tickets')) {
        const tokenArg = args[0];
        return mockServiceTickets.filter((t) => t.custom_fields?.trackingToken === tokenArg && !t.deleted_at);
      }
      if (typeof sql === 'string' && sql.includes('FROM lessee_portal_users')) {
        const idArg = args[0];
        const tenantArg = args[1];
        return mockPortalUsers.filter((u) => u.id === idArg && u.tenant_id === tenantArg && !u.deleted_at);
      }
      return [];
    }),
    $transaction: vi.fn(async (cb: (tx: any) => any) =>
      cb({
        $executeRawUnsafe: vi.fn().mockResolvedValue(0),
        $queryRawUnsafe: vi.fn().mockImplementation(async (sql: string, ...args: any[]) => {
          if (typeof sql === 'string' && sql.includes('set_config')) {
            const match = sql.match(/set_config\('app\.tenant_id',\s*'([^']+)'/);
            return [{ v: match ? match[1] : (args[0] || '*') }];
          }
          if (typeof sql === 'string' && sql.includes('FROM enterprise_connections')) {
            const idArg = args[0];
            return mockEnterpriseConnections.filter((c) => c.id === idArg && c.is_active);
          }
          if (typeof sql === 'string' && sql.includes('FROM service_tickets')) {
            const tokenArg = args[0];
            return mockServiceTickets.filter((t) => t.custom_fields?.trackingToken === tokenArg && !t.deleted_at);
          }
          return [];
        }),
        leaseContract2: {
          findMany: vi.fn().mockImplementation(async ({ where }) => {
            return mockLeaseContracts.filter(
              (c) => c.tenantId === where.tenantId && c.lesseeId === where.lesseeId && !c.deletedAt
            );
          }),
        },
      })
    ),
    leaseContract2: {
      findMany: vi.fn().mockImplementation(async ({ where }) => {
        return mockLeaseContracts.filter(
          (c) => c.tenantId === where.tenantId && c.lesseeId === where.lesseeId && !c.deletedAt
        );
      }),
    },
  },
}));

vi.mock('@/lib/telematics/gateway-ingest', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    processTelemetryBatch: vi.fn().mockResolvedValue({ processed: 1, failed: 0, alertsTriggered: 0 }),
  };
});

vi.mock('@/lib/leasing/esignature-store', () => ({
  getSignature: vi.fn().mockResolvedValue(null),
}));

describe('Executable Security Exemption & Boundary Assertion Suite', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.TELEMATICS_WEBHOOK_SECRET = 'super-secret-telematics-token';
    process.env.CRON_SECRET = 'valid-cron-secret-12345';
    process.env.LEASING_PORTAL_SESSION_SECRET = 'portal-secret-key-1234567890';
    mockEnterpriseConnections = [];
    mockServiceTickets = [];
    mockPortalUsers = [];
    mockLeaseContracts = [];
  });

  // ───────────────────────────────────────────────────────────────────────────
  // A. Inbound Webhook Security
  // ───────────────────────────────────────────────────────────────────────────
  describe('Inbound Webhook Security', () => {
    it('rejects telematics webhook with missing, empty, shorter, longer, and malformed secrets', async () => {
      const payload = JSON.stringify([{ imei: '123456789012345', lat: 25.2, lng: 55.3 }]);

      // 1. Missing secret
      const reqMissing = new NextRequest('http://localhost:3000/api/telematics/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
      });
      expect((await telematicsWebhookPOST(reqMissing)).status).toBe(401);

      // 2. Empty secret
      const reqEmpty = new NextRequest('http://localhost:3000/api/telematics/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-webhook-secret': '' },
        body: payload,
      });
      expect((await telematicsWebhookPOST(reqEmpty)).status).toBe(401);

      // 3. Shorter secret (5 chars vs 31 chars configured)
      const reqShort = new NextRequest('http://localhost:3000/api/telematics/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-webhook-secret': 'short' },
        body: payload,
      });
      expect((await telematicsWebhookPOST(reqShort)).status).toBe(401);

      // 4. Longer secret (60+ chars vs 31 chars configured)
      const reqLong = new NextRequest('http://localhost:3000/api/telematics/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-secret': 'super-secret-telematics-token-with-extra-bytes-padding-and-overflow',
        },
        body: payload,
      });
      expect((await telematicsWebhookPOST(reqLong)).status).toBe(401);

      // 5. Malformed characters / invalid secret
      const reqMalformed = new NextRequest('http://localhost:3000/api/telematics/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-webhook-secret': '???malformed!secret@@@$$$' },
        body: payload,
      });
      expect((await telematicsWebhookPOST(reqMalformed)).status).toBe(401);

      // 6. Exactly matching secret succeeds
      const reqValid = new NextRequest('http://localhost:3000/api/telematics/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-secret': 'super-secret-telematics-token',
        },
        body: payload,
      });
      expect((await telematicsWebhookPOST(reqValid)).status).toBe(200);
    });

    it('rejects enterprise webhook when connection ID does not exist in database', async () => {
      const req = new NextRequest(
        'http://localhost:3000/api/integrations/enterprise/webhook/00000000-0000-0000-0000-000000000099',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ entityType: 'ROSTER', tenantId: 'attacker-injected-tenant' }),
        }
      );

      const res = await enterpriseWebhookPOST(req, {
        params: { id: '00000000-0000-0000-0000-000000000099' },
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe('Invalid or inactive enterprise connection');
    });

    it('rejects enterprise webhook for valid connection UUID when secret/signature is missing or wrong', async () => {
      const validConnId = '11111111-2222-3333-4444-555555555555';
      mockEnterpriseConnections = [
        {
          id: validConnId,
          tenant_id: 'tenant-acme-corp',
          system_name: 'SAP Production ERP',
          system_type: 'SAP_S4HANA',
          is_active: true,
          auth_credentials: JSON.stringify({ webhookSecret: 'correct-erp-shared-secret' }),
          headers: '{}',
        },
      ];

      // 1. Missing secret
      const reqNoSecret = new NextRequest(
        `http://localhost:3000/api/integrations/enterprise/webhook/${validConnId}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ entityType: 'PURCHASE_ORDER', orderId: 'PO-999' }),
        }
      );
      const resNoSecret = await enterpriseWebhookPOST(reqNoSecret, { params: { id: validConnId } });
      expect(resNoSecret.status).toBe(401);
      const jsonNoSecret = await resNoSecret.json();
      expect(jsonNoSecret.error).toBe('Unauthorized enterprise webhook request');

      // 2. Wrong secret
      const reqWrongSecret = new NextRequest(
        `http://localhost:3000/api/integrations/enterprise/webhook/${validConnId}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-webhook-secret': 'invalid-secret-attacker',
          },
          body: JSON.stringify({ entityType: 'PURCHASE_ORDER', orderId: 'PO-999' }),
        }
      );
      const resWrongSecret = await enterpriseWebhookPOST(reqWrongSecret, { params: { id: validConnId } });
      expect(resWrongSecret.status).toBe(401);

      // Shorter secret (5 chars vs 25 chars)
      const reqShortSecret = new NextRequest(
        `http://localhost:3000/api/integrations/enterprise/webhook/${validConnId}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-webhook-secret': 'short' },
          body: JSON.stringify({ entityType: 'PURCHASE_ORDER', orderId: 'PO-999' }),
        }
      );
      expect((await enterpriseWebhookPOST(reqShortSecret, { params: { id: validConnId } })).status).toBe(401);

      // Longer secret (60+ chars)
      const reqLongSecret = new NextRequest(
        `http://localhost:3000/api/integrations/enterprise/webhook/${validConnId}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-webhook-secret': 'correct-erp-shared-secret-with-huge-padding-that-overflows-buffer',
          },
          body: JSON.stringify({ entityType: 'PURCHASE_ORDER', orderId: 'PO-999' }),
        }
      );
      expect((await enterpriseWebhookPOST(reqLongSecret, { params: { id: validConnId } })).status).toBe(401);

      // 3. Valid secret accepts request
      const reqValidSecret = new NextRequest(
        `http://localhost:3000/api/integrations/enterprise/webhook/${validConnId}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-webhook-secret': 'correct-erp-shared-secret',
          },
          body: JSON.stringify({ entityType: 'PURCHASE_ORDER', orderId: 'PO-999' }),
        }
      );
      const resValidSecret = await enterpriseWebhookPOST(reqValidSecret, { params: { id: validConnId } });
      expect(resValidSecret.status).toBe(200);
      const jsonValid = await resValidSecret.json();
      expect(jsonValid.success).toBe(true);
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
      const malformed = 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
      const req = new NextRequest(`http://localhost:3000/api/service-tickets/track/${malformed}`, {
        method: 'GET',
      });
      const res = await trackTicketGET(req, { params: Promise.resolve({ token: malformed }) });
      expect(res.status).toBe(404);
    });

    it('valid capability token exposes only its intended ticket and rejects expired tokens', async () => {
      const validActiveToken = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
      const validExpiredToken = 'f9e8d7c6b5a439281706f5e4d3c2b1a0';

      const thirtyDaysAgoMs = Date.now() - 35 * 24 * 60 * 60 * 1000;
      mockServiceTickets = [
        {
          id: 'ticket-uuid-active-1',
          ticket_type: 'MAINTENANCE',
          readable_id: 'ST2026-0001',
          title: 'Engine Diagnostic Inspection',
          description: 'Scheduled maintenance check',
          priority: 'NORMAL',
          status: 'IN_PROGRESS',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          due_date: null,
          history: [],
          custom_fields: { trackingToken: validActiveToken, assignedDepartment: 'WORKSHOP' },
          deleted_at: null,
        },
        {
          id: 'ticket-uuid-expired-2',
          ticket_type: 'REPAIR',
          readable_id: 'ST2026-0002',
          title: 'Transmission Overhaul',
          description: 'Old ticket',
          priority: 'HIGH',
          status: 'COMPLETED',
          created_at: new Date(thirtyDaysAgoMs).toISOString(),
          updated_at: new Date(thirtyDaysAgoMs).toISOString(),
          due_date: null,
          history: [],
          custom_fields: { trackingToken: validExpiredToken, assignedDepartment: 'WORKSHOP' },
          deleted_at: null,
        },
      ];

      // 1. Valid active token exposes ONLY ticket 1
      const activeReq = new NextRequest(
        `http://localhost:3000/api/service-tickets/track/${validActiveToken}`,
        { method: 'GET' }
      );
      const activeRes = await trackTicketGET(activeReq, { params: Promise.resolve({ token: validActiveToken }) });
      expect(activeRes.status).toBe(200);
      const activeJson = await activeRes.json();
      expect(activeJson.ticket.readableId).toBe('ST2026-0001');
      expect(activeJson.ticket.title).toBe('Engine Diagnostic Inspection');

      // 2. Expired token returns 410 Link has expired
      const expiredReq = new NextRequest(
        `http://localhost:3000/api/service-tickets/track/${validExpiredToken}`,
        { method: 'GET' }
      );
      const expiredRes = await trackTicketGET(expiredReq, { params: Promise.resolve({ token: validExpiredToken }) });
      expect(expiredRes.status).toBe(410);
      const expiredJson = await expiredRes.json();
      expect(expiredJson.error).toContain('Tracking link has expired');
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
      expect('status' in res).toBe(true);
      if ('status' in res) {
        expect(res.status).toBe(401);
      }
    });

    it('valid Lessee A session strictly isolates Lessee A records and denies access to Lessee B records within the same tenant', async () => {
      const tenantId = 'tenant-emirates-fleet';
      const lesseeA = 'lessee-alpha-corp';
      const lesseeB = 'lessee-beta-logistics';

      mockPortalUsers = [
        {
          id: 'user-a-1',
          tenant_id: tenantId,
          lessee_id: lesseeA,
          email: 'lessee.a@alphacorp.ae',
          full_name: 'Lessee Alpha User',
          phone: null,
          password_hash: 'mock-hash',
          is_active: true,
          role: 'LESSEE_USER',
          last_login_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      mockLeaseContracts = [
        {
          id: 'contract-a-100',
          tenantId,
          lesseeId: lesseeA,
          contractNumber: 'CNT-ALPHA-01',
          deletedAt: null,
          vehicles: [],
        },
        {
          id: 'contract-b-200',
          tenantId,
          lesseeId: lesseeB,
          contractNumber: 'CNT-BETA-02',
          deletedAt: null,
          vehicles: [],
        },
      ];

      // Create signed session cookie for Lessee A
      const { token: sessionTokenA } = signPortalSession({
        userId: 'user-a-1',
        lesseeId: lesseeA,
        tenantId,
      });

      const reqA = new NextRequest('http://localhost:3000/api/leasing-portal/contracts', {
        method: 'GET',
        headers: {
          cookie: `leasing-portal-session=${sessionTokenA}`,
        },
      });

      const resA = await portalContractsGET(reqA);
      expect(resA.status).toBe(200);
      const contractsA = await resA.json();

      // Must see ONLY Lessee A's contract; Lessee B's contract must never appear
      expect(contractsA).toHaveLength(1);
      expect(contractsA[0].id).toBe('contract-a-100');
      expect(contractsA[0].lesseeId).toBe(lesseeA);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // D. Job Scheduler Authentication & Authorization Security
  // ───────────────────────────────────────────────────────────────────────────
  describe('Job Scheduler Authorization Security (/api/jobs/run)', () => {
    it('isJobAuthorized rejects requests with missing or wrong CRON_SECRET and no operator session', async () => {
      const unauthReq = new NextRequest('http://localhost:3000/api/jobs/run?job=dunning-sweep', {
        method: 'POST',
      });
      expect(await isJobAuthorized(unauthReq)).toBe(false);

      const wrongSecretReq = new NextRequest('http://localhost:3000/api/jobs/run?job=dunning-sweep', {
        method: 'POST',
        headers: { authorization: 'Bearer wrong-secret-token' },
      });
      expect(await isJobAuthorized(wrongSecretReq)).toBe(false);
    });

    it('strictly rejects forged headers (x-tenant-id, x-user-id, x-user-role) without valid xl-session cookie', async () => {
      const forgedReq = new NextRequest('http://localhost:3000/api/jobs/run?job=dunning-sweep', {
        method: 'POST',
        headers: {
          'x-tenant-id': 'tenant-acme-fleet',
          'x-user-id': 'user-attacker',
          'x-user-role': 'SUPER_ADMIN',
        },
      });
      const auth = await verifyJobAuthorization(forgedReq, 'dunning-sweep');
      expect(auth.authorized).toBe(false);
      expect(auth.status).toBe(401);
      expect(auth.error).toBe('Unauthorized: Valid operator session required');
    });

    it('rejects operator with invalid or tampered xl-session cookie with 401', async () => {
      const tamperedReq = new NextRequest('http://localhost:3000/api/jobs/run?job=dunning-sweep', {
        method: 'POST',
        headers: {
          cookie: 'xl-session=invalid-payload.tampered-signature-123',
        },
      });
      const auth = await verifyJobAuthorization(tamperedReq, 'dunning-sweep');
      expect(auth.authorized).toBe(false);
      expect(auth.status).toBe(401);
      expect(auth.error).toBe('Unauthorized: Valid operator session required');
    });

    it('enforces job-specific role gate (e.g. DISPATCHER denied for dunning-sweep with 403)', async () => {
      const dispatcherToken = await signSession({
        userId: 'user-dispatcher-1',
        tenantId: 'tenant-origin-a',
        role: 'DISPATCHER',
        plan: 'ENTERPRISE',
      });
      const dispatcherReq = new NextRequest('http://localhost:3000/api/jobs/run?job=dunning-sweep', {
        method: 'POST',
        headers: {
          cookie: `xl-session=${dispatcherToken}`,
        },
      });
      const auth = await verifyJobAuthorization(dispatcherReq, 'dunning-sweep');
      expect(auth.authorized).toBe(false);
      expect(auth.status).toBe(403);
      expect(auth.error).toBe("Forbidden: role 'DISPATCHER' is not authorized to execute job 'dunning-sweep'");
    });

    it('authorizes operator with allowed job role (e.g. FINANCE for dunning-sweep) and derives identity from verified session', async () => {
      const financeToken = await signSession({
        userId: 'user-finance-1',
        tenantId: 'tenant-origin-a',
        role: 'FINANCE',
        plan: 'ENTERPRISE',
      });
      // Even if client attempts to forge x-tenant-id in header, verified session tenant is used
      const financeReq = new NextRequest('http://localhost:3000/api/jobs/run?job=dunning-sweep', {
        method: 'POST',
        headers: {
          cookie: `xl-session=${financeToken}`,
          'x-tenant-id': 'malicious-forged-tenant',
        },
      });
      const auth = await verifyJobAuthorization(financeReq, 'dunning-sweep');
      expect(auth.authorized).toBe(true);
      expect(auth.isCron).toBe(false);
      expect(auth.tenantId).toBe('tenant-origin-a');
      expect(auth.userId).toBe('user-finance-1');
    });

    it('rejects authenticated non-super-admin operator attempting cross-tenant execution via query param', async () => {
      const financeToken = await signSession({
        userId: 'user-finance-1',
        tenantId: 'tenant-origin-a',
        role: 'FINANCE',
        plan: 'ENTERPRISE',
      });
      const crossTenantReq = new NextRequest(
        'http://localhost:3000/api/jobs/run?job=dunning-sweep&tenantId=tenant-target-b',
        {
          method: 'POST',
          headers: {
            cookie: `xl-session=${financeToken}`,
          },
        }
      );
      const auth = await verifyJobAuthorization(crossTenantReq, 'dunning-sweep');
      expect(auth.authorized).toBe(false);
      expect(auth.status).toBe(403);
      expect(auth.error).toContain('cross-tenant execution not permitted');
    });

    it('isJobAuthorized accepts valid CRON_SECRET Bearer token for system scheduler and binds scope', async () => {
      const validCronReq = new NextRequest('http://localhost:3000/api/jobs/run?job=dunning-sweep', {
        method: 'POST',
        headers: { authorization: 'Bearer valid-cron-secret-12345' },
      });
      const auth = await verifyJobAuthorization(validCronReq, 'dunning-sweep');
      expect(auth.authorized).toBe(true);
      expect(auth.isCron).toBe(true);
      expect(auth.userId).toBe('system:cron');
      expect(auth.tenantId).toBeNull(); // All-tenant system job
    });

    it('POST /api/jobs/run returns 401 for unauthorized callers', async () => {
      const unauthReq = new NextRequest('http://localhost:3000/api/jobs/run?job=dunning-sweep', {
        method: 'POST',
      });
      const res = await jobsRunPOST(unauthReq);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized: Valid operator session required');
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

  // ───────────────────────────────────────────────────────────────────────────
  // E. Outbound Notification Quarantine & Suppression in Staging
  // ───────────────────────────────────────────────────────────────────────────
  describe('Outbound Notification Quarantine & Suppression', () => {
    it('suppresses SMS, WhatsApp, and Email when DISABLE_OUTBOUND_NOTIFICATIONS is true', async () => {
      process.env.DISABLE_OUTBOUND_NOTIFICATIONS = 'true';

      const smsRes = await sendSms({ to: '+971501234567', body: 'Test SMS' });
      expect(smsRes.sent).toBe(false);
      expect(smsRes.reason).toBe('quarantined_in_staging');

      const waRes = await sendWhatsApp({ to: '+971501234567', body: 'Test WhatsApp' });
      expect(waRes.sent).toBe(false);
      expect(waRes.reason).toBe('quarantined_in_staging');

      const emailRes = await sendEmail({ to: 'customer@example.com', subject: 'Test Email' });
      expect(emailRes.sent).toBe(false);
      expect(emailRes.reason).toBe('quarantined_in_staging');
      expect(emailRes.transport).toBe('quarantined');
    });

    it('suppresses SMS and WhatsApp when TWILIO credentials are set to DISABLED_IN_STAGING', async () => {
      delete process.env.DISABLE_OUTBOUND_NOTIFICATIONS;
      process.env.TWILIO_AUTH_TOKEN = 'DISABLED_IN_STAGING';
      process.env.TWILIO_ACCOUNT_SID = 'DISABLED_IN_STAGING';

      const smsRes = await sendSms({ to: '+971501234567', body: 'Test SMS' });
      expect(smsRes.sent).toBe(false);
      expect(smsRes.reason).toBe('quarantined_in_staging');

      const waRes = await sendWhatsApp({ to: '+971501234567', body: 'Test WhatsApp' });
      expect(waRes.sent).toBe(false);
      expect(waRes.reason).toBe('quarantined_in_staging');
    });
  });
});

