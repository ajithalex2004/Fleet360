/**
 * src/lib/digital-kyc-types.ts
 *
 * Client-safe types and deterministic cryptographic validation functions for
 * Digital KYC, UAE Pass profiles, OCR scan contracts, and electronic signatures.
 * Completely free of server-only and backend database dependencies.
 */

export type LegacyOcrDocType = 'EMIRATES_ID' | 'DRIVING_LICENSE' | 'PASSPORT';

export type KycDocumentType =
  | 'EMIRATES_ID'
  | 'DRIVING_LICENSE'
  | 'PASSPORT'
  | 'INTERNATIONAL_DRIVING_PERMIT';

export type KycOcrProvider =
  | 'gemini-2.5-flash'
  | 'gpt-4o-mini'
  | 'mrz-parser'
  | 'deterministic-fallback';

export interface UaePassProfile {
  uuid: string;
  fullNameEn: string;
  fullNameAr: string;
  emiratesId: string;
  mobile: string;
  email: string;
  nationality: string;
  userType: 'CITIZEN' | 'RESIDENT' | 'VISITOR';
  assuranceLevel: 'SOP3' | 'HIGH';
  verifiedAt: string;
}

export interface OcrScanResult {
  docType: LegacyOcrDocType;
  docNumber: string;
  fullName: string;
  expiryDate: string;
  issueDate: string;
  nationality: string;
  isExpired: boolean;
  confidenceScore: number;
  dateOfBirth?: string | null;
  emiratesId?: string | null;
  issuingCountry?: string | null;
  licenseClass?: string | null;
  daysUntilExpiry?: number | null;
  provider?: KycOcrProvider;
}

export interface ElectronicSignatureRecord {
  signerName: string;
  signerEmail: string;
  emiratesId: string;
  signatureDataUrl: string;
  contentHash: string;
  signedAt: string;
  termsAccepted: boolean;
}

export interface MultimodalKycScanInput {
  documentType: KycDocumentType;
  imageBase64OrUrl?: string;
  mimeType?: string;
  mrzText?: string;
  hintName?: string;
  tenantId?: string;
}

export interface MultimodalKycScanResult {
  documentType: KycDocumentType;
  docType: LegacyOcrDocType;
  fullName: string;
  documentNumber: string;
  docNumber: string;
  emiratesId: string | null;
  emiratesIdValid: boolean | null;
  nationality: string | null;
  dateOfBirth: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  issuingCountry: string | null;
  licenseClass: string | null;
  visaTypeHint: 'RESIDENT' | 'TOURIST';
  confidence: number;
  confidenceScore: number;
  isExpired: boolean;
  daysUntilExpiry: number | null;
  warnings: string[];
  provider: KycOcrProvider;
}

export const DEMO_UAE_PASS_USER: UaePassProfile = {
  uuid: 'uaepass-usr-8891-dxb',
  fullNameEn: 'Mohammed Al-Maktoum',
  fullNameAr: 'محمد المكتوم',
  emiratesId: '784-1988-1234567-1',
  mobile: '+971 50 123 4567',
  email: 'm.almaktoum@fleet360.ae',
  nationality: 'ARE',
  userType: 'CITIZEN',
  assuranceLevel: 'SOP3',
  verifiedAt: new Date().toISOString(),
};

export const STANDARD_RENTAL_TERMS = `I hereby certify that all provided personal and corporate identification documents are valid and authentic. I agree to the standard UAE FTA, RTA, and Fleet360 mobility rental terms, insurance coverage liability policies, Salik/Darb toll pass-through tariffs, and traffic fine obligations under the laws of the United Arab Emirates.`;

export function verifyEmiratesIdFormat(id: string): boolean {
  if (!id) return false;
  // Standard format: 784-YYYY-XXXXXXX-X (15 digits total, starting with 784)
  const regex = /^784-[0-9]{4}-[0-9]{7}-[0-9]{1}$/;
  return regex.test(id.trim());
}

export function formatCanonicalEmiratesId(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (verifyEmiratesIdFormat(trimmed)) return trimmed;
  const digits = trimmed.replace(/[\s-]/g, '');
  if (/^784\d{12}$/.test(digits)) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 14)}-${digits.slice(14, 15)}`;
  }
  return trimmed || null;
}

/**
 * Deterministic pure-JS SHA-256 implementation suitable for browser, Edge, and Node.js
 */
function sha256Sync(ascii: string): string {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let result = '';
  const words: number[] = [];
  const asciiBitLength = ascii.length * 8;
  const hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;
  const isComposite: Record<number, boolean> = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = candidate * 2; i <= 311; i += candidate) {
        isComposite[i] = true;
      }
      if (primeCounter < 8) {
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      }
      k[primeCounter] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      primeCounter++;
    }
  }
  ascii += '\x80';
  while ((ascii.length % 64) - 56) ascii += '\x00';
  for (let i = 0; i < ascii.length; i++) {
    const j = ascii.charCodeAt(i);
    words[i >> 2] |= j << ((3 - (i % 4)) * 8);
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength | 0;

  for (let j = 0; j < words.length; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash.slice(0);
    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15],
        w2 = w[i - 2];
      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      w[i] = i < 16 ? w[i] : (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      const s0_h = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22);
      const s1_h = rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25);
      const temp1 = (hash[7] + s1_h + ch + k[i] + w[i]) | 0;
      const temp2 = (s0_h + maj) | 0;
      hash[7] = hash[6];
      hash[6] = hash[5];
      hash[5] = hash[4];
      hash[4] = (hash[3] + temp1) | 0;
      hash[3] = hash[2];
      hash[2] = hash[1];
      hash[1] = hash[0];
      hash[0] = (temp1 + temp2) | 0;
    }
    for (let i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }
  for (let i = 0; i < 8; i++) {
    for (let j = 3; j >= 0; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

export function sealElectronicSignature(
  signerName: string,
  emiratesId: string,
  signedAt: string,
  termsText: string = STANDARD_RENTAL_TERMS,
): string {
  const payload = `${signerName}|${emiratesId}|${signedAt}|${termsText}`;
  return sha256Sync(payload);
}
