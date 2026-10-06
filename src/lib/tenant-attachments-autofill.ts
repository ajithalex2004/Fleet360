/**
 * Attachment autofill: read the Document Number and Expiry Date from an
 * uploaded tenant document (trade license, VAT certificate, …) with the AI
 * gateway's vision call, so the admin only has to check them.
 *
 * Suggestions only: nothing is stored here, the admin can edit every value,
 * and a value the model is unsure of is left empty rather than guessed.
 *
 * Off when the platform setting ff_attachment_autofill is 'false', when no
 * vision provider is configured, and for tenants whose data must stay in a
 * region (UAE / EU / US residency): the document would leave that region.
 */
import { aiGateway } from '@/lib/agents/gateway';
import { documentDataUrl } from '@/lib/agents/document-intelligence/pipeline/router';

export interface AutofillTypeInfo {
  code: string;
  name: string;
  requiresExpiry: boolean;
}

export type AutofillResult =
  | {
      status: 'ok';
      documentNumber: string | null;
      expiryDate: string | null;
      /** 0–1, as reported by the model. */
      confidence: number;
      /** Things the admin should look at (expired, wrong document, …). */
      warnings: string[];
    }
  | { status: 'skipped' | 'unavailable'; reason: string };

/** Below this the model's values are not offered. */
export const MIN_CONFIDENCE = 0.5;

/** What "document number" means for each seeded type; other types get a generic hint. */
const NUMBER_HINTS: Record<string, string> = {
  TRADE_LICENSE: 'the trade license number (often labelled "License No.", "Licence Number" or "رقم الرخصة")',
  COMMERCIAL_LICENSE: 'the commercial registration / license number (often "CR No.", "Registration No." or "رقم السجل التجاري")',
  VAT_CERTIFICATE: 'the Tax Registration Number (TRN), a 15-digit number (often "TRN" or "رقم التسجيل الضريبي")',
  PERMITS: 'the permit number',
};

export function autofillPrompt(type: AutofillTypeInfo): string {
  return [
    `The attached file should be a "${type.name}" for a company.`,
    `Read ${NUMBER_HINTS[type.code] ?? 'its main reference / document number'} and its expiry date`,
    '(often "Expiry Date", "Valid Until", "Expires On" or "تاريخ الانتهاء"). The document may be in English, Arabic or both.',
    'Reply with ONE JSON object and nothing else:',
    '{"documentNumber": string|null, "expiryDate": "YYYY-MM-DD"|null, "confidence": number between 0 and 1,',
    ' "documentKind": short description of what the document actually is, "matchesExpectedType": true|false}',
    'Use null for anything not clearly printed on the document. Never guess or invent values.',
    'Convert dates to YYYY-MM-DD (day/month order is the UAE convention, e.g. 31/12/2027 is 2027-12-31).',
  ].join('\n');
}

/** A real calendar date in YYYY-MM-DD, or null. */
export function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
    ? value.trim()
    : null;
}

/** Turn the model's reply into suggestions; anything malformed becomes null. */
export function parseAutofillReply(content: string, type: AutofillTypeInfo, today: string): AutofillResult {
  let parsed: Record<string, unknown>;
  try {
    const json = content.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
    const obj = JSON.parse(json.slice(json.indexOf('{'), json.lastIndexOf('}') + 1));
    if (!obj || typeof obj !== 'object') throw new Error('not an object');
    parsed = obj as Record<string, unknown>;
  } catch {
    return { status: 'unavailable', reason: 'The document could not be read.' };
  }

  const confidence = typeof parsed.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 1
    ? parsed.confidence : 0;
  const warnings: string[] = [];

  if (parsed.matchesExpectedType === false) {
    const kind = typeof parsed.documentKind === 'string' && parsed.documentKind.trim() ? ` (it looks like: ${parsed.documentKind.trim().slice(0, 80)})` : '';
    warnings.push(`This may not be a ${type.name}${kind}. Check that the right file was chosen.`);
  }
  if (confidence < MIN_CONFIDENCE) {
    return { status: 'ok', documentNumber: null, expiryDate: null, confidence, warnings: [...warnings, 'The document was hard to read: enter the details manually.'] };
  }

  let documentNumber = typeof parsed.documentNumber === 'string' ? parsed.documentNumber.trim().slice(0, 100) || null : null;
  if (documentNumber && type.code === 'VAT_CERTIFICATE') {
    const digits = documentNumber.replace(/\D/g, '');
    if (digits.length === 15) documentNumber = digits;
    else warnings.push('A TRN has 15 digits: check the number that was read.');
  }

  const expiryDate = normalizeDate(parsed.expiryDate);
  if (expiryDate && expiryDate < today) warnings.push(`This document appears to have expired on ${expiryDate}.`);
  if (!expiryDate && type.requiresExpiry) warnings.push('No expiry date was found: enter it manually.');

  return { status: 'ok', documentNumber, expiryDate, confidence, warnings };
}

/** Read the suggestions from a document. Never throws. */
export async function autofillAttachment(
  file: { base64: string; mimeType: string; fileName: string },
  type: AutofillTypeInfo,
  today = new Date().toISOString().slice(0, 10),
): Promise<AutofillResult> {
  if (!process.env.OPENAI_API_KEY) return { status: 'unavailable', reason: 'Document reading is not configured.' };
  try {
    const res = await aiGateway.vision(
      [documentDataUrl(file.base64, file.mimeType)],
      autofillPrompt(type),
      {
        systemPrompt: 'You read UAE company documents and return only the JSON asked for.',
        capabilityAlias: 'VISION_HIGH_ACCURACY',
        detail: 'high',
        maxTokens: 300,
        temperature: 0,
        timeoutMs: 30_000,
      },
    );
    return parseAutofillReply(res.content, type, today);
  } catch (e) {
    console.warn('[attachment-autofill] vision call failed:', e instanceof Error ? e.message : e);
    return { status: 'unavailable', reason: 'The document could not be read right now.' };
  }
}
