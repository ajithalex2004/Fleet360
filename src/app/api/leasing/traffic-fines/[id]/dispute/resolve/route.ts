/**
 * POST /api/leasing/traffic-fines/[id]/dispute/resolve
 *
 * Resolve a DISPUTED fine.
 * Body: { resolution: 'UPHELD'|'OVERTURNED'|'PARTIAL', adjustedAmount?, notes? }
 *
 * - UPHELD     → flip back to PENDING (sweep-bill will re-pick it up)
 * - OVERTURNED → flip to ABSORBED (we eat the cost; lessee won't be billed)
 * - PARTIAL    → set finalAmount = adjustedAmount, flip to PENDING for re-billing
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const RESOLUTIONS = ['UPHELD', 'OVERTURNED', 'PARTIAL'] as const;
type Resolution = typeof RESOLUTIONS[number];

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const resolution = String(body?.resolution ?? '').toUpperCase() as Resolution;
    if (!RESOLUTIONS.includes(resolution)) {
      return NextResponse.json({ error: `resolution must be one of: ${RESOLUTIONS.join(', ')}` }, { status: 400 });
    }

    const fine = await prisma.leaseTrafficFine.findUnique({ where: { id: params.id } });
    if (!fine) return NextResponse.json({ error: 'Fine not found' }, { status: 404 });
    if (fine.billingStatus !== 'DISPUTED') {
      return NextResponse.json({ error: `Fine is ${fine.billingStatus}, not DISPUTED` }, { status: 409 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    let summary = '';
    switch (resolution) {
      case 'UPHELD':
        updates.billingStatus = 'PENDING';
        summary = 'Dispute UPHELD — fine reverts to PENDING for re-billing.';
        break;
      case 'OVERTURNED':
        updates.billingStatus = 'ABSORBED';
        summary = 'Dispute OVERTURNED — fine absorbed by the lessor (no charge to lessee).';
        break;
      case 'PARTIAL': {
        const adjusted = Number(body?.adjustedAmount);
        if (!Number.isFinite(adjusted) || adjusted < 0) {
          return NextResponse.json({ error: 'adjustedAmount is required and must be ≥ 0 for PARTIAL' }, { status: 400 });
        }
        updates.billingStatus = 'PENDING';
        updates.finalAmount = adjusted;
        summary = `Dispute resolved PARTIAL — finalAmount adjusted to ${adjusted}, reverts to PENDING.`;
        break;
      }
    }

    const noteParts = [
      fine.notes,
      `[${new Date().toISOString().slice(0, 10)} ${resolution}] ${summary}${body?.notes ? ' ' + String(body.notes).trim() : ''}`,
    ].filter(Boolean);
    updates.notes = noteParts.join('\n');

    const updated = await prisma.leaseTrafficFine.update({
      where: { id: params.id },
      data: updates,
    });

    void logAudit({
      tenantId: req.headers.get('x-tenant-id') ?? undefined,
      userId: req.headers.get('x-user-id') ?? 'system',
      userRole: req.headers.get('x-user-role') ?? 'STAFF',
      entityType: 'LeaseTrafficFine',
      entityId: params.id,
      action: 'UPDATE',
      details: `Fine ${fine.fineNo ?? params.id.slice(0, 8)} dispute resolved: ${summary}`,
    });

    return NextResponse.json(updated);
  } catch (err) {
    captureException(err, {
      context: 'leasing.traffic-fines.dispute.resolve',
      tags: { fineId: params.id },
    });
    return NextResponse.json({ error: 'Resolution failed' }, { status: 500 });
  }
}
