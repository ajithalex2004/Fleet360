export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { DEMO_UAE_PASS_USER, UaePassProfile } from '@/lib/digital-kyc-engine';

export async function POST(req: NextRequest) {
  const auth = await requireAuthorizedTenant(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const rawBody = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(rawBody);
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
