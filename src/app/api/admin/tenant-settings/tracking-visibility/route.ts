export const dynamic = 'force-dynamic';

/**
 * GET   /api/admin/tenant-settings/tracking-visibility
 * PUT   /api/admin/tenant-settings/tracking-visibility
 *
 * Tenant-wide default tracking-visibility level — the bottom of the
 * resolution chain. Applies to any customer that hasn't had a per-customer
 * default explicitly set.
 *
 *   PUT body: { level: TrackingLevel }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import {
  setTenantTrackingDefault,
  TRACKING_LEVELS,
  isTrackingLevel,
  DEFAULT_TRACKING_LEVEL,
} from '@/lib/shipper-portal/visibility';
import { logAudit } from '@/lib/audit';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;
  try {
    // tenant_settings has tenant_id with RLS.
    const rows = await withTenantRls(prisma, tenantId, (tx) =>
      tx.$queryRawUnsafe<Array<{ level: string | null }>>(
        `SELECT default_portal_tracking_level AS level
           FROM tenant_settings
          WHERE tenant_id = $1
          LIMIT 1`,
        tenantId,
      )
    );
    return NextResponse.json({
      level: rows[0]?.level ?? DEFAULT_TRACKING_LEVEL,
    });
  } catch (e) {
    console.error('[admin/tenant-settings/tracking-visibility] GET', e);
    return NextResponse.json({ level: DEFAULT_TRACKING_LEVEL });
  }
}

export async function PUT(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId, userId } = authz;

  try {
    const body = stripTenantOwnershipFields(
      (await req.json().catch(() => ({}))) as Record<string, unknown>,
    ) as { level?: string };
    if (!body.level || !isTrackingLevel(body.level)) {
      return NextResponse.json({
        error: `level must be one of: ${TRACKING_LEVELS.join(', ')}`,
      }, { status: 400 });
    }
    // Pull `level` out into a const so TypeScript narrowing survives the
    // closure (and the runtime value can't change between checks).
    const newLevel = body.level;

    // Built inside the transaction, written after it commits. Auditing from
    // inside an interactive transaction loses the entry: a fire-and-forget
    // promise is abandoned when the callback returns, and awaiting it holds
    // this transaction's connection while logAudit checks out a second one
    // from the same pool.
    let audit: Parameters<typeof logAudit>[0] | null = null;

    // Read the previous value for the audit entry, then write — all under
    // the tenant-scoped transaction.
    const response = await withTenantRls(prisma, tenantId, async (tx) => {
      const prevRows = await tx.$queryRawUnsafe<Array<{ level: string | null }>>(
        `SELECT default_portal_tracking_level AS level FROM tenant_settings WHERE tenant_id = $1 LIMIT 1`,
        tenantId,
      );
      const previousLevel = prevRows[0]?.level ?? DEFAULT_TRACKING_LEVEL;

      await setTenantTrackingDefault({ tenantId, level: newLevel });

      audit = {
        tenantId,
        userId,
        userRole: req.headers.get('x-user-role') ?? 'TENANT_ADMIN',
        entityType: 'TenantSettings',
        entityId: tenantId,
        entityName: 'Portal tracking default',
        action: 'UPDATE',
        details: `Set tenant-wide default portal tracking visibility to ${newLevel} (was ${previousLevel})`,
      };

      return NextResponse.json({ ok: true, level: newLevel });
    });

    if (audit) await logAudit(audit);
    return response;
  } catch (e) {
    console.error('[admin/tenant-settings/tracking-visibility] PUT', e);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
