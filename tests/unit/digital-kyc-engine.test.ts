import { describe, it, expect } from 'vitest';
import {
  verifyEmiratesIdFormat,
  sealElectronicSignature,
  parseDocumentOcr,
  DEMO_UAE_PASS_USER,
} from '@/lib/digital-kyc-engine';

describe('Digital KYC, UAE Pass & Electronic Signatures Engine', () => {
  it('validates UAE national Emirates ID format strictly (784-YYYY-XXXXXXX-X)', () => {
    expect(verifyEmiratesIdFormat('784-1988-1234567-1')).toBe(true);
    expect(verifyEmiratesIdFormat('784-1995-9876543-2')).toBe(true);

    // Invalid formats
    expect(verifyEmiratesIdFormat('123-1988-1234567-1')).toBe(false); // wrong country code
    expect(verifyEmiratesIdFormat('784198812345671')).toBe(false); // missing dashes
    expect(verifyEmiratesIdFormat('784-198-1234567-1')).toBe(false); // wrong year length
    expect(verifyEmiratesIdFormat('')).toBe(false);
  });

  it('generates cryptographic SHA-256 tamper-proof electronic signature seals', () => {
    const signer = 'Mohammed Al-Maktoum';
    const eid = '784-1988-1234567-1';
    const timestamp = '2026-09-03T11:00:00.000Z';

    const hash1 = sealElectronicSignature(signer, eid, timestamp);
    const hash2 = sealElectronicSignature(signer, eid, timestamp);
    const hashDifferentSigner = sealElectronicSignature('Different Person', eid, timestamp);

    expect(hash1).toHaveLength(64);
    expect(hash1).toBe(hash2); // deterministic
    expect(hash1).not.toBe(hashDifferentSigner);
  });

  it('performs document OCR extraction for Emirates ID, Driving License, and Passport', () => {
    const eidOcr = parseDocumentOcr('EMIRATES_ID', 'Ahmed Mansoor');
    expect(eidOcr.docType).toBe('EMIRATES_ID');
    expect(eidOcr.fullName).toBe('Ahmed Mansoor');
    expect(eidOcr.docNumber).toContain('784-');
    expect(eidOcr.isExpired).toBe(false);

    const dlOcr = parseDocumentOcr('DRIVING_LICENSE', 'Ahmed Mansoor');
    expect(dlOcr.docType).toBe('DRIVING_LICENSE');
    expect(dlOcr.docNumber).toContain('DXB-DL-');

    const passportOcr = parseDocumentOcr('PASSPORT', 'Ahmed Mansoor');
    expect(passportOcr.docType).toBe('PASSPORT');
    expect(passportOcr.confidenceScore).toBeGreaterThanOrEqual(0.95);
  });

  it('maintains valid UAE Pass profile with SOP3 high assurance level', () => {
    expect(DEMO_UAE_PASS_USER.assuranceLevel).toBe('SOP3');
    expect(DEMO_UAE_PASS_USER.emiratesId).toMatch(/^784-/);
    expect(DEMO_UAE_PASS_USER.mobile).toContain('+971');
  });
});
