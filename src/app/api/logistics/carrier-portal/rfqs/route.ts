import { NextRequest, NextResponse } from 'next/server';

export async function GET(_req: NextRequest) {
  return NextResponse.json(
    {
      error: 'Secure invite token is required',
      message: 'Open RFQs from /carrier-portal/logistics/invite/[token]. Raw tenant/carrier access is disabled.',
    },
    { status: 410 },
  );
}
