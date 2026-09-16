import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import {
  validateSecret,
  requireSessionSecret,
  requireSsoEncryptionSecret,
} from '@/lib/session-secret';
import { signSession, verifySession } from '@/lib/tenant-session';
import { signSsoState, verifySsoState } from '@/lib/sso-state';

const OLD_DEV_SECRET = 'xl-mobility-dev-secret-change-in-production';
const VALID_TEST_SECRET = 'a-super-secret-key-that-is-at-least-32-chars-long-with-entropy-1234!';

describe('session-secret module validation', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    delete process.env.SESSION_SECRET;
    delete process.env.AUTH_SECRET;
    delete process.env.JWT_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.SSO_ENCRYPTION_KEY;
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('throws if secret is undefined or empty', () => {
    expect(() => validateSecret('TEST_KEY', undefined)).toThrow(/No TEST_KEY configured/);
    expect(() => validateSecret('TEST_KEY', '')).toThrow(/No TEST_KEY configured/);
    expect(() => requireSessionSecret()).toThrow(/No SESSION_SECRET configured/);
  });

  it('throws if secret is whitespace only', () => {
    expect(() => validateSecret('TEST_KEY', '   \t\n   ')).toThrow(/cannot be empty or whitespace/);
    process.env.SESSION_SECRET = '                                '; // 32 spaces
    expect(() => requireSessionSecret()).toThrow(/cannot be empty or whitespace/);
  });

  it('throws if secret is less than 32 characters after trimming', () => {
    expect(() => validateSecret('TEST_KEY', 'too-short')).toThrow(/must be at least 32 characters/);
    process.env.SESSION_SECRET = '  only-25-chars-padded   ';
    expect(() => requireSessionSecret()).toThrow(/must be at least 32 characters/);
  });

  it('throws if secret contains banned placeholder substrings', () => {
    const banned = [
      'change-in-production',
      'change-me',
      'placeholder',
      'default-secret',
      'dummy-secret',
      'xl-mobility-dev-secret',
      'fleet360-dev-secret',
    ];
    for (const b of banned) {
      const candidate = `valid-prefix-${b}-extra-entropy-1234567890`;
      expect(() => validateSecret('TEST_KEY', candidate)).toThrow(/forbidden insecure placeholder pattern/);
    }
  });

  it('throws if secret has insufficient entropy (< 6 distinct characters)', () => {
    const lowEntropy = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // 32 'a's
    expect(() => validateSecret('TEST_KEY', lowEntropy)).toThrow(/insufficient entropy/);
  });

  it('accepts high-entropy 32+ character secrets', () => {
    const valid = validateSecret('TEST_KEY', VALID_TEST_SECRET);
    expect(valid).toBe(VALID_TEST_SECRET);
  });

  it('validates dedicated SSO_ENCRYPTION_KEY with identical strictness', () => {
    process.env.SSO_ENCRYPTION_KEY = 'short';
    expect(() => requireSsoEncryptionSecret()).toThrow(/must be at least 32 characters/);

    process.env.SSO_ENCRYPTION_KEY = '                                ';
    expect(() => requireSsoEncryptionSecret()).toThrow(/cannot be empty or whitespace/);

    const dedicatedValid = 'dedicated-sso-key-with-sufficient-length-and-entropy-999!';
    process.env.SSO_ENCRYPTION_KEY = dedicatedValid;
    expect(requireSsoEncryptionSecret()).toBe(dedicatedValid);
  });

  it('falls back to SESSION_SECRET if SSO_ENCRYPTION_KEY is unset', () => {
    process.env.SESSION_SECRET = VALID_TEST_SECRET;
    expect(requireSsoEncryptionSecret()).toBe(VALID_TEST_SECRET);
  });
});

describe('Permanent Regression: Rejection of Old Hardcoded Dev Secret', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env.SESSION_SECRET = VALID_TEST_SECRET;
    delete process.env.SSO_ENCRYPTION_KEY;
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('rejects a session token forged using the old development secret', async () => {
    // 1. Forge a session token signed with the old hardcoded dev secret
    const payload = {
      userId: 'attacker-123',
      tenantId: 'victim-tenant-456',
      plan: 'ENTERPRISE',
      role: 'SUPER_ADMIN',
      exp: Date.now() + 60 * 60 * 1000,
    };
    const b64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const forgedSig = crypto.createHmac('sha256', OLD_DEV_SECRET).update(b64Payload).digest('hex');
    const forgedCookie = `${b64Payload}.${forgedSig}`;

    // 2. Verify with verifySession (which uses configured VALID_TEST_SECRET)
    const verified = await verifySession(forgedCookie);
    expect(verified).toBeNull();
  });

  it('verifies a session token signed with the legitimate configured secret', async () => {
    const token = await signSession({
      userId: 'legit-user-123',
      tenantId: 'tenant-456',
      plan: 'ENTERPRISE',
      role: 'TENANT_ADMIN',
    });

    const verified = await verifySession(token);
    expect(verified).not.toBeNull();
    expect(verified?.userId).toBe('legit-user-123');
    expect(verified?.tenantId).toBe('tenant-456');
  });

  it('rejects an SSO state cookie signed with the old development secret', async () => {
    const ssoPayload = {
      tenantId: 'victim-tenant-456',
      email: 'attacker@example.com',
      codeVerifier: 'verifier123',
      state: 'state123',
      nonce: 'nonce123',
      returnTo: '/dashboard',
      exp: Date.now() + 10 * 60 * 1000,
    };
    const b64 = Buffer.from(JSON.stringify(ssoPayload)).toString('base64url');
    const forgedSig = crypto.createHmac('sha256', OLD_DEV_SECRET).update(b64).digest('hex');
    const forgedToken = `${b64}.${forgedSig}`;

    const verified = await verifySsoState(forgedToken);
    expect(verified).toBeNull();
  });

  it('verifies an SSO state cookie signed with the legitimate configured secret', async () => {
    const token = await signSsoState({
      tenantId: 'legit-tenant-123',
      email: 'user@example.com',
      codeVerifier: 'verifier-abc',
      state: 'state-abc',
      nonce: 'nonce-abc',
      returnTo: '/dashboard',
    });

    const verified = await verifySsoState(token);
    expect(verified).not.toBeNull();
    expect(verified?.email).toBe('user@example.com');
  });
});
