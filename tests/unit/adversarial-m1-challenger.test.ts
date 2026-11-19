/**
 * Adversarial Challenge Test Suite for Milestone M1 (Features F01 through F08)
 *
 * Empirically stress-tests Worker M1's security fixes:
 * 1. SQL Injection Fuzzing & RLS Guard Validation
 * 2. Auth Bypass Verification (!auth.ok checks)
 * 3. Roster OTP Hardening, Lockout & Expiration Stress Tests
 * 4. Webhook Signature Spoofing (Twilio & Meta HMAC)
 * 5. Secret Fallback Fail-Closed, Login Brute Force Lockout & Headers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// Route handlers under test
import { POST as scope3Post } from '@/app/api/sustainability/scope3-report/route';
import { POST as asateelPost } from '@/app/api/compliance/telematics/asateel/route';
import { POST as rosterOtpPost, GET as rosterOtpGet } from '@/app/api/auth/roster-otp/route';
import { GET as verifyDomainGet, POST as verifyDomainPost } from '@/app/api/tenants/verify-domain/route';
import { POST as twilioPost } from '@/app/api/webhooks/twilio/route';
import { GET as whatsappGet, POST as whatsappPost } from '@/app/api/webhooks/whatsapp/route';
import { GET as stWhatsappGet, POST as stWhatsappPost } from '@/app/api/service-tickets/whatsapp-webhook/route';
import { POST as loginPost } from '@/app/api/auth/login/route';
import { POST as provisionPost } from '@/app/api/tenants/provision/route';
import { withTenantRls } from '@/lib/rls';
import { signPortalSession } from '@/lib/shipper-portal/auth';
import nextConfig from '../../next.config';

describe('Adversarial Challenge Suite — Milestone M1', () => {

  // ==========================================================================
  // CHALLENGE 1: SQL Injection Fuzzing & RLS Bypass
  // ==========================================================================
  describe('Challenge 1: SQL Injection Fuzzing & RLS Wildcard Bypass', () => {
    it('CH-01-A: withTenantRls strictly rejects SQL injection payloads in tenantId', async () => {
      const maliciousTenantIds = [
        "' OR '1'='1",
        "'; SELECT set_tenant_context('*'); --",
        "tnt-123; DROP TABLE customers; --",
        "tnt-123/*comment*/",
        "*", // Super-admin wildcard escalation
        "tnt-123' UNION SELECT * FROM \"User\"--",
        " ",
        "",
      ];

      for (const badId of maliciousTenantIds) {
        await expect(
          withTenantRls({} as any, badId, async () => {}),
        ).rejects.toThrow();
      }
    });

    it('CH-01-B: withTenantRls accepts only strictly validated alphanumeric/hyphen/underscore tenant IDs', async () => {
      const validMockPrisma: any = {
        $transaction: vi.fn(async (callback) => {
          const mockTx = {
            $queryRawUnsafe: vi.fn().mockResolvedValue([{ v: 'valid-tenant_123' }]),
          };
          return callback(mockTx);
        }),
      };

      let executed = false;
      await withTenantRls(validMockPrisma, 'valid-tenant_123', async () => {
        executed = true;
      });
      expect(executed).toBe(true);
    });
  });

  // ==========================================================================
  // CHALLENGE 2: Auth Bypass Verification (Dead Check Remediation)
  // ==========================================================================
  describe('Challenge 2: Auth Bypass Verification (!auth.ok)', () => {
    it('CH-02-A: POST /api/sustainability/scope3-report rejects unauthenticated requests with 401', async () => {
      const req = new NextRequest('http://localhost:3000/api/sustainability/scope3-report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientName: 'Attacker Corp' }),
      });

      const res = await scope3Post(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data).toHaveProperty('error');
    });

    it('CH-02-B: POST /api/compliance/telematics/asateel rejects unauthenticated requests with 401', async () => {
      const req = new NextRequest('http://localhost:3000/api/compliance/telematics/asateel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'evaluate_gating' }),
      });

      const res = await asateelPost(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data).toHaveProperty('error');
    });

    it('CH-02-C: POST /api/auth/roster-otp (UPDATE_TENANT_SMS_SETTING) rejects unauthenticated caller with 401', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/roster-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'UPDATE_TENANT_SMS_SETTING',
          enableSmsAuth: false,
          tenantId: 'victim-tenant',
        }),
      });

      const res = await rosterOtpPost(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data).toHaveProperty('error');
    });

    it('CH-02-D: POST /api/auth/roster-otp (UPDATE_TENANT_SMS_SETTING) rejects DRIVER role with 403', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/roster-otp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 'tnt-exl-solutions',
          'x-user-id': 'driver-999',
          'x-user-role': 'DRIVER',
        },
        body: JSON.stringify({
          action: 'UPDATE_TENANT_SMS_SETTING',
          enableSmsAuth: false,
        }),
      });

      const res = await rosterOtpPost(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('Only TENANT_ADMIN or SUPER_ADMIN');
    });

    it('CH-02-E: GET /api/tenants/verify-domain rejects unauthenticated caller with 401', async () => {
      const req = new NextRequest('http://localhost:3000/api/tenants/verify-domain?tenantId=t1');
      const res = await verifyDomainGet(req);
      expect(res.status).toBe(401);
    });

    it('CH-02-F: GET /api/tenants/verify-domain rejects non-admin role with 403', async () => {
      const req = new NextRequest('http://localhost:3000/api/tenants/verify-domain?tenantId=t1', {
        headers: {
          'x-tenant-id': 't1',
          'x-user-id': 'u1',
          'x-user-role': 'MEMBER',
        },
      });
      const res = await verifyDomainGet(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.message).toContain('TENANT_ADMIN role required');
    });

    it('CH-02-G: POST /api/tenants/verify-domain with missing parameters returns 400 (testing tenantBootstrapHandler error propagation)', async () => {
      const req = new NextRequest('http://localhost:3000/api/tenants/verify-domain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const res = await verifyDomainPost(req);
      expect(res.status).toBe(400);
    });
  });

  // ==========================================================================
  // CHALLENGE 3: OTP Stress Testing & Lockout Verification
  // ==========================================================================
  describe('Challenge 3: OTP Stress Testing, Demo Bypass & Lockout Enforcement', () => {
    const testEmail = 'fatima@ein360.ae';

    it('CH-03-A: SEND_OTP generates 6-digit random OTP and does NOT leak demoOtpHint or code', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/roster-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'SEND_OTP',
          identifier: testEmail,
        }),
      });

      const res = await rosterOtpPost(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.demoOtpHint).toBeUndefined();
      expect(data.otp).toBeUndefined();
    });

    it('CH-03-B: Hardcoded legacy demo OTP "849201" is strictly rejected', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/roster-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'VERIFY_OTP',
          identifier: testEmail,
          otp: '849201',
        }),
      });

      const res = await rosterOtpPost(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid or expired OTP code');
    });

    it('CH-03-C: Attempting brute force triggers lockout at 5 failed attempts (429)', async () => {
      // First 3 wrong guesses (already made 1 in CH-03-B, so 2, 3, 4, 5)
      for (let i = 2; i <= 4; i++) {
        const req = new NextRequest('http://localhost:3000/api/auth/roster-otp', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'VERIFY_OTP',
            identifier: testEmail,
            otp: `00000${i}`,
          }),
        });
        const res = await rosterOtpPost(req);
        expect(res.status).toBe(400);
      }

      // 5th attempt: threshold reached -> 429
      const req5 = new NextRequest('http://localhost:3000/api/auth/roster-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'VERIFY_OTP',
          identifier: testEmail,
          otp: '000005',
        }),
      });
      const res5 = await rosterOtpPost(req5);
      expect(res5.status).toBe(429);
      const data5 = await res5.json();
      expect(data5.error).toContain('Maximum verification attempts exceeded');

      // Subsequent attempt: OTP is purged from store
      const req6 = new NextRequest('http://localhost:3000/api/auth/roster-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'VERIFY_OTP',
          identifier: testEmail,
          otp: '123456',
        }),
      });
      const res6 = await rosterOtpPost(req6);
      expect(res6.status).toBe(400);
      const data6 = await res6.json();
      expect(data6.error).toContain('Invalid or expired OTP code');
    });

    it('CH-03-D: SEND_OTP enforces rate limiting after 3 requests per minute', async () => {
      const emailForRateLimit = 'fatima-rate-test@ein360.ae';
      // First send
      await rosterOtpPost(new NextRequest('http://localhost:3000/api/auth/roster-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'SEND_OTP', identifier: testEmail }),
      }));
      // Second send
      await rosterOtpPost(new NextRequest('http://localhost:3000/api/auth/roster-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'SEND_OTP', identifier: testEmail }),
      }));
      // Third send
      await rosterOtpPost(new NextRequest('http://localhost:3000/api/auth/roster-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'SEND_OTP', identifier: testEmail }),
      }));

      // Fourth send within window: rate limited (429)
      const res4 = await rosterOtpPost(new NextRequest('http://localhost:3000/api/auth/roster-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'SEND_OTP', identifier: testEmail }),
      }));
      expect(res4.status).toBe(429);
      const data = await res4.json();
      expect(data.error).toContain('Too many OTP requests');
    });
  });

  // ==========================================================================
  // CHALLENGE 4: Webhook Signature Spoofing Verification
  // ==========================================================================
  describe('Challenge 4: Webhook Signature Spoofing & Missing Secret Fail-Closed', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      process.env.TWILIO_AUTH_TOKEN = 'test-twilio-auth-token-12345';
      process.env.WHATSAPP_APP_SECRET = 'test-whatsapp-app-secret-67890';
      process.env.WHATSAPP_VERIFY_TOKEN = 'test-whatsapp-verify-token-abcde';
    });

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('CH-04-A: Twilio webhook rejects request when X-Twilio-Signature is missing (401)', async () => {
      const req = new NextRequest('http://localhost:3000/api/webhooks/twilio', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ MessageSid: 'SM123', MessageStatus: 'delivered' }),
      });

      const res = await twilioPost(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Missing X-Twilio-Signature');
    });

    it('CH-04-B: Twilio webhook rejects spoofed/invalid X-Twilio-Signature (403)', async () => {
      const req = new NextRequest('http://localhost:3000/api/webhooks/twilio', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-twilio-signature': 'spoofed_forged_base64_signature==',
        },
        body: JSON.stringify({ MessageSid: 'SM123', MessageStatus: 'delivered' }),
      });

      const res = await twilioPost(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('Invalid signature');
    });

    it('CH-04-C: Twilio webhook fails closed (503) if TWILIO_AUTH_TOKEN is unset', async () => {
      delete process.env.TWILIO_AUTH_TOKEN;

      const req = new NextRequest('http://localhost:3000/api/webhooks/twilio', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-twilio-signature': 'sig',
        },
        body: JSON.stringify({ MessageSid: 'SM123' }),
      });

      const res = await twilioPost(req);
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.error).toContain('Webhook secret not configured');
    });

    it('CH-04-D: WhatsApp webhook GET handshake rejects invalid verify_token (403)', async () => {
      const req = new NextRequest(
        'http://localhost:3000/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=attacker_token&hub.challenge=115599',
      );

      const res = await whatsappGet(req);
      expect(res.status).toBe(403);
    });

    it('CH-04-E: WhatsApp webhook POST (JSON) rejects missing X-Hub-Signature-256 (401)', async () => {
      const req = new NextRequest('http://localhost:3000/api/webhooks/whatsapp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ object: 'whatsapp_business_account', entry: [] }),
      });

      const res = await whatsappPost(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Missing signature');
    });

    it('CH-04-F: WhatsApp webhook POST (JSON) rejects spoofed HMAC signature (403)', async () => {
      const rawPayload = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
      const fakeHmac = crypto.createHmac('sha256', 'wrong_secret').update(rawPayload).digest('hex');

      const req = new NextRequest('http://localhost:3000/api/webhooks/whatsapp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': `sha256=${fakeHmac}`,
        },
        body: rawPayload,
      });

      const res = await whatsappPost(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('Invalid signature');
    });

    it('CH-04-G: Service Tickets WhatsApp Webhook rejects unsigned JSON (401)', async () => {
      const req = new NextRequest('http://localhost:3000/api/service-tickets/whatsapp-webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'Breakdown emergency', from: '+971501234567' }),
      });

      const res = await stWhatsappPost(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Missing X-Hub-Signature-256');
    });

    it('CH-04-H: Service Tickets WhatsApp Webhook rejects forged HMAC signature (403)', async () => {
      const payload = JSON.stringify({ body: 'Breakdown emergency', from: '+971501234567' });
      const forgedSig = 'sha256=0000000000000000000000000000000000000000000000000000000000000000';

      const req = new NextRequest('http://localhost:3000/api/service-tickets/whatsapp-webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': forgedSig,
        },
        body: payload,
      });

      const res = await stWhatsappPost(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('Invalid signature');
    });
  });

  // ==========================================================================
  // CHALLENGE 5: Secret Fallbacks, Rate Limiting & Security Headers
  // ==========================================================================
  describe('Challenge 5: Secret Fallbacks, Password Caps & Security Headers', () => {
    it('CH-05-A: Shipper portal session throws error in production when secret is missing', () => {
      const prevEnv = process.env.NODE_ENV;
      const prevSecret = process.env.SHIPPER_PORTAL_SESSION_SECRET;
      const prevSessionSecret = process.env.SESSION_SECRET;
      const prevAuthSecret = process.env.AUTH_SECRET;

      try {
        (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
        delete process.env.SHIPPER_PORTAL_SESSION_SECRET;
        delete process.env.SESSION_SECRET;
        delete process.env.AUTH_SECRET;

        expect(() => {
          signPortalSession({
            userId: 'u1',
            customerId: 'c1',
            tenantId: 't1',
          });
        }).toThrow(/SHIPPER_PORTAL_SESSION_SECRET must be configured in production/);
      } finally {
        (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;
        if (prevSecret) process.env.SHIPPER_PORTAL_SESSION_SECRET = prevSecret;
        if (prevSessionSecret) process.env.SESSION_SECRET = prevSessionSecret;
        if (prevAuthSecret) process.env.AUTH_SECRET = prevAuthSecret;
      }
    });

    it('CH-05-B: POST /api/auth/login rejects password exceeding 128 characters (400)', async () => {
      const overlyLongPassword = 'A'.repeat(129);
      const req = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@fleet360.ae',
          password: overlyLongPassword,
        }),
      });

      const res = await loginPost(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toContain('Password is too long');
    });

    it('CH-05-C: POST /api/tenants/provision rejects password exceeding 128 characters (422)', async () => {
      const overlyLongPassword = 'A'.repeat(129);
      const req = new NextRequest('http://localhost:3000/api/tenants/provision', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          companyName: 'Adversarial Corp',
          domain: 'adversarial.ae',
          contactEmail: 'admin@adversarial.ae',
          contactName: 'Admin Guy',
          adminFirstName: 'Admin',
          adminLastName: 'Guy',
          adminPassword: overlyLongPassword,
          selectedModules: ['admin'],
        }),
      });

      const res = await provisionPost(req);
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error).toContain('Validation Error');
    });

    it('CH-05-D: Global HTTP Security Headers configured in next.config.ts', async () => {
      expect(typeof nextConfig.headers).toBe('function');
      const headerConfigs = await (nextConfig.headers as any)();

      // Find catch-all route headers
      const catchAll = headerConfigs.find((h: any) => h.source === '/:path*');
      expect(catchAll).toBeDefined();

      const headerMap = new Map<string, string>();
      for (const h of catchAll.headers) {
        headerMap.set(h.key.toLowerCase(), h.value);
      }

      expect(headerMap.get('strict-transport-security')).toContain('max-age=63072000');
      expect(headerMap.get('x-frame-options')).toBe('SAMEORIGIN');
      expect(headerMap.get('x-content-type-options')).toBe('nosniff');
      expect(headerMap.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
      expect(headerMap.get('permissions-policy')).toBeDefined();
      expect(headerMap.get('content-security-policy')).toBeDefined();
    });
  });
});
