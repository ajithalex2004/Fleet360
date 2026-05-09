/**
 * Document Auto-Classification Agent (gpt-4o vision)
 *
 * Pass a UAE compliance document (Trade License, Emirates ID, Mulkiya,
 * insurance certificate, driving license, etc.) as a base64-encoded image
 * and the agent returns:
 *   - docType (mapped to the LeaseDocument enum)
 *   - extracted fields (number, holder name in EN+AR, expiry, etc.)
 *   - confidence
 *
 * Supported inputs: PNG, JPEG, WebP. PDF support deferred to v1.1
 * (would require pdf-poppler / Ghostscript to rasterise the first page).
 *
 * Cost note: gpt-4o vision is ~$0.005 per low-detail image. STS at
 * 200-vehicle scale + KYC doc renewals = ~AED 5-15/month in vision spend.
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { env, hasOpenAI } from '@/lib/env';

/* ── Output schema ───────────────────────────────────────────────────────── */

export const classifiedDocumentSchema = z.object({
  docType: z.enum([
    'TRADE_LICENSE',
    'EMIRATES_ID',
    'PASSPORT',
    'MOA',
    'SIGNED_AGREEMENT',
    'INSURANCE',
    'VEHICLE_PHOTO',
    'MULKIYA',           // UAE vehicle registration
    'DRIVING_LICENSE',
    'OTHER',
  ]),
  /** Concise human-readable name. */
  suggestedName: z.string().describe('e.g. "Trade License — ABC Trading LLC", "EID — Ahmed Al-Mansouri"'),
  /** Holder's name in English if present (or transliterated). */
  holderNameEn: z.string().nullable().describe('Latin script name; null if not legible'),
  /** Holder's name in Arabic if present. */
  holderNameAr: z.string().nullable().describe('Arabic script name; null if not present'),
  /** The primary identifier on the document (license no., EID no., plate no., etc.). */
  documentNumber: z.string().nullable(),
  /** Issue date if printed on the document. */
  issueDate: z.string().nullable().describe('ISO YYYY-MM-DD or null'),
  /** Expiry date if printed on the document — critical for renewal alerts. */
  expiryDate: z.string().nullable().describe('ISO YYYY-MM-DD or null'),
  /** UAE emirate of issue (DUBAI, ABU_DHABI, SHARJAH, etc.) when applicable. */
  emirate: z.string().nullable(),
  /** Issuing authority (RTA, MOI, DED, etc.) when applicable. */
  issuingAuthority: z.string().nullable(),
  /** Doc-type-specific fields (insurer name, policy no., vehicle plate, etc.). */
  additionalFields: z.record(z.string(), z.string()).describe('e.g. { insurer: "Oman Insurance", policyNumber: "POL-..." }'),
  confidence: z.enum(['low', 'medium', 'high']),
  /** Notes about anything illegible or uncertain. */
  warnings: z.array(z.string()),
});
export type ClassifiedDocument = z.infer<typeof classifiedDocumentSchema>;

/* ── System prompt ───────────────────────────────────────────────────────── */

const SYSTEM_PROMPT = `You are a UAE compliance document classifier for a vehicle leasing platform. You receive a single image of a document and extract its key fields.

UAE document types you will encounter most often:
1. TRADE_LICENSE — Issued by DED (Dubai Economic Department), DAFZA, JAFZA, or other free zones.
   Look for: company name (English + Arabic), license number (often "CN-XXXXXXX" or 6-digit), issue date, expiry date,
   issuing authority logo, list of activities. Issuing authority is usually printed at top.
2. EMIRATES_ID — Federal Authority for Identity & Citizenship.
   Look for: 15-digit ID number formatted "784-YYYY-XXXXXXX-X", holder name in EN + AR,
   nationality, date of birth, expiry, signature panel, photo.
3. MULKIYA — Vehicle registration card (RTA Dubai, ADP Abu Dhabi, etc.).
   Look for: plate number, owner name, vehicle make/model, chassis (VIN), engine, registration expiry date.
4. INSURANCE — Motor insurance certificate.
   Look for: insurer name, policy number, vehicle plate, coverage type, period (start + end dates).
5. DRIVING_LICENSE — RTA / MOI driving licence.
   Look for: license number, holder name EN + AR, nationality, classes, issue + expiry dates, photo.
6. PASSPORT — Standard passport bio page.
7. MOA — Memorandum of Association (corporate constitutional document, longer-form).
8. SIGNED_AGREEMENT — A signed lease agreement.
9. VEHICLE_PHOTO — Just a photo of a vehicle (e.g., damage assessment).
10. OTHER — Anything that doesn't fit.

Critical rules:
- If you cannot reasonably classify the doc, set docType=OTHER and confidence=low rather than guessing.
- Dates: always return ISO YYYY-MM-DD. UAE documents commonly use DD/MM/YYYY format — convert it.
- holderNameAr should be in Arabic script. holderNameEn in Latin script.
- If a field is illegible, set null and add an entry to warnings[].
- additionalFields should capture doc-type-specific data not in the top-level fields:
  * INSURANCE: { insurer, policyNumber, coverageType, vehiclePlate }
  * MULKIYA: { plateNumber, vehicleMake, vehicleModel, chassisNumber, engineNumber }
  * TRADE_LICENSE: { activities }  (truncated list ok)
  * DRIVING_LICENSE: { licenseClass }
- suggestedName format: "<DocType label> — <key identifier>", e.g. "Trade License — ABC Trading LLC".

Return the JSON exactly matching the schema. No prose, no markdown.`;

/* ── Schema → OpenAI JSON Schema (manually mirrored) ─────────────────────── */

function jsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'docType', 'suggestedName',
      'holderNameEn', 'holderNameAr',
      'documentNumber', 'issueDate', 'expiryDate',
      'emirate', 'issuingAuthority',
      'additionalFields', 'confidence', 'warnings',
    ],
    properties: {
      docType: {
        type: 'string',
        enum: [
          'TRADE_LICENSE', 'EMIRATES_ID', 'PASSPORT', 'MOA',
          'SIGNED_AGREEMENT', 'INSURANCE', 'VEHICLE_PHOTO',
          'MULKIYA', 'DRIVING_LICENSE', 'OTHER',
        ],
      },
      suggestedName: { type: 'string' },
      holderNameEn: { type: ['string', 'null'] },
      holderNameAr: { type: ['string', 'null'] },
      documentNumber: { type: ['string', 'null'] },
      issueDate: { type: ['string', 'null'] },
      expiryDate: { type: ['string', 'null'] },
      emirate: { type: ['string', 'null'] },
      issuingAuthority: { type: ['string', 'null'] },
      additionalFields: {
        type: 'object',
        additionalProperties: { type: 'string' },
      },
      confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      warnings: { type: 'array', items: { type: 'string' } },
    },
  };
}

/* ── Agent function ──────────────────────────────────────────────────────── */

const SUPPORTED_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

export interface ClassifyInput {
  /** Raw file bytes. */
  buffer: Buffer;
  mimeType: string;
  /** Optional: tell the model what we expect (improves accuracy when known). */
  expectedDocType?: string;
}

export interface ClassifyResult {
  ok: true;
  classification: ClassifiedDocument;
  modelUsed: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}
export interface ClassifyError {
  ok: false;
  error: string;
  detail?: unknown;
}

export async function classifyDocument(input: ClassifyInput): Promise<ClassifyResult | ClassifyError> {
  if (!hasOpenAI) {
    return { ok: false, error: 'AI Doc Classifier unavailable — OPENAI_API_KEY not configured.' };
  }
  if (!SUPPORTED_MIMES.has(input.mimeType.toLowerCase())) {
    return {
      ok: false,
      error: `Unsupported MIME type: ${input.mimeType}. v1.0 supports PNG, JPEG, WebP only — PDF support is in the v1.1 backlog.`,
    };
  }

  const t0 = Date.now();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  const dataUrl = `data:${input.mimeType};base64,${input.buffer.toString('base64')}`;

  const userText = input.expectedDocType
    ? `Classify this document. The user has indicated this should be of type ${input.expectedDocType}. Confirm or correct.`
    : 'Classify this UAE compliance document and extract its fields.';

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            // Use detail: 'high' so small Arabic / printed numbers are readable.
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
          ],
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'classified_document', strict: true, schema: jsonSchema() },
      },
      temperature: 0.1, // be conservative
      max_tokens: 1500,
    });

    const raw = completion.choices[0]?.message?.content ?? '';
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { return { ok: false, error: 'Classifier returned non-JSON output.', detail: raw }; }

    const validated = classifiedDocumentSchema.safeParse(parsed);
    if (!validated.success) {
      return { ok: false, error: 'Classifier output failed schema validation.', detail: validated.error.issues };
    }

    return {
      ok: true,
      classification: validated.data,
      modelUsed: completion.model,
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'OpenAI vision API error',
      detail: err,
    };
  }
}

/**
 * Map the agent's docType to the LeaseDocument schema's docType enum.
 * The schema (LeaseDocument) doesn't currently include MULKIYA or
 * DRIVING_LICENSE — both fall back to OTHER until v1.1 schema migration.
 */
export function mapToLeaseDocType(c: ClassifiedDocument['docType']): string {
  if (c === 'MULKIYA' || c === 'DRIVING_LICENSE') return 'OTHER';
  return c;
}
