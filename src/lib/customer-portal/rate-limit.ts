/**
 * Customer Portal — sign-in and password-setup rate limits.
 * Same limits as the RAC portal: 25 attempts / 15 min per IP and
 * 8 attempts / 15 min per (IP, email).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { RateLimiter } from '@/lib/rate-limiter';

const WINDOW_MS = 15 * 60_000;
const limiter = new RateLimiter({ windowMs: WINDOW_MS, maxRequests: 25 });

export function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (xff) return xff.slice(0, 128);
  return req.headers.get('x-real-ip')?.trim().slice(0, 128) || '127.0.0.1';
}

function tooMany(message: string, resetMs: number): NextResponse {
  const retryAfter = Math.max(1, Math.ceil((resetMs - Date.now()) / 1000));
  return NextResponse.json(
    { ok: false, error: message, code: 'RATE_LIMIT_EXCEEDED', retryAfter },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
}

export async function limitCustomerPortalAuth(
  req: NextRequest, action: 'login' | 'setup', email?: string | null,
): Promise<NextResponse | null> {
  const ip = clientIp(req);
  const byIp = await limiter.check(`customer-portal:${action}:ip:${ip}`, 25);
  if (!byIp.allowed) return tooMany('Too many attempts from this network. Wait a few minutes and try again.', byIp.resetMs);
  const norm = (email ?? '').trim().toLowerCase().slice(0, 254);
  if (norm) {
    const byPair = await limiter.check(`customer-portal:${action}:ip-email:${ip}:${norm}`, 8);
    if (!byPair.allowed) return tooMany('Too many attempts for this account. Wait a few minutes and try again.', byPair.resetMs);
  }
  return null;
}
