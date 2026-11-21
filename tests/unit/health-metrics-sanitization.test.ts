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

vi.mock('next/server', async () => await import('next/server.js'));

import { NextRequest } from 'next/server';

const { mockPrisma, settingsStore, mockLogAudit } = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    settingsStore: store,
    mockLogAudit: vi.fn().mockResolvedValue(undefined),
    mockPrisma: {
      $queryRawUnsafe: vi.fn(),
      $executeRawUnsafe: vi.fn(async (sql: string, key?: string, value?: string) => {
        if (String(sql).includes('platform_settings') && typeof key === 'string' && typeof value === 'string') {
          store.set(key, value);
        }
        return 1;
      }),
    },
  };
});

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}));

vi.mock('@/lib/agents/schema', () => ({
  ensureAgentSchema: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: mockLogAudit,
}));

vi.mock('@/lib/notifications', () => ({
  sendServerEmail: vi.fn().mockResolvedValue(true),
}));

import {
  getDbPoolMetrics,
  getGoogleMapsAndApisSpendingMetrics,
} from '@/lib/health/extended-metrics';
import {
  resetHealthAlertMemoryCacheForTests,
} from '@/lib/health/alerting';
import {
  GET as alertsGET,
  POST as alertsPOST,
} from '@/app/api/admin/health/alerts/route';

beforeEach(() => {
  vi.clearAllMocks();
  settingsStore.clear();
  vi.stubEnv('HEALTH_ALERT_WEBHOOK_URL', '');
  vi.stubEnv('SLACK_WEBHOOK_URL', '');
  vi.stubEnv('HEALTH_ALERT_EMAIL', '');
  vi.stubEnv('ADMIN_ALERT_EMAIL', '');
  vi.stubEnv('OPS_ALERT_EMAIL', '');
  resetHealthAlertMemoryCacheForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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

describe('M1-P0-1 / D: Alert webhook preservation, explicit clearing, and end-to-end redaction', () => {
  const SECRET_WEBHOOK = 'https://hooks.slack.com/services/T11111111/B22222222/SECRET_ALERT_TOKEN_999';
  const REPLACEMENT_WEBHOOK = 'https://discord.com/api/webhooks/123456789/NEW_SECRET_TOKEN_888';

  function superAdminHeaders(): Record<string, string> {
    return {
      'x-tenant-id': 'platform-tenant-1',
      'x-user-id': 'sa-1',
      'x-user-role': 'SUPER_ADMIN',
    };
  }

  function configureSettingsDbMock(): void {
    mockPrisma.$queryRawUnsafe.mockImplementation(async (sql: string) => {
      if (String(sql).includes('platform_settings')) {
        return Array.from(settingsStore.entries()).map(([key, value]) => ({ key, value }));
      }
      return [];
    });
  }

  beforeEach(() => {
    settingsStore.set('health_alert_enabled', 'true');
    settingsStore.set('health_alert_min_severity', 'degraded');
    settingsStore.set('health_alert_webhook_url', SECRET_WEBHOOK);
    settingsStore.set('health_alert_webhook_enabled', 'true');
    settingsStore.set('health_alert_email', 'ops@fleet360.example.com');
    settingsStore.set('health_alert_email_enabled', 'true');
    settingsStore.set('health_alert_cooldown_minutes', '15');
    configureSettingsDbMock();
  });

  it('denies unauthenticated (401) and TENANT_ADMIN (403) callers on GET and POST /api/admin/health/alerts', async () => {
    const unauthGet = await alertsGET(new NextRequest('https://fleet360.example.com/api/admin/health/alerts'));
    expect(unauthGet.status).toBe(401);

    const tenantGet = await alertsGET(
      new NextRequest('https://fleet360.example.com/api/admin/health/alerts', {
        headers: { 'x-tenant-id': 'tenant-1', 'x-user-id': 'u-1', 'x-user-role': 'TENANT_ADMIN' },
      }),
    );
    expect(tenantGet.status).toBe(403);

    const unauthPost = await alertsPOST(
      new NextRequest('https://fleet360.example.com/api/admin/health/alerts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'save', config: { cooldownMinutes: 30 } }),
      }),
    );
    expect(unauthPost.status).toBe(401);

    const tenantPost = await alertsPOST(
      new NextRequest('https://fleet360.example.com/api/admin/health/alerts', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 'tenant-1',
          'x-user-id': 'u-1',
          'x-user-role': 'TENANT_ADMIN',
        },
        body: JSON.stringify({ action: 'save', config: { cooldownMinutes: 30 } }),
      }),
    );
    expect(tenantPost.status).toBe(403);
  });

  it('GET /api/admin/health/alerts returns webhookConfigured=true and never exposes raw webhook URL characters', async () => {
    const res = await alertsGET(
      new NextRequest('https://fleet360.example.com/api/admin/health/alerts', {
        headers: superAdminHeaders(),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    const rawJson = JSON.stringify(body);

    expect(body.config.webhookConfigured).toBe(true);
    expect(body.config.webhookUrl).toBe('');
    expect(rawJson).not.toContain('SECRET_ALERT_TOKEN_999');
    expect(rawJson).not.toContain('hooks.slack.com');
    expect(rawJson).not.toContain('T11111111');
  });

  it('saving unrelated alert settings with omitted or blank webhookUrl preserves the stored webhook and redacts POST response', async () => {
    // 1. Omitted webhookUrl
    const resOmitted = await alertsPOST(
      new NextRequest('https://fleet360.example.com/api/admin/health/alerts', {
        method: 'POST',
        headers: { ...superAdminHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          config: { cooldownMinutes: 30, minSeverity: 'unhealthy' },
        }),
      }),
    );
    expect(resOmitted.status).toBe(200);
    const bodyOmitted = await resOmitted.json();
    expect(bodyOmitted.config.cooldownMinutes).toBe(30);
    expect(bodyOmitted.config.webhookConfigured).toBe(true);
    expect(bodyOmitted.config.webhookUrl).toBe('');
    expect(JSON.stringify(bodyOmitted)).not.toContain('SECRET_ALERT_TOKEN_999');
    expect(settingsStore.get('health_alert_webhook_url')).toBe(SECRET_WEBHOOK);

    // 2. Blank / whitespace webhookUrl (e.g., unchanged form input)
    const resBlank = await alertsPOST(
      new NextRequest('https://fleet360.example.com/api/admin/health/alerts', {
        method: 'POST',
        headers: { ...superAdminHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          config: { webhookUrl: '   ', email: 'oncall@fleet360.example.com' },
        }),
      }),
    );
    expect(resBlank.status).toBe(200);
    const bodyBlank = await resBlank.json();
    expect(bodyBlank.config.email).toBe('oncall@fleet360.example.com');
    expect(bodyBlank.config.webhookConfigured).toBe(true);
    expect(bodyBlank.config.webhookUrl).toBe('');
    expect(JSON.stringify(bodyBlank)).not.toContain('SECRET_ALERT_TOKEN_999');
    expect(settingsStore.get('health_alert_webhook_url')).toBe(SECRET_WEBHOOK);
  });

  it('Test Alert without replacement URL uses the stored webhook and never leaks raw webhook URL on success or failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const okRes = await alertsPOST(
      new NextRequest('https://fleet360.example.com/api/admin/health/alerts', {
        method: 'POST',
        headers: { ...superAdminHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'test',
          config: { webhookUrl: '', email: '' },
        }),
      }),
    );
    expect(okRes.status).toBe(200);
    const okBody = await okRes.json();
    expect(okBody.success).toBe(true);
    expect(okBody.webhook.attempted).toBe(true);
    expect(okBody.webhook.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(SECRET_WEBHOOK, expect.objectContaining({ method: 'POST' }));
    expect(JSON.stringify(okBody)).not.toContain('SECRET_ALERT_TOKEN_999');
    expect(JSON.stringify(okBody)).not.toContain('hooks.slack.com');

    // Upstream HTTP 500 echoing raw webhook URL must NOT leak into response
    fetchMock.mockResolvedValueOnce(
      new Response(`Failed delivering to ${SECRET_WEBHOOK}`, { status: 500 }),
    );
    const httpErrRes = await alertsPOST(
      new NextRequest('https://fleet360.example.com/api/admin/health/alerts', {
        method: 'POST',
        headers: { ...superAdminHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'test', config: { email: '' } }),
      }),
    );
    const httpErrBody = await httpErrRes.json();
    expect(httpErrBody.webhook.success).toBe(false);
    expect(httpErrBody.webhook.error).toBe('Webhook returned HTTP 500');
    expect(JSON.stringify(httpErrBody)).not.toContain('SECRET_ALERT_TOKEN_999');
    expect(JSON.stringify(httpErrBody)).not.toContain('hooks.slack.com');

    // Network exception embedding raw webhook URL must NOT leak into response OR console.error
    fetchMock.mockRejectedValueOnce(new Error(`connect ECONNREFUSED ${SECRET_WEBHOOK}`));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const netErrRes = await alertsPOST(
        new NextRequest('https://fleet360.example.com/api/admin/health/alerts', {
          method: 'POST',
          headers: { ...superAdminHeaders(), 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'test', config: { email: '' } }),
        }),
      );
      const netErrBody = await netErrRes.json();
      expect(netErrBody.webhook.success).toBe(false);
      expect(JSON.stringify(netErrBody)).not.toContain('SECRET_ALERT_TOKEN_999');
      expect(JSON.stringify(netErrBody)).not.toContain('hooks.slack.com');

      const loggedText = errSpy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
      expect(loggedText).not.toContain('SECRET_ALERT_TOKEN_999');
      expect(loggedText).not.toContain('hooks.slack.com');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('explicit clearWebhookUrl: true removes the stored webhook (including env fallback) and disables subsequent test dispatches', async () => {
    vi.stubEnv('HEALTH_ALERT_WEBHOOK_URL', SECRET_WEBHOOK);

    const clearRes = await alertsPOST(
      new NextRequest('https://fleet360.example.com/api/admin/health/alerts', {
        method: 'POST',
        headers: { ...superAdminHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          config: { clearWebhookUrl: true },
        }),
      }),
    );
    expect(clearRes.status).toBe(200);
    const clearBody = await clearRes.json();
    expect(clearBody.config.webhookConfigured).toBe(false);
    expect(clearBody.config.webhookEnabled).toBe(false);
    expect(clearBody.config.webhookUrl).toBe('');
    expect(settingsStore.get('health_alert_webhook_url')).toBe('');

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const testAfterClear = await alertsPOST(
      new NextRequest('https://fleet360.example.com/api/admin/health/alerts', {
        method: 'POST',
        headers: { ...superAdminHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'test', config: { email: '' } }),
      }),
    );
    const testBody = await testAfterClear.json();
    expect(testBody.webhook.attempted).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('replacing webhookUrl persists the new URL while keeping POST response fully redacted', async () => {
    const res = await alertsPOST(
      new NextRequest('https://fleet360.example.com/api/admin/health/alerts', {
        method: 'POST',
        headers: { ...superAdminHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          config: { webhookUrl: REPLACEMENT_WEBHOOK, webhookEnabled: true },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config.webhookConfigured).toBe(true);
    expect(body.config.webhookUrl).toBe('');
    expect(JSON.stringify(body)).not.toContain('NEW_SECRET_TOKEN_888');
    expect(JSON.stringify(body)).not.toContain('discord.com');
    expect(settingsStore.get('health_alert_webhook_url')).toBe(REPLACEMENT_WEBHOOK);
  });

  it('redacts raw webhook URL from logs/responses on DB write failures and rejects malformed JSON with 400', async () => {
    const badJsonRes = await alertsPOST(
      new NextRequest('https://fleet360.example.com/api/admin/health/alerts', {
        method: 'POST',
        headers: { ...superAdminHeaders(), 'content-type': 'application/json' },
        body: '{malformed-json',
      }),
    );
    expect(badJsonRes.status).toBe(400);

    mockPrisma.$executeRawUnsafe.mockRejectedValueOnce(
      new Error(`duplicate key value violates constraint for ${REPLACEMENT_WEBHOOK}`),
    );
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await alertsPOST(
        new NextRequest('https://fleet360.example.com/api/admin/health/alerts', {
          method: 'POST',
          headers: { ...superAdminHeaders(), 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'save',
            config: { webhookUrl: REPLACEMENT_WEBHOOK, webhookEnabled: true },
          }),
        }),
      );
      const body = await res.json();
      expect(JSON.stringify(body)).not.toContain('NEW_SECRET_TOKEN_888');
      expect(JSON.stringify(body)).not.toContain('discord.com');

      const loggedText = errSpy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
      expect(loggedText).not.toContain('NEW_SECRET_TOKEN_888');
      expect(loggedText).not.toContain('discord.com');
    } finally {
      errSpy.mockRestore();
    }
  });
});
