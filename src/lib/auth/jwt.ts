/**
 * Bearer JWT signing for the Go backend.
 *
 * The Next.js side is the only issuer; the Go backend validates against
 * the same JWT_SECRET via backend/auth/jwt.go (HS256). Browsers store the
 * returned token in localStorage and attach it as `Authorization: Bearer
 * <token>` on every call to the Go backend.
 *
 * Why hand-rolled WebCrypto instead of `jose`?
 *   - Matches the existing tenant-session pattern in src/lib/tenant-session.ts.
 *   - No new npm dependency.
 *   - Edge Runtime + Node.js compatible (globalThis.crypto.subtle is the
 *     same surface in both).
 *   - The JWT format is small and unambiguous — a 60-line implementation
 *     is more reviewable than pulling in a library.
 *
 * Token shape (must match backend/auth/jwt.go Claims):
 *   header   { "alg": "HS256", "typ": "JWT" }
 *   payload  { iss, sub, tenant_id, role, iat, exp }
 *   sig      HMAC-SHA256( header.payload )  (base64url, no padding)
 */

const JWT_ISSUER = 'fleet360-nextjs';
const JWT_TTL_SECONDS = 24 * 60 * 60; // 24h — matches the xl-session cookie

interface JwtPayload {
  /** User id (from User.id) — becomes the `sub` claim. */
  userId: string;
  /** Active tenant id (from UserTenant.tenantId). */
  tenantId: string;
  /** Role code (from Role.code), e.g. "SUPER_ADMIN", "FLEET_OPERATOR". */
  role: string;
}

/**
 * Sign a JWT for the Go backend. Returns the compact serialised form
 * (`header.payload.signature`). Caller decides where to put it — typically
 * in the login response body so the browser can stash it in localStorage.
 *
 * Throws if JWT_SECRET is unset or shorter than 16 characters — symmetric
 * to the Go side's refusal to validate against a too-short secret.
 */
export async function signJwtForBackend(payload: JwtPayload): Promise<string> {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'JWT_SECRET env var must be set and at least 16 characters (shared with Go backend)',
    );
  }

  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: JWT_ISSUER,
    sub: payload.userId,
    tenant_id: payload.tenantId,
    role: payload.role,
    iat: now,
    exp: now + JWT_TTL_SECONDS,
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

// ── base64url helpers (RFC 7515 §2 — no padding, "+/" → "-_") ──────────────

function base64UrlEncodeString(s: string): string {
  // btoa requires Latin-1; encode UTF-8 bytes first.
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
