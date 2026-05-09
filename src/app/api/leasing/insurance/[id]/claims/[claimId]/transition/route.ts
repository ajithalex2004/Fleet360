/**
 * POST /api/leasing/insurance/[id]/claims/[claimId]/transition
 *
 * Validated state-machine transition for an insurance claim.
 * Body: { to: ClaimStatus, approvedAmount?: number, settledAt?: ISO, notes?: string }
 *
 * - Validates the transition via canTransitionClaim (pure function)
 * - On APPROVED: sets approvedAmount if provided
 * - On SETTLED: stamps settledAt (defaults to now)
 * - Audit-logs every accepted transition
 * - 409 with the rule violation if illegal
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  canTransitionClaim,
  type ClaimStatus,
} from '@/lib/leasing-insurance-claim-state';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; claimId: string } },
) {
  try {
    const body = await req.json();
    const to = body?.to as ClaimStatus | undefined;
    if (!to) {
      return NextResponse.json({ error: 'Missing required body field: to' }, { status: 400 });
    }

    const claim = await prisma.leaseInsuranceClaim.findUnique({
      where: { id: params.claimId },
    });
    if (!claim || claim.policyId !== params.id) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    }

    const from = (claim.status ?? 'SUBMITTED') as ClaimStatus;
    const result = canTransitionClaim(from, to);
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 409 });
    }

    const updates: Record<string, unknown> = {
      status: to,
      updatedAt: new Date(),
    };
    if (to === 'APPROVED' && typeof body.approvedAmount === 'number') {
      updates.approvedAmount = body.approvedAmount;
    }
    if (to === 'SETTLED') {
      updates.settledAt = body.settledAt ? new Date(body.settledAt) : new Date();
    }
    if (typeof body.notes === 'string' && body.notes.trim()) {
      updates.notes = [claim.notes, `[${new Date().toISOString().slice(0, 10)} ${from}→${to}] ${body.notes.trim()}`]
        .filter(Boolean).join('\n');
    }

    const updated = await prisma.leaseInsuranceClaim.update({
      where: { id: params.claimId },
      data: updates,
    });

    void logAudit({
      tenantId: req.headers.get('x-tenant-id') ?? undefined,
      userId: req.headers.get('x-user-id') ?? 'system',
      userRole: req.headers.get('x-user-role') ?? 'STAFF',
      entityType: 'LeaseInsuranceClaim',
      entityId: params.claimId,
      action: 'UPDATE',
      details: `Claim ${claim.claimNo ?? params.claimId.slice(0, 8)} transitioned ${from} → ${to}${updates.approvedAmount ? ` (approved ${updates.approvedAmount})` : ''}.`,
    });

    return NextResponse.json(updated);
  } catch (err) {
    captureException(err, {
      context: 'leasing.insurance.claim.transition',
      tags: { policyId: params.id, claimId: params.claimId },
    });
    return NextResponse.json({ error: 'Transition failed' }, { status: 500 });
  }
}
