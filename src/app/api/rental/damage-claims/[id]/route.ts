export const dynamic = 'force-dynamic';

/**
 * /api/rental/damage-claims/[id]
 *
 * Manages damage claim assessment, approval workflow, billing, and settlement.
 * Settlement/billing transitions (`BILLED`, `CLOSED`, `SETTLED`, `RESOLVED`,
 * `WAIVED`, `REJECTED`, `APPROVED`), `billedToCustomer` edits, and `actualCost`
 * updates require `rental:approve:damage`.
 * Deletion requires `rental:delete:damage_claims`.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { revalidateCache } from '@/lib/server-cache';
import {
  approvalGate,
  approvalInProgress,
  approvalRequired,
  withApprovalStart,
} from '@/lib/workflow/approvals';
import { sessionUser } from '@/lib/session-user';
import { requireRentalPermission } from '@/lib/rental/rbac';
import {
  isRentalSecurityError,
  validateSafeDocumentOrSignatureUrl,
} from '@/lib/rental/security-guards';

const CACHE_TAG = 'rental:damage-claims';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'view',
    'damage_claims',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const claim = await tx.damageClaim.findFirst({
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

const STATUS_ACTIONS: Record<string, string> = {
  PENDING_APPROVAL: 'submit',
  APPROVED: 'approve',
  REJECTED: 'reject',
  BILLED: 'bill',
  CLOSED: 'close',
  SETTLED: 'close',
  RESOLVED: 'close',
  WAIVED: 'waive',
  ASSESSED: 'assess',
  OPEN: 'reopen',
};

const SETTLEMENT_STATUSES = new Set([
  'BILLED',
  'CLOSED',
  'SETTLED',
  'RESOLVED',
  'WAIVED',
  'REJECTED',
  'APPROVED',
]);

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const editDenied = await requireRentalPermission(
    req.headers,
    tenantId,
    'edit',
    'damage',
    req.nextUrl.pathname,
  );
  if (editDenied) return editDenied;

  const bodyRaw = await req.json().catch(() => ({}));
  const body = stripTenantOwnershipFields(
    (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
  );

  const requestedStatusUpper =
    body.status != null ? String(body.status).toUpperCase() : '';
  const action =
    typeof body.action === 'string'
      ? body.action.trim().toLowerCase()
      : body.status != null
        ? STATUS_ACTIONS[requestedStatusUpper] ?? 'unknown-status'
        : undefined;

  const hasActualCostEdit = 'actualCost' in body || 'actual_cost' in body;
  const hasBillingEdit = 'billedToCustomer' in body || 'billed_to_customer' in body;
  const isSettlementAction =
    SETTLEMENT_STATUSES.has(requestedStatusUpper) ||
    ['bill', 'close', 'waive', 'reject', 'approve'].includes(String(action ?? '').toLowerCase());

  if (isSettlementAction || hasActualCostEdit || hasBillingEdit) {
    const denied = await requireRentalPermission(
      req.headers,
      tenantId,
      'approve',
      'damage',
      req.nextUrl.pathname,
    );
    if (denied) return denied;
  }

  if (action === 'approve' || action === 'reject') {
    const gated = await approvalGate({
      headers: req.headers,
      tenantId,
      referenceType: 'rental_damage_claim',
      referenceId: params.id,
      action: action === 'reject' ? 'REJECT' : 'APPROVE',
      comments: String(body.reason ?? ''),
    });
    if (gated) {
      void revalidateCache([CACHE_TAG]).catch(() => {});
      return gated;
    }
  } else {
    // Block all concurrent mutations (including general field updates) while an approval workflow is active
    const busy = await approvalInProgress(tenantId, 'rental_damage_claim', params.id);
    if (busy) return busy;
  }

  const needsApproval =
    action === 'bill' || action === 'close'
      ? await approvalRequired(tenantId, 'rental_damage_claim').catch(() => false)
      : false;
  const me =
    action === 'approve' || action === 'reject'
      ? await sessionUser(req.headers).catch(() => null)
      : null;

  const response = await withTenantRls(prisma, tenantId, async (tx) => {
    try {
      if (Array.isArray(body.photos)) {
        for (const photo of body.photos) {
          validateSafeDocumentOrSignatureUrl(photo, { fieldName: 'photos' });
        }
      }

      const existing = await tx.damageClaim.findFirst({
        where: { id: params.id, tenantId },
      });
      if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      const status = (existing.status ?? 'OPEN').toUpperCase();
      const move = async (
        from: string[],
        data: Prisma.DamageClaimUncheckedUpdateManyInput,
      ) => {
        const { count } = await tx.damageClaim.updateMany({
          where: { id: params.id, tenantId, status: { in: from } },
          data,
        });
        if (!count) {
          return NextResponse.json(
            { error: 'The claim changed; reload and try again' },
            { status: 409 },
          );
        }
        return NextResponse.json(
          await tx.damageClaim.findFirst({ where: { id: params.id, tenantId } }),
        );
      };
      const cost = (v: unknown) =>
        v === undefined || v === null || v === '' ? undefined : Number(v);

      switch (action) {
        case 'assess': {
          if (!['OPEN', 'ASSESSED'].includes(status)) {
            return NextResponse.json(
              { error: `A ${status} claim can't be re-assessed` },
              { status: 400 },
            );
          }
          const actualCost = cost(body.actualCost ?? body.actual_cost);
          if (actualCost !== undefined && (!Number.isFinite(actualCost) || actualCost < 0)) {
            return NextResponse.json(
              { error: 'Actual cost must be zero or more' },
              { status: 400 },
            );
          }
          return move(['OPEN', 'ASSESSED'], {
            status: 'ASSESSED',
            ...(actualCost !== undefined ? { actualCost } : {}),
            ...(typeof body.billedToCustomer === 'boolean'
              ? { billedToCustomer: body.billedToCustomer }
              : {}),
            ...(typeof body.insuranceClaim === 'boolean'
              ? { insuranceClaim: body.insuranceClaim }
              : {}),
          });
        }
        case 'submit':
          if (!['OPEN', 'ASSESSED'].includes(status)) {
            return NextResponse.json(
              { error: 'Only open or assessed claims can be submitted' },
              { status: 400 },
            );
          }
          if (existing.actualCost == null && existing.estimatedCost == null) {
            return NextResponse.json(
              { error: 'Enter the estimated or actual cost before submitting' },
              { status: 400 },
            );
          }
          return move(['OPEN', 'ASSESSED'], { status: 'PENDING_APPROVAL' });
        case 'approve':
          if (status !== 'PENDING_APPROVAL') {
            return NextResponse.json(
              { error: 'Only claims pending approval can be approved' },
              { status: 400 },
            );
          }
          return move(['PENDING_APPROVAL'], { status: 'APPROVED' });
        case 'reject': {
          if (!['PENDING_APPROVAL', 'OPEN', 'ASSESSED'].includes(status)) {
            return NextResponse.json(
              { error: `A ${status} claim cannot be rejected` },
              { status: 400 },
            );
          }
          const note = `[Returned by ${me?.email ?? 'manager'}: ${String(body.reason ?? '').trim() || 'No reason given'}]`;
          const targetStatus =
            status === 'PENDING_APPROVAL' ? 'ASSESSED' : 'REJECTED';
          return move([status], {
            status: targetStatus,
            description: existing.description ? `${existing.description}\n${note}` : note,
          });
        }
        case 'waive': {
          if (['CLOSED', 'WAIVED'].includes(status)) {
            return NextResponse.json(
              { error: `Claim is already ${status}` },
              { status: 400 },
            );
          }
          const actualCost = cost(body.actualCost ?? body.actual_cost);
          if (actualCost !== undefined && (!Number.isFinite(actualCost) || actualCost < 0)) {
            return NextResponse.json(
              { error: 'Actual cost must be zero or more' },
              { status: 400 },
            );
          }
          return move([status], {
            status: 'WAIVED',
            billedToCustomer: false,
            actualCost: actualCost ?? 0,
          });
        }
        case 'bill':
        case 'close': {
          const from =
            action === 'bill'
              ? needsApproval
                ? ['APPROVED']
                : ['OPEN', 'ASSESSED', 'APPROVED']
              : needsApproval
                ? ['APPROVED', 'BILLED']
                : ['OPEN', 'ASSESSED', 'APPROVED', 'BILLED'];
          if (!from.includes(status)) {
            return NextResponse.json(
              {
                error:
                  needsApproval && ['OPEN', 'ASSESSED'].includes(status)
                    ? 'This claim needs approval first: submit it for approval'
                    : `A ${status} claim can't be ${action === 'bill' ? 'billed' : 'closed'}`,
              },
              { status: 400 },
            );
          }
          const actualCost = cost(body.actualCost ?? body.actual_cost);
          if (actualCost !== undefined && (!Number.isFinite(actualCost) || actualCost < 0)) {
            return NextResponse.json(
              { error: 'Actual cost must be zero or more' },
              { status: 400 },
            );
          }
          return move(from, {
            status: action === 'bill' ? 'BILLED' : 'CLOSED',
            ...(action === 'bill' ? { billedToCustomer: true } : {}),
            ...(actualCost !== undefined ? { actualCost } : {}),
          });
        }
        case 'reopen':
          if (status !== 'ASSESSED') {
            return NextResponse.json(
              { error: `A ${status} claim can't be reopened` },
              { status: 400 },
            );
          }
          return move(['ASSESSED'], { status: 'OPEN' });
        case undefined:
          break;
        default:
          return NextResponse.json(
            { error: `Unknown action or status: ${body.action ?? body.status}` },
            { status: 400 },
          );
      }

      if (!['OPEN', 'ASSESSED'].includes(status)) {
        return NextResponse.json(
          { error: `A ${status} claim can't be edited` },
          { status: 409 },
        );
      }

      // Explicit field whitelist for general edits (prevents mass-assignment & Prisma unknown argument crashes)
      const updateData: Prisma.DamageClaimUncheckedUpdateManyInput = {};

      if (typeof body.description === 'string') {
        const trimmedDesc = body.description.trim();
        if (!trimmedDesc) {
          return NextResponse.json({ error: 'description cannot be empty' }, { status: 400 });
        }
        updateData.description = trimmedDesc;
      }

      if ('estimatedCost' in body || 'estimated_cost' in body) {
        const rawEst = 'estimatedCost' in body ? body.estimatedCost : body.estimated_cost;
        if (rawEst === null || rawEst === '') {
          updateData.estimatedCost = null;
        } else if (rawEst !== undefined) {
          const parsedEst = Number(rawEst);
          if (!Number.isFinite(parsedEst) || parsedEst < 0) {
            return NextResponse.json(
              { error: 'estimatedCost must be zero or more' },
              { status: 400 },
            );
          }
          updateData.estimatedCost = parsedEst;
        }
      }

      if (hasActualCostEdit) {
        const rawAct = 'actualCost' in body ? body.actualCost : body.actual_cost;
        if (rawAct === null || rawAct === '') {
          updateData.actualCost = null;
        } else if (rawAct !== undefined) {
          const parsedAct = Number(rawAct);
          if (!Number.isFinite(parsedAct) || parsedAct < 0) {
            return NextResponse.json(
              { error: 'actualCost must be zero or more' },
              { status: 400 },
            );
          }
          updateData.actualCost = parsedAct;
        }
      }

      if (typeof body.insuranceClaim === 'boolean') {
        updateData.insuranceClaim = body.insuranceClaim;
      }

      if (hasBillingEdit) {
        const rawBilled =
          'billedToCustomer' in body ? body.billedToCustomer : body.billed_to_customer;
        if (typeof rawBilled === 'boolean') {
          updateData.billedToCustomer = rawBilled;
        }
      }

      if (Object.keys(updateData).length === 0) {
        return NextResponse.json(existing);
      }

      return move(['OPEN', 'ASSESSED'], updateData);
    } catch (e) {
      if (isRentalSecurityError(e)) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
      }
      console.error(
        'PATCH /api/rental/damage-claims/[id] error:',
        e instanceof Error ? e.message : e,
      );
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
    }
  });
  if (response.ok) void revalidateCache([CACHE_TAG]).catch(() => {});
  return action === 'submit'
    ? withApprovalStart(response, {
        headers: req.headers,
        tenantId,
        referenceType: 'rental_damage_claim',
        referenceId: params.id,
      })
    : response;
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'delete',
    'damage_claims',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  try {
    const busy = await approvalInProgress(tenantId, 'rental_damage_claim', params.id);
    if (busy) return busy;
    const { count } = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.damageClaim.deleteMany({ where: { id: params.id, tenantId } }),
    );
    if (count === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    void revalidateCache([CACHE_TAG]).catch(() => {});
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
