import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantByEmailOrCode } from '@/lib/tenant/mobile-config';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const query = body?.email || body?.code || 'fatima@ein360.ae';

    const config = resolveTenantByEmailOrCode(query);

    return NextResponse.json({
      success: true,
      query,
      config,
    });
  } catch (err) {
    console.error('[api/tenant/mobile-config POST]', err);
    return NextResponse.json({ error: 'Failed to resolve tenant mobile configuration' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get('email') || searchParams.get('code') || 'fatima@ein360.ae';
  const config = resolveTenantByEmailOrCode(query);
  return NextResponse.json({ success: true, query, config });
}
