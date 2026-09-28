/**
 * Tenant session utilities — session signing, verification, and context extraction.
 * Token format: base64url(JSON payload) + '.' + HMAC-SHA256 hex signature
 *
 * Uses Web Crypto API (globalThis.crypto.subtle) so this module is compatible
 * with both Edge Runtime (Next.js middleware) and Node.js API routes.
 * No external dependencies, no Node.js built-ins.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { decodePermissionClaim, encodePermissionClaim, type PermissionClaim } from '@/lib/authz/permission-claim';
import { isRevokedSince } from '@/lib/auth/revocation-check';
import { isSessionRevoked } from '@/lib/session-blocklist';
import { requireSessionSecret } from '@/lib/session-secret';

function getSecret(): string {
  return requireSessionSecret();
}

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Helpers ──────────────────────────────────────────────────────────────────

function toBase64Url(bytes: Uint8Array | string): string {
  let b64: string;
  if (typeof bytes === 'string') {
    if (typeof Buffer !== 'undefined') {
      b64 = Buffer.from(bytes, 'utf8').toString('base64');
    } else {
      b64 = btoa(unescape(encodeURIComponent(bytes)));
    }
  } else {
    if (typeof Buffer !== 'undefined') {
      b64 = Buffer.from(bytes).toString('base64');
    } else {
      let binary = '';
      bytes.forEach(b => (binary += String.fromCharCode(b)));
      b64 = btoa(binary);
    }
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromBase64Url(str: string): string {
  try {
    const padded = str.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4;
    const b64 = pad ? padded + '='.repeat(4 - pad) : padded;
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(b64, 'base64').toString('utf8');
    }
    return decodeURIComponent(escape(atob(b64)));
  } catch {
    return '';
  }
}

function hexFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function bytesFromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) return new Uint8Array(0);
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return arr;
}

/** Import a secret as an HMAC-SHA256 key (cached lazily). */
let _keyPromise: Promise<CryptoKey> | null = null;
let _cachedSecret: string | null = null;

function getKey(customSecret?: string): Promise<CryptoKey> {
  const secret = customSecret ?? getSecret();
  if (!customSecret) {
    if (_keyPromise && _cachedSecret === secret) {
      return _keyPromise;
    }
    _cachedSecret = secret;
    const enc = new TextEncoder();
    _keyPromise = globalThis.crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
    return _keyPromise;
  }

  const enc = new TextEncoder();
  return globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function hmacSign(data: string): Promise<string> {
  const key = await getKey();
  const enc = new TextEncoder();
  const sig = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(data));
  return hexFromBytes(new Uint8Array(sig));
}

async function hmacVerify(data: string, hexSig: string): Promise<boolean> {
  try {
    const enc = new TextEncoder();
    const sigBytes = bytesFromHex(hexSig);
    if (sigBytes.length !== 32) return false;

    // Verify with the configured secret only. There is no fallback to a
    // default/dev secret — a token that doesn't validate against the real
    // configured secret is invalid, full stop. (Previously this also
    // accepted tokens signed with a hard-coded default secret even when
    // a real SESSION_SECRET was configured, which let anyone who knew
    // that default string forge a valid session for any tenant/role.)
    const primaryKey = await getKey();
    const valid = await globalThis.crypto.subtle.verify(
      'HMAC',
      primaryKey,
      new Uint8Array(sigBytes),
      enc.encode(data),
    );
    return valid;
  } catch {
    return false;
  }
}

// ── Token management ─────────────────────────────────────────────────────────

export interface SessionPayload {
  userId: string;
  tenantId: string;
  plan: string;
  role: string; // e.g. 'SUPER_ADMIN' | 'TENANT_ADMIN'
  /** Set when a SUPER_ADMIN is impersonating this user — value is the
   *  impersonator's userId. Used to render the banner and audit actions. */
  impersonatedBy?: string;
  /**
   * ENTERPRISE data-residency region. Embedded in the session token so
   * middleware can route DB calls without a round-trip DB lookup on every
   * request. Values: 'GLOBAL' | 'EU' | 'UAE' | 'US'.
   * Absent for non-ENTERPRISE tenants (treated as 'GLOBAL' by the router).
   */
  dataResidency?: string;
  /** Effective permissions (src/lib/authz/permission-claim.ts). */
  perms?: PermissionClaim;
  /** Issued at (ms): a revocation invalidates sessions issued before it. */
  iat?: number;
  exp: number;
}

export interface VerifiedSession {
  userId: string;
  tenantId: string;
  plan: string;
  role: string;
  impersonatedBy?: string;
  dataResidency?: string;
  /** Effective permissions from the signed claim; null when the session carries none. */
  permissions: string[] | null;
}

/**
 * Signs a session payload and returns an opaque token string.
 */
export async function signSession(payload: {
  userId: string;
  tenantId: string;
  plan: string;
  role: string;
  impersonatedBy?: string;
  /**
   * The tenant's data-residency region; omit for GLOBAL. Every issuer sets
   * it (residencyClaimForTenant / residencySessionClaim) so middleware can
   * refuse tenants whose region this deployment does not serve.
   */
  dataResidency?: string;
  /**
   * The user's effective permissions in this tenant
   * (resolveSessionPermissions). Every staff session issuer passes them;
   * the authorization policy treats a session without them as holding none.
   */
  permissions?: readonly string[];
  /** Override TTL in ms (default 24 h). Impersonation uses a shorter TTL. */
  ttlMs?: number;
}): Promise<string> {
  const { ttlMs, permissions, ...rest } = payload;
  const fullPayload: SessionPayload = {
    ...rest,
    ...(permissions ? { perms: encodePermissionClaim(permissions) } : {}),
    iat: Date.now(),
    exp: Date.now() + (ttlMs ?? TOKEN_TTL_MS),
  };
  const encodedPayload = toBase64Url(JSON.stringify(fullPayload));
  const signature = await hmacSign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

/**
 * Verifies a session token.
 * Returns the decoded payload, or null if invalid / expired.
 */
export async function verifySession(
  token: string,
): Promise<VerifiedSession | null> {
  try {
    const dotIndex = token.lastIndexOf('.');
    if (dotIndex === -1) return null;

    const encodedPayload = token.slice(0, dotIndex);
    const signature = token.slice(dotIndex + 1);

    const valid = await hmacVerify(encodedPayload, signature);
    if (!valid) return null;

    const payload: SessionPayload = JSON.parse(fromBase64Url(encodedPayload));

    if (!payload.exp || payload.exp < Date.now()) {
      return null;
    }

    // Every login flow signs a role into the token. A token without one is
    // legacy or malformed, so treat it as no session rather than guessing a
    // role. (This used to default to TENANT_ADMIN, which gave a role-less
    // session full tenant-admin rights.)
    if (typeof payload.role !== 'string' || payload.role.trim() === '') {
      return null;
    }

    // Check revocation blocklist (Redis-backed; no-op when Redis not configured).
    if (await isSessionRevoked(token)) {
      return null;
    }

    // Revoked for the user, the tenant or the user in the tenant (role or
    // membership change, deactivation, password reset, sign out everywhere)
    // since it was issued; re-checked at most every 60 s. Sessions from
    // before iat existed count as issued a full lifetime before expiry.
    const issuedAt = typeof payload.iat === 'number' ? payload.iat : payload.exp - TOKEN_TTL_MS;
    if (await isRevokedSince(payload.userId, payload.tenantId, issuedAt)) {
      return null;
    }

    return {
      userId:        payload.userId,
      tenantId:      payload.tenantId,
      plan:          payload.plan,
      role:          payload.role,
      ...(payload.impersonatedBy ? { impersonatedBy: payload.impersonatedBy } : {}),
      ...(payload.dataResidency  ? { dataResidency:  payload.dataResidency  } : {}),
      // null: signed without a claim, or against another catalogue version.
      permissions:   decodePermissionClaim(payload.perms),
    };
  } catch {
    return null;
  }
}

// ── Request context helpers ───────────────────────────────────────────────────

/** Verify credentials directly on routes that bypass operator middleware. */
export async function getVerifiedRequestSession(request: { headers: Headers }) {
  const cookies = (request.headers.get('cookie') ?? '').split(';')
    .map(value => value.trim()).filter(value => value.startsWith('xl-session='));
  if (cookies.length !== 1) return null;
  const session = await verifySession(cookies[0].slice('xl-session='.length));
  if (!session || typeof session.userId !== 'string' || !session.userId ||
      typeof session.tenantId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(session.tenantId)) return null;
  return session;
}

export interface TenantContext {
  tenantId: string;
  userId: string;
  plan: string;
  /**
   * ENTERPRISE data-residency region injected by middleware as
   * `x-data-residency`. Absent (undefined) for non-ENTERPRISE tenants.
   * Use with `getPrismaForTenant()` from db-router.ts to obtain the
   * correct regional Prisma client.
   */
  dataResidency?: string;
}

/**
 * Reads tenant context from x-tenant-id / x-user-id / x-tenant-plan headers
 * set by middleware. Throws a 401 NextResponse if any header is missing.
 */
export function getTenantContext(request: NextRequest): TenantContext {
  const ctx = getTenantContextOrNull(request);
  if (!ctx) {
    throw NextResponse.json(
      { error: 'Unauthorized', message: 'Valid session required' },
      { status: 401 },
    );
  }
  return ctx;
}

/**
 * Reads tenant context from request headers set by middleware.
 * Returns null instead of throwing if headers are missing.
 */
export function getTenantContextOrNull(request: NextRequest): TenantContext | null {
  const tenantId     = request.headers.get('x-tenant-id');
  const userId       = request.headers.get('x-user-id');
  const plan         = request.headers.get('x-tenant-plan');
  const dataResidency = request.headers.get('x-data-residency') ?? undefined;

  if (!tenantId || !userId || !plan) return null;

  return { tenantId, userId, plan, dataResidency };
}
