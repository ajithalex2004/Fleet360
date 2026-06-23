import { NextRequest, NextResponse } from 'next/server';
import { resolveCarrierPortalInvite } from '@/lib/logistics/domain';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const resolved = await resolveCarrierPortalInvite(token);
    if (!resolved || !resolved.rfq) {
      return NextResponse.json({ error: 'Invite is invalid, expired, or no longer visible' }, { status: 404 });
    }

    return NextResponse.json(resolved);
  } catch (error) {
    console.error('[logistics/carrier-portal/invites/[token] GET]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load carrier invite' },
      { status: 500 },
    );
  }
}
