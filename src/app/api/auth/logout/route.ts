/**
 * POST /api/auth/logout
 * Clears the xl-session httpOnly cookie and redirects to /login.
 * Called by UserSwitcher sign-out and any "Log out" button in the platform.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/tenant-session';
import { revokeSession } from '@/lib/session-registry';

export async function POST(request: NextRequest) {
  const token = request.cookies.get('xl-session')?.value;
  const session = token ? await verifySession(token) : null;
  if (session?.sessionId) {
    await revokeSession(session.sessionId, session.userId, 'logout');
  }
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
