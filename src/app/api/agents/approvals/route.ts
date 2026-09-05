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
import { policyService } from '@/lib/agents/governance';

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

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const body = await req.json();
    const { approvalId, decision, notes, reviewerId } = body;

    if (!approvalId) {
      return NextResponse.json({ ok: false, error: 'Missing approvalId parameter' }, { status: 400 });
    }
    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      return NextResponse.json({ ok: false, error: "Decision must be 'APPROVED' or 'REJECTED'" }, { status: 400 });
    }

    return await withTenantRls(prisma, tenantId, async () => {
      const updatedItem = await policyService.reviewApprovalItem(
        approvalId,
        reviewerId || 'human_operator',
        decision,
        notes,
      );

      return NextResponse.json({
        ok: true,
        message: `Approval item ${approvalId} successfully marked as ${decision}`,
        data: updatedItem,
      });
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Failed to process approval review' },
      { status: 500 },
    );
  }
}
