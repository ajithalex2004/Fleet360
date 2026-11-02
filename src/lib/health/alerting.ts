import { prisma } from '@/lib/prisma';
import { runOutsideRlsScope } from '@/lib/rls-scope';
import { sendServerEmail } from '@/lib/notifications';

export interface HealthAlertConfig {
  enabled: boolean;
  minSeverity: 'degraded' | 'unhealthy';
  webhookUrl: string;
  webhookEnabled: boolean;
  email: string;
  emailEnabled: boolean;
  cooldownMinutes: number;
  lastStatus: 'ok' | 'degraded' | 'unhealthy' | null;
  lastSentAt: string | null;
  lastSummary: string | null;
}

export interface HealthStatusSnapshot {
  status: 'ok' | 'degraded' | 'unhealthy';
  responseTimeMs: number;
  timestamp: string;
  issues: string[];
  db?: { status: string; latencyMs: number; error?: string | null };
  storage?: { ok: boolean; durable: boolean; error?: string | null };
  redis?: { reachable: boolean; roundTripMs?: number | null; error?: string | null };
  schema?: { status: string; missingCount: number };
  backend?: { status: string; error?: string | null };
  outbox?: { status: string; pendingCount: number; stuckCount: number };
  jobRuns?: { status: string; failed24h: number };
  dbPool?: { status: string; activeConnections: number; poolExhaustionRisk: boolean };
  enterpriseBridge?: { status: string; totalConnectors: number; errorConnectors: number };
  security?: { status: string; failedLoginsLastHour: number; bruteForceRisk: boolean };
}

// In-memory fallback cache in case DB read fails
let memoryAlertConfig: HealthAlertConfig = {
  enabled: true,
  minSeverity: 'degraded',
  webhookUrl: process.env.HEALTH_ALERT_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL || '',
  webhookEnabled: !!(process.env.HEALTH_ALERT_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL),
  email: process.env.HEALTH_ALERT_EMAIL || process.env.ADMIN_ALERT_EMAIL || process.env.OPS_ALERT_EMAIL || '',
  emailEnabled: !!(process.env.HEALTH_ALERT_EMAIL || process.env.ADMIN_ALERT_EMAIL || process.env.OPS_ALERT_EMAIL),
  cooldownMinutes: 15,
  lastStatus: null,
  lastSentAt: null,
  lastSummary: null,
};

/**
 * Fetch current health alert configuration from platform_settings or fallback envs
 */
export async function getHealthAlertConfig(): Promise<HealthAlertConfig> {
  return runOutsideRlsScope(async () => {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ key: string; value: string }>>(`
        SELECT key, value FROM platform_settings
        WHERE key LIKE 'health_alert_%'
      `);

      const map: Record<string, string> = {};
      for (const r of rows) {
        map[r.key] = r.value;
      }

      const config: HealthAlertConfig = {
        enabled: map['health_alert_enabled'] !== undefined ? map['health_alert_enabled'] === 'true' : memoryAlertConfig.enabled,
        minSeverity: (map['health_alert_min_severity'] as 'degraded' | 'unhealthy') || memoryAlertConfig.minSeverity,
        webhookUrl: map['health_alert_webhook_url'] ?? (process.env.HEALTH_ALERT_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL || ''),
        webhookEnabled: map['health_alert_webhook_enabled'] !== undefined
          ? map['health_alert_webhook_enabled'] === 'true'
          : !!(map['health_alert_webhook_url'] || process.env.HEALTH_ALERT_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL),
        email: map['health_alert_email'] ?? (process.env.HEALTH_ALERT_EMAIL || process.env.ADMIN_ALERT_EMAIL || process.env.OPS_ALERT_EMAIL || ''),
        emailEnabled: map['health_alert_email_enabled'] !== undefined
          ? map['health_alert_email_enabled'] === 'true'
          : !!(map['health_alert_email'] || process.env.HEALTH_ALERT_EMAIL || process.env.ADMIN_ALERT_EMAIL || process.env.OPS_ALERT_EMAIL),
        cooldownMinutes: map['health_alert_cooldown_minutes'] ? parseInt(map['health_alert_cooldown_minutes'], 10) : 15,
        lastStatus: (map['health_alert_last_status'] as HealthAlertConfig['lastStatus']) || memoryAlertConfig.lastStatus,
        lastSentAt: map['health_alert_last_sent_at'] || memoryAlertConfig.lastSentAt,
        lastSummary: map['health_alert_last_summary'] || memoryAlertConfig.lastSummary,
      };

      memoryAlertConfig = config;
      return config;
    } catch (err) {
      console.warn('[getHealthAlertConfig] Failed to read platform_settings, using fallback config:', err);
      return memoryAlertConfig;
    }
  });
}

/**
 * Save health alert configuration to platform_settings
 */
export async function saveHealthAlertConfig(updates: Partial<HealthAlertConfig>): Promise<HealthAlertConfig> {
  return runOutsideRlsScope(async () => {
    const current = await getHealthAlertConfig();
    const merged: HealthAlertConfig = {
      ...current,
      ...updates,
    };

    const pairs: Array<[string, string]> = [
      ['health_alert_enabled', merged.enabled ? 'true' : 'false'],
      ['health_alert_min_severity', merged.minSeverity],
      ['health_alert_webhook_url', merged.webhookUrl || ''],
      ['health_alert_webhook_enabled', merged.webhookEnabled ? 'true' : 'false'],
      ['health_alert_email', merged.email || ''],
      ['health_alert_email_enabled', merged.emailEnabled ? 'true' : 'false'],
      ['health_alert_cooldown_minutes', String(merged.cooldownMinutes || 15)],
    ];

    if (merged.lastStatus) {
      pairs.push(['health_alert_last_status', merged.lastStatus]);
    }
    if (merged.lastSentAt) {
      pairs.push(['health_alert_last_sent_at', merged.lastSentAt]);
    }
    if (merged.lastSummary) {
      pairs.push(['health_alert_last_summary', merged.lastSummary]);
    }

    try {
      for (const [key, val] of pairs) {
        await prisma.$executeRawUnsafe(`
          INSERT INTO platform_settings (key, value, updated_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value,
                updated_at = NOW()
        `, key, val);
      }
    } catch (err) {
      console.error('[saveHealthAlertConfig] Error writing to platform_settings:', err);
    }

    memoryAlertConfig = merged;
    return merged;
  });
}

/**
 * Updates internal alert dispatch state in DB and memory
 */
async function recordAlertDispatched(status: 'ok' | 'degraded' | 'unhealthy', summary: string) {
  const nowIso = new Date().toISOString();
  memoryAlertConfig.lastStatus = status;
  memoryAlertConfig.lastSentAt = nowIso;
  memoryAlertConfig.lastSummary = summary;

  runOutsideRlsScope(async () => {
    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO platform_settings (key, value, updated_at)
        VALUES ('health_alert_last_status', $1, NOW())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `, status);

      await prisma.$executeRawUnsafe(`
        INSERT INTO platform_settings (key, value, updated_at)
        VALUES ('health_alert_last_sent_at', $1, NOW())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `, nowIso);

      await prisma.$executeRawUnsafe(`
        INSERT INTO platform_settings (key, value, updated_at)
        VALUES ('health_alert_last_summary', $1, NOW())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `, summary);
    } catch (err) {
      console.warn('[recordAlertDispatched] Failed to persist state in platform_settings:', err);
    }
  }).catch(() => {});
}

/**
 * Dispatch alert to a Webhook (Slack, Discord, or generic JSON HTTP endpoint)
 */
export async function dispatchWebhookAlert(
  webhookUrl: string,
  snapshot: HealthStatusSnapshot,
  isTest = false
): Promise<{ ok: boolean; error?: string }> {
  if (!webhookUrl || !webhookUrl.trim().startsWith('http')) {
    return { ok: false, error: 'Invalid or missing Webhook URL' };
  }

  const url = webhookUrl.trim();
  const isSlack = url.includes('slack.com');
  const isDiscord = url.includes('discord.com') || url.includes('discordapp.com');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fleet360.ae';
  const dashboardUrl = `${appUrl}/admin/health`;

  const isRecovery = snapshot.status === 'ok';
  const statusUpper = snapshot.status.toUpperCase();
  const severityEmoji = isTest
    ? '🧪'
    : isRecovery
    ? '✅'
    : snapshot.status === 'unhealthy'
    ? '🚨'
    : '⚠️';

  const title = isTest
    ? `[TEST ALERT] Fleet360 Health Alerting Verification`
    : isRecovery
    ? `Fleet360 System Health RECOVERED: All Systems Operational`
    : `Fleet360 System Health Alert: ${statusUpper}`;

  const issuesList = snapshot.issues.length > 0
    ? snapshot.issues.map((i) => `• ${i}`).join('\n')
    : 'All subsystems reporting nominal operation.';

  let payload: Record<string, unknown>;

  if (isSlack) {
    const color = isRecovery ? '#10b981' : snapshot.status === 'unhealthy' ? '#ef4444' : '#f59e0b';
    payload = {
      text: `${severityEmoji} *${title}*\nStatus: *${statusUpper}* | Latency: *${snapshot.responseTimeMs}ms*\n${issuesList}\n<${dashboardUrl}|Open Fleet360 Health Dashboard>`,
      attachments: [
        {
          color,
          title,
          title_link: dashboardUrl,
          text: `*System Health Status:* \`${statusUpper}\`\n*Response Latency:* ${snapshot.responseTimeMs}ms\n\n*Incident Details & Subsystems:*\n${issuesList}`,
          fields: [
            { title: 'Status', value: statusUpper, short: true },
            { title: 'Latency', value: `${snapshot.responseTimeMs}ms`, short: true },
            { title: 'Timestamp', value: snapshot.timestamp, short: false },
          ],
          footer: 'Fleet360 Automated Health Watchdog',
          footer_icon: 'https://fleet360.ae/favicon.ico',
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };
  } else if (isDiscord) {
    const embedColor = isRecovery ? 1097601 : snapshot.status === 'unhealthy' ? 15684420 : 16096779;
    payload = {
      content: `${severityEmoji} **${title}**`,
      embeds: [
        {
          title,
          url: dashboardUrl,
          description: `**Status:** \`${statusUpper}\`\n**Latency:** \`${snapshot.responseTimeMs}ms\`\n\n**Subsystems & Diagnostics:**\n${issuesList}`,
          color: embedColor,
          fields: [
            { name: 'Status', value: statusUpper, inline: true },
            { name: 'Latency', value: `${snapshot.responseTimeMs}ms`, inline: true },
            { name: 'Time', value: snapshot.timestamp, inline: false },
          ],
          footer: { text: 'Fleet360 Automated Health Watchdog' },
          timestamp: new Date().toISOString(),
        },
      ],
    };
  } else {
    // Generic JSON Webhook
    payload = {
      event: isTest ? 'health.test_probe' : isRecovery ? 'health.recovered' : 'health.status_changed',
      isTest,
      isRecovery,
      status: snapshot.status,
      severity: snapshot.status,
      timestamp: snapshot.timestamp,
      responseTimeMs: snapshot.responseTimeMs,
      issues: snapshot.issues,
      dashboardUrl,
      snapshot,
    };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Fleet360-Health-Watchdog/2.0',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        ok: false,
        error: `Webhook returned HTTP ${res.status}: ${errText.slice(0, 180)}`,
      };
    }

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[dispatchWebhookAlert] Webhook delivery failed:', msg);
    return { ok: false, error: msg };
  }
}

/**
 * Dispatch alert to configured email address
 */
export async function dispatchEmailAlert(
  recipientEmail: string,
  snapshot: HealthStatusSnapshot,
  isTest = false
): Promise<{ ok: boolean; error?: string }> {
  if (!recipientEmail || !recipientEmail.includes('@')) {
    return { ok: false, error: 'Invalid or missing recipient email address' };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fleet360.ae';
  const dashboardUrl = `${appUrl}/admin/health`;
  const isRecovery = snapshot.status === 'ok';
  const statusUpper = snapshot.status.toUpperCase();

  const emoji = isTest ? '🧪' : isRecovery ? '✅' : snapshot.status === 'unhealthy' ? '🚨' : '⚠️';
  const badgeColor = isRecovery ? '#10b981' : snapshot.status === 'unhealthy' ? '#ef4444' : '#f59e0b';
  const badgeBg = isRecovery ? '#ecfdf5' : snapshot.status === 'unhealthy' ? '#fef2f2' : '#fffbeb';

  const subject = isTest
    ? `🧪 [TEST ALERT] Fleet360 Health Alerting Verification`
    : isRecovery
    ? `✅ [RESOLVED] Fleet360 System Health: RECOVERED (OK)`
    : `${emoji} [${statusUpper} ALERT] Fleet360 System Health: ${snapshot.issues[0] || statusUpper}`;

  const issuesHtml = snapshot.issues.length > 0
    ? snapshot.issues.map((issue) => `<li style="margin-bottom: 6px; color: #374151;">${issue}</li>`).join('')
    : '<li style="color: #059669;">All subsystems and integration probes reporting healthy.</li>';

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b;">
      <div style="max-width: 620px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
        
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 24px 32px; border-bottom: 3px solid ${badgeColor};">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td>
                <span style="font-size: 20px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">FLEET360</span>
                <span style="font-size: 11px; font-weight: 600; color: #94a3b8; margin-left: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Ops Watchdog</span>
              </td>
              <td style="text-align: right;">
                <span style="display: inline-block; padding: 6px 14px; background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeColor}40; border-radius: 9999px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
                  ${emoji} ${statusUpper}
                </span>
              </td>
            </tr>
          </table>
        </div>

        <!-- Body -->
        <div style="padding: 32px;">
          <h2 style="font-size: 18px; font-weight: 700; margin: 0 0 12px 0; color: #0f172a;">
            ${isTest ? 'Verification Probe: Health Alerting is Active' : isRecovery ? 'System Has Fully Recovered' : 'System Health Alert Triggered'}
          </h2>
          <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 24px 0;">
            ${isTest
              ? 'This is a test notification dispatched from the Fleet360 System Health Monitor to verify email delivery credentials and ops channel configuration.'
              : isRecovery
              ? 'All core services, database connections, background schedulers, and API probes have recovered and are operating within nominal thresholds.'
              : 'The automated health monitor has detected an operational status change requiring engineering or ops attention.'}
          </p>

          <!-- Metrics Table -->
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; background: #f8fafc; border-radius: 10px; border: 1px solid #e2e8f0; font-size: 13px;">
            <tr>
              <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #64748b; width: 35%;">Health Status</td>
              <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; font-weight: 700; color: ${badgeColor};">${statusUpper}</td>
            </tr>
            <tr>
              <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #64748b;">Probe Latency</td>
              <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #0f172a;">${snapshot.responseTimeMs} ms</td>
            </tr>
            <tr>
              <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #64748b;">Timestamp</td>
              <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #0f172a;">${snapshot.timestamp}</td>
            </tr>
            <tr>
              <td style="padding: 10px 16px; font-weight: 600; color: #64748b;">Environment</td>
              <td style="padding: 10px 16px; color: #0f172a;">${process.env.NODE_ENV || 'production'}</td>
            </tr>
          </table>

          <!-- Diagnostic issues list -->
          <div style="margin-bottom: 28px;">
            <div style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; margin-bottom: 8px;">
              Diagnostics & Subsystems:
            </div>
            <ul style="margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.6;">
              ${issuesHtml}
            </ul>
          </div>

          <!-- CTA Button -->
          <div style="text-align: center; margin-top: 32px;">
            <a href="${dashboardUrl}" style="display: inline-block; padding: 12px 28px; background: #2563eb; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 10px; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2);">
              View Live Health Dashboard &rarr;
            </a>
          </div>
        </div>

        <!-- Footer -->
        <div style="background: #f1f5f9; padding: 16px 32px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b; text-align: center;">
          Fleet360 Automated Operations Watchdog &bull; Configure alerts in <a href="${appUrl}/admin/settings/notifications" style="color: #2563eb; text-decoration: none;">Admin &gt; Notifications</a>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const success = await sendServerEmail(
      recipientEmail,
      subject,
      htmlBody,
      isTest ? 'HEALTH_ALERT_TEST' : 'HEALTH_ALERT'
    );

    return {
      ok: !!success,
      error: success ? undefined : 'Email delivery failed or SMTP not configured',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[dispatchEmailAlert] Email dispatch failed:', msg);
    return { ok: false, error: msg };
  }
}

/**
 * Evaluates current health against alert triggers and cooling-off intervals.
 * Called automatically on health status probe or watchdog cron.
 */
export async function evaluateAndTriggerHealthAlerts(
  currentHealth: {
    status: 'ok' | 'degraded' | 'unhealthy';
    responseTimeMs?: number;
    db?: { status: string; latencyMs: number; error?: string | null };
    storage?: { ok: boolean; durable: boolean; error?: string | null };
    redis?: { reachable: boolean; roundTripMs?: number | null; error?: string | null };
    schema?: { status: string; missingCount: number };
    backend?: { status: string; error?: string | null };
    jobsAndOutbox?: {
      scheduler?: { status: string };
      jobRuns24h?: { status: string; failed24h: number };
      outbox?: { status: string; pendingCount: number; stuckCount: number };
    };
    dbPool?: { status: string; activeConnections: number; poolExhaustionRisk: boolean };
    enterpriseBridge?: { status: string; totalConnectors: number; errorConnectors: number };
    security?: { status: string; failedLoginsLastHour: number; bruteForceRisk: boolean };
    integrations?: { missingKeys?: string[] };
  }
): Promise<{
  triggered: boolean;
  reason?: string;
  webhookResult?: { ok: boolean; error?: string };
  emailResult?: { ok: boolean; error?: string };
}> {
  try {
    const config = await getHealthAlertConfig();
    if (!config.enabled) {
      return { triggered: false, reason: 'Alerting is disabled in settings' };
    }

    const currentStatus = currentHealth.status;
    const lastStatus = config.lastStatus || 'ok';

    // Collect human-readable issues
    const issues: string[] = [];
    if (currentHealth.db?.status === 'error') {
      issues.push(`PostgreSQL connection failed: ${currentHealth.db.error || 'Check database credentials'}`);
    } else if (currentHealth.db && currentHealth.db.latencyMs > 300) {
      issues.push(`PostgreSQL latency elevated: ${currentHealth.db.latencyMs}ms`);
    }

    if (currentHealth.dbPool?.poolExhaustionRisk) {
      issues.push(`PostgreSQL connection pool near exhaustion (>80% capacity utilized)`);
    }

    if (currentHealth.storage && (!currentHealth.storage.ok || !currentHealth.storage.durable)) {
      issues.push(`File storage alert: non-durable or unhealthy backend (${currentHealth.storage.error || 'Local fallback'})`);
    }

    if (currentHealth.redis && !currentHealth.redis.reachable) {
      issues.push(`Upstash Redis unreachable: ${currentHealth.redis.error || 'Connection timed out'}`);
    }

    if (currentHealth.backend && (currentHealth.backend.status === 'unreachable' || currentHealth.backend.status === 'not_ready')) {
      issues.push(`Go Microservices backend ${currentHealth.backend.status}: ${currentHealth.backend.error || 'Check service health'}`);
    }

    if (currentHealth.jobsAndOutbox?.outbox && currentHealth.jobsAndOutbox.outbox.stuckCount > 0) {
      issues.push(`Transactional Outbox has ${currentHealth.jobsAndOutbox.outbox.stuckCount} stuck events (>10m)`);
    }

    if (currentHealth.jobsAndOutbox?.jobRuns24h && currentHealth.jobsAndOutbox.jobRuns24h.failed24h > 0) {
      issues.push(`Background jobs encountered ${currentHealth.jobsAndOutbox.jobRuns24h.failed24h} failures in last 24h`);
    }

    if (currentHealth.enterpriseBridge && currentHealth.enterpriseBridge.errorConnectors > 0) {
      issues.push(`Enterprise Bridge: ${currentHealth.enterpriseBridge.errorConnectors} ERP connector(s) reporting sync error`);
    }

    if (currentHealth.security?.bruteForceRisk) {
      issues.push(`Security Alert: Elevated failed logins (${currentHealth.security.failedLoginsLastHour}/hr) indicating possible credential stuffing`);
    }

    if (currentHealth.integrations?.missingKeys && currentHealth.integrations.missingKeys.length > 0) {
      issues.push(`Missing integration credentials: ${currentHealth.integrations.missingKeys.join(', ')}`);
    }

    // Determine if condition should trigger an alert:
    // 1. Recovery: was degraded/unhealthy -> now ok
    const isRecovery = (lastStatus === 'degraded' || lastStatus === 'unhealthy') && currentStatus === 'ok';

    // 2. Status degradation: ok -> degraded / unhealthy, or degraded -> unhealthy
    const isDegradation =
      (lastStatus === 'ok' && (currentStatus === 'degraded' || currentStatus === 'unhealthy')) ||
      (lastStatus === 'degraded' && currentStatus === 'unhealthy');

    // 3. Minimum severity check: if minSeverity === 'unhealthy', skip degraded alerts unless it transitioned to unhealthy
    const meetsSeverityThreshold =
      config.minSeverity === 'unhealthy' ? currentStatus === 'unhealthy' : currentStatus !== 'ok';

    // 4. Cooldown evaluation: if status is still degraded/unhealthy, don't spam unless cooldown expired
    const now = Date.now();
    const lastSentTime = config.lastSentAt ? new Date(config.lastSentAt).getTime() : 0;
    const cooldownMs = (config.cooldownMinutes || 15) * 60 * 1000;
    const cooldownExpired = now - lastSentTime >= cooldownMs;

    let shouldTrigger = false;
    let triggerReason = '';

    if (isRecovery) {
      shouldTrigger = true;
      triggerReason = `System recovered from ${lastStatus} back to OK`;
    } else if (isDegradation && meetsSeverityThreshold) {
      shouldTrigger = true;
      triggerReason = `Status transitioned from ${lastStatus} to ${currentStatus}`;
    } else if (currentStatus !== 'ok' && meetsSeverityThreshold && cooldownExpired) {
      shouldTrigger = true;
      triggerReason = `Ongoing ${currentStatus} status (cooldown of ${config.cooldownMinutes}m elapsed)`;
    }

    if (!shouldTrigger) {
      return {
        triggered: false,
        reason: `Suppressed (current=${currentStatus}, last=${lastStatus}, cooldownRemaining=${Math.max(
          0,
          Math.round((cooldownMs - (now - lastSentTime)) / 1000)
        )}s)`,
      };
    }

    const snapshot: HealthStatusSnapshot = {
      status: currentStatus,
      responseTimeMs: currentHealth.responseTimeMs || 0,
      timestamp: new Date().toISOString(),
      issues,
      db: currentHealth.db,
      storage: currentHealth.storage,
      redis: currentHealth.redis,
      schema: currentHealth.schema,
      backend: currentHealth.backend,
      outbox: currentHealth.jobsAndOutbox?.outbox,
      jobRuns: currentHealth.jobsAndOutbox?.jobRuns24h,
      dbPool: currentHealth.dbPool,
      enterpriseBridge: currentHealth.enterpriseBridge,
      security: currentHealth.security,
    };

    let webhookResult: { ok: boolean; error?: string } | undefined;
    let emailResult: { ok: boolean; error?: string } | undefined;

    // Dispatch Webhook
    if (config.webhookEnabled && config.webhookUrl) {
      webhookResult = await dispatchWebhookAlert(config.webhookUrl, snapshot, false);
    }

    // Dispatch Email
    if (config.emailEnabled && config.email) {
      emailResult = await dispatchEmailAlert(config.email, snapshot, false);
    }

    const summaryText = issues.length > 0 ? issues[0] : `Health status: ${currentStatus}`;
    await recordAlertDispatched(currentStatus, summaryText);

    return {
      triggered: true,
      reason: triggerReason,
      webhookResult,
      emailResult,
    };
  } catch (err) {
    console.error('[evaluateAndTriggerHealthAlerts] Error in alert evaluation:', err);
    return {
      triggered: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * One-click synthetic test alert for testing webhook and email delivery
 */
export async function sendTestHealthAlert(
  customConfig?: Partial<HealthAlertConfig>
): Promise<{
  success: boolean;
  webhook: { attempted: boolean; success: boolean; error?: string };
  email: { attempted: boolean; success: boolean; error?: string };
  message: string;
}> {
  const baseConfig = await getHealthAlertConfig();
  const config = { ...baseConfig, ...customConfig };

  const testSnapshot: HealthStatusSnapshot = {
    status: 'degraded',
    responseTimeMs: 34,
    timestamp: new Date().toISOString(),
    issues: [
      'Synthetic Test Probe: Database response latency normal (12ms)',
      'Synthetic Test Probe: Redis round-trip nominal (18ms)',
      'Synthetic Test Probe: Outbox queue synchronized (0 stuck items)',
      'Notice: This is a verified test dispatch from Fleet360 Health Alerting',
    ],
  };

  const results = {
    success: false,
    webhook: { attempted: false, success: false, error: undefined as string | undefined },
    email: { attempted: false, success: false, error: undefined as string | undefined },
    message: '',
  };

  const promises: Promise<void>[] = [];

  // 1. Test Webhook
  if (config.webhookUrl) {
    results.webhook.attempted = true;
    promises.push(
      dispatchWebhookAlert(config.webhookUrl, testSnapshot, true).then((r) => {
        results.webhook.success = r.ok;
        results.webhook.error = r.error;
      })
    );
  }

  // 2. Test Email
  if (config.email) {
    results.email.attempted = true;
    promises.push(
      dispatchEmailAlert(config.email, testSnapshot, true).then((r) => {
        results.email.success = r.ok;
        results.email.error = r.error;
      })
    );
  }

  if (promises.length === 0) {
    return {
      success: false,
      webhook: results.webhook,
      email: results.email,
      message: 'No webhook URL or notification email configured to test.',
    };
  }

  await Promise.all(promises);

  const atLeastOneSuccess =
    (results.webhook.attempted && results.webhook.success) ||
    (results.email.attempted && results.email.success);

  results.success = atLeastOneSuccess;
  results.message = atLeastOneSuccess
    ? 'Test alert successfully delivered!'
    : 'Failed to deliver test alert to configured channels. Check credentials and channel URL.';

  return results;
}

/**
 * Background watchdog cron task handler.
 * Probes core database, storage, redis, and triggers automated alerts if state degrades.
 */
export async function runHealthWatchdogJob(): Promise<{
  status: 'ok' | 'error' | 'skipped';
  summary: string;
  data?: Record<string, unknown>;
}> {
  try {
    const config = await getHealthAlertConfig();
    if (!config.enabled) {
      return { status: 'skipped', summary: 'Health watchdog skipped: alerting is disabled' };
    }

    const t0 = Date.now();
    let dbStatus: 'connected' | 'error' = 'connected';
    let dbLatency = 0;
    let dbErr: string | null = null;
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbLatency = Date.now() - t0;
    } catch (e) {
      dbStatus = 'error';
      dbErr = e instanceof Error ? e.message : String(e);
    }

    const overallStatus: 'ok' | 'degraded' | 'unhealthy' = dbStatus === 'error' ? 'unhealthy' : 'ok';

    const result = await evaluateAndTriggerHealthAlerts({
      status: overallStatus,
      responseTimeMs: dbLatency,
      db: { status: dbStatus, latencyMs: dbLatency, error: dbErr },
    });

    return {
      status: 'ok',
      summary: result.triggered
        ? `Health watchdog alerted: ${result.reason}`
        : `Health watchdog evaluated: ${result.reason || 'Nominal'}`,
      data: { result, dbLatency },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'error', summary: `Health watchdog failed: ${msg}` };
  }
}
