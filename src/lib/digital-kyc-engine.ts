import crypto from 'crypto';

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
  docType: 'EMIRATES_ID' | 'DRIVING_LICENSE' | 'PASSPORT';
  docNumber: string;
  fullName: string;
  expiryDate: string;
  issueDate: string;
  nationality: string;
  isExpired: boolean;
  confidenceScore: number;
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

export function sealElectronicSignature(
  signerName: string,
  emiratesId: string,
  signedAt: string,
  termsText: string = STANDARD_RENTAL_TERMS
): string {
  const payload = `${signerName}|${emiratesId}|${signedAt}|${termsText}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function parseDocumentOcr(
  docType: 'EMIRATES_ID' | 'DRIVING_LICENSE' | 'PASSPORT',
  inputName?: string
): OcrScanResult {
  const currentYear = new Date().getFullYear();
  const futureYear = currentYear + 4;

  if (docType === 'EMIRATES_ID') {
    return {
      docType: 'EMIRATES_ID',
      docNumber: '784-1988-1234567-1',
      fullName: inputName || 'Mohammed Al-Maktoum',
      expiryDate: `${futureYear}-12-31`,
      issueDate: `${currentYear - 1}-01-15`,
      nationality: 'United Arab Emirates',
      isExpired: false,
      confidenceScore: 0.99,
    };
  }

  if (docType === 'DRIVING_LICENSE') {
    return {
      docType: 'DRIVING_LICENSE',
      docNumber: 'DXB-DL-8839201',
      fullName: inputName || 'Mohammed Al-Maktoum',
      expiryDate: `${futureYear}-08-20`,
      issueDate: `${currentYear - 2}-08-20`,
      nationality: 'United Arab Emirates',
      isExpired: false,
      confidenceScore: 0.98,
    };
  }

  // Passport
  return {
    docType: 'PASSPORT',
    docNumber: 'N10293847',
    fullName: inputName || 'Mohammed Al-Maktoum',
    expiryDate: `${futureYear}-05-10`,
    issueDate: `${currentYear - 5}-05-10`,
    nationality: 'United Arab Emirates',
    isExpired: false,
    confidenceScore: 0.97,
  };
}
