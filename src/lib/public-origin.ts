/**
 * Canonical public origin resolution behind reverse proxies (CDN, TLS termination, Docker).
 *
 * Checks in order:
 * 1. Explicit NEXT_PUBLIC_APP_URL configuration (trailing slashes stripped)
 * 2. X-Forwarded-Proto and X-Forwarded-Host (or Host) headers from reverse proxy
 * 3. Fallback to request URL / nextUrl origin or https://localhost:8080
 */

export function getPublicOrigin(req?: {
  headers?: Headers;
  nextUrl?: { origin: string };
  url?: string;
}): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;

  if (req?.headers) {
    const rawProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const proto = rawProto || 'https';
    const host = (req.headers.get('x-forwarded-host') || req.headers.get('host'))?.split(',')[0]?.trim();
    if (host) {
      return `${proto}://${host}`;
    }
  }

  if (req?.nextUrl?.origin) {
    return req.nextUrl.origin;
  }

  if (req?.url) {
    try {
      return new URL(req.url).origin;
    } catch {
      // ignore
    }
  }

  return 'https://localhost:8080';
}
