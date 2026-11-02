export const dynamic = 'force-dynamic';

/**
 * GET /api/logistics/drayage/cron
 *
 * Activates Leg 2 (empty return) for the caller's tenant's Leg 1 jobs whose
 * offload ETC has passed. The same check also runs whenever the drayage
 * workspace loads (getDrayageWorkspaceData).
 *
 * Operator session, own tenant only. It used to "check" CRON_SECRET with an
 * empty if-block and then run for every tenant's jobs; a scheduler call
 * needs a CRON_SESSION_BYPASS_PATHS (POST) entry and a real secret check.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { checkAndAutoActivateExpiredEtcJobs } from '@/lib/logistics/drayage-domain';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const result = await withTenantRls(prisma, tenantId, (tx) => checkAndAutoActivateExpiredEtcJobs(tx, tenantId));
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (err) {
    console.error('[api/logistics/drayage/cron GET]', err);
    return NextResponse.json({ error: 'Drayage ETC check failed' }, { status: 500 });
  }
}
