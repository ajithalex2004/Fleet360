export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/logout
 *
 * Clears all session cookies (xl-session, xl-driver-session,
 * xl-impersonator-session, xl-driver-vehicle-id) and revokes valid session
 * tokens (cookies + Bearer) in Redis.
 *
 * Security invariants (M1-P0-3):
 *  - State-changing GET logout is permanently removed (returns 405).
 *  - Same-origin CSRF check enforced on POST (cross-site requests get 403).
 *  - Proper Base64URL expiry decoding via verifySession() (fixes silent
 *    revocation drops across base64url length remainders).
 *  - Redis revocation failures are NEVER silently swallowed; returns 503
 *    with revoked: false while still clearing browser cookies.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { performSessionLogout } from '@/lib/auth/logout-revocation';

export async function POST(request: NextRequest): Promise<NextResponse> {
  return performSessionLogout(request);
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'Method Not Allowed', message: 'Use POST /api/auth/logout to sign out.' },
    {
      status: 405,
      headers: {
        Allow: 'POST',
        'Cache-Control': 'no-store',
      },
    },
  );
}
