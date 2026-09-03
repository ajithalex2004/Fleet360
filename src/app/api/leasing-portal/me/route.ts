/**
 * GET /api/leasing-portal/me
 * Returns the authenticated portal user + their lessee record. Used by
 * the portal shell to hydrate the session on load and gate the UI.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireLeasingPortal } from '@/lib/leasing-portal/auth';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await requireLeasingPortal(req);
  if (ctx instanceof NextResponse) return ctx;

  // A bare prisma call here never sets app.tenant_id, so RLS on `lessees`
  // silently returned no row for a lessee that genuinely exists -- every
  // portal session failed this check with a false "Lessee record no
  // longer exists" 404. Found via E2E testing right after logging into a
  // freshly-set-up portal account.
  const lessee = await withTenantRls(prisma, ctx.tenantId, (tx) =>
    tx.lessee.findFirst({
      where: { id: ctx.lesseeId, tenantId: ctx.tenantId },
      select: { id: true, name: true, type: true, email: true, phone: true, tradeLicense: true, emiratesId: true },
    }),
  );
  if (!lessee) {
    return NextResponse.json({ error: 'Lessee record no longer exists' }, { status: 404 });
  }

  return NextResponse.json({ user: ctx.user, lessee });
}
