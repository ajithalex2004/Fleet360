export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  getHealthAlertConfig,
  saveHealthAlertConfig,
  sendTestHealthAlert,
  HealthAlertConfig,
} from '@/lib/health/alerting';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
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

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  try {
    const rawBody = (await req.json()) as {
      action?: 'save' | 'test';
      config?: Partial<HealthAlertConfig>;
      [key: string]: unknown;
    };

    const action = rawBody.action || 'save';

    if (action === 'test') {
      const testConfig = rawBody.config || rawBody;
      const testResults = await sendTestHealthAlert(testConfig);
      return NextResponse.json(testResults);
    }

    // Save configuration
    const updates = rawBody.config || stripTenantOwnershipFields(rawBody);
    const updated = await saveHealthAlertConfig(updates);

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
