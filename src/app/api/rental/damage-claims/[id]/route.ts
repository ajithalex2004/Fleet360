export const dynamic = 'force-dynamic';

/**
 * /api/rental/damage-claims/[id]
 *
 * A claim is OPEN, ASSESSED (actual cost known), then BILLED to the customer
 * and CLOSED. With a company Damage Claim workflow (Admin > Workflows), how a
 * claim is settled needs approval: it is submitted (PENDING_APPROVAL), and
 * billed or closed only once APPROVED; a rejected claim goes back to
 * ASSESSED with the reason in its description. Without a workflow, it moves
 * between statuses as before. PATCH { action } or { status } (submit /
 * approve / reject / bill / close); a plain field update can't change the
 * status, and a claim waiting for approval can't be edited.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { revalidateCache } from '@/lib/server-cache';
import { approvalGate, approvalInProgress, approvalRequired, withApprovalStart } from '@/lib/workflow/approvals';
import { sessionUser } from '@/lib/session-user';

const CACHE_TAG = 'rental:damage-claims';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const claim = await tx.damageClaim.findUnique({
          where: { id: params.id, tenantId },
          include: { booking: { include: { customer: true } } },
        });
        if (!claim) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        return NextResponse.json(claim);
      } catch {
        return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
      }
  });
}

// The status a { status } update asks for, as an action.
const STATUS_ACTIONS: Record<string, string> = {
  PENDING_APPROVAL: 'submit', APPROVED: 'approve', BILLED: 'bill', CLOSED: 'close', ASSESSED: 'assess', OPEN: 'reopen',
};

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const body = stripTenantOwnershipFields(await req.json().catch(() => ({})));
  const action = typeof body.action === 'string' ? body.action
    : body.status != null ? STATUS_ACTIONS[String(body.status).toUpperCase()] ?? 'unknown-status' : undefined;

  if (action === 'approve' || action === 'reject') {
    const gated = await approvalGate({
      headers: req.headers, tenantId, referenceType: 'rental_damage_claim', referenceId: params.id,
      action: action === 'reject' ? 'REJECT' : 'APPROVE', comments: String(body.reason ?? ''),
    });
    if (gated) { void revalidateCache([CACHE_TAG]).catch(() => {}); return gated; }
  } else if (action === 'bill' || action === 'close' || action === 'reopen' || action === 'assess') {
    const busy = await approvalInProgress(tenantId, 'rental_damage_claim', params.id);
    if (busy) return busy;
  }
  const needsApproval = action === 'bill' || action === 'close'
    ? await approvalRequired(tenantId, 'rental_damage_claim').catch(() => false) : false;
  const me = action === 'approve' || action === 'reject' ? await sessionUser(req.headers).catch(() => null) : null;

  const response = await withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const existing = await tx.damageClaim.findFirst({ where: { id: params.id, tenantId } });
      if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      const status = (existing.status ?? 'OPEN').toUpperCase();
      const move = async (from: string[], data: Record<string, unknown>) => {
        // Only from the expected statuses, so two people can't both move it.
        const { count } = await tx.damageClaim.updateMany({
          where: { id: params.id, tenantId, status: { in: from } },
          data,
        });
        if (!count) return NextResponse.json({ error: 'The claim changed; reload and try again' }, { status: 409 });
        return NextResponse.json(await tx.damageClaim.findFirst({ where: { id: params.id, tenantId } }));
      };
      const cost = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));

      switch (action) {
        case 'assess': {
          if (!['OPEN', 'ASSESSED'].includes(status)) return NextResponse.json({ error: `A ${status} claim can't be re-assessed` }, { status: 400 });
          const actualCost = cost(body.actualCost);
          if (actualCost !== undefined && !(actualCost >= 0)) return NextResponse.json({ error: 'Actual cost must be zero or more' }, { status: 400 });
          return move(['OPEN', 'ASSESSED'], {
            status: 'ASSESSED',
            ...(actualCost !== undefined ? { actualCost } : {}),
            ...(typeof body.billedToCustomer === 'boolean' ? { billedToCustomer: body.billedToCustomer } : {}),
            ...(typeof body.insuranceClaim === 'boolean' ? { insuranceClaim: body.insuranceClaim } : {}),
          });
        }
        case 'submit':
          if (!['OPEN', 'ASSESSED'].includes(status)) return NextResponse.json({ error: 'Only open or assessed claims can be submitted' }, { status: 400 });
          if (existing.actualCost == null && existing.estimatedCost == null) {
            return NextResponse.json({ error: 'Enter the estimated or actual cost before submitting' }, { status: 400 });
          }
          return move(['OPEN', 'ASSESSED'], { status: 'PENDING_APPROVAL' });
        case 'approve':
          if (status !== 'PENDING_APPROVAL') return NextResponse.json({ error: 'Only claims pending approval can be approved' }, { status: 400 });
          return move(['PENDING_APPROVAL'], { status: 'APPROVED' });
        case 'reject': {
          if (status !== 'PENDING_APPROVAL') return NextResponse.json({ error: 'Only claims pending approval can be returned' }, { status: 400 });
          const note = `[Returned by ${me?.email ?? 'manager'}: ${String(body.reason ?? '').trim() || 'No reason given'}]`;
          return move(['PENDING_APPROVAL'], { status: 'ASSESSED', description: existing.description ? `${existing.description}\n${note}` : note });
        }
        case 'bill':
        case 'close': {
          // With a workflow, a claim is settled only as approved.
          const from = action === 'bill'
            ? (needsApproval ? ['APPROVED'] : ['OPEN', 'ASSESSED', 'APPROVED'])
            : (needsApproval ? ['APPROVED', 'BILLED'] : ['OPEN', 'ASSESSED', 'APPROVED', 'BILLED']);
          if (!from.includes(status)) {
            return NextResponse.json({
              error: needsApproval && ['OPEN', 'ASSESSED'].includes(status)
                ? 'This claim needs approval first: submit it for approval'
                : `A ${status} claim can't be ${action === 'bill' ? 'billed' : 'closed'}`,
            }, { status: 400 });
          }
          return move(from, { status: action === 'bill' ? 'BILLED' : 'CLOSED', ...(action === 'bill' ? { billedToCustomer: true } : {}) });
        }
        case 'reopen':
          if (status !== 'ASSESSED') return NextResponse.json({ error: `A ${status} claim can't be reopened` }, { status: 400 });
          return move(['ASSESSED'], { status: 'OPEN' });
        case undefined:
          break;
        default:
          return NextResponse.json({ error: `Unknown action or status: ${body.action ?? body.status}` }, { status: 400 });
      }

      // Field update: not while it waits for approval or once settled, never the status.
      if (!['OPEN', 'ASSESSED'].includes(status)) {
        return NextResponse.json({ error: `A ${status} claim can't be edited` }, { status: 409 });
      }
      const { booking: _b, status: _s, id: _i, bookingId: _k, ...data } = body;
      void _b; void _s; void _i; void _k;
      const claim = await tx.damageClaim.update({ where: { id: params.id, tenantId }, data });
      return NextResponse.json(claim);
    } catch (e) {
      console.error('PATCH /api/rental/damage-claims/[id] error:', e instanceof Error ? e.message : e);
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
    }
  });
  if (response.ok) void revalidateCache([CACHE_TAG]).catch(() => {});
  return action === 'submit'
    ? withApprovalStart(response, { headers: req.headers, tenantId, referenceType: 'rental_damage_claim', referenceId: params.id })
    : response;
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const busy = await approvalInProgress(tenantId, 'rental_damage_claim', params.id);
    if (busy) return busy;
    await withTenantRls(prisma, tenantId, async (tx) =>
      tx.damageClaim.delete({ where: { id: params.id, tenantId } }),
    );
    void revalidateCache([CACHE_TAG]).catch(() => {});
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
