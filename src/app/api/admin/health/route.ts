export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { ensureDbConnected, prisma } from '@/lib/prisma';
import { schemaReport, REQUIRED_SCHEMAS } from '@/lib/db/schema-registry';
import { storageStatus } from '@/lib/storage/health';
import { redisStatus } from '@/lib/redis-status';
import { goBackendConfigured } from '@/lib/go-routes';
import { getBackgroundJobsAndOutboxHealth } from '@/lib/jobs/health';
import {
  getDbPoolMetrics,
  getEnterpriseBridgeMetrics,
  getSecurityHealthMetrics,
  getAiHealthAndSpendingMetrics,
  getGoogleMapsAndApisSpendingMetrics,
} from '@/lib/health/extended-metrics';
import {
  getHealthAlertConfig,
  evaluateAndTriggerHealthAlerts,
} from '@/lib/health/alerting';

const RELEASE =
  process.env.GIT_COMMIT_SHA ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.RAILWAY_GIT_COMMIT_SHA ??
  'unknown';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  const startTime = Date.now();

  // 1. Database Check
  let dbStatus: 'connected' | 'error' = 'connected';
  let dbError: string | null = null;
  const dbStart = Date.now();
  try {
    await ensureDbConnected({ force: true, retries: 2, timeoutMs: 2_500 });
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    dbStatus = 'error';
    dbError = err instanceof Error ? err.message : String(err);
    console.error('[api/admin/health] database check failed:', err);
  }
  const dbLatencyMs = Date.now() - dbStart;

  // 2. Integrations Check
  const integrations = {
    stripe: {
      name: 'Stripe Payments',
      category: 'Billing',
      configured: !!process.env.STRIPE_SECRET_KEY,
      description: 'Customer checkout, subscription billing and webhook processing',
    },
    sendgrid: {
      name: 'SendGrid / Email',
      category: 'Messaging',
      configured: !!process.env.SENDGRID_API_KEY && !!(process.env.EMAIL_FROM ?? process.env.SMTP_FROM),
      description: 'Transactional email notifications, contract summaries and alerts',
    },
    sentry: {
      name: 'Sentry Telemetry',
      category: 'Monitoring',
      configured: !!(process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN),
      description: 'Real-time error tracking and application performance monitoring',
    },
    googleMaps: {
      name: 'Google Maps Platform',
      category: 'Geospatial',
      configured: !!(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY),
      description: 'Geocoding, route rendering, distance matrix, and vehicle live tracking maps',
    },
    ssoEncryption: {
      name: 'SSO Key Encryption',
      category: 'Security',
      configured: !!process.env.SSO_ENCRYPTION_KEY,
      description: 'At-rest encryption key for enterprise SAML & OIDC credentials',
    },
    appUrl: {
      name: 'Public App URL',
      category: 'Routing',
      configured: !!process.env.NEXT_PUBLIC_APP_URL,
      value: process.env.NEXT_PUBLIC_APP_URL || null,
      description: 'Canonical base URL used for email links and webhook callbacks',
    },
    sessionSecret: {
      name: 'Session Secret',
      category: 'Security',
      configured: !!process.env.SESSION_SECRET,
      description: 'Cryptographic secret used to sign and seal user session cookies',
    },
  };

  const missingIntegrations = Object.entries(integrations)
    .filter(([, v]) => !v.configured)
    .map(([k]) => k);

  // 3. Schema Status Check
  const schema = await schemaReport({ fresh: true });

  // 4. File Storage Check
  const storage = await storageStatus();

  // 5. Upstash Redis Check
  const redis = await redisStatus();

  // 6. Go Backend Service Readiness Check
  let backendInfo: {
    status: 'ready' | 'not_ready' | 'unreachable' | 'disabled';
    version?: string;
    url?: string;
    error?: string;
    latencyMs?: number;
  };

  const goConfigured = goBackendConfigured();
  const goBackendUrl = process.env.GO_BACKEND_URL;

  if (goConfigured && goBackendUrl) {
    const bStart = Date.now();
    try {
      const bRes = await fetch(new URL('/readyz', goBackendUrl), {
        cache: 'no-store',
        signal: AbortSignal.timeout(2500),
      });
      const bData = await bRes.json().catch(() => ({}));
      const bLatency = Date.now() - bStart;

      backendInfo = {
        status: bRes.ok ? 'ready' : 'not_ready',
        version: bData.version,
        url: goBackendUrl,
        latencyMs: bLatency,
        ...(bRes.ok ? {} : { error: `HTTP ${bRes.status}` }),
      };
    } catch (bErr) {
      backendInfo = {
        status: 'unreachable',
        url: goBackendUrl,
        latencyMs: Date.now() - bStart,
        error: bErr instanceof Error ? bErr.message : String(bErr),
      };
    }
  } else {
    backendInfo = {
      status: 'disabled',
      error: 'GO_BACKEND_URL is not set or Go routes are disabled',
    };
  }

  // 7. Background Jobs Scheduler, Runs & Outbox Health
  const jobsAndOutbox = await getBackgroundJobsAndOutboxHealth();

  // 8. Extended Health Subsystems: DB Pool & Compute, Enterprise Bridge, Security, AI & Maps Spending, Alerting Config
  const [dbPool, enterpriseBridge, security, aiSpending, googleApisSpending, alertConfig] = await Promise.all([
    getDbPoolMetrics(),
    getEnterpriseBridgeMetrics(),
    getSecurityHealthMetrics(),
    getAiHealthAndSpendingMetrics(),
    getGoogleMapsAndApisSpendingMetrics(),
    getHealthAlertConfig().catch(() => null),
  ]);

  // Calculate Rollup Status
  let overallStatus: 'ok' | 'degraded' | 'unhealthy' = 'ok';
  if (dbStatus === 'error' || dbPool.status === 'critical') {
    overallStatus = 'unhealthy';
  } else if (
    missingIntegrations.length > 0 ||
    schema.status === 'incomplete' ||
    !storage.durable ||
    !storage.ok ||
    (backendInfo.status === 'unreachable' || backendInfo.status === 'not_ready') ||
    (redis.configured && !redis.reachable) ||
    jobsAndOutbox.jobRuns24h.status === 'critical' ||
    jobsAndOutbox.outbox.status === 'critical' ||
    dbPool.status === 'warning' ||
    enterpriseBridge.status === 'error' ||
    security.status === 'critical'
  ) {
    overallStatus = 'degraded';
  }

  // System & Environment Info
  const systemInfo = {
    release: RELEASE,
    nodeVersion: process.version,
    platform: process.platform,
    environment: process.env.NODE_ENV || 'production',
    uptimeSeconds: Math.floor(process.uptime()),
    memory: {
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
  };

  const responseTimeMs = Date.now() - startTime;

  // Asynchronously evaluate automated health alerting rules (Slack / Discord Webhook / Email)
  evaluateAndTriggerHealthAlerts({
    status: overallStatus,
    responseTimeMs,
    db: { status: dbStatus, latencyMs: dbLatencyMs, error: dbError },
    storage: { ok: storage.ok, durable: storage.durable, error: storage.error ?? null },
    redis: { reachable: redis.reachable, roundTripMs: redis.roundTripMs, error: redis.error ?? null },
    schema: { status: schema.status, missingCount: schema.missingCount },
    backend: backendInfo,
    jobsAndOutbox,
    dbPool,
    enterpriseBridge,
    security,
    integrations: { missingKeys: missingIntegrations },
  }).catch((alertErr) => {
    console.error('[api/admin/health] alert evaluation failed:', alertErr);
  });

  return NextResponse.json(
    {
      status: overallStatus,
      responseTimeMs,
      timestamp: new Date().toISOString(),
      db: {
        status: dbStatus,
        latencyMs: dbLatencyMs,
        error: dbError,
      },
      dbPool,
      storage: {
        backend: storage.backend,
        durable: storage.durable,
        ok: storage.ok,
        error: storage.error ?? null,
      },
      schema: {
        status: schema.status,
        missingCount: schema.missingCount,
        missing: schema.missing,
        totalCheckedModules: Object.keys(REQUIRED_SCHEMAS).length,
      },
      backend: backendInfo,
      redis: {
        configured: redis.configured,
        reachable: redis.reachable,
        roundTripMs: redis.roundTripMs,
        host: redis.host,
        error: redis.error,
        checkedAt: redis.checkedAt,
      },
      integrations: {
        items: integrations,
        total: Object.keys(integrations).length,
        configuredCount: Object.values(integrations).filter((i) => i.configured).length,
        missingKeys: missingIntegrations,
      },
      jobsAndOutbox,
      enterpriseBridge,
      security,
      aiSpending,
      googleApisSpending,
      alerting: alertConfig
        ? {
            enabled: alertConfig.enabled,
            minSeverity: alertConfig.minSeverity,
            webhookConfigured: !!alertConfig.webhookUrl,
            webhookEnabled: alertConfig.webhookEnabled,
            emailConfigured: !!alertConfig.email,
            emailEnabled: alertConfig.emailEnabled,
            webhookUrl: alertConfig.webhookUrl ? `${alertConfig.webhookUrl.slice(0, 28)}...` : '',
            email: alertConfig.email || '',
            cooldownMinutes: alertConfig.cooldownMinutes,
            lastStatus: alertConfig.lastStatus,
            lastSentAt: alertConfig.lastSentAt,
            lastSummary: alertConfig.lastSummary,
          }
        : null,
      system: systemInfo,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
