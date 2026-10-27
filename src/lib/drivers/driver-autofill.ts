/**
 * src/lib/drivers/driver-autofill.ts
 *
 * UAE & GCC Driving License, Emirates ID, Passport, and Transport Permits OCR autofill.
 *
 * Hybrid pipeline:
 * 1. Native text stream parser for digital PDFs (RTA Dubai, Abu Dhabi Police, Oman ROP).
 * 2. Fallback to AI Vision Gateway for photographs and scans.
 */

import { aiGateway } from '@/lib/agents/gateway';
import { documentDataUrl } from '@/lib/agents/document-intelligence/pipeline/router';
import { extractPdfText, normalizeDate } from '@/lib/fleet/vehicle-autofill';

export interface DrivingLicenseAutofillResult {
  status: 'ok' | 'unavailable' | 'error';
  licenseNumber: string | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  nationality: string | null;
  dob: string | null;
  licenseExpiry: string | null;
  issueDate: string | null;
  driverCategory: string | null; // LIGHT_DUTY | HEAVY_DUTY | HEAVY_BUS | LIGHT_BUS | MOTORCYCLE | FORKLIFT
  licenseType: string | null;
  issuingAuthority: string | null;
  confidence: number;
  message?: string;
  warnings: string[];
}

export interface DriverDocumentAutofillResult {
  status: 'ok' | 'unavailable' | 'error';
  documentType: 'EMIRATES_ID' | 'PASSPORT' | 'VISA' | 'PERMIT' | string;
  documentNumber: string | null;
  fullName?: string | null;
  nationality?: string | null;
  dob?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  confidence: number;
  message?: string;
  warnings: string[];
}

/** Map natural language license categories to standard Driver Category enum values */
export function normalizeDriverCategory(raw: string | null | undefined): { category: string; licenseType: string } {
  if (!raw) return { category: 'LIGHT_DUTY', licenseType: 'LIGHT_VEHICLE' };
  const s = raw.toUpperCase();

  if (s.includes('HEAVY TRUCK') || s.includes('HEAVY VEHICLE') || s.includes('HEAVY_DUTY') || s.includes('HEAVY DUTY') || s.includes('TRAILER') || s.includes('TRUCK')) {
    return { category: 'HEAVY_DUTY', licenseType: 'HEAVY_VEHICLE' };
  }
  if (s.includes('HEAVY BUS') || s.includes('COACH') || s.includes('50 SEATER') || s.includes('HEAVY_BUS')) {
    return { category: 'HEAVY_BUS', licenseType: 'BUS' };
  }
  if (s.includes('LIGHT BUS') || s.includes('MINIBUS') || s.includes('COASTER') || s.includes('14 SEATER')) {
    return { category: 'LIGHT_BUS', licenseType: 'BUS' };
  }
  if (s.includes('MOTORCYCLE') || s.includes('BIKE') || s.includes('COURIER')) {
    return { category: 'MOTORCYCLE', licenseType: 'MOTORCYCLE' };
  }
  if (s.includes('FORKLIFT') || s.includes('EQUIPMENT') || s.includes('MACHINERY')) {
    return { category: 'FORKLIFT', licenseType: 'FORKLIFT' };
  }

  return { category: 'LIGHT_DUTY', licenseType: 'LIGHT_VEHICLE' };
}

/** Regex parser for local PDF text extraction from Driving Licenses */
export function parseLicenseText(text: string): DrivingLicenseAutofillResult {
  const result: DrivingLicenseAutofillResult = {
    status: 'ok',
    licenseNumber: null,
    fullName: null,
    firstName: null,
    lastName: null,
    nationality: null,
    dob: null,
    licenseExpiry: null,
    issueDate: null,
    driverCategory: 'LIGHT_DUTY',
    licenseType: 'LIGHT_VEHICLE',
    issuingAuthority: 'UAE Licensing Authority',
    confidence: 0.94,
    warnings: [],
  };

  // 1. License Number
  const licMatch = text.match(/(?:Licen[sc]e\s*(?:No|Number)|رقم\s*الرخصة)[^\w\d]*([A-Z0-9\-\/]{5,20})/i) ||
                   text.match(/\b([0-9]{7,9})\b/);
  if (licMatch) result.licenseNumber = licMatch[1].replace(/[\s\-_]/g, '').trim();

  // 2. Name
  const nameMatch = text.match(/(?:Name|Driver\s*Name|الاسم)[^\w\n]*([A-Z][A-Z\s]{3,40})/i);
  if (nameMatch) {
    const rawName = nameMatch[1].trim();
    if (!rawName.includes('UNITED') && !rawName.includes('EMIRATES') && !rawName.includes('MINISTRY')) {
      result.fullName = rawName;
      const parts = rawName.split(/\s+/);
      result.firstName = parts[0] || null;
      result.lastName = parts.slice(1).join(' ') || null;
    }
  }

  // 3. Nationality
  const natMatch = text.match(/(?:Nationality|الجنسية)[^\w\n]*([A-Z\s]{3,30})/i);
  if (natMatch) {
    result.nationality = natMatch[1].trim();
  }

  // 4. Dates
  const expMatch = text.match(/(?:Expiry\s*Date|Valid\s*(?:to|until)|تاريخ\s*الانتهاء)[\s\S]*?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4})/i);
  if (expMatch) result.licenseExpiry = normalizeDate(expMatch[1]);

  const issMatch = text.match(/(?:Issue\s*Date|Valid\s*from|تاريخ\s*الإصدار)[\s\S]*?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4})/i);
  if (issMatch) result.issueDate = normalizeDate(issMatch[1]);

  const dobMatch = text.match(/(?:Date\s*of\s*Birth|DOB|تاريخ\s*الميلاد)[\s\S]*?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4})/i);
  if (dobMatch) result.dob = normalizeDate(dobMatch[1]);

  // 5. Category
  if (/heavy\s*(?:truck|vehicle)|شاحنة/i.test(text)) {
    result.driverCategory = 'HEAVY_DUTY';
    result.licenseType = 'HEAVY_VEHICLE';
  } else if (/heavy\s*bus|حافلة\s*ثقيلة/i.test(text)) {
    result.driverCategory = 'HEAVY_BUS';
    result.licenseType = 'BUS';
  } else if (/light\s*bus|حافلة\s*خفيفة/i.test(text)) {
    result.driverCategory = 'LIGHT_BUS';
    result.licenseType = 'BUS';
  } else if (/motorcycle|دراجة/i.test(text)) {
    result.driverCategory = 'MOTORCYCLE';
    result.licenseType = 'MOTORCYCLE';
  }

  return result;
}

export async function autofillDrivingLicense(file: {
  base64: string;
  mimeType: string;
  fileName: string;
}): Promise<DrivingLicenseAutofillResult> {
  const isPdf = file.mimeType.includes('pdf') ||
                file.fileName.toLowerCase().endsWith('.pdf') ||
                file.base64.startsWith('JVBERi0');

  // Step 1: Deterministic local PDF extraction if available
  if (isPdf) {
    try {
      const pdfBuf = Buffer.from(file.base64, 'base64');
      const text = extractPdfText(pdfBuf);
      if (text && text.trim().length > 30) {
        const parsed = parseLicenseText(text);
        if (parsed.licenseNumber || (parsed.fullName && parsed.licenseExpiry)) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('[autofillDrivingLicense] Local PDF parse fallback:', e);
    }
  }

  // Step 2: Fallback to AI Vision Gateway
  const apiKey = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || '';
  const isKeyConfigured = apiKey.length > 10 && !apiKey.startsWith('dev-');

  if (!isKeyConfigured) {
    return {
      status: 'unavailable',
      licenseNumber: null,
      fullName: null,
      firstName: null,
      lastName: null,
      nationality: null,
      dob: null,
      licenseExpiry: null,
      issueDate: null,
      driverCategory: 'LIGHT_DUTY',
      licenseType: 'LIGHT_VEHICLE',
      issuingAuthority: null,
      confidence: 0,
      message: 'AI Document Vision is not configured in this environment. Please enter details manually.',
      warnings: ['No active AI Vision key'],
    };
  }

  const prompt = [
    'You are a high-precision Driving License and Identity Document OCR engine for UAE, Oman, and GCC authorities.',
    'Carefully inspect the attached Driving License document / card (رخصة قيادة).',
    'Extract all driver identity and license details in English.',
    '',
    'Field Guidelines:',
    '1. "licenseNumber": Exact alphanumeric license number.',
    '2. "fullName": Driver full name in English (e.g. "Jennish John" or "Ahmed Mohammed Al-Mansouri").',
    '3. "firstName": First name.',
    '4. "lastName": Last / family name.',
    '5. "nationality": Driver nationality (e.g. "United Arab Emirates", "India", "Oman", "Pakistan", "Egypt", "Philippines").',
    '6. "dob": Date of birth in YYYY-MM-DD format.',
    '7. "licenseExpiry": Expiry date of the license in YYYY-MM-DD format.',
    '8. "issueDate": Issue date in YYYY-MM-DD format (if visible, else null).',
    '9. "driverCategory": Must strictly be one of: "LIGHT_DUTY", "HEAVY_DUTY", "HEAVY_BUS", "LIGHT_BUS", "MOTORCYCLE", "FORKLIFT".',
    '   - Light Vehicle / Car -> "LIGHT_DUTY"',
    '   - Heavy Truck / Heavy Vehicle -> "HEAVY_DUTY"',
    '   - Heavy Bus / Coach -> "HEAVY_BUS"',
    '   - Light Bus / Coaster / Van -> "LIGHT_BUS"',
    '   - Motorcycle -> "MOTORCYCLE"',
    '10. "issuingAuthority": Authority name (e.g. "RTA Dubai", "Abu Dhabi Police", "Royal Oman Police", "Ministry of Interior").',
    '',
    'Return ONLY valid JSON matching this schema, no markdown codeblocks:',
    '{',
    '  "licenseNumber": string | null,',
    '  "fullName": string | null,',
    '  "firstName": string | null,',
    '  "lastName": string | null,',
    '  "nationality": string | null,',
    '  "dob": "YYYY-MM-DD" | null,',
    '  "licenseExpiry": "YYYY-MM-DD" | null,',
    '  "issueDate": "YYYY-MM-DD" | null,',
    '  "driverCategory": "LIGHT_DUTY" | "HEAVY_DUTY" | "HEAVY_BUS" | "LIGHT_BUS" | "MOTORCYCLE" | "FORKLIFT",',
    '  "issuingAuthority": string | null,',
    '  "confidence": number between 0 and 1,',
    '  "warnings": string[]',
    '}',
  ].join('\n');

  try {
    const dataUrl = documentDataUrl(file.base64, file.mimeType);
    const res = await aiGateway.vision([dataUrl], prompt, {
      systemPrompt: 'You extract official Driving License data into strict JSON.',
      capabilityAlias: 'VISION_HIGH_ACCURACY',
      detail: 'high',
      maxTokens: 500,
      temperature: 0,
      timeoutMs: 35_000,
    });

    const clean = res.content.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
    const parsed = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1));
    const cat = normalizeDriverCategory(parsed.driverCategory);

    return {
      status: 'ok',
      licenseNumber: parsed.licenseNumber ? String(parsed.licenseNumber).trim() : null,
      fullName: parsed.fullName ? String(parsed.fullName).trim() : null,
      firstName: parsed.firstName ? String(parsed.firstName).trim() : null,
      lastName: parsed.lastName ? String(parsed.lastName).trim() : null,
      nationality: parsed.nationality ? String(parsed.nationality).trim() : null,
      dob: normalizeDate(parsed.dob),
      licenseExpiry: normalizeDate(parsed.licenseExpiry),
      issueDate: normalizeDate(parsed.issueDate),
      driverCategory: cat.category,
      licenseType: cat.licenseType,
      issuingAuthority: parsed.issuingAuthority ?? 'RTA / Licensing Authority',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.95,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    };
  } catch (err) {
    console.error('[autofillDrivingLicense] AI Vision failed:', err);
    return {
      status: 'error',
      licenseNumber: null,
      fullName: null,
      firstName: null,
      lastName: null,
      nationality: null,
      dob: null,
      licenseExpiry: null,
      issueDate: null,
      driverCategory: 'LIGHT_DUTY',
      licenseType: 'LIGHT_VEHICLE',
      issuingAuthority: null,
      confidence: 0,
      message: err instanceof Error ? err.message : 'Failed to scan Driving License',
      warnings: ['OCR processing error'],
    };
  }
}

export async function autofillDriverDocument(
  file: { base64: string; mimeType: string; fileName: string },
  docTypeHint?: string,
): Promise<DriverDocumentAutofillResult> {
  const isPdf = file.mimeType.includes('pdf') || file.fileName.toLowerCase().endsWith('.pdf') || file.base64.startsWith('JVBERi0');

  // Fast PDF check for Emirates ID, Passport, or Permits
  if (isPdf) {
    try {
      const pdfBuf = Buffer.from(file.base64, 'base64');
      const text = extractPdfText(pdfBuf);
      if (text && text.trim().length > 30) {
        // Emirates ID pattern: 784-YYYY-XXXXXXX-X
        const eidMatch = text.match(/\b(784[\-\s]?\d{4}[\-\s]?\d{7}[\-\s]?\d)\b/);
        if (eidMatch) {
          const exp = text.match(/(?:Expiry|Valid\s*until)[\s\S]*?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
          return {
            status: 'ok',
            documentType: 'EMIRATES_ID',
            documentNumber: eidMatch[1].replace(/[\s]/g, '-'),
            expiryDate: exp ? normalizeDate(exp[1]) : null,
            confidence: 0.96,
            warnings: [],
          };
        }
      }
    } catch (e) {
      console.warn('[autofillDriverDocument] local pdf fallback:', e);
    }
  }

  const apiKey = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || '';
  if (apiKey.length <= 10 || apiKey.startsWith('dev-')) {
    return {
      status: 'unavailable',
      documentType: docTypeHint || 'PERMIT',
      documentNumber: null,
      confidence: 0,
      message: 'AI Vision service is unavailable. Please input permit/document details manually.',
      warnings: ['No active AI key'],
    };
  }

  const prompt = [
    'You are a high-accuracy government and corporate ID OCR engine.',
    'Inspect the attached document (Emirates ID, Passport, Residency Visa, or Transport Driver Permit).',
    `Expected Document Type Hint: "${docTypeHint || 'ANY'}"`,
    '',
    'Extract:',
    '1. "documentType": One of "EMIRATES_ID", "PASSPORT", "VISA", "PERMIT".',
    '2. "documentNumber": The primary document number (e.g. 784-1988-1234567-1 for Emirates ID, passport number, visa number, or permit reference).',
    '3. "fullName": Holder name if present.',
    '4. "nationality": Country of citizenship if present.',
    '5. "dob": Date of birth in YYYY-MM-DD.',
    '6. "expiryDate": Document expiry date in YYYY-MM-DD.',
    '7. "issueDate": Document issue date in YYYY-MM-DD.',
    '',
    'Reply with strictly valid JSON only:',
    '{',
    '  "documentType": string,',
    '  "documentNumber": string | null,',
    '  "fullName": string | null,',
    '  "nationality": string | null,',
    '  "dob": "YYYY-MM-DD" | null,',
    '  "expiryDate": "YYYY-MM-DD" | null,',
    '  "issueDate": "YYYY-MM-DD" | null,',
    '  "confidence": number,',
    '  "warnings": string[]',
    '}',
  ].join('\n');

  try {
    const dataUrl = documentDataUrl(file.base64, file.mimeType);
    const res = await aiGateway.vision([dataUrl], prompt, {
      systemPrompt: 'You extract driver identity documents into strict JSON.',
      capabilityAlias: 'VISION_HIGH_ACCURACY',
      detail: 'high',
      maxTokens: 500,
      temperature: 0,
      timeoutMs: 35_000,
    });

    const clean = res.content.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
    const parsed = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1));

    return {
      status: 'ok',
      documentType: parsed.documentType ?? docTypeHint ?? 'PERMIT',
      documentNumber: parsed.documentNumber ? String(parsed.documentNumber).trim() : null,
      fullName: parsed.fullName ? String(parsed.fullName).trim() : null,
      nationality: parsed.nationality ? String(parsed.nationality).trim() : null,
      dob: normalizeDate(parsed.dob),
      expiryDate: normalizeDate(parsed.expiryDate),
      issueDate: normalizeDate(parsed.issueDate),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.95,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    };
  } catch (err) {
    console.error('[autofillDriverDocument] Vision error:', err);
    return {
      status: 'error',
      documentType: docTypeHint || 'PERMIT',
      documentNumber: null,
      confidence: 0,
      message: err instanceof Error ? err.message : 'Failed to scan document',
      warnings: ['OCR failure'],
    };
  }
}
