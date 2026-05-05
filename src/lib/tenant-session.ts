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

const SECRET =
  process.env.SESSION_SECRET ?? 'xl-mobility-dev-secret-change-in-production';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Helpers ──────────────────────────────────────────────────────────────────

function toBase64Url(bytes: Uint8Array | string): string {
  let b64: string;
  if (typeof bytes === 'string') {
    // String → encode as UTF-8 bytes → base64
    b64 = btoa(unescape(encodeURIComponent(bytes)));
  } else {
    let binary = '';
    bytes.forEach(b => (binary += String.fromCharCode(b)));
    b64 = btoa(binary);
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromBase64Url(str: string): string {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  const b64 = pad ? padded + '='.repeat(4 - pad) : padded;
  return decodeURIComponent(escape(atob(b64)));
}

function hexFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function bytesFromHex(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return arr;
}

/** Import the SECRET as an HMAC-SHA256 key (cached lazily). */
let _keyPromise: Promise<CryptoKey> | null = null;
function getKey(): Promise<CryptoKey> {
  if (!_keyPromise) {
    const enc = new TextEncoder();
    _keyPromise = globalThis.crypto.subtle.importKey(
      'raw',
      enc.encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
  }
  return _keyPromise;
}

async function hmacSign(data: string): Promise<string> {
  const key = await getKey();
  const enc = new TextEncoder();
  const sig = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(data));
  return hexFromBytes(new Uint8Array(sig));
}

async function hmacVerify(data: string, hexSig: string): Promise<boolean> {
  const key = await getKey();
  const enc = new TextEncoder();
  const sigBytes = bytesFromHex(hexSig);
  return globalThis.crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(data));
}

// ── Token management ─────────────────────────────────────────────────────────

export interface SessionPayload {
  userId: string;
  tenantId: string;
  plan: string;
  role: string; // e.g. 'SUPER_ADMIN' | 'TENANT_ADMIN'
  exp: number;
}

/**
 * Signs a session payload and returns an opaque token string.
 */
export async function signSession(payload: {
  userId: string;
  tenantId: string;
  plan: string;
  role: string;
}): Promise<string> {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Date.now() + TOKEN_TTL_MS,
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
): Promise<{ userId: string; tenantId: string; plan: string; role: string } | null> {
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

    return {
      userId:   payload.userId,
      tenantId: payload.tenantId,
      plan:     payload.plan,
      role:     payload.role ?? 'TENANT_ADMIN',
    };
  } catch {
    return null;
  }
}

// ── Request context helpers ───────────────────────────────────────────────────

export interface TenantContext {
  tenantId: string;
  userId: string;
  plan: string;
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
  const tenantId = request.headers.get('x-tenant-id');
  const userId   = request.headers.get('x-user-id');
  const plan     = request.headers.get('x-tenant-plan');

  if (!tenantId || !userId || !plan) return null;

  return { tenantId, userId, plan };
}
