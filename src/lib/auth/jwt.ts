/**
 * Bearer JWT signing & verification for the Go backend.
 *
 * The Next.js side is the only issuer; the Go backend validates against
 * the same JWT_SECRET via backend/auth/jwt.go (HS256). Browsers store the
 * returned token in localStorage and attach it as `Authorization: Bearer
 * <token>` on every call to the Go backend.
 *
 * Token shape (must match backend/auth/jwt.go Claims):
 *   header   { "alg": "HS256", "typ": "JWT" }
 *   payload  { iss, sub, tenant_id, role, iat, exp, jti?, perms?, plan?, impersonated_by? }
 *
 * `jti` carries the shared UUIDv4 session ID (`sid`) paired with the Next.js
 * `xl-session` cookie so single-device logout atomically invalidates both
 * tokens in PostgreSQL (`revoked_session_tokens`) and Redis.
 */

import { encodePermissionClaim } from '@/lib/authz/permission-claim';

const JWT_ISSUER = 'fleet360-nextjs';
const JWT_TTL_SECONDS = 24 * 60 * 60; // 24h — matches the xl-session cookie

export interface JwtPayload {
  /** User id (from User.id) — becomes the `sub` claim. */
  userId: string;
  /** Active tenant id (from UserTenant.tenantId). */
  tenantId: string;
  /** Role code (from Role.code), e.g. "SUPER_ADMIN", "FLEET_OPERATOR". */
  role: string;
  /** Effective permissions in the tenant (as signed into the session); omit for non-staff tokens. */
  permissions?: readonly string[] | null;
  /** The tenant's plan (TRIAL is read-only outside trial-free modules). */
  plan?: string | null;
  /** Real user ID if the current session is an impersonation session. */
  impersonatedBy?: string | null;
  /** Shared session ID (UUIDv4) — encoded as RFC 7519 `jti` for single-device revocation parity. */
  sid?: string | null;
  /** Explicit issued-at unix seconds (prevents proxy re-signing from laundering a revoked session's `iat`). */
  issuedAtSec?: number | null;
  /** Explicit issued-at unix milliseconds (enables same-second bulk revocation parity with Go backend). */
  issuedAtMs?: number | null;
  /** Override token lifetime in seconds (default 24h). */
  ttlSeconds?: number | null;
}

export interface VerifiedBackendJwt {
  userId: string;
  tenantId: string;
  role: string;
  jti?: string;
  impersonatedBy?: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

/**
 * Sign a JWT for the Go backend. Returns the compact serialised form
 * (`header.payload.signature`).
 *
 * Throws if JWT_SECRET is unset or shorter than 16 characters — symmetric
 * to the Go side's refusal to validate against a too-short secret.
 */
export async function signJwtForBackend(payload: JwtPayload): Promise<string> {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret.length < 16) {
    throw new Error(
      'JWT_SECRET env var must be set and at least 16 characters (shared with Go backend)',
    );
  }

  const header = { alg: 'HS256', typ: 'JWT' };
  const nowMs = Date.now();
  const now = Math.floor(nowMs / 1000);
  const ttl =
    typeof payload.ttlSeconds === 'number' && Number.isFinite(payload.ttlSeconds) && payload.ttlSeconds > 0
      ? Math.floor(payload.ttlSeconds)
      : JWT_TTL_SECONDS;
  const iatMs =
    typeof payload.issuedAtMs === 'number' && Number.isFinite(payload.issuedAtMs) && payload.issuedAtMs > 0
      ? Math.min(Math.floor(payload.issuedAtMs), nowMs)
      : typeof payload.issuedAtSec === 'number' && Number.isFinite(payload.issuedAtSec) && payload.issuedAtSec > 0
        ? Math.min(Math.floor(payload.issuedAtSec) * 1000, nowMs)
        : nowMs;
  const iat = Math.floor(iatMs / 1000);
  const cleanSid = typeof payload.sid === 'string' && payload.sid.trim() ? payload.sid.trim() : undefined;

  const claims = {
    iss: JWT_ISSUER,
    sub: payload.userId,
    tenant_id: payload.tenantId,
    role: payload.role,
    iat,
    iat_ms: iatMs,
    exp: now + ttl,
    ...(cleanSid ? { jti: cleanSid } : {}),
    ...(payload.permissions ? { perms: encodePermissionClaim(payload.permissions) } : {}),
    ...(payload.plan ? { plan: payload.plan } : {}),
    ...(payload.impersonatedBy ? { impersonated_by: payload.impersonatedBy } : {}),
  };

  const encodedHeader = base64UrlEncodeString(JSON.stringify(header));
  const encodedPayload = base64UrlEncodeString(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signingInput),
  );
  const encodedSig = base64UrlEncodeBytes(new Uint8Array(sigBuf));

  return `${signingInput}.${encodedSig}`;
}

/**
 * Verify a Go-backend HS256 JWT signed by `signJwtForBackend` (using JWT_SECRET).
 * Used on logout (`Authorization: Bearer <jwt>`) so standalone Go Bearer JWTs
 * are cryptographically verified before persisting durable revocation records.
 */
export async function verifyJwtForBackend(token: string): Promise<VerifiedBackendJwt | null> {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret.length < 16) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSig] = parts;
  if (!encodedHeader || !encodedPayload || !encodedSig) return null;

  try {
    const header = JSON.parse(base64UrlDecodeToString(encodedHeader)) as { alg?: unknown; typ?: unknown };
    if (header.alg !== 'HS256') return null;

    const sigBytes = base64UrlDecodeToBytes(encodedSig);
    if (sigBytes.length !== 32) return null;

    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const valid = await globalThis.crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    );
    if (!valid) return null;

    const claims = JSON.parse(base64UrlDecodeToString(encodedPayload)) as Record<string, unknown>;
    if (claims.iss !== JWT_ISSUER) return null;
    if (typeof claims.sub !== 'string' || !claims.sub.trim()) return null;
    if (typeof claims.tenant_id !== 'string' || !claims.tenant_id.trim()) return null;
    if (typeof claims.role !== 'string' || !claims.role.trim()) return null;
    if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) return null;

    const expiresAtMs = claims.exp * 1000;
    if (expiresAtMs <= Date.now()) return null;

    const issuedAtMs =
      typeof claims.iat_ms === 'number' && Number.isFinite(claims.iat_ms) && claims.iat_ms > 0
        ? Math.floor(claims.iat_ms)
        : typeof claims.iat === 'number' && Number.isFinite(claims.iat)
          ? claims.iat * 1000
          : expiresAtMs - JWT_TTL_SECONDS * 1000;
    const jti = typeof claims.jti === 'string' && claims.jti.trim() ? claims.jti.trim() : undefined;
    const impersonatedBy =
      typeof claims.impersonated_by === 'string' && claims.impersonated_by.trim()
        ? claims.impersonated_by.trim()
        : undefined;

    return {
      userId: claims.sub.trim(),
      tenantId: claims.tenant_id.trim(),
      role: claims.role.trim(),
      ...(jti ? { jti } : {}),
      ...(impersonatedBy ? { impersonatedBy } : {}),
      issuedAtMs,
      expiresAtMs,
    };
  } catch {
    return null;
  }
}

// ── base64url helpers (RFC 7515 §2 — no padding, "+/" → "-_") ──────────────

function base64UrlEncodeString(s: string): string {
  const utf8 = new TextEncoder().encode(s);
  return base64UrlEncodeBytes(utf8);
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecodeToBytes(str: string): Uint8Array<ArrayBuffer> {
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  if (pad === 1) throw new Error('Invalid base64url length');
  const padded = pad ? normalized + '='.repeat(4 - pad) : normalized;
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64UrlDecodeToString(str: string): string {
  return new TextDecoder().decode(base64UrlDecodeToBytes(str));
}
