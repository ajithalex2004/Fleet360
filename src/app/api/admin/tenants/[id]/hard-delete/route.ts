/**
 * Tenant hard-delete — permanently destroy a tenant and all of its data.
 *
 * POST /api/admin/tenants/[id]/hard-delete?dryRun=true|false
 *
 * Default is dryRun=true. Caller must explicitly opt in to the
 * destructive run with ?dryRun=false. Both paths return the same
 * shape so the UI can show a preview, then execute with a typed-name
 * confirmation.
 *
 * Strategy: multi-pass delete with FK-aware ordering. Each pass tries
 * every tenant_id-bearing table; FK-blocked tables fail this pass and
 * are retried in the next one (because their referencing rows are
 * now gone). Same algorithm as scripts/hard-delete-final-pass.mjs.
 *
 * Hard delete is irreversible. Every run is recorded in
 * platform_audit_log (dry runs included, so there's a record of who
 * previewed what).
 *
 * SUPER_ADMIN only. Per-tenant SUPER_ADMIN does NOT grant access.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { logAudit } from '@/lib/platform-audit-log';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
const MAX_PASSES = 8;

interface RouteParams { params: Promise<{ id: string }>; }

function requireSuperAdmin(req: NextRequest): { ok: true; userId: string; email: string } | { ok: false; res: NextResponse } {
  const role   = req.headers.get('x-user-role') ?? '';
  const userId = req.headers.get('x-user-id')   ?? '';
  const email  = req.headers.get('x-user-email') ?? '';
  if (role !== 'SUPER_ADMIN') {
    return {
      ok: false,
      res: NextResponse.json(
        { error: 'Forbidden', message: 'Platform admin only. Requires a system-wide SUPER_ADMIN role.' },
        { status: 403 },
      ),
    };
  }
  if (!userId) {
    return { ok: false, res: NextResponse.json({ error: 'No session' }, { status: 401 }) };
  }
  return { ok: true, userId, email };
}

/**
 * Returns a Map<tableName, rowCount> for every table with a tenant_id
 * column, counting rows that match the given tenant id. Used for the
 * dry-run preview.
 *
 * Runs outside a transaction (with a longer default timeout) because
 * the per-table query loop can take >5s on large DBs.
 */
async function countPerTable(tenantId: string): Promise<Map<string, number>> {
  const tables = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name   = 'tenant_id'
      ORDER BY table_name`,
  );
  const counts = new Map<string, number>();
  for (const { table_name } of tables) {
    if (table_name === 'tenants') continue;
    try {
      const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT COUNT(*)::bigint AS n FROM "${table_name}" WHERE "tenant_id"::text = $1`,
        tenantId,
      );
      const n = Number(rows[0]?.n ?? 0n);
      if (n > 0) counts.set(table_name, n);
    } catch {
      // Skip tables we can't read (RLS or missing perms). Dry-run is
      // best-effort; actual delete will surface the real error.
    }
  }
  return counts;
}

/**
 * Multi-pass delete. Returns per-table deletion counts. Throws if any
 * table is still blocked after MAX_PASSES.
 *
 * Runs inside a 60s transaction. The default 5s Prisma transaction
 * timeout is too tight for a 161-table query loop on a remote DB.
 */
async function multiPassDelete(tenantId: string): Promise<Record<string, number>> {
  const tables = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name   = 'tenant_id'
      ORDER BY table_name`,
  );
  const allTables = tables.map(t => t.table_name).filter(n => n !== 'tenants');

  return prisma.$transaction(async (tx) => {
    // Set the RLS GUC for this transaction so DELETEs see all rows.
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '*', true)`);

    let remaining = [...allTables];
    const summary: Record<string, number> = {};
    let pass = 0;
    // Treat an empty tenant (no rows in any tenant_id-bearing table) as
    // a normal case. The first pass will see zero progress because every
    // table returns 0 rows — that's not a blocker, it's just "nothing to
    // delete here". We detect this by counting the first-pass deletes:
    // if first pass deletes 0 rows AND no tables errored, we're done.
    let firstPassDeleted = false;
    let firstPassErrored = false;

    while (remaining.length > 0 && pass < MAX_PASSES) {
      pass++;
      const stillBlocked: string[] = [];
      let progress = false;
      for (const table of remaining) {
        try {
          const r = await tx.$executeRawUnsafe(
            `DELETE FROM "${table}" WHERE "tenant_id"::text = $1`,
            tenantId,
          );
          const n = Number(r);
          if (n > 0) {
            summary[table] = (summary[table] ?? 0) + n;
            progress = true;
            if (pass === 1) firstPassDeleted = true;
          }
        } catch (e) {
          // Capture the first error to surface in the response.
          if (pass === 1 && stillBlocked.length === 0) {
            const msg = e instanceof Error ? e.message : String(e);
            (summary as Record<string, unknown>).__firstError = `${table}: ${msg.split('\n')[0] ?? msg}`;
          }
          stillBlocked.push(table);
          if (pass === 1) firstPassErrored = true;
        }
      }
      // Only treat "no progress" as failure if we were actually trying
      // to do something (had errors) or if we deleted at least once and
      // then got stuck. An empty tenant that deleted 0 rows on pass 1
      // with no errors is just empty — exit early.
      if (!progress) {
        if (pass === 1 && !firstPassErrored) {
          // Empty tenant — nothing to clean up. Set remaining to []
          // so the post-loop "still blocked" check doesn't false-positive.
          remaining = [];
          break;
        }
        const firstErr = (summary as Record<string, unknown>).__firstError;
        throw new Error(
          `No progress in pass ${pass}. ${stillBlocked.length} table(s) still blocked. ` +
          `First error: ${firstErr ?? 'unknown'}. ` +
          `This usually means a non-tenant_id column has an FK to one of the remaining tables.`,
        );
      }
      remaining = stillBlocked;
    }
    if (remaining.length > 0) {
      const firstErr = (summary as Record<string, unknown>).__firstError;
      throw new Error(`${remaining.length} table(s) still blocked after ${MAX_PASSES} passes. First error: ${firstErr ?? 'unknown'}`);
    }

    // Finally, delete the tenant row
    const r = await tx.$executeRawUnsafe(
      `DELETE FROM tenants WHERE "id"::text = $1`,
      tenantId,
    );
    summary['tenants'] = Number(r);

    return summary;
  }, { timeout: 60_000, maxWait: 10_000 });
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
  const auth = requireSuperAdmin(req);
  if (!auth.ok) return auth.res;

  const { id: tenantId } = await params;
  if (!tenantId) {
    return NextResponse.json({ error: 'tenant id is required' }, { status: 400 });
  }

  const dryRun = (req.nextUrl.searchParams.get('dryRun') ?? 'true') !== 'false';

  // 1. Confirm the tenant exists and capture its name for the audit log
  const tenant = await prisma.$queryRawUnsafe<{ id: string; name: string; is_active: boolean }[]>(
    `SELECT id, name, is_active FROM tenants WHERE id = $1 LIMIT 1`,
    tenantId,
  );
  if (!tenant.length) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }
  const { name: tenantName, is_active } = tenant[0];

  // 2. Hard protections
  // (a) Refuse to hard-delete an active tenant — must be soft-deleted
  //     first. This prevents accidental wipe of a live customer.
  if (is_active) {
    return NextResponse.json(
      {
        error: 'Refused',
        message: 'Tenant is still active. Soft-delete it (set is_active=false) first, then hard-delete.',
      },
      { status: 400 },
    );
  }
  // (b) Defense in depth: refuse if this is the only tenant row in the
  //     table (active or not). Catches the catastrophic case where the
  //     target is the very last tenant left. We allow hard-deleting
  //     inactive tenants even if only 1 active remains — the active
  //     count is preserved by the soft-delete we just confirmed.
  const totalCount = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*)::bigint AS n FROM tenants`,
  );
  const nTotal = Number(totalCount[0]?.n ?? 0n);
  if (nTotal <= 1) {
    return NextResponse.json(
      {
        error: 'Refused',
        message: 'This is the only tenant in the platform. Hard-delete would leave the system without a tenant row. Add a replacement tenant first.',
      },
      { status: 400 },
    );
  }

  // 3. Run the dry-run preview OR the actual destructive delete
  if (dryRun) {
    // Set the RLS GUC at session level so SELECT COUNT(*) returns the
    // real per-tenant count instead of NULL-tenant-id rows only. Cleared
    // after the preview. (multiPassDelete uses a transaction instead.)
    await prisma.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '*', false)`);
    let counts: Map<string, number>;
    try {
      counts = await countPerTable(tenantId);
    } finally {
      // Always clear the GUC, even on error
      await prisma.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '', false)`).catch(() => {});
    }
    const totalRows = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    const tables = Array.from(counts.entries())
      .map(([name, n]) => ({ name, rowCount: n }))
      .sort((a, b) => b.rowCount - a.rowCount);

    await logAudit({
      action: 'tenant.hard_delete',
      targetType: 'tenant',
      targetId: tenantId,
      targetName: tenantName,
      performedBy: { userId: auth.userId, email: auth.email },
      dryRun: true,
      metadata: { tables, totalRows },
    });

    return NextResponse.json({
      dryRun: true,
      tenant: { id: tenantId, name: tenantName },
      tables,
      totalRows,
    });
  }

  // 4. Actual destructive run. multiPassDelete opens a 60s transaction
  //    internally — that's the only place we need the RLS GUC.
  let summary: Record<string, number>;
  try {
    summary = await multiPassDelete(tenantId);
  } catch (e) {
    return NextResponse.json(
      {
        error: 'Hard delete failed',
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }

  const totalRows = Object.values(summary).reduce((a, b) => a + b, 0);
  const tables = Object.entries(summary)
    .map(([name, n]) => ({ name, rowCount: n }))
    .sort((a, b) => b.rowCount - a.rowCount);

  await logAudit({
    action: 'tenant.hard_delete',
    targetType: 'tenant',
    targetId: tenantId,
    targetName: tenantName,
    performedBy: { userId: auth.userId, email: auth.email },
    dryRun: false,
    metadata: { tables, totalRows },
  });

  // Bust the cached tenant list so the platform dashboard and the
  // tenants page both see the deletion on the next render.
  const { revalidateCache } = await import('@/lib/server-cache');
  revalidateCache(['tenants:list']);

  return NextResponse.json({
    dryRun: false,
    tenant: { id: tenantId, name: tenantName },
    tables,
    totalRows,
  });
  } catch (err) {
    console.error('[hard-delete tenant]', err);
    return NextResponse.json(
      { error: 'Hard delete failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
