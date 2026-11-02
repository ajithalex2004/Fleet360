export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { autofillDrivingLicense } from '@/lib/drivers/driver-autofill';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  try {
    const body = await req.json();
    const { base64, mimeType, fileName } = body;

    if (!base64) {
      return NextResponse.json({ error: 'Missing base64 file data' }, { status: 400 });
    }

    const result = await autofillDrivingLicense({
      base64,
      mimeType: mimeType || 'image/jpeg',
      fileName: fileName || 'license.jpg',
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[autofill-license route] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to parse Driving License' },
      { status: 500 },
    );
  }
}
