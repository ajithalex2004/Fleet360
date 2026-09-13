export const dynamic = 'force-dynamic';

/**
 * POST /api/leasing/dunning/notices/[id]/resolve
 *
 * [id] is the LeaseDunningNotice id. A human closing out a
 * DELIVERY_UNKNOWN/FAILED_EXHAUSTED notice — resolving an uncertain send
 * is a real, audited operation from day one, not raw DB access.
 *
 * resolution:
 *   CONFIRMED_SUBMITTED     — terminal; mirrors dispatchStatus SUBMITTED,
 *                             no new attempt.
 *   CONFIRMED_NOT_SUBMITTED — resolves the current attempt AND reserves a
 *                             fresh, claimable occurrence (reserveNextAttempt),
 *                             the same operation used everywhere else. On a
 *                             FAILED_EXHAUSTED notice this also raises
 *                             maxSendAttempts by exactly one — the true
 *                             attempt count made is never erased, only the
 *                             ceiling is auditably extended by the one extra
 *                             try a human just authorized.
 *   UNRESOLVED              — records the resolution only; stays terminal.
 *
 * The attempt row is updated in place for its own resolution fields only —
 * never deleted or replaced — so the prepared/outcome evidence it already
 * recorded stays intact.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { canApprove, buildPermissionKey, SYSTEM_ROLES } from '@/lib/permissions';
import { reserveNextAttempt } from '@/lib/finance/dunning-dispatch';
import { captureMessage } from '@/lib/sentry';

const RESOLVABLE_STATUSES = new Set(['DELIVERY_UNKNOWN', 'FAILED_EXHAUSTED']);
const RESOLUTIONS = new Set(['CONFIRMED_SUBMITTED', 'CONFIRMED_NOT_SUBMITTED', 'UNRESOLVED']);

function permsFor(req: NextRequest): string[] {
  const roleCode = req.headers.get('x-user-role') ?? '';
  return (SYSTEM_ROLES.find(r => r.code === roleCode)?.permissions ?? [])
    .map(p => buildPermissionKey(p.module, p.action, p.resource));
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  if (!canApprove(permsFor(req), 'leasing', 'dunning_delivery')) {
    return NextResponse.json({ error: 'You do not have permission to resolve dunning delivery status.' }, { status: 403 });
  }

  const userId = req.headers.get('x-user-id') ?? 'system';

  try {
    const bodyRaw = await req.json();
    const body = stripTenantOwnershipFields(bodyRaw);
    const resolution = String(body.resolution ?? '');
    if (!RESOLUTIONS.has(resolution)) {
      return NextResponse.json({ error: 'resolution must be one of CONFIRMED_SUBMITTED|CONFIRMED_NOT_SUBMITTED|UNRESOLVED' }, { status: 400 });
    }
    // LeaseDunningDispatchAttempt has no free-text notes column — captured
    // for audit visibility only, not persisted alongside the resolution.
    if (body.notes) {
      captureMessage('Dunning: resolution notes (not persisted to a DB column)', {
        level: 'info', context: 'api.leasing.dunning.notices.resolve',
        extra: { noticeId: params.id, tenantId, resolvedBy: userId, resolution, notes: String(body.notes) },
      });
    }

    const result = await withTenantRls(prisma, tenantId, async (tx) => {
      const notice = await tx.leaseDunningNotice.findFirst({ where: { id: params.id, tenantId } });
      if (!notice) throw Object.assign(new Error('Notice not found'), { status: 404 });
      if (!RESOLVABLE_STATUSES.has(notice.dispatchStatus)) {
        throw Object.assign(
          new Error(`Notice is ${notice.dispatchStatus} — only DELIVERY_UNKNOWN or FAILED_EXHAUSTED notices can be resolved`),
          { status: 400 },
        );
      }
      if (!notice.currentAttemptToken) {
        throw Object.assign(new Error('Notice has no current attempt'), { status: 400 });
      }

      const attempt = await tx.leaseDunningDispatchAttempt.findFirst({
        where: { tenantId, attemptToken: notice.currentAttemptToken },
      });
      if (!attempt) throw Object.assign(new Error('Current attempt not found'), { status: 404 });

      const resolved = await tx.leaseDunningDispatchAttempt.updateMany({
        where: { id: attempt.id, tenantId, resolution: null },
        data: { resolution, resolvedBy: userId, resolvedAt: new Date() },
      });
      if (resolved.count === 0) {
        throw Object.assign(new Error('This attempt has already been resolved'), { status: 409 });
      }

      if (resolution === 'CONFIRMED_SUBMITTED') {
        await tx.leaseDunningNotice.updateMany({
          where: { id: notice.id, tenantId, currentAttemptToken: attempt.attemptToken },
          data: { dispatchStatus: 'SUBMITTED' },
        });
      } else if (resolution === 'CONFIRMED_NOT_SUBMITTED') {
        const wasExhausted = notice.dispatchStatus === 'FAILED_EXHAUSTED';
        if (wasExhausted) {
          await tx.$executeRawUnsafe(
            `UPDATE lease_dunning_notices SET max_send_attempts = max_send_attempts + 1 WHERE id = $1 AND tenant_id = $2`,
            notice.id, tenantId,
          );
        }
        const expectedOutcome = wasExhausted ? 'FAILED' : 'DELIVERY_UNKNOWN';
        const reserved = await reserveNextAttempt(tx, tenantId, notice.id, expectedOutcome, { immediate: true });
        if (reserved.noOp) {
          captureMessage('Dunning: resolution recorded but reserve-next-attempt was a no-op', {
            level: 'warning', context: 'api.leasing.dunning.notices.resolve',
            extra: { noticeId: notice.id, tenantId, reason: reserved.reason },
          });
        }
      }

      const updatedNotice = await tx.leaseDunningNotice.findFirst({ where: { id: notice.id, tenantId } });
      return { attemptId: attempt.id, resolution, notice: updatedNotice };
    });

    return NextResponse.json(result);
  } catch (e: any) {
    const status = e?.status || 500;
    if (status === 500) console.error(e);
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status });
  }
}
