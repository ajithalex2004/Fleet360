/**
 * POST /api/leasing/traffic-fines/[id]/dispute
 *
 * Mark a traffic fine as DISPUTED (lessee is contesting). Refuses if the fine
 * has already been PAID or fully ABSORBED. Body: { reason }
 *
 * POST /resolve under the same path with { resolution: 'UPHELD'|'OVERTURNED'|'PARTIAL', adjustedAmount? }
 * resolves the dispute; UPHELD flips back to PENDING for re-billing,
 * OVERTURNED flips to ABSORBED (we eat the cost), PARTIAL adjusts finalAmount
 * and flips to PENDING.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const fine = await prisma.leaseTrafficFine.findUnique({ where: { id: params.id } });
    if (!fine) return NextResponse.json({ error: 'Fine not found' }, { status: 404 });

    if (fine.billingStatus === 'PAID') {
      return NextResponse.json({ error: 'Cannot dispute a fine that is already PAID' }, { status: 409 });
    }
    if (fine.billingStatus === 'ABSORBED') {
      return NextResponse.json({ error: 'Fine is already absorbed — nothing to dispute' }, { status: 409 });
    }

    const reason = String(body?.reason ?? '').trim();
    if (!reason) {
      return NextResponse.json({ error: 'reason is required' }, { status: 400 });
    }

    const updated = await prisma.leaseTrafficFine.update({
      where: { id: params.id },
      data: {
        billingStatus: 'DISPUTED',
        notes: [fine.notes, `[${new Date().toISOString().slice(0, 10)} DISPUTED] ${reason}`].filter(Boolean).join('\n'),
        updatedAt: new Date(),
      },
    });

    void logAudit({
      tenantId: req.headers.get('x-tenant-id') ?? undefined,
      userId: req.headers.get('x-user-id') ?? 'system',
      userRole: req.headers.get('x-user-role') ?? 'STAFF',
      entityType: 'LeaseTrafficFine',
      entityId: params.id,
      action: 'UPDATE',
      details: `Fine ${fine.fineNo ?? params.id.slice(0, 8)} disputed: ${reason}`,
    });

    return NextResponse.json(updated);
  } catch (err) {
    captureException(err, {
      context: 'leasing.traffic-fines.dispute',
      tags: { fineId: params.id },
    });
    return NextResponse.json({ error: 'Dispute failed' }, { status: 500 });
  }
}
