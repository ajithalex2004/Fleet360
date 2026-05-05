/**
 * RAC Quote Co-pilot Agent
 *
 * Turns a natural-language rental brief (English or Arabic) into a structured
 * rental booking proposal with priced ancillaries and channel-aware pricing.
 *
 * Input examples:
 *   EN: "1 SUV for a Saudi tourist family, pickup DXB Saturday 09:00, return
 *        next Friday 18:00, GPS + child seat, no driver"
 *   AR: "أحتاج سيارة دفع رباعي لعائلة من السعودية..."
 *
 * Output: SuggestedRental matching the schema below (Zod-validated, OpenAI
 * structured outputs in strict mode).
 *
 * Differences from the leasing co-pilot:
 *   - Daily / weekly / monthly rates (not monthly only)
 *   - Vehicle category (not specific make/model — that's allocated at handover)
 *   - Ancillary line items (GPS, child seat, additional driver, cross-border, Salik)
 *   - Insurance waiver tier (CDW / LDW / TP)
 *   - Channel detection (DIRECT / CORPORATE / AGENCY / ONLINE)
 *   - Length-of-rental discount ladder applied automatically
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { env, hasOpenAI } from '@/lib/env';

/* ── Output schema ───────────────────────────────────────────────────────── */

export const ancillarySchema = z.object({
  code: z.enum([
    'GPS', 'CHILD_SEAT', 'BOOSTER_SEAT', 'ADDITIONAL_DRIVER',
    'YOUNG_DRIVER_SURCHARGE', 'CROSS_BORDER_OMAN', 'CROSS_BORDER_SAUDI',
    'CROSS_BORDER_QATAR', 'SALIK_TAG', 'DELIVERY_PICKUP',
    'AIRPORT_PICKUP_FEE', 'EXTRA_KM_PACK', 'FUEL_PRE_PAID', 'WIFI_HOTSPOT',
  ]),
  description: z.string().describe('Human-readable label, language-matched to the brief'),
  quantity: z.number().int().min(1),
  unitCharge: z.number().min(0).describe('Charge per unit per day in AED, or one-time charge'),
  isOneTime: z.boolean().describe('True if charged once for the whole rental, false if per-day'),
  totalCharge: z.number().min(0).describe('quantity × unitCharge × (isOneTime ? 1 : days)'),
});

export const suggestedRentalSchema = z.object({
  vehicleCategory: z.enum([
    'ECONOMY', 'COMPACT', 'MID_SIZE_SEDAN', 'FULL_SIZE_SEDAN',
    'COMPACT_SUV', 'STANDARD_SUV', 'FULL_SIZE_SUV', 'LUXURY_SEDAN', 'LUXURY_SUV',
    'VAN', 'PICKUP', 'MINI_BUS',
  ]),
  exampleVehicles: z.array(z.string()).min(1).describe('e.g. ["Toyota Land Cruiser", "Nissan Patrol"] — sample makes/models in this category'),
  pickupLocation: z.string().describe('Best-effort interpreted from brief; e.g. "Dubai Airport (DXB)", "Sharjah City"'),
  dropoffLocation: z.string().describe('Same — falls back to pickupLocation if not specified'),
  pickupDate: z.string().describe('ISO YYYY-MM-DD, best-effort if relative date is given'),
  dropoffDate: z.string().describe('ISO YYYY-MM-DD'),
  totalDays: z.number().int().min(1),
  channel: z.enum(['DIRECT', 'CORPORATE', 'AGENCY', 'ONLINE']),
  baseDailyRate: z.number().min(0).describe('Rate before LoR discount, in AED'),
  appliedDailyRate: z.number().min(0).describe('After length-of-rental discount applied'),
  lorDiscountPct: z.number().min(0).max(100).describe('Length-of-rental discount %'),
  baseRentalCharge: z.number().min(0).describe('appliedDailyRate × totalDays'),
  insuranceTier: z.enum(['MINIMUM', 'CDW', 'LDW', 'TP', 'PAI', 'SUPER_CDW']),
  insuranceCharge: z.number().min(0).describe('Daily insurance charge × totalDays in AED'),
  ancillaries: z.array(ancillarySchema),
  ancillariesTotal: z.number().min(0),
  subTotal: z.number().min(0).describe('base + insurance + ancillaries'),
  vatPct: z.number().min(0).max(100).default(5),
  vatAmount: z.number().min(0),
  totalAmount: z.number().min(0).describe('subTotal + VAT'),
  securityDeposit: z.number().min(0).describe('Refundable hold; typical 1500-5000 AED depending on category'),
  pricingRationale: z.string().describe('2-4 sentences explaining the pricing logic. Match brief language.'),
  detectedLanguage: z.enum(['en', 'ar', 'mixed']),
  confidence: z.enum(['low', 'medium', 'high']),
  warnings: z.array(z.string()).describe('Anything ambiguous — confirm with customer'),
});

export type Ancillary = z.infer<typeof ancillarySchema>;
export type SuggestedRental = z.infer<typeof suggestedRentalSchema>;

/* ── System prompt ───────────────────────────────────────────────────────── */

const SYSTEM_PROMPT = `You are a UAE-based Rent-A-Car (RAC) booking co-pilot for a fleet rental company. Convert a natural-language customer brief into a structured rental booking proposal.

Rules:
1. Accept briefs in English, Arabic, or mixed. Set detectedLanguage accordingly.
2. All money is in AED. Distances in km.
3. Use realistic UAE daily rental rates by category (per vehicle per day):
   - ECONOMY (Yaris/Sunny/Picanto):                AED  80–130
   - COMPACT (Corolla/Sentra/Elantra):             AED 100–150
   - MID_SIZE_SEDAN (Camry/Altima/Sonata):         AED 130–200
   - FULL_SIZE_SEDAN (Avalon/Maxima):              AED 200–280
   - COMPACT_SUV (X-Trail/CX-5/Tucson):            AED 180–280
   - STANDARD_SUV (Pajero/Pathfinder/Forester):    AED 220–350
   - FULL_SIZE_SUV (Patrol/Land Cruiser/Tahoe):    AED 300–550
   - LUXURY_SEDAN (E-Class/5-Series/A6):           AED 400–650
   - LUXURY_SUV (X5/GLE/Q7/Range Rover):           AED 550–950
   - VAN (Hiace/Urvan/H1):                         AED 220–350
   - PICKUP (Hilux/Navara/Frontier):               AED 180–280
   - MINI_BUS (Coaster):                           AED 350–550

4. Length-of-rental discount ladder (apply automatically):
   - 1–3 days:    full base rate, lorDiscountPct=0
   - 4–7 days:    -10%
   - 8–14 days:   -15%
   - 15–29 days:  -20%
   - 30+ days:    -30% (effectively monthly rate)
   appliedDailyRate = baseDailyRate × (1 - lorDiscountPct/100), rounded to nearest AED.

5. Insurance tier defaults (per vehicle per day):
   - MINIMUM (basic third-party only):  AED 0  (already in base rate)
   - CDW  (Collision Damage Waiver, 2,000 AED excess):    AED 30–50
   - LDW  (Loss Damage Waiver, no theft excess):           AED 40–70
   - TP   (Theft Protection):                              AED 20–40
   - PAI  (Personal Accident Insurance):                   AED 15–30
   - SUPER_CDW (zero excess, all-inclusive):              AED 80–150
   Default to CDW unless brief says otherwise. Higher tier for luxury vehicles.

6. Common ancillaries (charge × per day unless noted):
   - GPS:                       AED 25/day
   - CHILD_SEAT:                AED 30/day
   - BOOSTER_SEAT:              AED 25/day
   - ADDITIONAL_DRIVER:         AED 50/day
   - YOUNG_DRIVER_SURCHARGE:    AED 70/day (if driver under 25)
   - CROSS_BORDER_OMAN:         AED 200 one-time
   - CROSS_BORDER_SAUDI:        AED 350 one-time
   - CROSS_BORDER_QATAR:        AED 350 one-time
   - SALIK_TAG:                 AED 15/day + actual tolls passed through
   - DELIVERY_PICKUP:           AED 100–200 one-time per leg
   - AIRPORT_PICKUP_FEE:        AED 75 one-time
   - EXTRA_KM_PACK (200km/day): AED 50/day
   - FUEL_PRE_PAID:             AED 200–400 one-time depending on tank
   - WIFI_HOTSPOT:              AED 35/day

7. Channel detection:
   - "tourist", "agency", "OTA", "online" → ONLINE
   - "corporate", "company", "fleet" → CORPORATE
   - "travel agent", "Hala", "Booking.com" → AGENCY
   - default → DIRECT (counter walk-in)

8. Security deposit: 1× to 2× total rental amount, rounded to nearest 500 AED. Higher for luxury.

9. VAT: 5% on subTotal.

10. Compute pickup/dropoff dates: if brief says "Saturday to Friday" or relative dates, interpret as the next instance of that day from today's date, in the UAE timezone (UTC+4). totalDays = ceil((dropoff - pickup) / 24h). For a "1 week" rental: 7 days. For "weekend": 2-3 days.

11. exampleVehicles: list 2-4 popular UAE makes/models for the chosen category.

12. pricingRationale: 2-4 sentences in the brief's language explaining LoR discount applied, insurance choice, why these ancillaries.

13. confidence: high if pickup/dropoff dates + category + duration are clear; medium if 2 of 3; low if vague.

14. Use warnings[] for ambiguous bits — don't fabricate dates if the brief is vague; surface the ambiguity.

Return a single JSON object exactly matching the response schema. No prose, no markdown.`;

/* ── JSON schema for OpenAI strict mode ─────────────────────────────────── */

function jsonSchema(): Record<string, unknown> {
  const ancillarySchemaJson = {
    type: 'object',
    additionalProperties: false,
    required: ['code', 'description', 'quantity', 'unitCharge', 'isOneTime', 'totalCharge'],
    properties: {
      code: {
        type: 'string',
        enum: [
          'GPS', 'CHILD_SEAT', 'BOOSTER_SEAT', 'ADDITIONAL_DRIVER',
          'YOUNG_DRIVER_SURCHARGE', 'CROSS_BORDER_OMAN', 'CROSS_BORDER_SAUDI',
          'CROSS_BORDER_QATAR', 'SALIK_TAG', 'DELIVERY_PICKUP',
          'AIRPORT_PICKUP_FEE', 'EXTRA_KM_PACK', 'FUEL_PRE_PAID', 'WIFI_HOTSPOT',
        ],
      },
      description: { type: 'string' },
      quantity: { type: 'integer', minimum: 1 },
      unitCharge: { type: 'number', minimum: 0 },
      isOneTime: { type: 'boolean' },
      totalCharge: { type: 'number', minimum: 0 },
    },
  };

  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'vehicleCategory', 'exampleVehicles',
      'pickupLocation', 'dropoffLocation', 'pickupDate', 'dropoffDate', 'totalDays', 'channel',
      'baseDailyRate', 'appliedDailyRate', 'lorDiscountPct', 'baseRentalCharge',
      'insuranceTier', 'insuranceCharge',
      'ancillaries', 'ancillariesTotal',
      'subTotal', 'vatPct', 'vatAmount', 'totalAmount', 'securityDeposit',
      'pricingRationale', 'detectedLanguage', 'confidence', 'warnings',
    ],
    properties: {
      vehicleCategory: {
        type: 'string',
        enum: [
          'ECONOMY', 'COMPACT', 'MID_SIZE_SEDAN', 'FULL_SIZE_SEDAN',
          'COMPACT_SUV', 'STANDARD_SUV', 'FULL_SIZE_SUV', 'LUXURY_SEDAN', 'LUXURY_SUV',
          'VAN', 'PICKUP', 'MINI_BUS',
        ],
      },
      exampleVehicles: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 6 },
      pickupLocation: { type: 'string' },
      dropoffLocation: { type: 'string' },
      pickupDate: { type: 'string' },
      dropoffDate: { type: 'string' },
      totalDays: { type: 'integer', minimum: 1 },
      channel: { type: 'string', enum: ['DIRECT', 'CORPORATE', 'AGENCY', 'ONLINE'] },
      baseDailyRate: { type: 'number', minimum: 0 },
      appliedDailyRate: { type: 'number', minimum: 0 },
      lorDiscountPct: { type: 'number', minimum: 0, maximum: 100 },
      baseRentalCharge: { type: 'number', minimum: 0 },
      insuranceTier: { type: 'string', enum: ['MINIMUM', 'CDW', 'LDW', 'TP', 'PAI', 'SUPER_CDW'] },
      insuranceCharge: { type: 'number', minimum: 0 },
      ancillaries: { type: 'array', items: ancillarySchemaJson, maxItems: 20 },
      ancillariesTotal: { type: 'number', minimum: 0 },
      subTotal: { type: 'number', minimum: 0 },
      vatPct: { type: 'number', minimum: 0, maximum: 100 },
      vatAmount: { type: 'number', minimum: 0 },
      totalAmount: { type: 'number', minimum: 0 },
      securityDeposit: { type: 'number', minimum: 0 },
      pricingRationale: { type: 'string' },
      detectedLanguage: { type: 'string', enum: ['en', 'ar', 'mixed'] },
      confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      warnings: { type: 'array', items: { type: 'string' } },
    },
  };
}

/* ── Agent function ──────────────────────────────────────────────────────── */

export interface RentalCopilotResult {
  ok: true;
  suggestion: SuggestedRental;
  modelUsed: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}
export interface RentalCopilotError {
  ok: false;
  error: string;
  detail?: unknown;
}

export async function generateRentalSuggestion(brief: string): Promise<RentalCopilotResult | RentalCopilotError> {
  if (!hasOpenAI) {
    return { ok: false, error: 'AI Rental Co-pilot unavailable — OPENAI_API_KEY not configured.' };
  }
  if (!brief || brief.trim().length < 10) {
    return { ok: false, error: 'Brief is too short. Describe the rental needs in at least one sentence.' };
  }

  const t0 = Date.now();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  // Pass today's date so the model can resolve relative dates ("Saturday", "next week").
  const today = new Date().toISOString().slice(0, 10);

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Today's date in UAE timezone: ${today}\n\nCustomer brief:\n${brief.trim()}`,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'suggested_rental', strict: true, schema: jsonSchema() },
      },
      temperature: 0.2,
      max_tokens: 2200,
    });

    const raw = completion.choices[0]?.message?.content ?? '';
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { return { ok: false, error: 'Co-pilot returned non-JSON output.', detail: raw }; }

    const validated = suggestedRentalSchema.safeParse(parsed);
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
