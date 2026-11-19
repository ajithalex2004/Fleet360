import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  try {
    const body = await req.json().catch(() => ({}));
    const fineAmount = Number(body.fineAmount ?? 0);
    const adminFee = Number(body.adminFee ?? 0);

    if (isNaN(fineAmount) || isNaN(adminFee) || fineAmount < 0 || adminFee < 0) {
      return NextResponse.json({ error: 'fineAmount and adminFee must be non-negative numbers' }, { status: 400 });
    }

    // Statutory fines are out-of-scope (0% VAT per FTA VATP006/VATP040)
    // Admin fees are standard-rated at 5% VAT
    const vatRate = 0.05;
    const vatAmount = Math.round(adminFee * vatRate * 100) / 100;
    const total = Math.round((fineAmount + adminFee + vatAmount) * 100) / 100;

    return NextResponse.json({
      ok: true,
      fineAmount,
      adminFee,
      statutoryTaxCategory: 'O',
      statutoryVatRate: 0,
      adminTaxCategory: 'S',
      adminVatRate: vatRate,
      vatAmount,
      total,
    });
  } catch (e) {
    console.error('[traffic-fines/preview-split]', e);
    return NextResponse.json({ error: 'Failed to preview tax split' }, { status: 500 });
  }
}
