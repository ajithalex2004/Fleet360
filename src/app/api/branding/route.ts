/**
 * GET /api/branding?tenant=<code>
 * GET /api/branding?domain=<acme.com>
 *
 * Public endpoint — returns the white-label branding for an unauthenticated
 * page (typically /login when arriving via a tenant-specific link).
 *
 * Returns 200 with branding=null when no tenant matches, so callers can
 * fall back to the default look without throwing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBrandingByCode, getBrandingByDomain } from '@/lib/branding';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code   = url.searchParams.get('tenant') ?? '';
  const domain = url.searchParams.get('domain') ?? '';

  let branding = null;
  if (code)   branding = await getBrandingByCode(code.trim());
  else if (domain) branding = await getBrandingByDomain(domain.trim());

  return NextResponse.json({ ok: true, branding }, {
    headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
  });
}
