import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import {
  validateSecret,
  requireSessionSecret,
  requireSsoEncryptionSecret,
} from '@/lib/session-secret';
import { signSession, verifySession } from '@/lib/tenant-session';
import { signSsoState, verifySsoState } from '@/lib/sso-state';
import { encryptSecret, decryptSecret, reencryptSecret } from '@/lib/sso';

const OLD_DEV_SECRET = 'xl-mobility-dev-secret-change-in-production';
const VALID_SESSION_SECRET = 'a-super-secret-session-key-that-is-at-least-32-chars-long-with-entropy-1234!';
const VALID_SSO_KEY = 'a-dedicated-sso-encryption-key-that-is-at-least-32-chars-long-9876!';
const ROTATED_SSO_KEY = 'a-new-rotated-sso-encryption-key-that-is-also-32-chars-long-54321!';

describe('1. Secret Configuration & Validation (session-secret.ts)', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    delete process.env.SESSION_SECRET;
    delete process.env.AUTH_SECRET;
    delete process.env.JWT_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.SSO_ENCRYPTION_KEY;
    delete process.env.SSO_PREVIOUS_ENCRYPTION_KEY;
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('rejects undefined or empty secrets with a clear configuration error', () => {
    expect(() => validateSecret('SESSION_SECRET', undefined)).toThrow(/No SESSION_SECRET configured/);
    expect(() => validateSecret('SESSION_SECRET', '')).toThrow(/No SESSION_SECRET configured/);
  });

  it('rejects whitespace-only secrets', () => {
    expect(() => validateSecret('SESSION_SECRET', '   \t\n   ')).toThrow(/cannot be empty or whitespace/);
  });

  it('rejects leading or trailing whitespace rather than silently trimming it', () => {
    const padded = `  ${VALID_SESSION_SECRET}  `;
    expect(() => validateSecret('SESSION_SECRET', padded)).toThrow(/contains leading or trailing whitespace/);
  });

  it('rejects secrets shorter than 32 characters', () => {
    expect(() => validateSecret('SESSION_SECRET', 'too-short-key')).toThrow(/must be at least 32 characters/);
  });

  it('rejects known development placeholders and never echoes the secret in error messages', () => {
    const candidate = 'my-secret-with-change-in-production-placeholder-12345';
    let caughtError: Error | null = null;
    try {
      validateSecret('SESSION_SECRET', candidate);
    } catch (err: any) {
      caughtError = err;
    }
    expect(caughtError).not.toBeNull();
    expect(caughtError?.message).toMatch(/forbidden insecure placeholder pattern/);
    expect(caughtError?.message).not.toContain(candidate);
  });

  it('rejects low-entropy repetitive strings', () => {
    const lowEntropy = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // 32 'a's
    expect(() => validateSecret('SESSION_SECRET', lowEntropy)).toThrow(/insufficient entropy/);
  });

  it('accepts valid, high-entropy 32+ character secrets without modification', () => {
    const result = validateSecret('SESSION_SECRET', VALID_SESSION_SECRET);
    expect(result).toBe(VALID_SESSION_SECRET);
  });
});

describe('2. Dedicated SSO Encryption Key & Key Separation', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env.SESSION_SECRET = VALID_SESSION_SECRET;
    delete process.env.SSO_ENCRYPTION_KEY;
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('validates dedicated SSO_ENCRYPTION_KEY with identical strictness', () => {
    process.env.SSO_ENCRYPTION_KEY = 'short';
    expect(() => requireSsoEncryptionSecret()).toThrow(/must be at least 32 characters/);

    process.env.SSO_ENCRYPTION_KEY = `  ${VALID_SSO_KEY}  `;
    expect(() => requireSsoEncryptionSecret()).toThrow(/contains leading or trailing whitespace/);
  });

  it('strictly requires dedicated SSO_ENCRYPTION_KEY in production (no fallback allowed)', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SSO_ENCRYPTION_KEY;
    expect(() => requireSsoEncryptionSecret()).toThrow(/SSO_ENCRYPTION_KEY is mandatory in production/);
  });

  it('allows controlled fallback to SESSION_SECRET with warning in non-production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.SSO_ENCRYPTION_KEY;
    expect(requireSsoEncryptionSecret()).toBe(VALID_SESSION_SECRET);
  });
});

describe('3. Session Token Verification & Tampering Rejection', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env.SESSION_SECRET = VALID_SESSION_SECRET;
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('verifies a valid, unexpired session token signed with the configured secret', async () => {
    const token = await signSession({
      userId: 'user-valid',
      tenantId: 'tenant-valid',
      plan: 'ENTERPRISE',
      role: 'TENANT_ADMIN',
    });
    const verified = await verifySession(token);
    expect(verified).not.toBeNull();
    expect(verified?.userId).toBe('user-valid');
  });

  it('rejects an otherwise-valid, unexpired session token signed with the old development secret', async () => {
    // Unexpired (+24h), well-formed payload, valid role/tenant
    const payload = {
      userId: 'attacker-123',
      tenantId: 'tenant-target',
      plan: 'ENTERPRISE',
      role: 'SUPER_ADMIN',
      exp: Date.now() + 24 * 60 * 60 * 1000,
    };
    const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const forgedSig = crypto.createHmac('sha256', OLD_DEV_SECRET).update(b64).digest('hex');
    const forgedToken = `${b64}.${forgedSig}`;

    const verified = await verifySession(forgedToken);
    expect(verified).toBeNull();
  });

  it('rejects a session token with tampered payload claims', async () => {
    const token = await signSession({
      userId: 'user-orig',
      tenantId: 'tenant-orig',
      plan: 'PRO',
      role: 'USER',
    });
    const parts = token.split('.');
    const decoded = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    decoded.role = 'SUPER_ADMIN'; // Privilege escalation attempt
    const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString('base64url');
    const tamperedToken = `${tamperedPayload}.${parts[1]}`;

    const verified = await verifySession(tamperedToken);
    expect(verified).toBeNull();
  });

  it('rejects a session token with tampered signature', async () => {
    const token = await signSession({
      userId: 'user-orig',
      tenantId: 'tenant-orig',
      plan: 'PRO',
      role: 'USER',
    });
    const parts = token.split('.');
    const tamperedSig = parts[1].slice(0, -2) + (parts[1].endsWith('0') ? '1' : '0');
    const tamperedToken = `${parts[0]}.${tamperedSig}`;

    const verified = await verifySession(tamperedToken);
    expect(verified).toBeNull();
  });

  it('rejects an expired session token', async () => {
    const payload = {
      userId: 'user-expired',
      tenantId: 'tenant-expired',
      plan: 'PRO',
      role: 'USER',
      exp: Date.now() - 1000, // expired 1 second ago
    };
    const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', VALID_SESSION_SECRET).update(b64).digest('hex');
    const expiredToken = `${b64}.${sig}`;

    const verified = await verifySession(expiredToken);
    expect(verified).toBeNull();
  });
});

describe('4. SSO State Cookie Verification & Tampering Rejection', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env.SESSION_SECRET = VALID_SESSION_SECRET;
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('verifies a valid, unexpired SSO state cookie', async () => {
    const token = await signSsoState({
      tenantId: 'tenant-oidc',
      email: 'pilot@example.com',
      codeVerifier: 'verifier-123',
      state: 'state-123',
      nonce: 'nonce-123',
      returnTo: '/logistics/dispatch',
    });
    const verified = await verifySsoState(token);
    expect(verified).not.toBeNull();
    expect(verified?.email).toBe('pilot@example.com');
  });

  it('rejects an otherwise-valid, unexpired SSO state cookie signed with the old development secret', async () => {
    const payload = {
      tenantId: 'tenant-oidc',
      email: 'pilot@example.com',
      codeVerifier: 'verifier-123',
      state: 'state-123',
      nonce: 'nonce-123',
      returnTo: '/logistics/dispatch',
      exp: Date.now() + 10 * 60 * 1000,
    };
    const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const forgedSig = crypto.createHmac('sha256', OLD_DEV_SECRET).update(b64).digest('hex');
    const forgedToken = `${b64}.${forgedSig}`;

    const verified = await verifySsoState(forgedToken);
    expect(verified).toBeNull();
  });

  it('rejects a tampered SSO state cookie', async () => {
    const token = await signSsoState({
      tenantId: 'tenant-oidc',
      email: 'user@example.com',
      codeVerifier: 'v',
      state: 's',
      nonce: 'n',
      returnTo: '/',
    });
    const parts = token.split('.');
    const tampered = `${parts[0]}tampered.${parts[1]}`;
    const verified = await verifySsoState(tampered);
    expect(verified).toBeNull();
  });

  it('rejects an expired SSO state cookie', async () => {
    const payload = {
      tenantId: 'tenant-oidc',
      email: 'user@example.com',
      codeVerifier: 'v',
      state: 's',
      nonce: 'n',
      returnTo: '/',
      exp: Date.now() - 5000,
    };
    const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', VALID_SESSION_SECRET).update(b64).digest('hex');
    const expired = `${b64}.${sig}`;
    const verified = await verifySsoState(expired);
    expect(verified).toBeNull();
  });
});

describe('5. SSO Encryption Lifecycle, Versioning & Rotation Migration', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env.SESSION_SECRET = VALID_SESSION_SECRET;
    process.env.SSO_ENCRYPTION_KEY = VALID_SSO_KEY;
    delete process.env.SSO_PREVIOUS_ENCRYPTION_KEY;
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('encrypts plaintext into versioned v1: format and decrypts cleanly', () => {
    const secret = 'client-secret-azure-ad-xyz-987';
    const encrypted = encryptSecret(secret);
    expect(encrypted.startsWith('v1:')).toBe(true);

    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(secret);
  });

  it('fails to decrypt if wrong encryption key is used', () => {
    const secret = 'client-secret-azure-ad-xyz-987';
    const encrypted = encryptSecret(secret);

    // Attempt decryption with a different key
    expect(() => decryptSecret(encrypted, { activeKey: ROTATED_SSO_KEY })).toThrow(
      /Failed to decrypt SSO client secret/
    );
  });

  it('fails to decrypt tampered ciphertext (integrity failure)', () => {
    const secret = 'client-secret-azure-ad-xyz-987';
    const encrypted = encryptSecret(secret);
    // Tamper with the base64 ciphertext
    const tampered = encrypted.slice(0, -4) + 'AAAA';
    expect(() => decryptSecret(tampered)).toThrow(/Failed to decrypt SSO client secret/);
  });

  it('decrypts legacy v0 (unversioned) ciphertext for backward compatibility', () => {
    const secret = 'legacy-stored-azure-secret-555';
    // Manually create legacy v0 format (raw base64 without 'v1:' prefix)
    const key = crypto.createHash('sha256').update(VALID_SSO_KEY).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const legacyV0Ciphertext = Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');

    expect(legacyV0Ciphertext.startsWith('v1:')).toBe(false);
    const decrypted = decryptSecret(legacyV0Ciphertext);
    expect(decrypted).toBe(secret);
  });

  it('maintains key separation: rotating SESSION_SECRET does NOT affect SSO decryption', () => {
    const secret = 'tenant-client-secret-to-preserve';
    const encrypted = encryptSecret(secret);

    // Rotate SESSION_SECRET completely
    process.env.SESSION_SECRET = 'completely-different-rotated-session-secret-at-least-32-chars!';

    // SSO credential remains 100% readable because SSO_ENCRYPTION_KEY is separate
    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(secret);
  });

  it('supports controlled key rotation: decrypts with previous key and re-encrypts to active key', () => {
    const secret = 'enterprise-entra-id-secret';
    // Encrypt under Key 1
    const oldCiphertext = encryptSecret(secret, VALID_SSO_KEY);

    // Rotate to Key 2 (New Active Key), with Key 1 configured as previous key
    process.env.SSO_ENCRYPTION_KEY = ROTATED_SSO_KEY;
    process.env.SSO_PREVIOUS_ENCRYPTION_KEY = VALID_SSO_KEY;

    // 1. Can still decrypt using fallback to previous key during transition
    const decryptedWithFallback = decryptSecret(oldCiphertext);
    expect(decryptedWithFallback).toBe(secret);

    // 2. Re-encrypt the record to active key
    const migratedCiphertext = reencryptSecret(oldCiphertext, ROTATED_SSO_KEY, VALID_SSO_KEY);
    expect(migratedCiphertext.startsWith('v1:')).toBe(true);

    // 3. Retire Key 1 completely
    delete process.env.SSO_PREVIOUS_ENCRYPTION_KEY;

    // Migrated ciphertext is decryptable with active Key 2
    expect(decryptSecret(migratedCiphertext)).toBe(secret);

    // Un-migrated old ciphertext now fails (retired key rejected)
    expect(() => decryptSecret(oldCiphertext)).toThrow(/Failed to decrypt SSO client secret/);
  });
});
