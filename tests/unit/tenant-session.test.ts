/**
 * Unit tests for src/lib/tenant-session.ts
 *
 * What is tested:
 *  - signSession(): returns a properly formatted token string
 *  - verifySession(): decodes a valid token and returns the correct payload
 *  - verifySession(): returns null for tampered tokens
 *  - verifySession(): returns null for expired tokens (Date.now mock)
 *  - Round-trip: sign → verify returns the same payload
 *
 * Prerequisites:
 *  - SESSION_SECRET env var (set by tests/setup.ts from .env.test)
 *  - Web Crypto available (polyfilled in setup.ts for Node < 20)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signSession, verifySession } from '@/lib/tenant-session';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SAMPLE_PAYLOAD = {
  userId:   'user-uuid-001',
  tenantId: 'tenant-uuid-001',
  plan:     'ENTERPRISE',
  role:     'TENANT_ADMIN',
};

// ── signSession() ─────────────────────────────────────────────────────────────

describe('signSession()', () => {
  it('returns a string', async () => {
    const token = await signSession(SAMPLE_PAYLOAD);
    expect(typeof token).toBe('string');
  });

  it('returns a token with a single dot separator (payload.signature)', async () => {
    const token = await signSession(SAMPLE_PAYLOAD);
    // Token format: base64url(payload) + '.' + hex-signature
    // The dot is the last dot (payload itself contains no dots in base64url)
    expect(token).toContain('.');
    const parts = token.split('.');
    // There should be exactly 2 parts: encoded payload and hex signature
    expect(parts.length).toBe(2);
  });

  it('returns a non-empty string for all valid payload fields', async () => {
    const token = await signSession({
      userId:   'u1',
      tenantId: 't1',
      plan:     'TRIAL',
      role:     'SUPER_ADMIN',
    });
    expect(token.length).toBeGreaterThan(10);
  });

  it('produces different tokens for different payloads (because exp differs too)', async () => {
    const t1 = await signSession({ ...SAMPLE_PAYLOAD, userId: 'user-A' });
    const t2 = await signSession({ ...SAMPLE_PAYLOAD, userId: 'user-B' });
    expect(t1).not.toBe(t2);
  });

  it('includes exp in the encoded payload', async () => {
    const before = Date.now();
    const token = await signSession(SAMPLE_PAYLOAD);
    const after = Date.now();

    // Decode payload without verifying signature
    const encodedPayload = token.slice(0, token.lastIndexOf('.'));
    const pad = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = pad + '='.repeat((4 - (pad.length % 4)) % 4);
    const decoded = JSON.parse(decodeURIComponent(escape(atob(padded))));

    expect(decoded.exp).toBeGreaterThanOrEqual(before);
    expect(decoded.exp).toBeLessThanOrEqual(after + 24 * 60 * 60 * 1000 + 100);
  });
});

// ── verifySession() ───────────────────────────────────────────────────────────

describe('verifySession()', () => {
  it('returns the correct payload for a freshly signed token', async () => {
    const token = await signSession(SAMPLE_PAYLOAD);
    const result = await verifySession(token);

    expect(result).not.toBeNull();
    expect(result!.userId).toBe(SAMPLE_PAYLOAD.userId);
    expect(result!.tenantId).toBe(SAMPLE_PAYLOAD.tenantId);
    expect(result!.plan).toBe(SAMPLE_PAYLOAD.plan);
    expect(result!.role).toBe(SAMPLE_PAYLOAD.role);
  });

  it('returns null for a tampered payload (modified base64)', async () => {
    const token = await signSession(SAMPLE_PAYLOAD);
    // Replace the first character of the payload to corrupt it
    const tampered = 'X' + token.slice(1);
    const result = await verifySession(tampered);
    expect(result).toBeNull();
  });

  it('returns null for a tampered signature', async () => {
    const token = await signSession(SAMPLE_PAYLOAD);
    const dotIndex = token.lastIndexOf('.');
    const tamperedSig = token.slice(dotIndex + 1).replace(/a/g, 'b').replace(/b/g, 'c');
    const tampered = token.slice(0, dotIndex + 1) + tamperedSig;
    const result = await verifySession(tampered);
    expect(result).toBeNull();
  });

  it('returns null for a completely random string', async () => {
    const result = await verifySession('notavalidtoken.atall');
    expect(result).toBeNull();
  });

  it('returns null for an empty string', async () => {
    const result = await verifySession('');
    expect(result).toBeNull();
  });

  it('returns null for a token without a dot separator', async () => {
    const result = await verifySession('nodotinthisstring');
    expect(result).toBeNull();
  });

  it('returns null for an expired token', async () => {
    // Sign a token normally (exp = now + 24h)
    const token = await signSession(SAMPLE_PAYLOAD);

    // Decode, set exp to the past, re-sign with same key
    // Instead of re-signing (we don't have direct access to the key),
    // we mock Date.now() to return a future date so the token appears expired
    const futureDate = Date.now() + 25 * 60 * 60 * 1000; // 25 hours from now
    const originalNow = Date.now;
    Date.now = () => futureDate;

    try {
      const result = await verifySession(token);
      expect(result).toBeNull();
    } finally {
      Date.now = originalNow;
    }
  });

  it('returns null when Date.now is mocked to be just past expiry', async () => {
    const token = await signSession(SAMPLE_PAYLOAD);

    // Token TTL is 24 hours = 86_400_000 ms
    // Set time to 24h + 1s after signing
    const pastExpiry = Date.now() + 86_400_000 + 1000;
    const originalNow = Date.now;
    Date.now = () => pastExpiry;

    try {
      const result = await verifySession(token);
      expect(result).toBeNull();
    } finally {
      Date.now = originalNow;
    }
  });

  it('returns null for a token signed with a different secret (simulated by manual corruption)', async () => {
    // We can't easily change the secret without module re-import, so we
    // test this by verifying that any byte change in the signature fails
    const token = await signSession(SAMPLE_PAYLOAD);
    const dotIndex = token.lastIndexOf('.');
    const payload = token.slice(0, dotIndex);
    // Construct a completely fabricated signature (wrong key)
    const fakeSignature = 'a'.repeat(64);
    const result = await verifySession(`${payload}.${fakeSignature}`);
    expect(result).toBeNull();
  });
});

// ── Round-trip ────────────────────────────────────────────────────────────────

describe('signSession → verifySession round-trip', () => {
  const testCases = [
    {
      name: 'SUPER_ADMIN + ENTERPRISE',
      payload: { userId: 'su-1', tenantId: 'ten-1', plan: 'ENTERPRISE', role: 'SUPER_ADMIN' },
    },
    {
      name: 'TENANT_ADMIN + TRIAL',
      payload: { userId: 'ta-2', tenantId: 'ten-2', plan: 'TRIAL', role: 'TENANT_ADMIN' },
    },
    {
      name: 'FLEET_MANAGER + PROFESSIONAL',
      payload: { userId: 'fm-3', tenantId: 'ten-3', plan: 'PROFESSIONAL', role: 'FLEET_MANAGER' },
    },
    {
      name: 'VIEWER + STANDARD',
      payload: { userId: 'v-4', tenantId: 'ten-4', plan: 'STANDARD', role: 'VIEWER' },
    },
  ];

  for (const tc of testCases) {
    it(`round-trip preserves all fields for ${tc.name}`, async () => {
      const token = await signSession(tc.payload);
      const result = await verifySession(token);

      expect(result).not.toBeNull();
      expect(result!.userId).toBe(tc.payload.userId);
      expect(result!.tenantId).toBe(tc.payload.tenantId);
      expect(result!.plan).toBe(tc.payload.plan);
      expect(result!.role).toBe(tc.payload.role);
    });
  }

  it('two separate tokens for the same payload both verify successfully', async () => {
    const t1 = await signSession(SAMPLE_PAYLOAD);
    const t2 = await signSession(SAMPLE_PAYLOAD);

    const r1 = await verifySession(t1);
    const r2 = await verifySession(t2);

    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    // Payloads are the same (different exp will be very close but tokens differ)
    expect(r1!.userId).toBe(r2!.userId);
    expect(r1!.tenantId).toBe(r2!.tenantId);
  });

  it('verifying a token from another tenant correctly decodes that tenant', async () => {
    const tokenA = await signSession({ userId: 'ua', tenantId: 'tenant-A', plan: 'ENTERPRISE', role: 'TENANT_ADMIN' });
    const tokenB = await signSession({ userId: 'ub', tenantId: 'tenant-B', plan: 'TRIAL', role: 'TENANT_ADMIN' });

    const resA = await verifySession(tokenA);
    const resB = await verifySession(tokenB);

    expect(resA!.tenantId).toBe('tenant-A');
    expect(resB!.tenantId).toBe('tenant-B');
    expect(resA!.plan).toBe('ENTERPRISE');
    expect(resB!.plan).toBe('TRIAL');
  });
});
