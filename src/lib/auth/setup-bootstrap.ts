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

const MAX_IP_HEADER_SCAN_BYTES = 4096;
const STRICT_IPV4_RE = /^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/;
const IPV6_CHARS_RE = /^[0-9a-f:.]+$/;
const CANONICAL_IPV4_MAPPED_RE = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;

/**
 * Detects whether this process is running behind Railway's managed ingress
 * using server-injected environment variables (never client-spoofable headers).
 */
export function isRailwayRuntime(): boolean {
  return Boolean(
    process.env.RAILWAY_ENVIRONMENT?.trim() ||
    process.env.RAILWAY_PROJECT_ID?.trim() ||
    process.env.RAILWAY_SERVICE_ID?.trim(),
  );
}

function parseStrictIpv4(candidate: string): string | null {
  if (!STRICT_IPV4_RE.test(candidate)) return null;
  const octets = candidate.split('.');
  for (let i = 0; i < 4; i++) {
    const n = Number(octets[i]);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
  }
  return candidate;
}

/**
 * Canonicalizes an IPv6 literal to RFC 5952 compressed lowercase form using
 * the WHATWG URL parser (Edge Runtime & Node.js compatible), and unwraps all
 * IPv4-mapped IPv6 representations (dotted, hex, or expanded) to dotted-quad
 * IPv4 so alternate textual encodings cannot split per-IP rate-limit buckets.
 */
function parseCanonicalIpv6(candidate: string): string | null {
  if (!candidate.includes(':') || !IPV6_CHARS_RE.test(candidate)) return null;
  try {
    const hostname = new URL(`http://[${candidate}]/`).hostname;
    if (!hostname.startsWith('[') || !hostname.endsWith(']')) return null;
    const canonical = hostname.slice(1, -1);
    const mapped = CANONICAL_IPV4_MAPPED_RE.exec(canonical);
    if (mapped) {
      const hi = parseInt(mapped[1], 16);
      const lo = parseInt(mapped[2], 16);
      return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    }
    return canonical;
  } catch {
    return null;
  }
}

/**
 * Validates and canonicalizes a single IP literal (strict IPv4, RFC 5952 IPv6,
 * IPv4-mapped IPv6, optional port or RFC 7239 quotes). Returns null for
 * malformed, multi-value, zone-qualified, or oversized strings so untrusted
 * garbage never enters rate-limit keys or audit logs.
 */
export function parseIpCandidate(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 128) return null;
  let s = raw.trim();
  if (!s || s.length > 64) return null;

  if (s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1).trim();
  }
  if (!s) return null;

  if (s.startsWith('[')) {
    const closeIdx = s.indexOf(']');
    if (closeIdx === -1) return null;
    const host = s.slice(1, closeIdx);
    // RFC 7239 brackets are strictly for IPv6 literals.
    if (!host.includes(':')) return null;
    const rest = s.slice(closeIdx + 1);
    if (rest) {
      if (!/^:\d{1,5}$/.test(rest)) return null;
      const portNum = Number(rest.slice(1));
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) return null;
    }
    s = host;
  } else {
    const firstColon = s.indexOf(':');
    if (firstColon !== -1 && s.indexOf(':', firstColon + 1) === -1) {
      const host = s.slice(0, firstColon);
      const port = s.slice(firstColon + 1);
      if (!/^\d{1,5}$/.test(port)) return null;
      const portNum = Number(port);
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) return null;
      s = host;
    }
  }

  if (s.includes('%')) return null;

  const lowered = s.toLowerCase();
  return parseStrictIpv4(lowered) ?? parseCanonicalIpv6(lowered);
}

/**
 * Extracts a right-anchored valid IP from X-Forwarded-For bounded to the
 * trailing 4 KB (preventing attacker-prepended padding from pushing off the
 * real proxy-appended client IP):
 *  - 'rightmost': last valid IP (standard single-hop reverse proxy).
 *  - 'penultimate': 2nd valid IP from the right when >= 2 valid IPs exist
 *    (strips Railway's single trailing CDN77 ingress hop while still defeating
 *    attacker-prepended leftmost spoofed entries), else falls back to the sole
 *    valid IP.
 */
function extractValidXffIp(xff: string | null, mode: 'rightmost' | 'penultimate'): string | null {
  if (!xff) return null;
  const bounded =
    xff.length > MAX_IP_HEADER_SCAN_BYTES
      ? xff.slice(-MAX_IP_HEADER_SCAN_BYTES)
      : xff;
  const parts = bounded.split(',');
  const wanted = mode === 'penultimate' ? 2 : 1;
  const foundFromRight: string[] = [];

  for (let i = parts.length - 1; i >= 0; i--) {
    const parsed = parseIpCandidate(parts[i]);
    if (parsed) {
      foundFromRight.push(parsed);
      if (foundFromRight.length >= wanted) break;
    }
  }

  if (foundFromRight.length === 0) return null;
  if (mode === 'penultimate' && foundFromRight.length >= 2) {
    return foundFromRight[1];
  }
  return foundFromRight[0];
}

/**
 * Derive the real client IP safely for rate-limiting and audit forensics.
 *
 * - On Railway (`RAILWAY_ENVIRONMENT` / `RAILWAY_PROJECT_ID` / `RAILWAY_SERVICE_ID`):
 *   Railway's Metal Edge (CDN77) overwrites `X-Real-IP` with the true connecting
 *   client IP and appends its own rotating ingress proxy IP (`152.233.x.x`) to
 *   the right of `X-Forwarded-For`. Reading rightmost `X-Forwarded-For` on
 *   Railway buckets unrelated customers onto shared CDN77 edge IPs and dilutes
 *   per-IP limits across POPs; therefore we prefer Railway-overwritten `X-Real-IP`
 *   first, falling back to right-anchored penultimate valid `X-Forwarded-For`
 *   (stripping the trailing CDN77 hop while still defeating spoofed leftmost
 *   entries), then `CF-Connecting-IP`.
 *
 * - Outside Railway (local dev, CI, standard reverse proxies such as NGINX/Envoy):
 *   Proxies append the connecting peer IP on the right of `X-Forwarded-For`, so
 *   we prefer the rightmost valid `X-Forwarded-For` entry first (defeating
 *   attacker-spoofed leftmost entries), then `X-Real-IP`, then `CF-Connecting-IP`.
 */
export function trustedClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  const realIp = parseIpCandidate(req.headers.get('x-real-ip'));
  const cfIp = parseIpCandidate(req.headers.get('cf-connecting-ip'));

  if (isRailwayRuntime()) {
    if (realIp) return realIp;
    const railwayPenultimateXff = extractValidXffIp(xff, 'penultimate');
    if (railwayPenultimateXff) return railwayPenultimateXff;
    if (cfIp) return cfIp;
    return 'unknown';
  }

  const rightmostXff = extractValidXffIp(xff, 'rightmost');
  if (rightmostXff) return rightmostXff;
  if (realIp) return realIp;
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
