/**
 * POST /api/shipper-portal/auth/logout — clears the session cookie.
 */

import { NextResponse } from 'next/server';
import { buildClearSessionCookie } from '@/lib/shipper-portal/auth';

export const runtime = 'nodejs';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.set('Set-Cookie', buildClearSessionCookie());
  return res;
}
