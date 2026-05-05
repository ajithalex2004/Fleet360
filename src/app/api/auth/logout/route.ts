/**
 * POST /api/auth/logout
 * Clears the xl-session httpOnly cookie and redirects to /login.
 * Called by UserSwitcher sign-out and any "Log out" button in the platform.
 */

import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({ ok: true, message: 'Logged out successfully.' });
  // Expire the cookie immediately
  response.cookies.set('xl-session', '', {
    httpOnly: true,
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',
    maxAge:   0,
    path:     '/',
  });
  return response;
}
