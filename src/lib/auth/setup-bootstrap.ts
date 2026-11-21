/**
 * Shared fail-closed validation and rate limiting for one-time initial
 * platform Super Admin bootstrap (M1-P0-2).
 */

import type { NextRequest } from 'next/server';
import { RateLimiter } from '@/lib/rate-limiter';

export const MIN_SETUP_SECRET_LENGTH = 32;
export const MAX_SETUP_BOOTSTRAP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
export const BOOTSTRAP_ADVISORY_LOCK_KEY = 7361001;

let setupPerIpLimiter = new RateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5,
});

let setupGlobalLimiter = new RateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 15,
});

export function getSetupRateLimiters(): {
  perIp: RateLimiter;
  global: RateLimiter;
} {
  return { perIp: setupPerIpLimiter, global: setupGlobalLimiter };
}

/** Tests only: reset in-process fallback rate-limit windows between cases. */
export function resetSetupRateLimiterForTests(): void {
  setupPerIpLimiter = new RateLimiter({
    windowMs: 15 * 60 * 1000,
    maxRequests: 5,
  });
  setupGlobalLimiter = new RateLimiter({
    windowMs: 15 * 60 * 1000,
    maxRequests: 15,
  });
}

/**
 * Derive client IP from the trusted proxy edge rather than the attacker-
 * spoofable leftmost entry of X-Forwarded-For.
 *
 * Standard reverse proxies (Railway, Cloudflare, Envoy, NGINX) append the
 * connecting peer IP on the right of X-Forwarded-For (or overwrite
 * cf-connecting-ip / x-real-ip). Using the rightmost non-empty entry prevents
 * trivial rate-limit bypass by prepending random spoofed IPs.
 */
export function trustedClientIp(req: NextRequest): string {
  // Prefer rightmost X-Forwarded-For hop appended by Railway/proxy edge first
  // so client-injected CF-Connecting-IP headers on non-Cloudflare deployments
  // cannot spoof audit_logs.ip_address or stretch per-IP rate limits.
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }

  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  const cfIp = req.headers.get('cf-connecting-ip')?.trim();
  if (cfIp) return cfIp;

  return 'unknown';
}

export function validateBootstrapConfig():
  | { ok: true; secret: string }
  | { ok: false; status: 410 | 503; reason: string } {
  const isProd = process.env.NODE_ENV === 'production';

  // In production, bootstrap must be explicitly enabled for the initial install window.
  if (isProd && process.env.SETUP_BOOTSTRAP_ENABLED !== 'true') {
    return { ok: false, status: 503, reason: 'SETUP_BOOTSTRAP_ENABLED is not true in production' };
  }

  const secret = (process.env.SETUP_SECRET ?? '').trim();
  if (!secret || secret.length < MIN_SETUP_SECRET_LENGTH) {
    return { ok: false, status: 503, reason: 'SETUP_SECRET missing or below 32-character minimum' };
  }

  const expiresAtRaw = process.env.SETUP_BOOTSTRAP_EXPIRES_AT?.trim();
  if (expiresAtRaw) {
    const expiresAtMs = Date.parse(expiresAtRaw);
    const now = Date.now();
    if (!Number.isFinite(expiresAtMs) || now > expiresAtMs) {
      return { ok: false, status: 410, reason: 'SETUP_BOOTSTRAP_EXPIRES_AT is invalid or expired' };
    }
    if (isProd && expiresAtMs - now > MAX_SETUP_BOOTSTRAP_WINDOW_MS) {
      return { ok: false, status: 503, reason: 'SETUP_BOOTSTRAP_EXPIRES_AT exceeds 24h maximum window in production' };
    }
  }

  return { ok: true, secret };
}
