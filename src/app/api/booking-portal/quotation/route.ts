export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { calculateInstantQuotation, type QuotationRequest } from '@/lib/pricing/instant-quotation';

export async function POST(req: NextRequest) {
  const auth = await requireAuthorizedTenant(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const rawBody = await req.json();
    // Body is user-supplied; calculateInstantQuotation already defends
    // against missing fields internally (e.g. `params.serviceType || 'RENTAL'`).
    const body = stripTenantOwnershipFields(rawBody) as QuotationRequest;
    const quotation = calculateInstantQuotation(body);
    return NextResponse.json(quotation);
  } catch (err) {
    console.error('[api/booking-portal/quotation POST]', err);
    return NextResponse.json({ error: 'Failed to calculate quotation' }, { status: 400 });
  }
}
