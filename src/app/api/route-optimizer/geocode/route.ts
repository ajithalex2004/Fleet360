/**
 * GET /api/route-optimizer/geocode?q=Dubai+Mall&limit=5
 * Hybrid: Google Geocoding (primary, best UAE accuracy) →
 *         Mapbox Geocoding (fallback)
 * Both API keys stay server-side.
 */

import { NextRequest, NextResponse } from 'next/server';
import { geocodeAddress } from '@/lib/mapbox';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json(
      { error: 'Query parameter "q" is required (min 2 characters).' },
      { status: 400 },
    );
  }

  try {
    const results = await geocodeAddress(q);

    if (!results.length) {
      return NextResponse.json({ results: [], message: 'No results found.' });
    }

    return NextResponse.json({ results });
  } catch (err) {
    console.error('[route-optimizer/geocode]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
