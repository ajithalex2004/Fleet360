export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { DEMO_UAE_PASS_USER, UaePassProfile } from '@/lib/digital-kyc-engine';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const overrideName = body?.name;

    const profile: UaePassProfile = {
      ...DEMO_UAE_PASS_USER,
      fullNameEn: overrideName || DEMO_UAE_PASS_USER.fullNameEn,
      verifiedAt: new Date().toISOString(),
    };

    return NextResponse.json({
      success: true,
      provider: 'UAE_PASS',
      assuranceLevel: 'SOP3',
      profile,
    });
  } catch (err) {
    console.error('[api/kyc/uae-pass POST]', err);
    return NextResponse.json({ error: 'UAE Pass verification failed' }, { status: 500 });
  }
}
