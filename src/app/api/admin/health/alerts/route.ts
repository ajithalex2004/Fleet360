export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  getHealthAlertConfig,
  saveHealthAlertConfig,
  sendTestHealthAlert,
  sanitizeHealthAlertConfigForResponse,
  redactWebhookSecrets,
  type HealthAlertConfigUpdate,
} from '@/lib/health/alerting';
import { withAuditedAction } from '@/lib/audited-action';

// Platform health alerting is platform-wide configuration — and "test" sends
// an alert to whatever targets the caller supplies — so both handlers are for
// platform admins only.
const NOT_PLATFORM_ADMIN = { error: 'Only a platform admin can manage health alerts.' };
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

function extractAlertConfigUpdate(raw: Record<string, unknown>, topLevelClear: unknown): HealthAlertConfigUpdate {
  const cleaned = stripTenantOwnershipFields(raw) as Record<string, unknown>;
  const update: HealthAlertConfigUpdate = {};

  if (typeof cleaned.enabled === 'boolean') update.enabled = cleaned.enabled;
  if (cleaned.minSeverity === 'degraded' || cleaned.minSeverity === 'unhealthy') {
    update.minSeverity = cleaned.minSeverity;
  }
  if (typeof cleaned.webhookUrl === 'string') update.webhookUrl = cleaned.webhookUrl;
  if (typeof cleaned.webhookEnabled === 'boolean') update.webhookEnabled = cleaned.webhookEnabled;
  if (typeof cleaned.email === 'string') update.email = cleaned.email;
  if (typeof cleaned.emailEnabled === 'boolean') update.emailEnabled = cleaned.emailEnabled;
  if (typeof cleaned.cooldownMinutes === 'number' && Number.isFinite(cleaned.cooldownMinutes)) {
    update.cooldownMinutes = Math.max(1, Math.min(1440, Math.round(cleaned.cooldownMinutes)));
  }
  if (cleaned.clearWebhookUrl === true || topLevelClear === true) {
    update.clearWebhookUrl = true;
  }

  return update;
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  if (authz.role !== 'SUPER_ADMIN') {
    return NextResponse.json(NOT_PLATFORM_ADMIN, { status: 403 });
  }

  try {
    const config = await getHealthAlertConfig();
    return NextResponse.json(
      { config: sanitizeHealthAlertConfigForResponse(config) },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[GET /api/admin/health/alerts] Error fetching config:', redactWebhookSecrets(msg));
    return NextResponse.json(
      { error: 'Failed to load health alert settings.' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

async function handlePOST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  if (authz.role !== 'SUPER_ADMIN') {
    return NextResponse.json(NOT_PLATFORM_ADMIN, { status: 403 });
  }

  let suppliedWebhookForRedaction: string | undefined;
  try {
    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body.' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json(
        { error: 'Invalid request body.' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const rawBody = parsed as Record<string, unknown>;
    const action = rawBody.action === 'test' ? 'test' : 'save';
    const nested =
      rawBody.config && typeof rawBody.config === 'object' && !Array.isArray(rawBody.config)
        ? (rawBody.config as Record<string, unknown>)
        : null;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { action: _action, config: _nested, clearWebhookUrl: topLevelClear, ...rest } = rawBody;
    const supplied = extractAlertConfigUpdate(nested ?? rest, topLevelClear);
    suppliedWebhookForRedaction = supplied.webhookUrl;

    if (action === 'test') {
      const testResults = await sendTestHealthAlert(supplied);
      return NextResponse.json(testResults, { headers: NO_STORE_HEADERS });
    }

    const updated = await saveHealthAlertConfig(supplied);
    return NextResponse.json(
      {
        success: true,
        config: sanitizeHealthAlertConfigForResponse(updated),
        message: 'Health alert settings updated successfully.',
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      '[POST /api/admin/health/alerts] Error saving alert config:',
      redactWebhookSecrets(msg, suppliedWebhookForRedaction),
    );
    return NextResponse.json(
      { error: 'Failed to update health alert settings.' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
