import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  _req: NextRequest,
  _ctx: { params: Promise<{ id: string }> },
) {
  return NextResponse.json(
    {
      error: 'Secure invite token is required',
      message: 'Submit carrier bids through /api/logistics/carrier-portal/invites/[token]/bid.',
    },
    { status: 410 },
  );
}
