/**
 * MFA recovery codes: every issued code verifies once. The checker used to
 * require 5 + 5 hex characters while codes are issued as 10 + 5, so no
 * recovery code ever worked (sign-in, disabling MFA, first passkey).
 */
import { describe, it, expect } from 'vitest';
import { generateRecoveryCodes, RECOVERY_CODE_FORMAT, verifyRecoveryCode } from '@/lib/totp';

describe('recovery codes', () => {
  it('verifies every issued code, case-insensitively, and only against its own hash', () => {
    const { plaintext, hashed } = generateRecoveryCodes(10);
    plaintext.forEach((code, i) => {
      expect(code).toMatch(RECOVERY_CODE_FORMAT);
      expect(verifyRecoveryCode(code, hashed)).toBe(hashed[i]);
      expect(verifyRecoveryCode(` ${code.toUpperCase()} `, hashed)).toBe(hashed[i]);
    });
    expect(verifyRecoveryCode('0000000000-00000', hashed)).toBeNull();
    expect(verifyRecoveryCode('not-a-code', hashed)).toBeNull();
  });
});
