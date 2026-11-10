/**
 * Suggests Document Number, Expiry Date, and rich UAE Company Profile fields
 * (Company Name EN/AR, Trade License No, Issuing Authority, 15-digit FTA VAT TRN,
 * Corporate Tax TRN, Emirate, Structured PEPPOL Address, Phone, Email) from a
 * tenant attachment scan or PDF (UAE Trade License / FTA VAT Certificate).
 *
 * The result is only a suggestion for the form inputs: nothing here writes to
 * the database, and a failure or low-confidence read never blocks the upload.
 */

import { aiGateway } from '@/lib/agents/gateway';
import { extractPdfText } from '@/lib/fleet/vehicle-autofill';
import { UAE_EMIRATES, normalizeUaeTrn } from '@/lib/finance/uae';

export interface AutofillAttachmentType {
  code: string;
  name: string;
  requiresExpiry: boolean;
}

export interface ExtractedCompanyProfileFields {
  companyName?: string | null;
  arabicName?: string | null;
  trn?: string | null;
  corporateTaxTrn?: string | null;
  tradeLicenseNo?: string | null;
  tradeLicenseAuthority?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  emirate?: string | null;
  emirateCode?: string | null;
  streetName?: string | null;
  additionalStreetName?: string | null;
  postalZone?: string | null;
  address?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  peppolEndpointId?: string | null;
  detectedDocType?: 'TRADE_LICENSE' | 'VAT_CERTIFICATE' | 'CORPORATE_TAX_CERTIFICATE' | 'OTHER' | null;
}

export type AutofillResult =
  | {
      status: 'ok';
      documentNumber: string | null;
      expiryDate: string | null;
      confidence: number;
      warnings: string[];
      extractedFields?: ExtractedCompanyProfileFields;
    }
  | {
      status: 'unavailable';
      reason: string;
    };

export interface CompanyDocumentAutofillResult {
  status: 'ok' | 'unavailable' | 'error';
  message?: string;
  docType: 'TRADE_LICENSE' | 'VAT_CERTIFICATE' | 'CORPORATE_TAX_CERTIFICATE' | 'OTHER';
  documentNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  companyName: string | null;
  arabicName: string | null;
  trn: string | null;
  corporateTaxTrn: string | null;
  tradeLicenseNo: string | null;
  tradeLicenseAuthority: string | null;
  emirate: string | null;
  emirateCode: string | null;
  streetName: string | null;
  additionalStreetName: string | null;
  postalZone: string | null;
  address: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  peppolEndpointId: string | null;
  confidence: number;
  warnings: string[];
}

export const MIN_CONFIDENCE = 0.55;

const SYSTEM_PROMPT = [
  'You read business registration and compliance documents and return JSON only.',
  'Never guess from a file name. Read only what is visible in the document itself.',
  'If a field is unreadable, absent or uncertain, return null for that field and lower confidence.',
].join(' ');

export function autofillPrompt(type: AutofillAttachmentType): string {
  const numberHint =
    type.code === 'VAT_CERTIFICATE'
      ? 'For a UAE VAT certificate, documentNumber is the 15-digit Tax Registration Number (TRN), digits only.'
      : type.code === 'TRADE_LICENSE'
        ? 'For a trade license, documentNumber is the trade license number / registration number printed on the license.'
        : 'documentNumber is the main reference / document number printed on the document.';

  const richHint =
    type.code === 'TRADE_LICENSE' || type.code === 'VAT_CERTIFICATE' || type.code === 'CORPORATE_TAX_CERTIFICATE'
      ? [
          'If visible on the document, also include these optional keys:',
          '"companyName" (English legal/trade name), "arabicName" (Arabic legal/trade name),',
          '"trn" (15-digit UAE VAT TRN digits only), "corporateTaxTrn" (UAE Corporate Tax TRN),',
          '"tradeLicenseNo" (Trade License / CRN number), "tradeLicenseAuthority" (issuing authority e.g. DED Dubai, ADDED Abu Dhabi, DMCC, JAFZA),',
          '"issueDate" ("YYYY-MM-DD"), "emirate" (Dubai, Abu Dhabi, Sharjah, Ajman, Umm Al Quwain, Ras Al Khaimah, Fujairah),',
          '"streetName", "additionalStreetName" (area/building), "postalZone" (P.O. Box), "address" (full address),',
          '"contactPhone", "contactEmail".',
        ].join(' ')
      : '';

  return [
    `Expected document type: "${type.name}" (code: ${type.code}).`,
    numberHint,
    'Convert any expiry date you see (e.g. DD/MM/YYYY, DD-MM-YYYY, "31 Dec 2026") to ISO "YYYY-MM-DD".',
    'If the document does not look like the expected type, set matchesExpectedType to false and name what it looks like in documentKind.',
    richHint,
    'Reply with a single JSON object and no other text:',
    '{"documentNumber": string|null, "expiryDate": "YYYY-MM-DD"|null, "confidence": number between 0 and 1, "documentKind": string|null, "matchesExpectedType": boolean}',
  ]
    .filter(Boolean)
    .join('\n');
}

export function normalizeDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return s;
}

/**
 * Normalizes flexible date strings (YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY) to YYYY-MM-DD.
 */
export function normalizeFlexibleDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  const iso = normalizeDate(s);
  if (iso) return iso;

  const dmy = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s);
  if (dmy) {
    const day = String(Number(dmy[1])).padStart(2, '0');
    const month = String(Number(dmy[2])).padStart(2, '0');
    const year = dmy[3];
    return normalizeDate(`${year}-${month}-${day}`);
  }

  const ymdSlash = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/.exec(s);
  if (ymdSlash) {
    const year = ymdSlash[1];
    const month = String(Number(ymdSlash[2])).padStart(2, '0');
    const day = String(Number(ymdSlash[3])).padStart(2, '0');
    return normalizeDate(`${year}-${month}-${day}`);
  }

  return null;
}

function cleanStr(val: unknown, maxLen = 200): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'n/a') return null;
  return trimmed.slice(0, maxLen);
}

export function resolveEmirateAndCode(raw: string | null | undefined): { emirate: string | null; emirateCode: string | null } {
  if (!raw) return { emirate: null, emirateCode: null };
  const upper = raw.trim().toUpperCase();
  for (const em of UAE_EMIRATES) {
    if (
      em.code.toUpperCase() === upper ||
      em.nameEn.toUpperCase() === upper ||
      upper.includes(em.nameEn.toUpperCase()) ||
      (em.nameAr && raw.includes(em.nameAr))
    ) {
      return { emirate: em.nameEn, emirateCode: em.code };
    }
  }
  if (upper.includes('DXB') || upper.includes('DUBAI')) return { emirate: 'Dubai', emirateCode: 'AE-DU' };
  if (upper.includes('AUH') || upper.includes('ABU DHABI') || upper.includes('ABUDHABI')) return { emirate: 'Abu Dhabi', emirateCode: 'AE-AZ' };
  if (upper.includes('SHJ') || upper.includes('SHARJAH')) return { emirate: 'Sharjah', emirateCode: 'AE-SH' };
  if (upper.includes('AJM') || upper.includes('AJMAN')) return { emirate: 'Ajman', emirateCode: 'AE-AJ' };
  if (upper.includes('UAQ') || upper.includes('UMM AL QUWAIN')) return { emirate: 'Umm Al Quwain', emirateCode: 'AE-UQ' };
  if (upper.includes('RAK') || upper.includes('RAS AL KHAIMAH')) return { emirate: 'Ras Al Khaimah', emirateCode: 'AE-RK' };
  if (upper.includes('FUJ') || upper.includes('FUJAIRAH')) return { emirate: 'Fujairah', emirateCode: 'AE-FU' };
  return { emirate: raw.trim(), emirateCode: null };
}

export function parseAutofillReply(
  raw: string,
  type: AutofillAttachmentType,
  todayIso: string = new Date().toISOString().slice(0, 10),
): AutofillResult {
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return { status: 'unavailable', reason: 'The document could not be read.' };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return { status: 'unavailable', reason: 'The document could not be read.' };
  }

  const confidenceRaw = Number(parsed.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0;

  let documentNumber =
    typeof parsed.documentNumber === 'string' && parsed.documentNumber.trim()
      ? parsed.documentNumber.trim().slice(0, 100)
      : null;
  let expiryDate = normalizeDate(parsed.expiryDate) ?? normalizeFlexibleDate(parsed.expiryDate);
  const warnings: string[] = [];

  if (confidence < MIN_CONFIDENCE) {
    documentNumber = null;
    expiryDate = null;
    warnings.push('Could not read this document with enough confidence; enter the details manually.');
  }

  if (parsed.matchesExpectedType === false) {
    const kind = typeof parsed.documentKind === 'string' && parsed.documentKind.trim() ? parsed.documentKind.trim() : 'a different document';
    warnings.push(`This may not be a ${type.name} (it looks like: ${kind}). Check that the right file was chosen.`);
  }

  if (type.code === 'VAT_CERTIFICATE' && documentNumber) {
    const digits = documentNumber.replace(/\D/g, '');
    if (digits.length === 15) {
      documentNumber = digits;
    } else {
      warnings.push('A TRN has 15 digits: check the number that was read.');
    }
  }

  if (expiryDate && expiryDate < todayIso) {
    warnings.push(`This document appears to have expired on ${expiryDate}.`);
  } else if (type.requiresExpiry && !expiryDate && confidence >= MIN_CONFIDENCE) {
    warnings.push('No expiry date was found: enter it manually.');
  }

  // Extract optional rich company profile fields if present in the model response
  const extractedFields: ExtractedCompanyProfileFields = {};
  let hasExtraFields = false;

  if (confidence >= MIN_CONFIDENCE) {
    const companyName = cleanStr(parsed.companyName, 160);
    const arabicName = cleanStr(parsed.arabicName, 160);
    const rawTrn = cleanStr(parsed.trn, 30);
    const trn = rawTrn ? normalizeUaeTrn(rawTrn) : (type.code === 'VAT_CERTIFICATE' && documentNumber?.length === 15 ? documentNumber : null);
    const corporateTaxTrn = cleanStr(parsed.corporateTaxTrn, 30)?.replace(/\D/g, '') || null;
    const tradeLicenseNo = cleanStr(parsed.tradeLicenseNo, 80) || (type.code === 'TRADE_LICENSE' ? documentNumber : null);
    const tradeLicenseAuthority = cleanStr(parsed.tradeLicenseAuthority, 120);
    const issueDate = normalizeFlexibleDate(parsed.issueDate);
    const { emirate, emirateCode } = resolveEmirateAndCode(cleanStr(parsed.emirate, 60) || cleanStr(parsed.emirateCode, 20));
    const streetName = cleanStr(parsed.streetName, 160);
    const additionalStreetName = cleanStr(parsed.additionalStreetName, 160);
    const postalZone = cleanStr(parsed.postalZone, 40);
    const address = cleanStr(parsed.address, 300);
    const contactPhone = cleanStr(parsed.contactPhone, 40);
    const contactEmail = cleanStr(parsed.contactEmail, 120);

    const candidateMap: ExtractedCompanyProfileFields = {
      ...(companyName ? { companyName } : {}),
      ...(arabicName ? { arabicName } : {}),
      ...(trn && parsed.trn ? { trn } : {}),
      ...(corporateTaxTrn ? { corporateTaxTrn } : {}),
      ...(tradeLicenseNo && parsed.tradeLicenseNo ? { tradeLicenseNo } : {}),
      ...(tradeLicenseAuthority ? { tradeLicenseAuthority } : {}),
      ...(issueDate ? { issueDate } : {}),
      ...(emirate ? { emirate } : {}),
      ...(emirateCode ? { emirateCode } : {}),
      ...(streetName ? { streetName } : {}),
      ...(additionalStreetName ? { additionalStreetName } : {}),
      ...(postalZone ? { postalZone } : {}),
      ...(address ? { address } : {}),
      ...(contactPhone ? { contactPhone } : {}),
      ...(contactEmail ? { contactEmail } : {}),
    };

    if (Object.keys(candidateMap).length > 0) {
      hasExtraFields = true;
      Object.assign(extractedFields, candidateMap);
      if (trn && !extractedFields.trn) extractedFields.trn = trn;
      if (tradeLicenseNo && !extractedFields.tradeLicenseNo) extractedFields.tradeLicenseNo = tradeLicenseNo;
      if (expiryDate) extractedFields.expiryDate = expiryDate;
    }
  }

  return {
    status: 'ok',
    documentNumber,
    expiryDate,
    confidence,
    warnings,
    ...(hasExtraFields ? { extractedFields } : {}),
  };
}

export async function autofillAttachment(
  file: { base64: string; mimeType: string; fileName: string },
  type: AutofillAttachmentType,
  todayIso?: string,
): Promise<AutofillResult> {
  if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
    return { status: 'unavailable', reason: 'AI document reader is not configured; enter the details manually.' };
  }
  try {
    const dataUrl = `data:${file.mimeType};base64,${file.base64}`;
    const res = await aiGateway.vision([dataUrl], autofillPrompt(type), {
      systemPrompt: SYSTEM_PROMPT,
      capabilityAlias: 'VISION_HIGH_ACCURACY',
      detail: 'high',
      temperature: 0,
      maxTokens: 600,
    });
    if (res.fromFallback) {
      return { status: 'unavailable', reason: 'The document could not be read automatically; enter the details manually.' };
    }
    return parseAutofillReply(res.content, type, todayIso);
  } catch {
    return { status: 'unavailable', reason: 'The document could not be read automatically; enter the details manually.' };
  }
}

// ── Deterministic PDF Text Parser for UAE Trade License & FTA VAT Certificate ──

export function parseUaeCompanyDocumentText(
  rawText: string,
  expectedType: 'TRADE_LICENSE' | 'VAT_CERTIFICATE' | 'CORPORATE_TAX_CERTIFICATE' | 'AUTO' = 'AUTO',
): Partial<CompanyDocumentAutofillResult> {
  const result: Partial<CompanyDocumentAutofillResult> = {};
  const text = rawText.replace(/\r/g, '\n');

  // Detect document type if AUTO
  const upper = text.toUpperCase();
  let detectedType: 'TRADE_LICENSE' | 'VAT_CERTIFICATE' | 'CORPORATE_TAX_CERTIFICATE' | 'OTHER' =
    expectedType === 'AUTO' ? 'OTHER' : expectedType;

  if (expectedType === 'AUTO') {
    if (
      upper.includes('TAX REGISTRATION CERTIFICATE') ||
      upper.includes('VALUE ADDED TAX') ||
      upper.includes('FEDERAL TAX AUTHORITY') ||
      upper.includes('TRN') ||
      /100\d{12}/.test(text.replace(/[\s-]/g, ''))
    ) {
      detectedType = upper.includes('CORPORATE TAX') && !upper.includes('VALUE ADDED TAX')
        ? 'CORPORATE_TAX_CERTIFICATE'
        : 'VAT_CERTIFICATE';
    } else if (
      upper.includes('COMMERCIAL LICENSE') ||
      upper.includes('TRADE LICENSE') ||
      upper.includes('ECONOMIC DEVELOPMENT') ||
      upper.includes('ECONOMY AND TOURISM') ||
      upper.includes('LICENSE NO') ||
      upper.includes('LICENCE NO')
    ) {
      detectedType = 'TRADE_LICENSE';
    }
  }
  result.docType = detectedType;

  // 1. Extract 15-digit UAE VAT TRN (starts with 100)
  const trnLabeled = text.match(/(?:Tax\s*Registration\s*(?:Number|No\.?)|TRN|VAT\s*(?:Reg(?:istration)?\s*)?(?:No\.?|Number))[\s:.\-#]*([0-9][0-9\s\-]{13,20}[0-9])/i);
  if (trnLabeled) {
    const digits = trnLabeled[1].replace(/\D/g, '');
    if (digits.length === 15) result.trn = digits;
  }
  if (!result.trn) {
    const compact = text.replace(/[\s\-]/g, '');
    const m15 = compact.match(/(100\d{12})/);
    if (m15) result.trn = m15[1];
  }

  // 2. Extract Corporate Tax Registration Number
  const ctMatch = text.match(/(?:Corporate\s*Tax\s*(?:Registration\s*)?(?:Number|No\.?|TRN))[\s:.\-#]*([0-9]{9,15})/i);
  if (ctMatch) {
    result.corporateTaxTrn = ctMatch[1].replace(/\D/g, '');
  }

  // 3. Extract Trade License Number / Commercial Registration No
  const tlPatterns = [
    /(?:License\s*No\.?|Licence\s*No\.?|Commercial\s*License\s*No\.?|Trade\s*License\s*No\.?|Registration\s*No\.?)[\s:.\-#]*([A-Z0-9\-\/]{4,25})/i,
    /\b(CN-\d{5,12})\b/i,
    /\b(DMCC-\d{4,10})\b/i,
    /\b(JAFZA-\d{4,10})\b/i,
  ];
  for (const pat of tlPatterns) {
    const m = text.match(pat);
    if (m && m[1] && !/^(DATE|TYPE|NAME|EXPIRY|ISSUE|STATUS|NUMBER)$/i.test(m[1].trim())) {
      const candidate = m[1].trim();
      if (candidate !== result.trn) {
        result.tradeLicenseNo = candidate;
        break;
      }
    }
  }

  // 4. Extract Issuing Authority & Emirate
  if (/DEPARTMENT\s+OF\s+ECONOMY\s+AND\s+TOURISM|DEPARTMENT\s+OF\s+ECONOMIC\s+DEVELOPMENT.*DUBAI|\bDED\b.*DUBAI/i.test(text)) {
    result.tradeLicenseAuthority = 'DED Dubai (DET)';
    result.emirate = 'Dubai';
    result.emirateCode = 'AE-DU';
  } else if (/DEPARTMENT\s+OF\s+ECONOMIC\s+DEVELOPMENT.*ABU\s+DHABI|\bADDED\b|CN-\d{6,}/i.test(text)) {
    result.tradeLicenseAuthority = 'ADDED Abu Dhabi';
    result.emirate = 'Abu Dhabi';
    result.emirateCode = 'AE-AZ';
  } else if (/SHARJAH\s+ECONOMIC\s+DEVELOPMENT|\bSEDD\b/i.test(text)) {
    result.tradeLicenseAuthority = 'SEDD Sharjah';
    result.emirate = 'Sharjah';
    result.emirateCode = 'AE-SH';
  } else if (/\bDMCC\b|DUBAI\s+MULTI\s+COMMODITIES/i.test(text)) {
    result.tradeLicenseAuthority = 'DMCC Free Zone';
    result.emirate = 'Dubai';
    result.emirateCode = 'AE-DU';
  } else if (/\bJAFZA\b|JEBEL\s+ALI\s+FREE\s+ZONE/i.test(text)) {
    result.tradeLicenseAuthority = 'JAFZA';
    result.emirate = 'Dubai';
    result.emirateCode = 'AE-DU';
  } else if (/\bADGM\b|ABU\s+DHABI\s+GLOBAL\s+MARKET/i.test(text)) {
    result.tradeLicenseAuthority = 'ADGM';
    result.emirate = 'Abu Dhabi';
    result.emirateCode = 'AE-AZ';
  } else if (/\bDIFC\b|DUBAI\s+INTERNATIONAL\s+FINANCIAL/i.test(text)) {
    result.tradeLicenseAuthority = 'DIFC';
    result.emirate = 'Dubai';
    result.emirateCode = 'AE-DU';
  } else if (/\bRAKEZ\b|RAS\s+AL\s+KHAIMAH\s+ECONOMIC/i.test(text)) {
    result.tradeLicenseAuthority = 'RAKEZ';
    result.emirate = 'Ras Al Khaimah';
    result.emirateCode = 'AE-RK';
  } else if (/FEDERAL\s+TAX\s+AUTHORITY/i.test(text) && detectedType !== 'TRADE_LICENSE') {
    result.tradeLicenseAuthority = result.tradeLicenseAuthority || 'UAE Federal Tax Authority (FTA)';
  }

  // Fallback Emirate detection from text
  if (!result.emirate) {
    const emMatch = text.match(/\b(Abu\s*Dhabi|Dubai|Sharjah|Ajman|Umm\s*Al\s*Quwain|Ras\s*Al\s*Khaimah|Fujairah)\b/i);
    if (emMatch) {
      const resolved = resolveEmirateAndCode(emMatch[1]);
      result.emirate = resolved.emirate;
      result.emirateCode = resolved.emirateCode;
    }
  }

  // 5. Extract English Legal / Trade Name
  const namePatterns = [
    /(?:Legal\s*Name\s*\(?English\)?|Trade\s*Name|Company\s*Name|Establishment\s*Name|Entity\s*Name|Registrant\s*Name)[\s:.\-]*([A-Z0-9][A-Za-z0-9\s&.,'\-()]{3,100})/i,
    /\b([A-Z][A-Z0-9\s&.,'\-]{3,80}\s+(?:L\.?L\.?C\.?|LLC|F\.?Z\.?E\.?|FZE|F\.?Z\.?C\.?O\.?|FZCO|P\.?J\.?S\.?C\.?|PJSC|SOLE\s+PROPRIETORSHIP|BRANCH))\b/,
  ];
  for (const pat of namePatterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      const cleaned = m[1].split(/\n/)[0].trim();
      if (cleaned.length >= 3 && !/^(GOVERNMENT|DEPARTMENT|MINISTRY|FEDERAL TAX)/i.test(cleaned)) {
        result.companyName = cleaned;
        break;
      }
    }
  }

  // 6. Extract Arabic Legal / Trade Name
  const arabicLabeled = text.match(/(?:الاسم\s*التجاري|اسم\s*الشركة|الاسم\s*القانوني|اسم\s*المؤسسة)[\s:.\-]*([\u0600-\u06FF\s0-9.,\-()]{4,120})/);
  if (arabicLabeled && arabicLabeled[1]) {
    result.arabicName = arabicLabeled[1].split(/\n/)[0].trim();
  } else {
    const arabicCompanyLine = text.match(/([\u0600-\u06FF][\u0600-\u06FF\s]{4,100}(?:ش\.?\s*ذ\.?\s*م\.?\s*م|ذ\.?\s*م\.?\s*م|شركة|لتأجير|للنقل|للخدمات|التجارة))/);
    if (arabicCompanyLine && arabicCompanyLine[1]) {
      result.arabicName = arabicCompanyLine[1].split(/\n/)[0].trim();
    }
  }

  // 7. Extract Issue Date & Expiry Date
  const expMatch = text.match(/(?:Expiry\s*Date|Expiration\s*Date|Valid\s*Until|Exp\.?\s*Date)[\s:.\-]*(\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4})/i);
  if (expMatch) {
    result.expiryDate = normalizeFlexibleDate(expMatch[1]);
  }
  const issMatch = text.match(/(?:Issue\s*Date|Issuance\s*Date|Effective\s*Registration\s*Date|Effective\s*Date|Registration\s*Date)[\s:.\-]*(\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4})/i);
  if (issMatch) {
    result.issueDate = normalizeFlexibleDate(issMatch[1]);
  }

  // Fallback dates if not labeled
  if (!result.expiryDate) {
    const allDates = Array.from(text.matchAll(/\b(\d{2}[\/\-.]\d{2}[\/\-.]\d{4}|\d{4}-\d{2}-\d{2})\b/g))
      .map(m => normalizeFlexibleDate(m[1]))
      .filter((d): d is string => Boolean(d))
      .sort();
    if (allDates.length > 0) {
      result.expiryDate = allDates[allDates.length - 1];
      if (!result.issueDate && allDates.length > 1) {
        result.issueDate = allDates[0];
      }
    }
  }

  // 8. Extract Address, P.O. Box, Phone, Email
  const poBoxMatch = text.match(/(?:P\.?\s*O\.?\s*Box|Postal\s*Code)[\s:.\-#]*(\d{3,10})/i);
  if (poBoxMatch) {
    result.postalZone = poBoxMatch[1].trim();
  }

  const addrMatch = text.match(/(?:Address|Location|Premises\s*Address|Registered\s*Address)[\s:.\-]*([^\n]{6,160})/i);
  if (addrMatch && addrMatch[1]) {
    result.address = addrMatch[1].trim();
    result.streetName = addrMatch[1].trim();
  }

  const phoneMatch = text.match(/(?:\+971|00971|0[24679]|05[024568])[\s\-]?\d{1,3}[\s\-]?\d{3,4}[\s\-]?\d{0,4}/);
  if (phoneMatch) {
    result.contactPhone = phoneMatch[0].trim();
  }

  const emailMatch = text.match(/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/);
  if (emailMatch && !/gov\.ae|tax\.gov\.ae|dubaided\.ae/i.test(emailMatch[0])) {
    result.contactEmail = emailMatch[0].toLowerCase();
  }

  if (result.trn) {
    result.peppolEndpointId = result.trn;
  }

  result.documentNumber =
    detectedType === 'VAT_CERTIFICATE'
      ? result.trn ?? result.tradeLicenseNo ?? null
      : detectedType === 'CORPORATE_TAX_CERTIFICATE'
        ? result.corporateTaxTrn ?? result.trn ?? null
        : result.tradeLicenseNo ?? result.trn ?? null;

  return result;
}

const COMPANY_DOCUMENT_VISION_PROMPT = `You are reading an official UAE Company Document (either a UAE Trade / Commercial License issued by DED Dubai, ADDED Abu Dhabi, Sharjah SEDD, or a UAE Free Zone like DMCC/JAFZA/ADGM/DIFC/RAKEZ, OR a UAE Federal Tax Authority (FTA) VAT / Corporate Tax Registration Certificate).

Extract every visible field accurately from the document (in both English and Arabic) and return ONLY a single valid JSON object with these keys:
{
  "docType": "TRADE_LICENSE" | "VAT_CERTIFICATE" | "CORPORATE_TAX_CERTIFICATE" | "OTHER",
  "documentNumber": string | null,
  "companyName": string | null,
  "arabicName": string | null,
  "trn": string | null,
  "corporateTaxTrn": string | null,
  "tradeLicenseNo": string | null,
  "tradeLicenseAuthority": string | null,
  "issueDate": "YYYY-MM-DD" | null,
  "expiryDate": "YYYY-MM-DD" | null,
  "emirate": "Dubai" | "Abu Dhabi" | "Sharjah" | "Ajman" | "Umm Al Quwain" | "Ras Al Khaimah" | "Fujairah" | null,
  "streetName": string | null,
  "additionalStreetName": string | null,
  "postalZone": string | null,
  "address": string | null,
  "contactPhone": string | null,
  "contactEmail": string | null,
  "confidence": number
}

Rules:
- For a UAE VAT Registration Certificate, "trn" and "documentNumber" MUST be the 15-digit Tax Registration Number starting with 100 (digits only, no spaces or dashes).
- For a UAE Trade License, "tradeLicenseNo" and "documentNumber" MUST be the License / Commercial Registration Number (e.g. CN-1234567 or 6-7 digit DED license number).
- "companyName" is the English legal/trade name of the company.
- "arabicName" is the Arabic legal/trade name of the company (الاسم التجاري / اسم الشركة).
- "tradeLicenseAuthority" is the issuing authority (e.g., "DED Dubai (DET)", "ADDED Abu Dhabi", "SEDD Sharjah", "DMCC", "JAFZA", "ADGM", "DIFC", "RAKEZ", "UAE Federal Tax Authority").
- Convert all dates (DD/MM/YYYY, DD-MM-YYYY, etc.) to ISO "YYYY-MM-DD".
- Return null for any field not visible on the document. Do not invent values.`;

/**
 * Full hybrid extraction for UAE Company Trade License & FTA VAT Certificate:
 * 1. Fast native PDF text + ToUnicode CMap extraction with deterministic regexes.
 * 2. AI Vision fallback (or primary for images / scanned PDFs) via aiGateway.vision.
 */
export async function autofillCompanyDocument(
  file: { base64: string; mimeType: string; fileName: string },
  expectedType: 'TRADE_LICENSE' | 'VAT_CERTIFICATE' | 'CORPORATE_TAX_CERTIFICATE' | 'AUTO' = 'AUTO',
): Promise<CompanyDocumentAutofillResult> {
  const warnings: string[] = [];
  const todayIso = new Date().toISOString().slice(0, 10);

  let pdfPartial: Partial<CompanyDocumentAutofillResult> = {};
  const isPdf = file.mimeType === 'application/pdf' || file.fileName?.toLowerCase().endsWith('.pdf');

  // Step 1: Try native PDF text extraction first
  if (isPdf) {
    try {
      const buf = Buffer.from(file.base64, 'base64');
      const rawText = extractPdfText(buf);
      if (rawText.length > 25) {
        pdfPartial = parseUaeCompanyDocumentText(rawText, expectedType);
      }
    } catch {
      // Fall through to AI Vision
    }
  }

  const pdfKeyCount = [
    pdfPartial.companyName,
    pdfPartial.arabicName,
    pdfPartial.trn,
    pdfPartial.tradeLicenseNo,
    pdfPartial.expiryDate,
    pdfPartial.emirate,
  ].filter(Boolean).length;

  // Step 2: If Vision AI is configured, run Vision when image OR when PDF text had fewer than 3 key fields
  const hasAiKey = Boolean(process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY);
  let visionPartial: Partial<CompanyDocumentAutofillResult> = {};
  let visionConfidence = 0;

  if (hasAiKey && (!isPdf || pdfKeyCount < 3)) {
    try {
      const mimeType = file.mimeType || (isPdf ? 'application/pdf' : 'image/jpeg');
      const dataUrl = `data:${mimeType};base64,${file.base64}`;
      const promptWithType =
        expectedType !== 'AUTO'
          ? `Expected document type: ${expectedType}.\n\n${COMPANY_DOCUMENT_VISION_PROMPT}`
          : COMPANY_DOCUMENT_VISION_PROMPT;

      const res = await aiGateway.vision([dataUrl], promptWithType, {
        systemPrompt: SYSTEM_PROMPT,
        capabilityAlias: 'VISION_HIGH_ACCURACY',
        detail: 'high',
        temperature: 0,
        maxTokens: 900,
      });

      if (!res.fromFallback && res.content) {
        const cleaned = res.content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
          visionConfidence = Number.isFinite(Number(parsed.confidence))
            ? Math.max(0, Math.min(1, Number(parsed.confidence)))
            : 0.88;

          const rawTrn = cleanStr(parsed.trn, 30)?.replace(/\D/g, '') || null;
          const docNum = cleanStr(parsed.documentNumber, 80);
          const { emirate, emirateCode } = resolveEmirateAndCode(
            cleanStr(parsed.emirate, 60) || cleanStr(parsed.emirateCode, 20),
          );

          visionPartial = {
            docType:
              parsed.docType === 'TRADE_LICENSE' ||
              parsed.docType === 'VAT_CERTIFICATE' ||
              parsed.docType === 'CORPORATE_TAX_CERTIFICATE'
                ? parsed.docType
                : expectedType !== 'AUTO'
                  ? expectedType
                  : 'OTHER',
            documentNumber: docNum,
            companyName: cleanStr(parsed.companyName, 160),
            arabicName: cleanStr(parsed.arabicName, 160),
            trn: rawTrn && rawTrn.length === 15 ? rawTrn : null,
            corporateTaxTrn: cleanStr(parsed.corporateTaxTrn, 30)?.replace(/\D/g, '') || null,
            tradeLicenseNo: cleanStr(parsed.tradeLicenseNo, 80),
            tradeLicenseAuthority: cleanStr(parsed.tradeLicenseAuthority, 120),
            issueDate: normalizeFlexibleDate(parsed.issueDate),
            expiryDate: normalizeFlexibleDate(parsed.expiryDate),
            emirate,
            emirateCode,
            streetName: cleanStr(parsed.streetName, 160),
            additionalStreetName: cleanStr(parsed.additionalStreetName, 160),
            postalZone: cleanStr(parsed.postalZone, 40),
            address: cleanStr(parsed.address, 300),
            contactPhone: cleanStr(parsed.contactPhone, 40),
            contactEmail: cleanStr(parsed.contactEmail, 120),
          };
        }
      }
    } catch {
      // Fall back to whatever pdfPartial extracted
    }
  }

  // Merge visionPartial + pdfPartial (preferring non-null values)
  const docType =
    (expectedType !== 'AUTO' ? expectedType : null) ||
    visionPartial.docType ||
    pdfPartial.docType ||
    'OTHER';

  const rawTrn = visionPartial.trn || pdfPartial.trn || (docType === 'VAT_CERTIFICATE' ? visionPartial.documentNumber?.replace(/\D/g, '') : null) || null;
  const trn = rawTrn && rawTrn.length === 15 ? rawTrn : rawTrn || null;
  if (docType === 'VAT_CERTIFICATE' && trn && trn.length !== 15) {
    warnings.push('UAE VAT TRN should be 15 digits starting with 100 — please verify.');
  }

  const tradeLicenseNo =
    visionPartial.tradeLicenseNo ||
    pdfPartial.tradeLicenseNo ||
    (docType === 'TRADE_LICENSE' ? visionPartial.documentNumber || pdfPartial.documentNumber : null) ||
    null;

  const corporateTaxTrn =
    visionPartial.corporateTaxTrn ||
    pdfPartial.corporateTaxTrn ||
    (docType === 'CORPORATE_TAX_CERTIFICATE' ? visionPartial.documentNumber || pdfPartial.documentNumber : null) ||
    null;

  const documentNumber =
    docType === 'VAT_CERTIFICATE'
      ? trn || visionPartial.documentNumber || pdfPartial.documentNumber || null
      : docType === 'TRADE_LICENSE'
        ? tradeLicenseNo || visionPartial.documentNumber || pdfPartial.documentNumber || null
        : visionPartial.documentNumber || pdfPartial.documentNumber || tradeLicenseNo || trn || null;

  const expiryDate = visionPartial.expiryDate || pdfPartial.expiryDate || null;
  const issueDate = visionPartial.issueDate || pdfPartial.issueDate || null;

  if (expiryDate && expiryDate < todayIso) {
    warnings.push(`This document appears to have expired on ${expiryDate}.`);
  }

  const companyName = visionPartial.companyName || pdfPartial.companyName || null;
  const arabicName = visionPartial.arabicName || pdfPartial.arabicName || null;
  const tradeLicenseAuthority = visionPartial.tradeLicenseAuthority || pdfPartial.tradeLicenseAuthority || null;
  const emirate = visionPartial.emirate || pdfPartial.emirate || null;
  const emirateCode = visionPartial.emirateCode || pdfPartial.emirateCode || resolveEmirateAndCode(emirate).emirateCode;
  const streetName = visionPartial.streetName || pdfPartial.streetName || null;
  const additionalStreetName = visionPartial.additionalStreetName || pdfPartial.additionalStreetName || null;
  const postalZone = visionPartial.postalZone || pdfPartial.postalZone || null;
  const address =
    visionPartial.address ||
    pdfPartial.address ||
    [streetName, additionalStreetName, postalZone ? `P.O. Box ${postalZone}` : null, emirate].filter(Boolean).join(', ') ||
    null;
  const contactPhone = visionPartial.contactPhone || pdfPartial.contactPhone || null;
  const contactEmail = visionPartial.contactEmail || pdfPartial.contactEmail || null;
  const peppolEndpointId = trn && /^\d{15}$/.test(trn) ? trn : tradeLicenseNo || null;

  const anyExtracted = Boolean(
    documentNumber ||
      companyName ||
      arabicName ||
      trn ||
      corporateTaxTrn ||
      tradeLicenseNo ||
      tradeLicenseAuthority ||
      expiryDate ||
      emirate ||
      address,
  );

  if (!anyExtracted) {
    if (!hasAiKey && !isPdf) {
      return {
        status: 'unavailable',
        message: 'AI vision reader is not configured (set OPENAI_API_KEY or GEMINI_API_KEY) or upload a digital PDF.',
        docType,
        documentNumber: null,
        issueDate: null,
        expiryDate: null,
        companyName: null,
        arabicName: null,
        trn: null,
        corporateTaxTrn: null,
        tradeLicenseNo: null,
        tradeLicenseAuthority: null,
        emirate: null,
        emirateCode: null,
        streetName: null,
        additionalStreetName: null,
        postalZone: null,
        address: null,
        contactPhone: null,
        contactEmail: null,
        peppolEndpointId: null,
        confidence: 0,
        warnings,
      };
    }
    return {
      status: 'error',
      message: 'Could not extract company details from this document. Please check the file or enter fields manually.',
      docType,
      documentNumber: null,
      issueDate: null,
      expiryDate: null,
      companyName: null,
      arabicName: null,
      trn: null,
      corporateTaxTrn: null,
      tradeLicenseNo: null,
      tradeLicenseAuthority: null,
      emirate: null,
      emirateCode: null,
      streetName: null,
      additionalStreetName: null,
      postalZone: null,
      address: null,
      contactPhone: null,
      contactEmail: null,
      peppolEndpointId: null,
      confidence: 0,
      warnings,
    };
  }

  const confidence = visionConfidence > 0 ? visionConfidence : Math.min(0.96, 0.65 + pdfKeyCount * 0.06);

  return {
    status: 'ok',
    docType,
    documentNumber,
    issueDate,
    expiryDate,
    companyName,
    arabicName,
    trn,
    corporateTaxTrn,
    tradeLicenseNo,
    tradeLicenseAuthority,
    emirate,
    emirateCode,
    streetName,
    additionalStreetName,
    postalZone,
    address,
    contactPhone,
    contactEmail,
    peppolEndpointId,
    confidence,
    warnings,
  };
}
