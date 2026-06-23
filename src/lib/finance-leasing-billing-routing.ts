import { NextRequest, NextResponse } from 'next/server';

export function isFinanceLeasingBillingApiPath(req: NextRequest) {
  return req.nextUrl.pathname.startsWith('/api/finance/leasing-billing');
}

export function legacyLeasingBillingWriteMoved(req: NextRequest, movedTo: string) {
  if (isFinanceLeasingBillingApiPath(req)) return null;
  return NextResponse.json({
    error: 'Moved to Finance & Billing',
    message: 'Leasing billing writes now run through Finance & Billing APIs.',
    movedTo,
  }, {
    status: 410,
    headers: {
      'X-Fleet360-Deprecated': 'true',
      'X-Fleet360-Moved-To': movedTo,
    },
  });
}
