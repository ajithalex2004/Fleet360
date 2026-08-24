/**
 * POST /api/auth/logout
 * Clears the xl-session httpOnly cookie and revokes the token in Redis so
 * it cannot be replayed even if extracted before expiry.
 *
 * Also clears xl-driver-session — the driver mobile app uses a separate
 * cookie namespace to keep driver sessions isolated from the admin. Logging
 * out of one should log out of both.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { revokeSession } from '@/lib/session-blocklist';
import { verifySession } from '@/lib/tenant-session';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
const SESSION_COOKIES = ['xl-session', 'xl-driver-session'] as const;

async function logoutResponse(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true, message: 'Logged out successfully.' });

  for (const name of SESSION_COOKIES) {
    const raw = request.cookies.get(name)?.value;

    // Revoke the token in Redis before clearing the cookie so any in-flight
    // request that already read the cookie is also rejected.
    if (raw) {
      try {
        // verifySession parses the exp — we need it for the Redis TTL.
        // We call verifySession here just to extract exp; even if it returns
        // null (already expired) we still clear the cookie below.
        const session = await verifySession(raw);
        if (session) {
          // Recover exp from token payload (base64url portion before the dot).
          const dotIndex = raw.lastIndexOf('.');
          if (dotIndex !== -1) {
            const payloadJson = atob(
              raw.slice(0, dotIndex)
                .replace(/-/g, '+')
                .replace(/_/g, '/')
                + '==',
            );
            const { exp } = JSON.parse(payloadJson) as { exp?: number };
            if (exp) {
              await revokeSession(raw, exp);
            }
          }
        }
      } catch {
        // Non-fatal — cookie still cleared below.
      }
    }

    response.cookies.set(name, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure:   process.env.NODE_ENV === 'production',
      maxAge:   0,
      path:     '/',
    });
  }

  return response;
}

export async function POST(request: NextRequest) {
  return logoutResponse(request);
}

export async function GET(request: NextRequest) {
  return logoutResponse(request);
}
