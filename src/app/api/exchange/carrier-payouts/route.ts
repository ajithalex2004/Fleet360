import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { postOperationalJournalEntry } from '@/lib/finance/journal-service';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  try {
    const body = await req.json().catch(() => ({}));
    const carrierId = body.carrierId ? String(body.carrierId) : null;
    const amount = Number(body.amount ?? 0);

    if (!carrierId || isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: 'carrierId and a positive amount are required' }, { status: 400 });
    }

    const payoutId = randomUUID();
    const currency = body.currency || 'AED';

    return await withTenantRls(prisma, tenantId, async (tx) => {
      const glLines = [
        {
          code: '5220',
          name: 'Subcontracted Partner Transport Cost',
          description: `Carrier payout to ${carrierId}`,
          debit: amount,
          credit: 0,
        },
        {
          code: '2110',
          name: 'Accounts Payable — Trade',
          description: `Payable clearance for carrier ${carrierId}`,
          debit: 0,
          credit: amount,
        },
      ];

      const glEntry = await postOperationalJournalEntry(tx, {
        tenantId,
        entryDate: new Date().toISOString().slice(0, 10),
        narration: `Carrier Payout — ${carrierId}`,
        reference: `PAYOUT-${payoutId.slice(0, 8).toUpperCase()}`,
        sourceType: 'CARRIER_PAYOUT',
        sourceId: payoutId,
        currency,
        lines: glLines,
      });

      return NextResponse.json({
        ok: true,
        payoutId,
        carrierId,
        amount,
        currency,
        status: 'POSTED',
        glEntry,
      }, { status: 201 });
    });
  } catch (e) {
    console.error('[exchange/carrier-payouts]', e);
    return NextResponse.json({ error: 'Failed to process carrier payout' }, { status: 500 });
  }
}
