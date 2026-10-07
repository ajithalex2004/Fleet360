export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { syncPermissionCatalog } from '@/lib/authz/permission-catalog-sync';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
// ── GET: quick DB health check ────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    // Platform-admin so the query is allowed even if any future permission or
    // role table ends up with RLS. Today Permission/Role are no-ops here.
    return await withPlatformAdmin(prisma, async (tx) => {
      await tx.$queryRaw`SELECT 1`;
      const permCount  = await tx.permission.count();
      const roleCount  = await tx.role.count();
      return NextResponse.json({ db: 'ok', permissions: permCount, roles: roleCount });
    });
    } catch (e) {
    return NextResponse.json({ db: 'e', error: String(e) }, { status: 500 });
  }
}

// ── POST: seed permissions + system roles ────────────────────────────────────
async function handlePOST(_req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    return await withPlatformAdmin(prisma, async (tx) => {
      await syncPermissionCatalog(tx);

      // ── 4. Return final counts ────────────────────────────────────────────────
      const [permCount, roleCount] = await Promise.all([
        tx.permission.count(),
        tx.role.count(),
      ]);

      return NextResponse.json({ success: true, permissions: permCount, roles: roleCount });
    });
    } catch (e) {
    console.error('[SEED ERROR]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
