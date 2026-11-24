export const dynamic = 'force-dynamic';

/**
 * /api/admin/service-config/templates/facilities
 *
 * GET  — install status: { installed, total } types of the Facilities catalogue.
 * POST — install the Facilities Management catalogue for the caller's tenant
 *        (4 categories, 16 ticket types, 4 departments). Idempotent; never
 *        overwrites admin edits. TENANT_ADMIN / SUPER_ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeServiceConfig, requireAdmin } from '@/lib/service-config/auth';
import { facilitiesInstallStatus, installFacilitiesTemplate } from '@/lib/service-config/facilities-template';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;

  const status = await facilitiesInstallStatus(auth.tenantId);
  return NextResponse.json({ ok: true, ...status });
}

async function handlePOST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;
  const admin = requireAdmin(auth);
  if (!admin.ok) return admin.res;

  try {
    const result = await installFacilitiesTemplate(auth.tenantId);
    void logAudit({
      tenantId: auth.tenantId, userId: auth.userId, userRole: auth.role || undefined,
      entityType: 'ServiceCatalogueTemplate', entityId: 'FACILITIES', entityName: 'Facilities Management',
      action: 'CREATE', details: `Installed Facilities catalogue: ${result.typesAdded} of ${result.total} types added`,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    captureException(err, { context: 'service-config.templates.facilities.install' });
    return NextResponse.json({ ok: false, error: 'Failed to install the Facilities catalogue' }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
