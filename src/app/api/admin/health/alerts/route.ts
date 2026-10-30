export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  getHealthAlertConfig,
  saveHealthAlertConfig,
  sendTestHealthAlert,
  HealthAlertConfig,
} from '@/lib/health/alerting';
import { withAuditedAction } from '@/lib/audited-action';

// Platform health alerting is platform-wide configuration — and "test" sends
// an alert to whatever targets the caller supplies — so both handlers are for
// platform admins only.
const NOT_PLATFORM_ADMIN = { error: 'Only a platform admin can manage health alerts.' };

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
    return NextResponse.json({ config });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[GET /api/admin/health/alerts] Error fetching config:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
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

  try {
    const rawBody = (await req.json()) as {
      action?: 'save' | 'test';
      config?: Partial<HealthAlertConfig>;
      [key: string]: unknown;
    };

    const action = rawBody.action || 'save';
    // The config is either nested under `config` or the body itself.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { action: _action, config: nested, ...rest } = rawBody;
    const supplied: Partial<HealthAlertConfig> =
      nested ?? (stripTenantOwnershipFields(rest) as Partial<HealthAlertConfig>);

    if (action === 'test') {
      const testResults = await sendTestHealthAlert(supplied);
      return NextResponse.json(testResults);
    }

    const updated = await saveHealthAlertConfig(supplied);
    return NextResponse.json({
      success: true,
      config: updated,
      message: 'Health alert settings updated successfully.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/admin/health/alerts] Error saving alert config:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
