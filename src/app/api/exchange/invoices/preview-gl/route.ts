import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  try {
    const body = await req.json().catch(() => ({}));
    const amount = Number(body.amount ?? 0);
    const vatAmount = Number(body.vatAmount ?? 0);
    const total = Number((amount + vatAmount).toFixed(2));

    const lines = [
      {
        accountCode: '1130',
        accountName: 'Accounts Receivable — Freight Exchange',
        accountType: 'ASSET',
        description: 'Customer transport gross receivable',
        debit: total,
        credit: 0,
      },
      {
        accountCode: '4400',
        accountName: 'Freight Exchange Revenue',
        accountType: 'REVENUE',
        description: 'Net transport freight revenue (excl. VAT)',
        debit: 0,
        credit: amount,
      },
      {
        accountCode: '2120',
        accountName: 'UAE Output VAT Payable (5%)',
        accountType: 'LIABILITY',
        description: 'Output VAT on transport supply',
        debit: 0,
        credit: vatAmount,
      },
    ];

    return NextResponse.json(lines);
  } catch (e) {
    console.error('[exchange/invoices/preview-gl]', e);
    return NextResponse.json({ error: 'Failed to preview exchange GL lines' }, { status: 500 });
  }
}
