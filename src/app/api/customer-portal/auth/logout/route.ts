export const dynamic = 'force-dynamic';

/** POST /api/customer-portal/auth/logout — clears the customer-portal-session cookie. */

import { NextResponse } from 'next/server';
import { buildClearCustomerPortalCookie } from '@/lib/customer-portal/session';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.set('Set-Cookie', buildClearCustomerPortalCookie());
  return res;
}
