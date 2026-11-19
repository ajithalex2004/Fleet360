export * from './digital-kyc-types';
import {
  type LegacyOcrDocType,
  type KycDocumentType,
  type KycOcrProvider,
  type MultimodalKycScanInput,
  type MultimodalKycScanResult,
  type OcrScanResult,
  type UaePassProfile,
  formatCanonicalEmiratesId,
  sealElectronicSignature,
  verifyEmiratesIdFormat,
  DEMO_UAE_PASS_USER,
  STANDARD_RENTAL_TERMS,
} from './digital-kyc-types';

const ISO3_TO_COUNTRY_NAME: Record<string, string> = {
  ARE: 'United Arab Emirates',
  SAU: 'Saudi Arabia',
  OMN: 'Oman',
  KWT: 'Kuwait',
  BHR: 'Bahrain',
  QAT: 'Qatar',
  GBR: 'United Kingdom',
  USA: 'United States',
  CAN: 'Canada',
  AUS: 'Australia',
  DEU: 'Germany',
  FRA: 'France',
  ITA: 'Italy',
  ESP: 'Spain',
  IND: 'India',
  PAK: 'Pakistan',
  PHL: 'Philippines',
  EGY: 'Egypt',
  JOR: 'Jordan',
  LBN: 'Lebanon',
  ZAF: 'South Africa',
  CHN: 'China',
  JPN: 'Japan',
  SGP: 'Singapore',
};

function parseMrzYyMmDd(raw: string, mode: 'DOB' | 'EXPIRY'): string | null {
  if (!/^\d{6}$/.test(raw)) return null;
  const yy = Number(raw.slice(0, 2));
  const mm = Number(raw.slice(2, 4));
  const dd = Number(raw.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

  const currentYear = new Date().getUTCFullYear();
  const currentTwoDigit = currentYear % 100;
  let fullYear: number;
  if (mode === 'DOB') {
    fullYear = yy > currentTwoDigit ? 1900 + yy : 2000 + yy;
  } else {
    fullYear = yy >= 70 ? 1900 + yy : 2000 + yy;
  }
  const iso = `${String(fullYear).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) ? null : iso;
}

function computeExpiryMetrics(expiryIso?: string | null): {
  isExpired: boolean;
  daysUntilExpiry: number | null;
} {
  if (!expiryIso) return { isExpired: false, daysUntilExpiry: null };
  const exp = new Date(expiryIso);
  if (Number.isNaN(exp.getTime())) return { isExpired: false, daysUntilExpiry: null };
  exp.setUTCHours(23, 59, 59, 999);
  const diffMs = exp.getTime() - Date.now();
  const days = Math.ceil(diffMs / 86_400_000);
  return {
    isExpired: diffMs < 0,
    daysUntilExpiry: days,
  };
}

function parseMrzNameField(rawNameSection: string): string | null {
  const parts = rawNameSection.split('<<');
  const surname = (parts[0] ?? '').replace(/<+/g, ' ').trim();
  const given = parts
    .slice(1)
    .join(' ')
    .replace(/<+/g, ' ')
    .trim();
  const combined = [given, surname].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (!combined) return null;
  return combined
    .toLowerCase()
    .replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

function looksLikeMrzInput(text?: string | null): boolean {
  if (!text) return false;
  const upper = text.toUpperCase();
  return (
    upper.includes('<<') &&
    (upper.includes('IDARE') ||
      upper.includes('I<ARE') ||
      upper.includes('P<') ||
      text.includes('\n'))
  );
}

/**
 * Parses ICAO-9303 TD1 (UAE Emirates ID 3-line MRZ: `IDARE...`) and
 * TD3 (Passport 2-line MRZ: `P<...`) strings synchronously.
 */
export function parseMrzText(
  rawText: string,
  fallbackDocType: KycDocumentType = 'EMIRATES_ID',
): {
  documentType: KycDocumentType;
  fullName: string;
  documentNumber: string;
  emiratesId: string | null;
  nationality: string | null;
  issuingCountry: string | null;
  dateOfBirth: string | null;
  expiryDate: string | null;
  confidence: number;
} | null {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim().toUpperCase().replace(/\s+/g, ''))
    .filter((l) => l.length >= 24);

  if (lines.length === 0) return null;

  // TD1: 3 lines (~30 chars each), e.g., UAE Emirates ID (`IDARE...`)
  if (
    lines.length >= 3 &&
    (lines[0].startsWith('ID') || lines[0].startsWith('I<') || lines[0].startsWith('AC'))
  ) {
    const l1 = lines[0].padEnd(30, '<');
    const l2 = lines[1].padEnd(30, '<');
    const l3 = lines[2].padEnd(30, '<');

    const issuingIso3 = l1.slice(2, 5).replace(/</g, '');
    const rawCardNo = l1.slice(5, 14).replace(/</g, '');
    const joinedOptional = `${l1.slice(15, 30)}${l2.slice(18, 29)}`.replace(/</g, '');
    const eidMatch = joinedOptional.match(/784\d{12}/);
    const emiratesId = eidMatch ? formatCanonicalEmiratesId(eidMatch[0]) : null;

    const dob = parseMrzYyMmDd(l2.slice(0, 6), 'DOB');
    const expiry = parseMrzYyMmDd(l2.slice(8, 14), 'EXPIRY');
    const natIso3 = l2.slice(15, 18).replace(/</g, '') || issuingIso3;
    const fullName = parseMrzNameField(l3) || 'Unknown Cardholder';

    return {
      documentType: emiratesId || issuingIso3 === 'ARE' ? 'EMIRATES_ID' : fallbackDocType,
      fullName,
      documentNumber: emiratesId || rawCardNo || '784-1988-1234567-1',
      emiratesId,
      nationality: ISO3_TO_COUNTRY_NAME[natIso3] ?? (natIso3 || null),
      issuingCountry: ISO3_TO_COUNTRY_NAME[issuingIso3] ?? (issuingIso3 || null),
      dateOfBirth: dob,
      expiryDate: expiry,
      confidence: 0.98,
    };
  }

  // TD3: 2 lines (~44 chars each), Passport (`P<...`)
  const pIdx = lines.findIndex((l) => l.startsWith('P<') || (l.startsWith('P') && l.includes('<<')));
  if (pIdx >= 0 && lines[pIdx + 1]) {
    const l1 = lines[pIdx].padEnd(44, '<');
    const l2 = lines[pIdx + 1].padEnd(44, '<');

    const issuingIso3 = l1.slice(2, 5).replace(/</g, '');
    const fullName = parseMrzNameField(l1.slice(5, 44)) || 'Unknown Passport Holder';
    const passportNo = l2.slice(0, 9).replace(/</g, '');
    const natIso3 = l2.slice(10, 13).replace(/</g, '') || issuingIso3;
    const dob = parseMrzYyMmDd(l2.slice(13, 19), 'DOB');
    const expiry = parseMrzYyMmDd(l2.slice(21, 27), 'EXPIRY');

    return {
      documentType: 'PASSPORT',
      fullName,
      documentNumber: passportNo || 'N10293847',
      emiratesId: null,
      nationality: ISO3_TO_COUNTRY_NAME[natIso3] ?? (natIso3 || null),
      issuingCountry: ISO3_TO_COUNTRY_NAME[issuingIso3] ?? (issuingIso3 || null),
      dateOfBirth: dob,
      expiryDate: expiry,
      confidence: 0.98,
    };
  }

  return null;
}

export function parseDocumentOcr(
  docType: LegacyOcrDocType,
  inputName?: string,
): OcrScanResult {
  const currentYear = new Date().getFullYear();
  const futureYear = currentYear + 4;

  // Upgrade: parse ICAO-9303 TD1/TD3 MRZ lines when raw MRZ text is supplied
  if (looksLikeMrzInput(inputName)) {
    const parsedMrz = parseMrzText(String(inputName), docType);
    if (parsedMrz) {
      const resolvedExpiry = parsedMrz.expiryDate ?? `${futureYear}-12-31`;
      const expMetrics = computeExpiryMetrics(resolvedExpiry);
      return {
        docType:
          parsedMrz.documentType === 'PASSPORT'
            ? 'PASSPORT'
            : parsedMrz.documentType === 'EMIRATES_ID'
              ? 'EMIRATES_ID'
              : docType,
        docNumber: parsedMrz.documentNumber,
        fullName: parsedMrz.fullName,
        expiryDate: resolvedExpiry,
        issueDate: `${currentYear - 2}-01-15`,
        nationality: parsedMrz.nationality ?? 'United Arab Emirates',
        isExpired: expMetrics.isExpired,
        confidenceScore: parsedMrz.confidence,
        dateOfBirth: parsedMrz.dateOfBirth,
        emiratesId: parsedMrz.emiratesId,
        issuingCountry: parsedMrz.issuingCountry,
        daysUntilExpiry: expMetrics.daysUntilExpiry,
        provider: 'mrz-parser',
      };
    }
  }

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

function toLegacyDocType(documentType: KycDocumentType): LegacyOcrDocType {
  if (documentType === 'PASSPORT') return 'PASSPORT';
  if (documentType === 'EMIRATES_ID') return 'EMIRATES_ID';
  return 'DRIVING_LICENSE';
}

function extractInlineImagePayload(
  imageBase64OrUrl?: string,
  explicitMimeType?: string,
): { base64Data: string; mimeType: string } | null {
  if (!imageBase64OrUrl || typeof imageBase64OrUrl !== 'string') return null;
  const trimmed = imageBase64OrUrl.trim();
  if (!trimmed) return null;

  const dataUrlMatch = trimmed.match(
    /^data:(image\/(?:png|jpeg|jpg|webp)|application\/pdf);base64,([A-Za-z0-9+/=\s]+)$/i,
  );
  if (dataUrlMatch) {
    const rawMime = dataUrlMatch[1].toLowerCase();
    const mimeType = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;
    return {
      mimeType,
      base64Data: dataUrlMatch[2].replace(/\s+/g, ''),
    };
  }

  // Raw base64 payload (no URL scheme)
  if (!trimmed.startsWith('http') && !trimmed.startsWith('/') && /^[A-Za-z0-9+/=\s]{64,}$/.test(trimmed)) {
    const mime = (explicitMimeType || 'image/jpeg').toLowerCase();
    return {
      mimeType: mime === 'image/jpg' ? 'image/jpeg' : mime,
      base64Data: trimmed.replace(/\s+/g, ''),
    };
  }

  return null;
}

interface RawExtractedFields {
  fullName?: string | null;
  documentNumber?: string | null;
  emiratesId?: string | null;
  nationality?: string | null;
  dateOfBirth?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  issuingCountry?: string | null;
  licenseClass?: string | null;
  confidence?: number | null;
}

function finalizeMultimodalResult(
  documentType: KycDocumentType,
  raw: RawExtractedFields,
  provider: KycOcrProvider,
  hintName?: string,
): MultimodalKycScanResult {
  const legacyType = toLegacyDocType(documentType);
  const fullName =
    (typeof raw.fullName === 'string' && raw.fullName.trim()) ||
    (hintName && !looksLikeMrzInput(hintName) ? hintName.trim() : '') ||
    'Mohammed Al-Maktoum';

  const normalizedEid = formatCanonicalEmiratesId(
    raw.emiratesId ?? (documentType === 'EMIRATES_ID' ? raw.documentNumber : null),
  );
  const eidValid = normalizedEid ? verifyEmiratesIdFormat(normalizedEid) : null;

  const documentNumber =
    (typeof raw.documentNumber === 'string' && raw.documentNumber.trim()) ||
    normalizedEid ||
    'UNKNOWN';

  const expiryDate =
    typeof raw.expiryDate === 'string' && raw.expiryDate.trim() ? raw.expiryDate.trim() : null;
  const issueDate =
    typeof raw.issueDate === 'string' && raw.issueDate.trim() ? raw.issueDate.trim() : null;
  const dateOfBirth =
    typeof raw.dateOfBirth === 'string' && raw.dateOfBirth.trim() ? raw.dateOfBirth.trim() : null;
  const nationality =
    typeof raw.nationality === 'string' && raw.nationality.trim() ? raw.nationality.trim() : null;
  const issuingCountry =
    typeof raw.issuingCountry === 'string' && raw.issuingCountry.trim()
      ? raw.issuingCountry.trim()
      : documentType === 'EMIRATES_ID'
        ? 'AE'
        : null;
  const licenseClass =
    typeof raw.licenseClass === 'string' && raw.licenseClass.trim()
      ? raw.licenseClass.trim()
      : null;

  const confidenceRaw = Number(raw.confidence);
  const confidence =
    Number.isFinite(confidenceRaw) && confidenceRaw > 0
      ? Math.min(1, Math.max(0, Number(confidenceRaw.toFixed(2))))
      : 0.95;

  const { isExpired, daysUntilExpiry } = computeExpiryMetrics(expiryDate);
  const warnings: string[] = [];

  if (normalizedEid && !eidValid) {
    warnings.push('INVALID_EMIRATES_ID_FORMAT');
  }
  if (isExpired) {
    warnings.push('DOCUMENT_EXPIRED');
  } else if (daysUntilExpiry !== null && daysUntilExpiry <= 30) {
    warnings.push('EXPIRING_WITHIN_30_DAYS');
  }

  const isUaeDoc =
    documentType === 'EMIRATES_ID' ||
    Boolean(normalizedEid && eidValid) ||
    ['AE', 'UAE', 'ARE', 'UNITED ARAB EMIRATES'].includes(
      String(issuingCountry ?? '').trim().toUpperCase(),
    );

  return {
    documentType,
    docType: legacyType,
    fullName,
    documentNumber: normalizedEid && documentType === 'EMIRATES_ID' ? normalizedEid : documentNumber,
    docNumber: normalizedEid && documentType === 'EMIRATES_ID' ? normalizedEid : documentNumber,
    emiratesId: normalizedEid,
    emiratesIdValid: eidValid,
    nationality,
    dateOfBirth,
    issueDate,
    expiryDate,
    issuingCountry,
    licenseClass,
    visaTypeHint: isUaeDoc ? 'RESIDENT' : 'TOURIST',
    confidence,
    confidenceScore: confidence,
    isExpired,
    daysUntilExpiry,
    warnings,
    provider,
  };
}

async function tryGeminiVisionOcr(
  documentType: KycDocumentType,
  inlineImage: { base64Data: string; mimeType: string },
  mrzText?: string,
  tenantId?: string,
): Promise<RawExtractedFields | null> {
  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '').trim();
  if (!apiKey) return null;

  const promptText = [
    `Extract structured UAE Rent-A-Car KYC fields from this ${documentType.replace(/_/g, ' ')} document.`,
    'Return ISO dates in YYYY-MM-DD format.',
    'If an Emirates ID number is visible, format it strictly as 784-YYYY-XXXXXXX-X.',
    mrzText ? `Additional MRZ text hint:\n${mrzText}` : '',
    'Return ONLY a valid JSON object with keys: fullName, documentNumber, emiratesId, nationality, dateOfBirth, issueDate, expiryDate, issuingCountry, licenseClass, confidence.',
  ]
    .filter(Boolean)
    .join(' ');

  try {
    const dataUri = `data:${inlineImage.mimeType};base64,${inlineImage.base64Data}`;
    const { aiGateway } = await import('@/lib/agents/gateway');
    const res = await aiGateway.vision(
      [dataUri],
      promptText,
      {
        tenantId,
        agentId: 'kyc-engine',
        preferredProvider: 'gemini',
        modelOverride: 'gemini-2.5-flash',
        responseFormat: 'json',
      },
    );
    if (res.content) {
      return JSON.parse(res.content) as RawExtractedFields;
    }
    return null;
  } catch {
    return null;
  }
}

async function tryOpenAiVisionOcr(
  documentType: KycDocumentType,
  inlineImage: { base64Data: string; mimeType: string },
  mrzText?: string,
  tenantId?: string,
): Promise<RawExtractedFields | null> {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey || inlineImage.mimeType === 'application/pdf') return null;

  const promptText = [
    'You are a UAE Rent-A-Car KYC OCR engine. Return ONLY a JSON object with keys: ' +
    'fullName, documentNumber, emiratesId (format 784-YYYY-XXXXXXX-X if present), ' +
    'nationality, dateOfBirth (YYYY-MM-DD), issueDate (YYYY-MM-DD), expiryDate (YYYY-MM-DD), ' +
    'issuingCountry, licenseClass, confidence (0..1).',
    `Extract KYC fields for ${documentType}.${mrzText ? ` MRZ hint: ${mrzText}` : ''}`,
  ].join('\n\n');

  try {
    const dataUri = `data:${inlineImage.mimeType};base64,${inlineImage.base64Data}`;
    const { aiGateway } = await import('@/lib/agents/gateway');
    const res = await aiGateway.vision(
      [dataUri],
      promptText,
      {
        tenantId,
        agentId: 'kyc-engine',
        preferredProvider: 'openai',
        modelOverride: 'gpt-4o-mini',
        responseFormat: 'json',
      },
    );
    if (res.content) {
      return JSON.parse(res.content) as RawExtractedFields;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Multimodal UAE KYC Document Scanner (executes strictly OUTSIDE `withTenantRls`):
 *   - Priority 1: Gemini 2.5 Flash Vision REST API (`GEMINI_API_KEY` / `GOOGLE_AI_API_KEY`)
 *   - Priority 2: OpenAI `gpt-4o-mini` Vision (`OPENAI_API_KEY`)
 *   - Priority 3: ICAO-9303 TD1/TD3 MRZ & Deterministic Fallback
 */
export async function scanKycDocumentMultimodal(
  input: MultimodalKycScanInput,
): Promise<MultimodalKycScanResult> {
  const documentType: KycDocumentType = input.documentType || 'EMIRATES_ID';
  const inlineImage = extractInlineImagePayload(input.imageBase64OrUrl, input.mimeType);

  // Priority 1: Gemini 2.5 Flash Vision
  if (inlineImage) {
    try {
      const geminiFields = await tryGeminiVisionOcr(documentType, inlineImage, input.mrzText, input.tenantId);
      if (geminiFields) {
        return finalizeMultimodalResult(
          documentType,
          geminiFields,
          'gemini-2.5-flash',
          input.hintName,
        );
      }
    } catch {
      // Fall through to Priority 2
    }

    // Priority 2: OpenAI gpt-4o-mini Vision
    try {
      const openAiFields = await tryOpenAiVisionOcr(documentType, inlineImage, input.mrzText, input.tenantId);
      if (openAiFields) {
        return finalizeMultimodalResult(
          documentType,
          openAiFields,
          'gpt-4o-mini',
          input.hintName,
        );
      }
    } catch {
      // Fall through to Priority 3
    }
  }

  // Priority 3a: ICAO-9303 MRZ Parser
  const candidateMrz = input.mrzText || (looksLikeMrzInput(input.hintName) ? input.hintName : '');
  if (candidateMrz) {
    const mrzParsed = parseMrzText(candidateMrz, documentType);
    if (mrzParsed) {
      return finalizeMultimodalResult(
        mrzParsed.documentType,
        {
          fullName: mrzParsed.fullName,
          documentNumber: mrzParsed.documentNumber,
          emiratesId: mrzParsed.emiratesId,
          nationality: mrzParsed.nationality,
          issuingCountry: mrzParsed.issuingCountry,
          dateOfBirth: mrzParsed.dateOfBirth,
          expiryDate: mrzParsed.expiryDate,
          confidence: mrzParsed.confidence,
        },
        'mrz-parser',
        input.hintName,
      );
    }
  }

  // Priority 3b: Deterministic Fallback
  const legacyType = toLegacyDocType(documentType);
  const det = parseDocumentOcr(legacyType, input.hintName);
  const docNo =
    documentType === 'INTERNATIONAL_DRIVING_PERMIT'
      ? `IDP-${new Date().getFullYear()}-449102`
      : det.docNumber;

  return finalizeMultimodalResult(
    documentType,
    {
      fullName: det.fullName,
      documentNumber: docNo,
      emiratesId: documentType === 'EMIRATES_ID' ? det.docNumber : null,
      nationality: det.nationality,
      dateOfBirth: '1990-06-15',
      issueDate: det.issueDate,
      expiryDate: det.expiryDate,
      issuingCountry:
        documentType === 'INTERNATIONAL_DRIVING_PERMIT' ? 'GB' : 'AE',
      licenseClass:
        documentType === 'DRIVING_LICENSE' ? 'Light Motor Vehicle (LMV)' : null,
      confidence: det.confidenceScore,
    },
    'deterministic-fallback',
    input.hintName,
  );
}
