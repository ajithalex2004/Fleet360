/**
 * DELETE /api/bus-ops/route-consolidations/[id]
 *
 * Permanently removes a REVERTED consolidation's audit row and its child
 * records. Intended for clearing test/demo rows out of the History tab —
 * not a general-purpose undo.
 *
 * WHY THIS IS DELIBERATELY NARROW
 * route_consolidations is an append-only audit log of an irreversible
 * network change. Two things depend on rows surviving:
 *   - appliedStateHash, which revert-eligibility compares against the
 *     current fingerprint to detect drift.
 *   - the (tenantId, idempotencyKey) unique index, which is what stops the
 *     same consolidation being applied twice.
 * So this endpoint refuses anything that is still live:
 *
 *   - APPLIED rows are rejected (409). The merge is in force; deleting its
 *     provenance would strand the merged route with no record of where it
 *     came from, and free the idempotency key for a duplicate apply.
 *     Revert it first — that is what POST .../route-consolidation/revert
 *     is for.
 *   - Cross-tenant ids are invisible, not merely forbidden (404), so the
 *     endpoint can't be used to probe which ids exist.
 *
 * Response:
 *   200 { deleted: true, id, sourcesDeleted, enrollmentMigrationsDeleted }
 *   404 { error } — no such consolidation for this tenant
 *   409 { error, status } — row is not REVERTED
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireBusOpsAdminAccess } from '@/lib/bus-ops/require-admin-access';
import { logAudit } from '@/lib/audit';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const permError = requireBusOpsAdminAccess(req, 'route-consolidation');
  if (permError) return permError;

  const userId = req.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'x-user-id required for delete' }, { status: 401 });
  }

  const consolidationId = params.id;
  if (!consolidationId) {
    return NextResponse.json({ error: 'consolidation id is required' }, { status: 400 });
  }

  try {
    return await withTenantRls(prisma, tenantId, async (tx) => {
      // Read inside the transaction, scoped by tenant. findFirst (not
      // findUnique) so another tenant's id reads as absent rather than
      // forbidden — same 404 either way, nothing leaks.
      const existing = await tx.routeConsolidation.findFirst({
        where: { id: consolidationId, tenantId },
        select: { id: true, status: true, mergedRouteId: true, appliedAt: true },
      });

      if (!existing) {
        return NextResponse.json({ error: 'Consolidation not found' }, { status: 404 });
      }

      if (existing.status !== 'REVERTED') {
        return NextResponse.json(
          {
            error:
              `Only REVERTED consolidations can be deleted (this one is ${existing.status}). ` +
              'Revert it first via POST /api/bus-ops/route-consolidation/revert.',
            status: existing.status,
          },
          { status: 409 },
        );
      }

      // Children are ON DELETE CASCADE on consolidation_id (verified against
      // the live schema, not just prisma/schema.prisma, which is known to
      // drift). Deleting them explicitly first is still worth it: it keeps
      // the behaviour identical if that cascade is ever dropped, and gives
      // us real counts to return and audit rather than a bare "ok".
      const enrollmentMigrationsDeleted = await tx.routeConsolidationEnrollmentMigration.deleteMany({
        where: { consolidationId, tenantId },
      });
      const sourcesDeleted = await tx.routeConsolidationSource.deleteMany({
        where: { consolidationId, tenantId },
      });
      await tx.routeConsolidation.delete({ where: { id: consolidationId } });

      // Deleting an audit row is itself auditable, so this is awaited rather
      // than fire-and-forget: an un-awaited promise here was silently dropped
      // when the handler returned, and the entry never landed. logAudit
      // swallows its own errors, so awaiting still can't fail the delete.
      await logAudit({
        tenantId,
        userId,
        userRole: req.headers.get('x-user-role') ?? undefined,
        entityType: 'RouteConsolidation',
        entityId: consolidationId,
        action: 'DELETE',
        details:
          `Deleted REVERTED consolidation ${consolidationId.slice(0, 8)} ` +
          `(applied ${existing.appliedAt.toISOString()}` +
          `${existing.mergedRouteId ? `, merged route ${existing.mergedRouteId.slice(0, 8)}` : ''}) — ` +
          `${sourcesDeleted.count} source row(s), ` +
          `${enrollmentMigrationsDeleted.count} enrolment-migration row(s).`,
        ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
        userAgent: req.headers.get('user-agent') ?? undefined,
      });

      return NextResponse.json({
        deleted: true,
        id: consolidationId,
        sourcesDeleted: sourcesDeleted.count,
        enrollmentMigrationsDeleted: enrollmentMigrationsDeleted.count,
      });
    });
  } catch (e) {
    console.error('[route-consolidations.delete]', e);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}
