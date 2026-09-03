/**
 * POST /api/leasing-portal/auth/logout
 * Clears the leasing-portal-session cookie. Public route — no auth
 * required to log out (an expired/invalid cookie should still clear).
 */

import { NextResponse } from 'next/server';
import { buildClearSessionCookie } from '@/lib/leasing-portal/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.set('Set-Cookie', buildClearSessionCookie());
  return res;
}
