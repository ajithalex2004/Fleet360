/**
 * Quotation Co-pilot Agent
 *
 * Turns a natural-language brief (in English or Arabic) into a structured
 * lease-quotation suggestion the user can review, tweak, and convert into
 * a real LeaseQuotation.
 *
 * Input examples:
 *   EN: "3 Toyota SUVs for 24 months, ~30,000 km/year, corporate client,
 *        include insurance and maintenance"
 *   AR: "أحتاج 3 سيارات دفع رباعي تويوتا لمدة 24 شهرًا..."
 *
 * Output: a SuggestedQuotation object validated against a Zod schema.
 * Uses OpenAI gpt-4o with structured outputs for reliability.
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { env, hasOpenAI } from '@/lib/env';

/* ── Output schema ───────────────────────────────────────────────────────── */

export const suggestedVehicleSchema = z.object({
  vehicleType: z.enum(['SEDAN', 'SUV', 'VAN', 'BUS', 'TRUCK', 'LUXURY', 'COMPACT', 'PICKUP']),
  make: z.string().describe('Suggested make, e.g. Toyota, Nissan, Mercedes-Benz'),
  model: z.string().describe('Suggested model, e.g. Land Cruiser, X-Trail, E-Class'),
  year: z.number().int().min(2020).max(2030).describe('Model year — typically current year for a new lease'),
  quantity: z.number().int().min(1).describe('How many of this vehicle'),
  monthlyRate: z.number().describe('Suggested monthly rate per vehicle in AED. Realistic UAE market rate.'),
  rationale: z.string().describe('1-2 sentences on why this vehicle fits the brief'),
});

export const suggestedQuotationSchema = z.object({
  leaseType: z.enum(['LONG_TERM', 'SHORT_TERM', 'DAILY', 'MONTHLY']),
  durationMonths: z.number().int().min(1).max(120),
  vehicles: z.array(suggestedVehicleSchema).min(1).max(20),
  mileageCapPerMonth: z.number().int().min(0).describe('Monthly mileage cap in km. Convert from annual if brief says km/year.'),
  insuranceCost: z.number().min(0).describe('Monthly cost in AED if requested; 0 if not requested'),
  maintenanceCost: z.number().min(0).describe('Monthly cost in AED if requested; 0 if not requested'),
  driverCost: z.number().min(0).describe('Monthly cost in AED if driver requested; 0 if not requested'),
  insuranceIncluded: z.boolean(),
  maintenanceIncluded: z.boolean(),
  driverIncluded: z.boolean(),
  securityDeposit: z.number().min(0).describe('Suggested security deposit in AED. Typically 1-2 months rent.'),
  pricingRationale: z.string().describe('Plain-language explanation of the pricing logic, 2-4 sentences'),
  detectedLanguage: z.enum(['en', 'ar', 'mixed']).describe('Language of the input brief'),
  confidence: z.enum(['low', 'medium', 'high']).describe('Self-assessed confidence based on how specific the brief was'),
  warnings: z.array(z.string()).describe('Anything ambiguous in the brief that the user should confirm'),
});

export type SuggestedVehicle = z.infer<typeof suggestedVehicleSchema>;
export type SuggestedQuotation = z.infer<typeof suggestedQuotationSchema>;

/* ── System prompt ───────────────────────────────────────────────────────── */

const SYSTEM_PROMPT = `You are a UAE-based vehicle leasing pricing co-pilot for a fleet leasing company. You help sales staff convert a natural-language customer brief into a structured lease quotation.

Rules:
1. Accept briefs in English, Arabic, or mixed. Detect the language and set detectedLanguage accordingly.
2. All monetary values are in AED (UAE Dirham). All distances in kilometres.
3. Use realistic UAE market rates. Reference points (monthly rate per vehicle):
   - Compact sedan (Yaris, Corolla): AED 1,800–2,500
   - Mid-size sedan (Camry, Altima): AED 2,500–3,500
   - SUV (Land Cruiser, Patrol, Pajero): AED 3,500–6,500
   - Compact SUV (X-Trail, Pathfinder): AED 2,800–4,200
   - Pickup truck (Hilux, Navara): AED 2,500–3,800
   - Van (Hiace, Urvan): AED 2,800–4,000
   - Mini-bus (Coaster): AED 4,500–7,500
   - Luxury (E-Class, 5-Series, Q7): AED 5,500–9,500
4. Mileage cap: if the brief gives km/year, divide by 12 for mileageCapPerMonth. Default cap if not specified: 2,500 km/month for sedans, 3,000 km/month for SUVs, 4,000 km/month for commercial.
5. Insurance: if brief asks for it, estimate AED 200–400/vehicle/month depending on segment. Otherwise 0 and insuranceIncluded=false.
6. Maintenance: AED 150–350/vehicle/month if requested. Otherwise 0.
7. Driver: AED 3,500–5,000/month per driver if requested.
8. Security deposit: typically 1 month's rent for B2C, can waive or reduce for established B2B clients. Use your judgment based on the brief.
9. Default leaseType: LONG_TERM if duration ≥ 12 months, MONTHLY if 1–11, SHORT_TERM if days/weeks mentioned.
10. The pricingRationale and per-vehicle rationale must be in the same language as the input brief.
11. If a number is genuinely ambiguous, populate warnings[] — do NOT make up numbers without indicating uncertainty.
12. Confidence: high if the brief specified vehicle type + count + duration + use case; medium if 2–3 of those; low if the brief is vague.

You will return a JSON object exactly matching the response schema provided. No prose, no markdown, no commentary outside the JSON.`;

/* ── Agent function ──────────────────────────────────────────────────────── */

export interface CopilotResult {
  ok: true;
  suggestion: SuggestedQuotation;
  modelUsed: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

export interface CopilotError {
  ok: false;
  error: string;
  detail?: unknown;
}

export async function generateQuotationSuggestion(brief: string): Promise<CopilotResult | CopilotError> {
  if (!hasOpenAI) {
    return {
      ok: false,
      error: 'AI Co-pilot unavailable — OPENAI_API_KEY not configured.',
    };
  }
  if (!brief || brief.trim().length < 10) {
    return {
      ok: false,
      error: 'Brief is too short. Provide at least one sentence describing the customer\'s needs.',
    };
  }

  const t0 = Date.now();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  // Convert Zod schema → JSON Schema for OpenAI structured outputs.
  const responseSchema = zodToOpenAiSchema();

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: brief.trim() },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'suggested_quotation',
          strict: true,
          schema: responseSchema,
        },
      },
      temperature: 0.2,
      max_tokens: 2000,
    });

    const raw = completion.choices[0]?.message?.content ?? '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'Co-pilot returned non-JSON output.', detail: raw };
    }

    const validated = suggestedQuotationSchema.safeParse(parsed);
    if (!validated.success) {
      return {
        ok: false,
        error: 'Co-pilot output failed schema validation.',
        detail: validated.error.issues,
      };
    }

    return {
      ok: true,
      suggestion: validated.data,
      modelUsed: completion.model,
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'OpenAI API error',
      detail: err,
    };
  }
}

/* ── Schema → OpenAI JSON Schema (manually mirrored — keep in sync) ─────── */

function zodToOpenAiSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'leaseType', 'durationMonths', 'vehicles', 'mileageCapPerMonth',
      'insuranceCost', 'maintenanceCost', 'driverCost',
      'insuranceIncluded', 'maintenanceIncluded', 'driverIncluded',
      'securityDeposit', 'pricingRationale', 'detectedLanguage', 'confidence', 'warnings',
    ],
    properties: {
      leaseType: { type: 'string', enum: ['LONG_TERM', 'SHORT_TERM', 'DAILY', 'MONTHLY'] },
      durationMonths: { type: 'integer', minimum: 1, maximum: 120 },
      vehicles: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['vehicleType', 'make', 'model', 'year', 'quantity', 'monthlyRate', 'rationale'],
          properties: {
            vehicleType: { type: 'string', enum: ['SEDAN', 'SUV', 'VAN', 'BUS', 'TRUCK', 'LUXURY', 'COMPACT', 'PICKUP'] },
            make: { type: 'string' },
            model: { type: 'string' },
            year: { type: 'integer', minimum: 2020, maximum: 2030 },
            quantity: { type: 'integer', minimum: 1 },
            monthlyRate: { type: 'number' },
            rationale: { type: 'string' },
          },
        },
      },
      mileageCapPerMonth: { type: 'integer', minimum: 0 },
      insuranceCost: { type: 'number', minimum: 0 },
      maintenanceCost: { type: 'number', minimum: 0 },
      driverCost: { type: 'number', minimum: 0 },
      insuranceIncluded: { type: 'boolean' },
      maintenanceIncluded: { type: 'boolean' },
      driverIncluded: { type: 'boolean' },
      securityDeposit: { type: 'number', minimum: 0 },
      pricingRationale: { type: 'string' },
      detectedLanguage: { type: 'string', enum: ['en', 'ar', 'mixed'] },
      confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      warnings: { type: 'array', items: { type: 'string' } },
    },
  };
}
