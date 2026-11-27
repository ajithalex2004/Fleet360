/**
 * Native Resend HTTPS Email API & Admin Test Channel Regression Suite
 *
 * Covers:
 *  - Platform-settings Resend API delivery (`POST https://api.resend.com/emails`)
 *  - `RESEND_API_KEY` env fallback vs explicit `email_provider = 'smtp'` precedence
 *  - Error classification (`4xx` -> DEFINITE_FAILURE, `5xx`/network -> UNCERTAIN)
 *  - Strict API-key secret redaction in logs and error responses
 *  - Header-injection sanitization (`\r\n` stripping)
 *  - Staging quarantine (`DISABLE_OUTBOUND_NOTIFICATIONS` / `MOCK_NOTIFICATIONS`)
 *  - `isEmailTransportConfigured()` for Resend DB/env configs
 *  - `POST /api/admin/test-channel` Resend flow, `SUPER_ADMIN` guard, stored API-key
 *    reuse (`canReuseStoredEmailApiKey`), anti-exfiltration provider-swap block, and
 *    SMTP non-Exchange sender resolution (`smtp.resend.com` vs Office 365).
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

import { NextRequest } from 'next/server';

const { mockPrisma, mockWithPlatformAdmin, mockCaptureException, mockSendMail, mockVerify, mockCreateTransport } =
  vi.hoisted(() => {
    const prisma = {
      $queryRawUnsafe: vi.fn(),
    };
    const sendMail = vi.fn().mockResolvedValue({ messageId: '<smtp-msg-1@example.com>' });
    const verify = vi.fn().mockResolvedValue(true);
    const createTransport = vi.fn(() => ({ sendMail, verify }));
    return {
      mockPrisma: prisma,
      mockWithPlatformAdmin: vi.fn(async (_p: unknown, fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)),
      mockCaptureException: vi.fn(),
      mockSendMail: sendMail,
      mockVerify: verify,
      mockCreateTransport: createTransport,
    };
  });

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/rls', () => ({ withPlatformAdmin: mockWithPlatformAdmin }));
vi.mock('@/lib/sentry', () => ({ captureException: mockCaptureException }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('nodemailer', () => ({
  default: { createTransport: mockCreateTransport },
  createTransport: mockCreateTransport,
}));

let sendEmail: typeof import('@/lib/email').sendEmail;
let isEmailTransportConfigured: typeof import('@/lib/email').isEmailTransportConfigured;
let invalidateSmtpCache: typeof import('@/lib/email').invalidateSmtpCache;
let testChannelPOST: typeof import('@/app/api/admin/test-channel/route').POST;
let canReuseStoredEmailApiKey: typeof import('@/lib/platform-settings-secrets').canReuseStoredEmailApiKey;

beforeAll(async () => {
  vi.resetModules();
  ({ sendEmail, isEmailTransportConfigured, invalidateSmtpCache } = await import('@/lib/email'));
  ({ POST: testChannelPOST } = await import('@/app/api/admin/test-channel/route'));
  ({ canReuseStoredEmailApiKey } = await import('@/lib/platform-settings-secrets'));
});

function setPlatformRows(entries: Record<string, string>) {
  const rows = Object.entries(entries).map(([key, value]) => ({ key, value }));
  mockPrisma.$queryRawUnsafe.mockResolvedValue(rows);
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateSmtpCache();
  mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
  mockSendMail.mockResolvedValue({ messageId: '<smtp-msg-1@example.com>' });
  mockVerify.mockResolvedValue(true);
  mockCreateTransport.mockReturnValue({ sendMail: mockSendMail, verify: mockVerify });
  mockWithPlatformAdmin.mockImplementation(async (_p: unknown, fn: (tx: typeof mockPrisma) => Promise<unknown>) =>
    fn(mockPrisma),
  );
  vi.stubEnv('DISABLE_OUTBOUND_NOTIFICATIONS', '');
  vi.stubEnv('MOCK_NOTIFICATIONS', '');
  vi.stubEnv('RESEND_API_KEY', '');
  vi.stubEnv('SENDGRID_API_KEY', '');
  vi.stubEnv('EMAIL_FROM', '');
  vi.stubEnv('SMTP_FROM', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Native Resend HTTPS Email API (src/lib/email.ts)', () => {
  it('sends via Resend REST API when platform_settings.email_provider is "resend"', async () => {
    setPlatformRows({
      email_provider: 'resend',
      email_api_key: 're_live_secret_1234567890',
      email_from_name: 'Fleet360\r\nOps',
      email_from_address: 'noreply@fleet360.ae',
      email_reply_to: 'support@fleet360.ae',
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 're_msg_abc123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    expect(await isEmailTransportConfigured()).toBe(true);

    const res = await sendEmail({
      to: ['ops@example.com'],
      subject: 'Invoice Ready',
      html: '<p>Hello</p>',
      text: 'Hello',
    });

    expect(res).toEqual({
      sent: true,
      status: 200,
      transport: 'resend',
      id: 're_msg_abc123',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_live_secret_1234567890');
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      from: '"Fleet360 Ops" <noreply@fleet360.ae>',
      to: ['ops@example.com'],
      subject: 'Invoice Ready',
      html: '<p>Hello</p>',
      text: 'Hello',
      reply_to: 'support@fleet360.ae',
    });
  });

  it('supports RESEND_API_KEY env fallback unless admin explicitly configured smtp', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_env_fallback_999999');
    vi.stubEnv('EMAIL_FROM', 'alerts@fleet360.ae');

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 're_env_1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    expect(await isEmailTransportConfigured()).toBe(true);
    const envRes = await sendEmail({ to: 'a@example.com', subject: 'Ping' });
    expect(envRes.sent).toBe(true);
    expect(envRes.transport).toBe('resend');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Explicit DB email_provider = 'smtp' takes precedence over RESEND_API_KEY env
    invalidateSmtpCache();
    setPlatformRows({
      email_provider: 'smtp',
      smtp_host: 'smtp.example.com',
      smtp_port: '465',
      smtp_encryption: 'ssl',
      smtp_username: 'mailer@example.com',
      smtp_password: 'smtp-secret-password',
      email_from_address: 'mailer@example.com',
    });
    const smtpRes = await sendEmail({ to: 'b@example.com', subject: 'Via SMTP' });
    expect(smtpRes.sent).toBe(true);
    expect(smtpRes.transport).toBe('smtp');
    expect(mockCreateTransport).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('classifies 4xx as DEFINITE_FAILURE, 5xx/network as UNCERTAIN, and redacts API key from errors', async () => {
    const secretKey = 're_super_secret_token_xyz987';
    setPlatformRows({
      email_provider: 'resend',
      email_api_key: secretKey,
      email_from_address: 'noreply@fleet360.ae',
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // 422 rejected (DEFINITE_FAILURE) + secret echoed by upstream is scrubbed
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: `Domain not verified for key ${secretKey}` }), { status: 422 }),
      ),
    );
    const r422 = await sendEmail({ to: 'u@example.com', subject: 'Test' });
    expect(r422.sent).toBe(false);
    expect(r422.reason).toBe('resend_error');
    expect(r422.errorClass).toBe('DEFINITE_FAILURE');
    expect(r422.error).not.toContain(secretKey);
    expect(r422.error).toContain('[REDACTED_SECRET]');

    // 503 upstream outage (UNCERTAIN)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Service Unavailable', { status: 503 })));
    const r503 = await sendEmail({ to: 'u@example.com', subject: 'Test' });
    expect(r503.sent).toBe(false);
    expect(r503.errorClass).toBe('UNCERTAIN');

    // Network failure (UNCERTAIN) + key redacted
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`ECONNRESET auth=${secretKey}`)));
    const rNet = await sendEmail({ to: 'u@example.com', subject: 'Test' });
    expect(rNet.sent).toBe(false);
    expect(rNet.reason).toBe('network_error');
    expect(rNet.errorClass).toBe('UNCERTAIN');
    expect(rNet.error).not.toContain(secretKey);

    errSpy.mockRestore();
  });

  it('respects staging quarantine and reports unconfigured when API key or From address is missing', async () => {
    setPlatformRows({
      email_provider: 'resend',
      email_api_key: '',
      email_from_address: 'noreply@fleet360.ae',
    });
    expect(await isEmailTransportConfigured()).toBe(false);
    const unconf = await sendEmail({ to: 'u@example.com', subject: 'Test' });
    expect(unconf.sent).toBe(false);
    expect(unconf.reason).toBe('resend_not_configured');

    invalidateSmtpCache();
    setPlatformRows({
      email_provider: 'resend',
      email_api_key: 're_valid_123456',
      email_from_address: 'noreply@fleet360.ae',
    });
    vi.stubEnv('DISABLE_OUTBOUND_NOTIFICATIONS', 'true');
    expect(await isEmailTransportConfigured()).toBe(false);
    const quarantined = await sendEmail({ to: 'u@example.com', subject: 'Test' });
    expect(quarantined).toEqual({
      sent: false,
      reason: 'quarantined_in_staging',
      transport: 'quarantined',
    });
  });
});

describe('Admin POST /api/admin/test-channel (Resend API + Secret Binding + Non-Exchange SMTP)', () => {
  function superAdminRequest(body: unknown) {
    return new NextRequest('https://fleet360.example.com/api/admin/test-channel', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': 'tenant-root',
        'x-user-id': 'admin-1',
        'x-user-role': 'SUPER_ADMIN',
      },
      body: JSON.stringify(body),
    });
  }

  it('sends live Resend test email with supplied key, returns Cache-Control: no-store, and blocks non-SUPER_ADMIN', async () => {
    const nonAdmin = await testChannelPOST(
      new NextRequest('https://fleet360.example.com/api/admin/test-channel', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 'tenant-a',
          'x-user-id': 'u-1',
          'x-user-role': 'TENANT_ADMIN',
        },
        body: JSON.stringify({ channel: 'email', settings: { email_provider: 'resend' } }),
      }),
    );
    expect(nonAdmin.status).toBe(403);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 're_test_999' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await testChannelPOST(
      superAdminRequest({
        channel: 'email',
        toEmail: 'admin@example.com',
        settings: {
          email_provider: 'resend',
          email_from_name: 'Fleet360',
          email_from_address: 'noreply@fleet360.ae',
          email_api_key: 're_supplied_key_123456',
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.messageId).toBe('re_test_999');
  });

  it('reuses stored email_api_key ONLY when saved email_provider matches (blocks provider-swap exfiltration)', async () => {
    // Unit check on helper
    expect(
      canReuseStoredEmailApiKey({ email_provider: 'resend', email_api_key: 're_saved_1234' }, 'resend'),
    ).toEqual({ ok: true, apiKey: 're_saved_1234' });
    expect(
      canReuseStoredEmailApiKey({ email_provider: 'sendgrid', email_api_key: 'sg_saved_1234' }, 'resend').ok,
    ).toBe(false);

    // Provider matches -> reuses stored key cleanly
    setPlatformRows({
      email_provider: 'resend',
      email_api_key: 're_stored_secret_7777',
      email_from_address: 'noreply@fleet360.ae',
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 're_reused_1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const okRes = await testChannelPOST(
      superAdminRequest({
        channel: 'email',
        toEmail: 'inbox@example.com',
        settings: {
          email_provider: 'resend',
          email_from_address: 'noreply@fleet360.ae',
          email_api_key: '',
        },
      }),
    );
    expect(okRes.status).toBe(200);
    expect((fetchMock.mock.calls[0][1] as RequestInit & { headers: Record<string, string> }).headers.Authorization).toBe(
      'Bearer re_stored_secret_7777',
    );

    // Provider swapped (stored was sendgrid, request asks for resend with blank key) -> 400 blocked
    setPlatformRows({
      email_provider: 'sendgrid',
      email_api_key: 'sg_other_provider_key',
    });
    const blockedRes = await testChannelPOST(
      superAdminRequest({
        channel: 'email',
        toEmail: 'inbox@example.com',
        settings: {
          email_provider: 'resend',
          email_from_address: 'noreply@fleet360.ae',
          email_api_key: '',
        },
      }),
    );
    expect(blockedRes.status).toBe(400);
  });

  it('uses email_from_address for non-Exchange SMTP relays (e.g. smtp.resend.com) and smtp_username for Exchange', async () => {
    const res1 = await testChannelPOST(
      superAdminRequest({
        channel: 'email',
        toEmail: 'inbox@example.com',
        settings: {
          email_provider: 'smtp',
          email_from_name: 'Fleet360',
          email_from_address: 'noreply@fleet360.ae',
          smtp_host: 'smtp.resend.com',
          smtp_port: '465',
          smtp_encryption: 'ssl',
          smtp_username: 'resend',
          smtp_password: 're_smtp_password_1234',
        },
      }),
    );
    expect(res1.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: '"Fleet360" <noreply@fleet360.ae>' }),
    );

    mockSendMail.mockClear();
    const res2 = await testChannelPOST(
      superAdminRequest({
        channel: 'email',
        toEmail: 'inbox@example.com',
        settings: {
          email_provider: 'smtp',
          email_from_name: 'Fleet360',
          email_from_address: 'alias@fleet360.ae',
          smtp_host: 'smtp.office365.com',
          smtp_port: '587',
          smtp_encryption: 'tls',
          smtp_username: 'alerts@fleet360.ae',
          smtp_password: 'o365-password-1234',
        },
      }),
    );
    expect(res2.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: '"Fleet360" <alerts@fleet360.ae>' }),
    );
  });
});
