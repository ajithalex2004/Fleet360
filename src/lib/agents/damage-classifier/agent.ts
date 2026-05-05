/**
 * Vehicle Damage Classifier Agent (gpt-4o vision)
 *
 * Two operating modes:
 *   1. SINGLE — one photo, agent identifies all visible damage and
 *               estimates repair cost in AED using the UAE bodyshop index.
 *   2. DIFF   — before + after photos, agent isolates NEW damage that
 *               wasn't present at handover. Closes the #1 customer-dispute
 *               area in RAC: "this damage was already there."
 *
 * Each detected damage gets:
 *   - damageType: SCRATCH | DENT | BROKEN_GLASS | FLAT_TIRE | BUMPER_DAMAGE
 *                 | MIRROR_DAMAGE | LIGHT_DAMAGE | INTERIOR_STAIN
 *                 | INTERIOR_TEAR | MISSING_PART | PAINT_CHIP | RUST | OTHER
 *   - location: 16-panel vehicle silhouette (FRONT_BUMPER, REAR_BUMPER,
 *               FRONT_LEFT_DOOR, ROOF, HOOD, INTERIOR_SEAT, etc.)
 *   - severity: MINOR | MODERATE | MAJOR | TOTAL_LOSS
 *   - estimatedCost{Min,Max}: AED range from the embedded UAE price index
 *   - confidence: low | medium | high
 *
 * Cost note: gpt-4o vision is ~$0.005-$0.01 per image at high detail.
 * RAC operator handing over 30 cars/day with before+after photos at
 * AED 0.04/comparison = ~AED 35/month.
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { env, hasOpenAI } from '@/lib/env';

/* ── Output schemas ─────────────────────────────────────────────────────── */

export const damageItemSchema = z.object({
  damageType: z.enum([
    'SCRATCH', 'DENT', 'BROKEN_GLASS', 'FLAT_TIRE', 'BUMPER_DAMAGE',
    'MIRROR_DAMAGE', 'LIGHT_DAMAGE', 'INTERIOR_STAIN', 'INTERIOR_TEAR',
    'MISSING_PART', 'PAINT_CHIP', 'RUST', 'WHEEL_DAMAGE', 'OTHER',
  ]),
  location: z.enum([
    'FRONT_BUMPER', 'REAR_BUMPER', 'HOOD', 'ROOF', 'TRUNK',
    'FRONT_LEFT_DOOR', 'FRONT_RIGHT_DOOR', 'REAR_LEFT_DOOR', 'REAR_RIGHT_DOOR',
    'FRONT_LEFT_FENDER', 'FRONT_RIGHT_FENDER', 'REAR_LEFT_QUARTER', 'REAR_RIGHT_QUARTER',
    'WINDSHIELD', 'REAR_WINDOW', 'SIDE_MIRROR_LEFT', 'SIDE_MIRROR_RIGHT',
    'HEADLIGHT_LEFT', 'HEADLIGHT_RIGHT', 'TAILLIGHT_LEFT', 'TAILLIGHT_RIGHT',
    'WHEEL_FRONT_LEFT', 'WHEEL_FRONT_RIGHT', 'WHEEL_REAR_LEFT', 'WHEEL_REAR_RIGHT',
    'INTERIOR_SEAT', 'INTERIOR_DASHBOARD', 'INTERIOR_FLOOR', 'INTERIOR_OTHER',
    'UNKNOWN',
  ]),
  severity: z.enum(['MINOR', 'MODERATE', 'MAJOR', 'TOTAL_LOSS']),
  description: z.string().describe('Plain-language description, e.g. "10cm horizontal scratch on the rear bumper"'),
  estimatedCostMin: z.number().min(0).describe('Lower-bound AED estimate from UAE bodyshop index'),
  estimatedCostMax: z.number().min(0).describe('Upper-bound AED estimate'),
  confidence: z.enum(['low', 'medium', 'high']),
  /** Only present in DIFF mode: where the damage came from. */
  origin: z.enum(['NEW', 'PRE_EXISTING', 'REPAIRED']).nullable(),
});
export type DamageItem = z.infer<typeof damageItemSchema>;

export const damageClassificationSchema = z.object({
  mode: z.enum(['SINGLE', 'DIFF']),
  vehicleLooksRoadworthy: z.boolean().describe('Best-effort assessment: would this car be safe to drive away?'),
  overallCondition: z.enum(['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'NON_DRIVEABLE']),
  damages: z.array(damageItemSchema),
  summaryEn: z.string().describe('2-3 sentence summary in English'),
  summaryAr: z.string().describe('2-3 sentence summary in Arabic'),
  /** Sum of estimatedCostMin/Max across damages with origin=NEW (or all if SINGLE mode). */
  billableEstimateMin: z.number().min(0),
  billableEstimateMax: z.number().min(0),
  /** Currency for all estimates. */
  currency: z.string().default('AED'),
  /** Anything illegible / ambiguous. */
  warnings: z.array(z.string()),
});
export type DamageClassification = z.infer<typeof damageClassificationSchema>;

/* ── System prompt ───────────────────────────────────────────────────────── */

const SYSTEM_PROMPT = `You are a UAE-based vehicle damage assessor for a Rent-A-Car platform. You receive ONE or TWO photos of a rental vehicle and identify visible damage.

Two modes:
- SINGLE: one photo. List every visible damage with origin=null.
- DIFF: two photos labeled BEFORE_HANDOVER and AFTER_RETURN. For each damage:
  * origin=NEW       — present only in AFTER (this is what gets billed to customer)
  * origin=PRE_EXISTING — present in both photos (already known damage, not billable)
  * origin=REPAIRED  — present in BEFORE but not AFTER (not relevant to current claim)

UAE bodyshop price index (use these ranges for estimatedCostMin/Max in AED):
- Light scratch (touch-up + polish):                200–500
- Deep scratch (paint required, single panel):      800–1,500
- Small dent (PDR, no paint damage):                300–800
- Large dent (with paint repair, single panel):     1,200–3,500
- Bumper repair (cosmetic):                         800–2,500
- Bumper replacement:                               2,000–8,000
- Side mirror replacement:                          600–2,500   (premium models 2k-5k)
- Windshield replacement:                           1,500–4,500
- Headlight replacement (each):                     1,500–5,000  (LED/xenon higher)
- Taillight replacement:                            500–2,500
- Single panel respray:                             1,500–3,500
- Interior stain (professional clean):              200–500
- Interior tear / reupholstery (single seat):       800–3,000
- Wheel/rim damage (refurbish):                     250–800
- Tire replacement (basic):                         250–600
- Tire replacement (premium):                       800–2,500
- Missing part (cap, badge, trim):                  100–600

Rules:
1. Only flag damage that is actually visible — do NOT speculate about damage hidden in shadows or angles.
2. Use UNKNOWN for location only if you genuinely can't tell (e.g. extreme close-up).
3. severity:
   - MINOR: cosmetic only, vehicle fully driveable, < AED 1,000
   - MODERATE: noticeable cosmetic, minor functional impact, AED 1,000–4,000
   - MAJOR: significant repair needed, may affect driveability, AED 4,000–15,000
   - TOTAL_LOSS: write-off territory, > AED 15,000 or non-economical to repair
4. vehicleLooksRoadworthy: false if any TOTAL_LOSS, broken windshield + driver-side, missing wheel, etc.
5. summaryEn AND summaryAr both required — translate to Arabic, don't return null.
6. In DIFF mode, billableEstimateMin/Max should be the SUM of NEW damages only. In SINGLE mode, it's the sum of ALL damages.
7. If you cannot identify any damage, return damages=[] with appropriate summary and overallCondition=GOOD.
8. Use warnings[] for image quality / lighting / angle issues that affect confidence.

Return JSON exactly matching the schema. No prose, no markdown.`;

/* ── JSON schema for OpenAI strict mode ─────────────────────────────────── */

function jsonSchema(): Record<string, unknown> {
  const damageItemJson = {
    type: 'object',
    additionalProperties: false,
    required: [
      'damageType', 'location', 'severity', 'description',
      'estimatedCostMin', 'estimatedCostMax', 'confidence', 'origin',
    ],
    properties: {
      damageType: {
        type: 'string',
        enum: [
          'SCRATCH', 'DENT', 'BROKEN_GLASS', 'FLAT_TIRE', 'BUMPER_DAMAGE',
          'MIRROR_DAMAGE', 'LIGHT_DAMAGE', 'INTERIOR_STAIN', 'INTERIOR_TEAR',
          'MISSING_PART', 'PAINT_CHIP', 'RUST', 'WHEEL_DAMAGE', 'OTHER',
        ],
      },
      location: {
        type: 'string',
        enum: [
          'FRONT_BUMPER', 'REAR_BUMPER', 'HOOD', 'ROOF', 'TRUNK',
          'FRONT_LEFT_DOOR', 'FRONT_RIGHT_DOOR', 'REAR_LEFT_DOOR', 'REAR_RIGHT_DOOR',
          'FRONT_LEFT_FENDER', 'FRONT_RIGHT_FENDER', 'REAR_LEFT_QUARTER', 'REAR_RIGHT_QUARTER',
          'WINDSHIELD', 'REAR_WINDOW', 'SIDE_MIRROR_LEFT', 'SIDE_MIRROR_RIGHT',
          'HEADLIGHT_LEFT', 'HEADLIGHT_RIGHT', 'TAILLIGHT_LEFT', 'TAILLIGHT_RIGHT',
          'WHEEL_FRONT_LEFT', 'WHEEL_FRONT_RIGHT', 'WHEEL_REAR_LEFT', 'WHEEL_REAR_RIGHT',
          'INTERIOR_SEAT', 'INTERIOR_DASHBOARD', 'INTERIOR_FLOOR', 'INTERIOR_OTHER',
          'UNKNOWN',
        ],
      },
      severity: { type: 'string', enum: ['MINOR', 'MODERATE', 'MAJOR', 'TOTAL_LOSS'] },
      description: { type: 'string' },
      estimatedCostMin: { type: 'number', minimum: 0 },
      estimatedCostMax: { type: 'number', minimum: 0 },
      confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      origin: { type: ['string', 'null'], enum: ['NEW', 'PRE_EXISTING', 'REPAIRED', null] },
    },
  };

  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'mode', 'vehicleLooksRoadworthy', 'overallCondition', 'damages',
      'summaryEn', 'summaryAr', 'billableEstimateMin', 'billableEstimateMax',
      'currency', 'warnings',
    ],
    properties: {
      mode: { type: 'string', enum: ['SINGLE', 'DIFF'] },
      vehicleLooksRoadworthy: { type: 'boolean' },
      overallCondition: { type: 'string', enum: ['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'NON_DRIVEABLE'] },
      damages: { type: 'array', items: damageItemJson, maxItems: 30 },
      summaryEn: { type: 'string' },
      summaryAr: { type: 'string' },
      billableEstimateMin: { type: 'number', minimum: 0 },
      billableEstimateMax: { type: 'number', minimum: 0 },
      currency: { type: 'string' },
      warnings: { type: 'array', items: { type: 'string' } },
    },
  };
}

/* ── Agent function ──────────────────────────────────────────────────────── */

const SUPPORTED_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

export interface ClassifyDamageInput {
  /** Single mode: 1 image. Diff mode: [before, after]. */
  images: Array<{ buffer: Buffer; mimeType: string; label?: 'BEFORE_HANDOVER' | 'AFTER_RETURN' | 'PHOTO' }>;
}

export interface ClassifyDamageResult {
  ok: true;
  classification: DamageClassification;
  modelUsed: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}
export interface ClassifyDamageError {
  ok: false;
  error: string;
  detail?: unknown;
}

export async function classifyDamage(
  input: ClassifyDamageInput,
): Promise<ClassifyDamageResult | ClassifyDamageError> {
  if (!hasOpenAI) {
    return { ok: false, error: 'AI Damage Classifier unavailable — OPENAI_API_KEY not configured.' };
  }
  if (!input.images || input.images.length === 0 || input.images.length > 2) {
    return { ok: false, error: 'Send 1 image (single mode) or 2 images (diff mode).' };
  }
  for (const img of input.images) {
    if (!SUPPORTED_MIMES.has(img.mimeType.toLowerCase())) {
      return {
        ok: false,
        error: `Unsupported MIME type: ${img.mimeType}. Use PNG, JPEG, or WebP.`,
      };
    }
  }

  const t0 = Date.now();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const mode = input.images.length === 2 ? 'DIFF' : 'SINGLE';

  // Build user message: instruction + N images, each labeled.
  const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
  if (mode === 'DIFF') {
    userContent.push({
      type: 'text',
      text: `DIFF mode. Image 1 = BEFORE_HANDOVER (vehicle condition at start of rental). Image 2 = AFTER_RETURN (condition at return). Identify NEW damage in image 2 not present in image 1, and bill only those.`,
    });
  } else {
    userContent.push({
      type: 'text',
      text: 'SINGLE mode. Identify all visible damage in this photo. Set origin=null on each damage item.',
    });
  }
  for (const img of input.images) {
    const dataUrl = `data:${img.mimeType};base64,${img.buffer.toString('base64')}`;
    userContent.push({
      type: 'image_url',
      image_url: { url: dataUrl, detail: 'high' },
    });
  }

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'damage_classification', strict: true, schema: jsonSchema() },
      },
      temperature: 0.1,
      max_tokens: 2500,
    });

    const raw = completion.choices[0]?.message?.content ?? '';
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { return { ok: false, error: 'Classifier returned non-JSON output.', detail: raw }; }

    const validated = damageClassificationSchema.safeParse(parsed);
    if (!validated.success) {
      return {
        ok: false,
        error: 'Classifier output failed schema validation.',
        detail: validated.error.issues,
      };
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
