export const dynamic = 'force-dynamic';

/**
 * /api/agents/approvals
 * ---------------------
 * GET: Lists Human-in-the-Loop review queue items for the tenant.
 * POST: Approves or Rejects an approval proposal with audit logging.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { policyService, ApprovalNotPendingError } from '@/lib/agents/governance';
import { hasPermission, buildPermissionKey, SYSTEM_ROLES } from '@/lib/permissions';
import { z } from 'zod';

const ReviewBody = z.object({
  approvalId: z.string().uuid(),
  decision: z.enum(['APPROVED', 'REJECTED']),
  notes: z.string().max(2000).optional(),
});

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    return await withTenantRls(prisma, tenantId, async () => {
      const items = await policyService.getPendingApprovals(tenantId);
      return NextResponse.json({ ok: true, data: items, count: items.length });
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Failed to retrieve pending approvals' },
      { status: 500 },
    );
  }
}

/** Permissions of the caller's system role (same rule as other approval routes). */
function permsFor(req: NextRequest): string[] {
  const roleCode = req.headers.get('x-user-role') ?? '';
  return (SYSTEM_ROLES.find((r) => r.code === roleCode)?.permissions ?? [])
    .map((p) => buildPermissionKey(p.module, p.action, p.resource));
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId, userId, role } = authz;

  // The reviewer is recorded on the decision and an approval can change
  // live data: a request without a signed-in user is refused, not recorded
  // as some placeholder.
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'A signed-in user is required to review agent actions.' }, { status: 401 });
  }

  // Approving an agent action can now change live data (work orders,
  // incident severity, dispatch offers), so deciding needs the agents
  // `approve` permission, not just access to the AI area.
  if (role !== 'SUPER_ADMIN' && !hasPermission(permsFor(req), 'agents', 'approve')) {
    return NextResponse.json({ ok: false, error: 'You do not have permission to approve AI agent actions.' }, { status: 403 });
  }

  try {
    // Validated before use: a non-UUID approvalId would fail the ::uuid
    // cast in SQL and surface as a 500.
    const parsed = ReviewBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({
        ok: false,
        error: "Invalid request: approvalId must be a UUID, decision 'APPROVED' or 'REJECTED', notes at most 2000 characters.",
      }, { status: 400 });
    }
    const { approvalId, decision, notes } = parsed.data;

    return await withTenantRls(prisma, tenantId, async () => {
      // The reviewer is the signed-in user, never a body field: the audit
      // trail of who approved an agent action must not be client-chosen.
      const updatedItem = await policyService.reviewApprovalItem(
        approvalId,
        userId,
        decision,
        notes,
        tenantId,
      );

      if (updatedItem.execution && updatedItem.execution.executed === false) {
        return NextResponse.json({
          ok: false,
          error: `Approved, but not applied: ${String(updatedItem.execution.reason)} The item is marked EXPIRED.`,
          data: updatedItem,
        }, { status: 409 });
      }

      return NextResponse.json({
        ok: true,
        message: `Approval item ${approvalId} successfully marked as ${decision}`,
        data: updatedItem,
      });
    });
  } catch (err: any) {
    if (err instanceof ApprovalNotPendingError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 409 });
    }
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Failed to process approval review' },
      { status: 500 },
    );
  }
}
