export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { calculateInstantQuotation, type QuotationRequest } from '@/lib/pricing/instant-quotation';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  try {
    const rawBody = await req.json();
    const body = stripTenantOwnershipFields(rawBody) as QuotationRequest;
    const quotation = calculateInstantQuotation(body);
    return NextResponse.json(quotation);
  } catch (err) {
    console.error('[api/booking-portal/quotation POST]', err);
    return NextResponse.json({ error: 'Failed to calculate quotation' }, { status: 400 });
  }
}
