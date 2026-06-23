import { NextRequest, NextResponse } from 'next/server';
import { requireOperationalContext } from '@/lib/cross-module-governance';
import { loadResolvedRentalMasterData } from '@/lib/rental-master-data';

export async function GET(req: NextRequest) {
  try {
    const ctx = requireOperationalContext(req, 'rac');
    if (ctx instanceof NextResponse) return ctx;

    const catalog = await loadResolvedRentalMasterData(ctx.tenantId);
    return NextResponse.json(
      { catalog },
      { headers: { 'Cache-Control': 'private, max-age=120, stale-while-revalidate=300' } },
    );
  } catch (error) {
    console.error('[rental-master-data] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load rental master data' }, { status: 500 });
  }
}
