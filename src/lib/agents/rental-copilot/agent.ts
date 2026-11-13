/**
 * Grounded RAC Quote & Booking Co-pilot Agent (2-Phase Architecture)
 *
 * Phase 1 (`extractRentalIntent` — strictly OUTSIDE `withTenantRls`):
 *   Extracts structured rental intent ONLY (category, dates/days, locations,
 *   customer segment, channel, insurance plan code, requested ancillary codes &
 *   quantities, promo code, language) from an English/Arabic/mixed brief.
 *   Provider cascade:
 *     1. Gemini 3.8 Flash (`gemini-3.8-flash` via Interactions REST API)
 *     2. OpenAI (`gpt-4o-mini` structured JSON output)
 *     3. Deterministic Bilingual (EN + AR) NLP Parser fallback
 *   ZERO prices, discounts, or totals are ever requested from or trusted from an LLM.
 *
 * Phase 2 (`buildGroundedRentalQuoteInTx` — strictly INSIDE `withTenantRls`):
 *   Queries the tenant's real `vehicles` availability (excluding active/confirmed
 *   bookings, active/draft agreements, open workshop work orders, active lease
 *   allocations, and fleet grounding blocks), resolves ancillaries from the
 *   tenant's `rental_ancillaries` master catalogue, computes authoritative pricing
 *   via `quoteRentalRateInTx` (`pricing_rules` + `rate_events` + 5% UAE VAT),
 *   and proposes the nearest in-stock upgrade category when the requested class
 *   has 0 available units.
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { env, hasOpenAI } from '@/lib/env';
import { prisma } from '@/lib/prisma';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { findGroundingBlocks } from '@/lib/fleet/grounding-blocks';
import { withSavepoint } from '@/lib/rental/locks';
import {
  RENTAL_VEHICLE_CATEGORIES,
  formatRentalCategoryLabel,
  normalizeRentalCategory,
} from '@/lib/rental/categories';
import {
  calculateRate,
  quoteRentalRateInTx,
  type PricingRuleRow,
  type RateResult,
} from '@/lib/rental-rate-engine';
import { normalizeFuelPct } from '@/lib/rental/telematics-service';
import type { AgentDefinition, AgentEvent, AgentRunResult } from '../types';

/* ── Schemas & Public Types ──────────────────────────────────────────────── */

export const ancillarySchema = z.object({
  code: z.string().min(1),
  description: z.string().describe('Human-readable label, language-matched to the brief'),
  quantity: z.number().int().min(1),
  unitCharge: z.number().min(0).describe('Charge per unit per day in AED, or one-time charge'),
  isOneTime: z.boolean().describe('True if charged once for the whole rental, false if per-day'),
  totalCharge: z.number().min(0).describe('quantity × unitCharge × (isOneTime ? 1 : days)'),
});

export const suggestedRentalSchema = z.object({
  vehicleCategory: z.enum([
    'ECONOMY',
    'COMPACT',
    'MID_SIZE',
    'FULL_SIZE',
    'COMPACT_SUV',
    'MID_SIZE_SUV',
    'FULL_SIZE_SUV',
    'LUXURY',
    'PREMIUM',
    'SPORTS',
    'VAN',
    'PICKUP',
    'BUS',
    'SPECIAL',
    // Legacy aliases retained for backward-compatible validation
    'MID_SIZE_SEDAN',
    'FULL_SIZE_SEDAN',
    'STANDARD_SUV',
    'LUXURY_SEDAN',
    'LUXURY_SUV',
    'MINI_BUS',
  ]),
  exampleVehicles: z.array(z.string()).min(1),
  pickupLocation: z.string(),
  dropoffLocation: z.string(),
  pickupDate: z.string(),
  dropoffDate: z.string(),
  totalDays: z.number().int().min(1),
  channel: z.enum(['DIRECT', 'CORPORATE', 'AGENCY', 'ONLINE']),
  baseDailyRate: z.number().min(0),
  appliedDailyRate: z.number().min(0),
  lorDiscountPct: z.number().min(0).max(100),
  baseRentalCharge: z.number().min(0),
  insuranceTier: z.enum(['MINIMUM', 'CDW', 'LDW', 'TP', 'PAI', 'SUPER_CDW']),
  insuranceCharge: z.number().min(0),
  ancillaries: z.array(ancillarySchema),
  ancillariesTotal: z.number().min(0),
  subTotal: z.number().min(0),
  vatPct: z.number().min(0).max(100).default(5),
  vatAmount: z.number().min(0),
  totalAmount: z.number().min(0),
  securityDeposit: z.number().min(0),
  pricingRationale: z.string(),
  detectedLanguage: z.enum(['en', 'ar', 'mixed']),
  confidence: z.enum(['low', 'medium', 'high']),
  warnings: z.array(z.string()),
});

export type Ancillary = z.infer<typeof ancillarySchema>;
export type SuggestedRental = z.infer<typeof suggestedRentalSchema>;

export interface RequestedAncillaryIntent {
  code: string;
  quantity: number;
}

export interface ExtractedRentalIntent {
  vehicleCategory: string;
  pickupDate: string;
  dropoffDate: string;
  rentalDays: number;
  pickupLocation: string;
  dropoffLocation: string;
  pickupLocationCode: string;
  dropoffLocationCode: string;
  customerType:
    | 'INDIVIDUAL'
    | 'CORPORATE'
    | 'AIRLINE'
    | 'INSURANCE'
    | 'FREQUENT_FLYER'
    | 'GOVERNMENT';
  channel: 'DIRECT' | 'CORPORATE' | 'AGENCY' | 'ONLINE';
  insurancePlanCode: 'MINIMUM' | 'CDW' | 'LDW' | 'TP' | 'PAI' | 'SUPER_CDW';
  requestedAncillaries: RequestedAncillaryIntent[];
  promoCode: string | null;
  youngDriverUnder25: boolean;
  crossBorderDestination: 'OMAN' | 'SAUDI' | 'QATAR' | 'BAHRAIN' | null;
  language: 'en' | 'ar';
  detectedLanguage: 'en' | 'ar' | 'mixed';
  confidence: 'low' | 'medium' | 'high';
  warnings: string[];
}

export interface GroundedAvailableVehicle {
  id: string;
  licensePlate: string;
  make: string;
  model: string;
  year: number | null;
  category: string;
  status: string;
  fuelPct: number;
  odometerKm: number | null;
  branchId: string | null;
}

export interface GroundedAncillaryLine extends Ancillary {
  ancillaryId: string | null;
  nameEn: string;
  nameAr: string | null;
  pricingType: string;
  source: 'TENANT_CATALOGUE' | 'SYSTEM_TARIFF_FALLBACK';
}

export interface GroundedPricingRuleMeta {
  id: string;
  name: string;
  vehicleCategory: string;
  baseDailyRate: number;
  weeklyRate: number | null;
  monthlyRate: number | null;
  includedKmPerDay: number;
  excessKmRate: number;
  gracePeriodMin: number;
}

export interface GroundedRateEventMeta {
  id: string;
  eventCode: string;
  name: string;
  dateFrom: string;
  dateTo: string;
  multiplier: number;
  flatSurcharge: number;
  isApplied: boolean;
}

export interface GroundedUpgradeAlternative {
  vehicleCategory: string;
  categoryLabel: string;
  availableCount: number;
  availableVehicles: GroundedAvailableVehicle[];
  quoteBreakdown: RateResult;
  dailyRate: number;
  totalAmount: number;
  rateDeltaPerDay: number;
  totalDeltaAmount: number;
  reasonEn: string;
  reasonAr: string;
}

export interface GroundedRentalQuotePayload {
  intent: ExtractedRentalIntent;
  suggestion: SuggestedRental;
  quoteBreakdown: RateResult;
  availableVehicles: GroundedAvailableVehicle[];
  availableCount: number;
  appliedPricingRule: GroundedPricingRuleMeta | null;
  activeRateEvents: GroundedRateEventMeta[];
  ancillaries: GroundedAncillaryLine[];
  catalogueAncillariesCount: number;
  upgradeAlternative: GroundedUpgradeAlternative | null;
  explanation: {
    en: string;
    ar: string;
  };
}

export interface RentalIntentExtractionResult {
  ok: true;
  intent: ExtractedRentalIntent;
  modelUsed: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

export interface RentalCopilotResult {
  ok: true;
  suggestion: SuggestedRental;
  grounded?: GroundedRentalQuotePayload;
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

/* ── Arithmetic Invariants ───────────────────────────────────────────────── */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Enforces deterministic non-negative arithmetic and 5% UAE VAT invariants
 * on `SuggestedRental` objects.
 */
export function enforceSuggestedRentalInvariants(raw: SuggestedRental): SuggestedRental {
  const totalDays = Math.max(1, Math.round(raw.totalDays));
  const baseDailyRate = Math.max(0, round2(raw.baseDailyRate));
  const lorDiscountPct = Math.min(100, Math.max(0, round2(raw.lorDiscountPct)));
  const appliedDailyRate =
    raw.appliedDailyRate > 0
      ? Math.max(0, round2(raw.appliedDailyRate))
      : Math.max(0, round2(baseDailyRate * (1 - lorDiscountPct / 100)));

  const baseRentalCharge = Math.max(0, round2(appliedDailyRate * totalDays));
  const insuranceCharge = Math.max(0, round2(raw.insuranceCharge));

  const ancillaries = raw.ancillaries.map((anc) => {
    const quantity = Math.max(1, Math.round(anc.quantity));
    const unitCharge = Math.max(0, round2(anc.unitCharge));
    const totalCharge = Math.max(
      0,
      round2(quantity * unitCharge * (anc.isOneTime ? 1 : totalDays)),
    );
    return {
      ...anc,
      quantity,
      unitCharge,
      totalCharge,
    };
  });

  const ancillariesTotal = Math.max(
    0,
    round2(ancillaries.reduce((sum, a) => sum + a.totalCharge, 0)),
  );
  const subTotal = Math.max(0, round2(baseRentalCharge + insuranceCharge + ancillariesTotal));
  const vatPct = 5;
  const vatAmount = Math.max(0, round2(subTotal * 0.05));
  const totalAmount = Math.max(0, round2(subTotal + vatAmount));
  const securityDeposit = Math.max(0, round2(raw.securityDeposit));

  return {
    ...raw,
    totalDays,
    baseDailyRate,
    lorDiscountPct,
    appliedDailyRate,
    baseRentalCharge,
    insuranceCharge,
    ancillaries,
    ancillariesTotal,
    subTotal,
    vatPct,
    vatAmount,
    totalAmount,
    securityDeposit,
  };
}

/* ── Deterministic Reference Constants (Non-LLM) ─────────────────────────── */

const CATEGORY_ARABIC_LABELS: Record<string, string> = {
  ECONOMY: 'اقتصادية',
  COMPACT: 'مدمجة',
  MID_SIZE: 'سيدان متوسطة',
  FULL_SIZE: 'سيدان كبيرة',
  COMPACT_SUV: 'كروس أوفر / دفع رباعي مدمجة',
  MID_SIZE_SUV: 'دفع رباعي متوسطة',
  FULL_SIZE_SUV: 'دفع رباعي عائلية كبيرة',
  LUXURY: 'فاخرة',
  PREMIUM: 'تنفيذية بريميوم',
  SPORTS: 'رياضية',
  VAN: 'فان عائلي',
  PICKUP: 'بيك أب',
  BUS: 'حافلة صغيرة',
  SPECIAL: 'خاصة',
};

const CATEGORY_SAMPLE_MODELS: Record<string, string[]> = {
  ECONOMY: ['Toyota Yaris', 'Nissan Sunny', 'Kia Picanto'],
  COMPACT: ['Toyota Corolla', 'Hyundai Elantra', 'Honda Civic'],
  MID_SIZE: ['Toyota Camry', 'Nissan Altima', 'Hyundai Sonata'],
  FULL_SIZE: ['Toyota Avalon', 'Ford Taurus', 'Nissan Maxima'],
  COMPACT_SUV: ['Toyota RAV4', 'Hyundai Tucson', 'Mazda CX-5'],
  MID_SIZE_SUV: ['Toyota Fortuner', 'Nissan X-Trail', 'Mitsubishi Montero Sport'],
  FULL_SIZE_SUV: ['Nissan Patrol', 'Toyota Land Cruiser', 'Chevrolet Tahoe'],
  LUXURY: ['Mercedes-Benz E-Class', 'BMW 5 Series', 'Range Rover Vogue'],
  PREMIUM: ['Lexus ES 350', 'Genesis G80', 'Audi A6'],
  SPORTS: ['Porsche 911', 'Ford Mustang GT', 'BMW M4'],
  VAN: ['Toyota Hiace', 'Kia Carnival', 'Hyundai Staria'],
  PICKUP: ['Toyota Hilux', 'Nissan Navara', 'Mitsubishi L200'],
  BUS: ['Toyota Coaster (22-Seater)', 'Nissan Civilian'],
  SPECIAL: ['Mercedes-Benz V-Class VIP', 'Cadillac Escalade ESV'],
};

const CATEGORY_DEFAULT_DEPOSIT_AED: Record<string, number> = {
  ECONOMY: 1500,
  COMPACT: 1500,
  MID_SIZE: 2000,
  FULL_SIZE: 2500,
  COMPACT_SUV: 2000,
  MID_SIZE_SUV: 2500,
  FULL_SIZE_SUV: 3500,
  PREMIUM: 3500,
  LUXURY: 5000,
  SPORTS: 5000,
  VAN: 2500,
  PICKUP: 2000,
  BUS: 3500,
  SPECIAL: 5000,
};

/**
 * Deterministic RAC upgrade ladder when the requested category has 0 available units.
 */
const RAC_UPGRADE_LADDER: Record<string, string[]> = {
  ECONOMY: ['COMPACT', 'MID_SIZE', 'COMPACT_SUV', 'FULL_SIZE', 'MID_SIZE_SUV'],
  COMPACT: ['MID_SIZE', 'COMPACT_SUV', 'FULL_SIZE', 'MID_SIZE_SUV', 'ECONOMY'],
  MID_SIZE: ['FULL_SIZE', 'COMPACT_SUV', 'MID_SIZE_SUV', 'PREMIUM', 'COMPACT'],
  FULL_SIZE: ['PREMIUM', 'MID_SIZE_SUV', 'FULL_SIZE_SUV', 'LUXURY', 'MID_SIZE'],
  COMPACT_SUV: ['MID_SIZE_SUV', 'FULL_SIZE_SUV', 'MID_SIZE', 'FULL_SIZE', 'PREMIUM'],
  MID_SIZE_SUV: ['FULL_SIZE_SUV', 'LUXURY', 'COMPACT_SUV', 'FULL_SIZE', 'VAN'],
  FULL_SIZE_SUV: ['LUXURY', 'MID_SIZE_SUV', 'VAN', 'PREMIUM'],
  PREMIUM: ['LUXURY', 'FULL_SIZE', 'FULL_SIZE_SUV', 'MID_SIZE_SUV'],
  LUXURY: ['PREMIUM', 'FULL_SIZE_SUV', 'SPORTS'],
  SPORTS: ['LUXURY', 'PREMIUM', 'FULL_SIZE_SUV'],
  VAN: ['BUS', 'FULL_SIZE_SUV', 'MID_SIZE_SUV'],
  PICKUP: ['MID_SIZE_SUV', 'FULL_SIZE_SUV', 'VAN'],
  BUS: ['VAN', 'FULL_SIZE_SUV'],
  SPECIAL: ['LUXURY', 'PREMIUM', 'FULL_SIZE_SUV'],
};

interface SystemAncillaryTariff {
  code: string;
  aliases: string[];
  nameEn: string;
  nameAr: string;
  unitPrice: number;
  isOneTime: boolean;
}

/**
 * Deterministic UAE RAC ancillary fallback definitions used ONLY when a tenant's
 * `rental_ancillaries` table has not yet seeded a requested ancillary code.
 */
const SYSTEM_ANCILLARY_TARIFFS: SystemAncillaryTariff[] = [
  {
    code: 'GPS',
    aliases: ['GPS', 'NAV', 'NAVIGATION', 'SAT_NAV'],
    nameEn: 'GPS Navigation Unit',
    nameAr: 'جهاز ملاحة GPS',
    unitPrice: 25,
    isOneTime: false,
  },
  {
    code: 'CHILD_SEAT',
    aliases: ['CHILD_SEAT', 'BABY_SEAT', 'INFANT_SEAT', 'KIDS_SEAT'],
    nameEn: 'Child Safety Seat',
    nameAr: 'مقعد أطفال آمن',
    unitPrice: 30,
    isOneTime: false,
  },
  {
    code: 'BOOSTER_SEAT',
    aliases: ['BOOSTER_SEAT', 'BOOSTER'],
    nameEn: 'Booster Seat',
    nameAr: 'مقعد أطفال معزز',
    unitPrice: 25,
    isOneTime: false,
  },
  {
    code: 'ADDITIONAL_DRIVER',
    aliases: ['ADDITIONAL_DRIVER', 'ADD_DRIVER', 'EXTRA_DRIVER', 'SECOND_DRIVER'],
    nameEn: 'Additional Authorized Driver',
    nameAr: 'سائق إضافي معتمد',
    unitPrice: 35,
    isOneTime: false,
  },
  {
    code: 'YOUNG_DRIVER_SURCHARGE',
    aliases: ['YOUNG_DRIVER_SURCHARGE', 'YOUNG_DRIVER', 'UNDERAGE_SURCHARGE'],
    nameEn: 'Young Driver Surcharge (Under 25)',
    nameAr: 'رسوم السائق الشاب (أقل من 25 سنة)',
    unitPrice: 50,
    isOneTime: false,
  },
  {
    code: 'CROSS_BORDER_OMAN',
    aliases: ['CROSS_BORDER_OMAN', 'OMAN_NOC', 'OMAN_PERMIT', 'OMAN_INSURANCE', 'ORANGE_CARD_OMAN'],
    nameEn: 'Oman Cross-Border NOC & Orange Card',
    nameAr: 'تصريح عبور حدود عُمان والبطاقة البرتقالية',
    unitPrice: 250,
    isOneTime: true,
  },
  {
    code: 'CROSS_BORDER_SAUDI',
    aliases: ['CROSS_BORDER_SAUDI', 'KSA_NOC', 'SAUDI_NOC', 'SAUDI_PERMIT'],
    nameEn: 'Saudi Arabia (KSA) Cross-Border NOC',
    nameAr: 'تصريح عبور حدود المملكة العربية السعودية',
    unitPrice: 400,
    isOneTime: true,
  },
  {
    code: 'CROSS_BORDER_QATAR',
    aliases: ['CROSS_BORDER_QATAR', 'QATAR_NOC'],
    nameEn: 'Qatar Cross-Border NOC',
    nameAr: 'تصريح عبور حدود قطر',
    unitPrice: 350,
    isOneTime: true,
  },
  {
    code: 'SALIK_TAG',
    aliases: ['SALIK_TAG', 'SALIK', 'DARB', 'TOLL_TAG'],
    nameEn: 'Salik / Darb Toll Tag Admin',
    nameAr: 'شريحة سالك / درب للرسوم المرورية',
    unitPrice: 10,
    isOneTime: false,
  },
  {
    code: 'DELIVERY_PICKUP',
    aliases: ['DELIVERY_PICKUP', 'HOTEL_DELIVERY', 'DELIVERY', 'COLLECTION'],
    nameEn: 'Hotel / Doorstep Vehicle Delivery',
    nameAr: 'توصيل واستلام المركبة من الفندق / الموقع',
    unitPrice: 120,
    isOneTime: true,
  },
  {
    code: 'AIRPORT_PICKUP_FEE',
    aliases: ['AIRPORT_PICKUP_FEE', 'AIRPORT_FEE', 'AIRPORT_SURCHARGE'],
    nameEn: 'Airport Counter Pickup Fee',
    nameAr: 'رسوم استلام من المطار',
    unitPrice: 75,
    isOneTime: true,
  },
  {
    code: 'EXTRA_KM_PACK',
    aliases: ['EXTRA_KM_PACK', 'UNLIMITED_KM', 'EXTRA_MILEAGE'],
    nameEn: 'Extra Mileage Pack (+200 km/day)',
    nameAr: 'باقة كيلومترات إضافية (+200 كم/يوم)',
    unitPrice: 50,
    isOneTime: false,
  },
  {
    code: 'FUEL_PRE_PAID',
    aliases: ['FUEL_PRE_PAID', 'PREPAID_FUEL', 'FULL_TANK'],
    nameEn: 'Pre-Paid Full Fuel Tank',
    nameAr: 'خزان وقود مدفوع مسبقاً',
    unitPrice: 220,
    isOneTime: true,
  },
  {
    code: 'WIFI_HOTSPOT',
    aliases: ['WIFI_HOTSPOT', 'WIFI', 'MIFI', 'INTERNET'],
    nameEn: 'In-Car 5G Wi-Fi Hotspot',
    nameAr: 'جهاز واي فاي متنقل داخل السيارة',
    unitPrice: 35,
    isOneTime: false,
  },
];

/* ── Date & Language Helpers ─────────────────────────────────────────────── */

function getUaeTodayDate(): Date {
  // Shift UTC by +4 hours (UAE Gulf Standard Time) and floor to midnight UTC
  const now = new Date();
  const uaeMs = now.getTime() + 4 * 3600 * 1000;
  const d = new Date(uaeMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function formatIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addUtcDays(base: Date, days: number): Date {
  const out = new Date(base.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function detectBriefLanguage(brief: string): {
  language: 'en' | 'ar';
  detectedLanguage: 'en' | 'ar' | 'mixed';
} {
  const arabicChars = (brief.match(/[\u0600-\u06FF]/g) ?? []).length;
  const latinChars = (brief.match(/[A-Za-z]/g) ?? []).length;
  if (arabicChars > 0 && latinChars > 8) {
    return {
      language: arabicChars >= latinChars ? 'ar' : 'en',
      detectedLanguage: 'mixed',
    };
  }
  if (arabicChars > 0) {
    return { language: 'ar', detectedLanguage: 'ar' };
  }
  return { language: 'en', detectedLanguage: 'en' };
}

function normalizeArabicDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

const WEEKDAY_MAP: Array<{ pattern: RegExp; dow: number }> = [
  { pattern: /\b(?:sun(?:day)?|الأحد|الاحد)\b/i, dow: 0 },
  { pattern: /\b(?:mon(?:day)?|الإثنين|الاثنين)\b/i, dow: 1 },
  { pattern: /\b(?:tue(?:s(?:day)?)?|الثلاثاء)\b/i, dow: 2 },
  { pattern: /\b(?:wed(?:nesday)?|الأربعاء|الاربعاء)\b/i, dow: 3 },
  { pattern: /\b(?:thu(?:r(?:s(?:day)?)?)?|الخميس)\b/i, dow: 4 },
  { pattern: /\b(?:fri(?:day)?|الجمعة)\b/i, dow: 5 },
  { pattern: /\b(?:sat(?:urday)?|السبت)\b/i, dow: 6 },
];

function nextWeekdayFrom(base: Date, targetDow: number, minDaysAhead = 1): Date {
  const currentDow = base.getUTCDay();
  let diff = (targetDow - currentDow + 7) % 7;
  if (diff < minDaysAhead) diff += 7;
  return addUtcDays(base, diff);
}

/* ── Deterministic Bilingual NLP Parser (Zero-Dependency Fallback) ───────── */

export function parseRentalIntentDeterministic(rawBrief: string): ExtractedRentalIntent {
  const brief = normalizeArabicDigits(rawBrief.trim());
  const lower = brief.toLowerCase();
  const { language, detectedLanguage } = detectBriefLanguage(brief);
  const warnings: string[] = [];

  // 1. Vehicle Category (normalized to canonical RAC category)
  let rawCat = 'MID_SIZE';
  let catExplicit = true;

  if (
    /full[-\s]?size\s*suv|large\s*suv|7[-\s]?seat(?:er)?\s*suv|patrol|land\s*cruiser|tahoe|yukon|escalade|دفع رباعي كبيرة|عائلية كبيرة|باترول|لاند\s*كروزر/i.test(
      brief,
    )
  ) {
    rawCat = 'FULL_SIZE_SUV';
  } else if (/compact\s*suv|crossover|rav4|tucson|cx-?5|sportage|كروس\s*أوفر/i.test(brief)) {
    rawCat = 'COMPACT_SUV';
  } else if (/mid[-\s]?size\s*suv|standard\s*suv|fortuner|x-?trail|pajero|pathfinder|دفع رباعي متوسطة/i.test(brief)) {
    rawCat = 'MID_SIZE_SUV';
  } else if (/\bsuv\b|4x4|دفع رباعي|عائلية/i.test(brief)) {
    const largeParty = /\b(?:family|kids|children|[5-8]\s*(?:pax|people|persons|adults)|عائلة|أطفال)\b/i.test(brief);
    rawCat = largeParty ? 'FULL_SIZE_SUV' : 'MID_SIZE_SUV';
  } else if (/sports?|supercar|ferrari|lamborghini|porsche|mustang|رياضية|سبورت/i.test(brief)) {
    rawCat = 'SPORTS';
  } else if (/luxury|vip|s-class|e-class|5-series|7-series|range\s*rover|mercedes|فاخرة|فخمة|مرسيدس|رنج\s*روفر/i.test(brief)) {
    rawCat = 'LUXURY';
  } else if (/premium|executive|lexus|genesis|بريميوم|تنفيذية|لكزس/i.test(brief)) {
    rawCat = 'PREMIUM';
  } else if (/minibus|coaster|\bbus\b|14[-\s]?seat|22[-\s]?seat|30[-\s]?seat|حافلة|باص|كوستر/i.test(brief)) {
    rawCat = 'BUS';
  } else if (/\bvan\b|mpv|hiace|carnival|staria|فان|هايس/i.test(brief)) {
    rawCat = 'VAN';
  } else if (/pickup|hilux|navara|truck|بيك\s*[أا]ب|هايلكس/i.test(brief)) {
    rawCat = 'PICKUP';
  } else if (/full[-\s]?size|avalon|taurus|maxima|سيدان كبيرة/i.test(brief)) {
    rawCat = 'FULL_SIZE';
  } else if (/mid[-\s]?size|sedan|camry|altima|sonata|accord|سيدان|كامري|التيما/i.test(brief)) {
    rawCat = 'MID_SIZE';
  } else if (/compact|corolla|civic|elantra|sentra|مدمجة|كورولا|النترا/i.test(brief)) {
    rawCat = 'COMPACT';
  } else if (/economy|budget|small|hatchback|yaris|sunny|picanto|اقتصادية|صغيرة|يارس|صني/i.test(brief)) {
    rawCat = 'ECONOMY';
  } else {
    catExplicit = false;
    warnings.push(
      language === 'ar'
        ? 'لم يتم تحديد فئة المركبة صراحةً؛ تم افتراض فئة سيدان متوسطة.'
        : 'Vehicle category was not explicitly stated; defaulted to Mid-Size Sedan.',
    );
  }

  const vehicleCategory = normalizeRentalCategory(rawCat) || 'MID_SIZE';

  // 2. Dates & Rental Duration
  const today = getUaeTodayDate();
  let pickupDateObj = addUtcDays(today, 1);
  let rentalDays = 3;
  let datesExplicit = false;

  const isoMatches = brief.match(/\b(20\d{2}-\d{2}-\d{2})\b/g);
  if (isoMatches && isoMatches.length >= 2) {
    const p = new Date(`${isoMatches[0]}T00:00:00.000Z`);
    const d = new Date(`${isoMatches[1]}T00:00:00.000Z`);
    if (!Number.isNaN(p.getTime()) && !Number.isNaN(d.getTime()) && d > p) {
      pickupDateObj = p;
      rentalDays = Math.max(1, Math.round((d.getTime() - p.getTime()) / 86_400_000));
      datesExplicit = true;
    }
  }

  if (!datesExplicit) {
    // Check explicit day/week/month count first
    const dayMatch = brief.match(/(\d+)\s*(?:days?|nights?|\bd\b|أيام|ايام|يوم|يوماً|ليالي)/i);
    const weekMatch = brief.match(/(\d+)\s*(?:weeks?|أسابيع|اسابيع)/i);
    const monthMatch = brief.match(/(\d+)\s*(?:months?|أشهر|شهور)/i);

    if (dayMatch) {
      rentalDays = Math.min(365, Math.max(1, Number(dayMatch[1])));
      datesExplicit = true;
    } else if (weekMatch) {
      rentalDays = Math.min(365, Math.max(1, Number(weekMatch[1]) * 7));
      datesExplicit = true;
    } else if (monthMatch) {
      rentalDays = Math.min(365, Math.max(1, Number(monthMatch[1]) * 30));
      datesExplicit = true;
    } else if (/يومين/i.test(brief)) {
      rentalDays = 2;
      datesExplicit = true;
    } else if (/أسبوعين|اسبوعين/i.test(brief)) {
      rentalDays = 14;
      datesExplicit = true;
    } else if (/\bmon(?:day)?\s*[-–to]+\s*fri(?:day)?\b/i.test(brief)) {
      pickupDateObj = nextWeekdayFrom(today, 1, 1);
      rentalDays = 5;
      datesExplicit = true;
    } else if (/weekly|\ba\s+week\b|أسبوع|اسبوع/i.test(brief)) {
      rentalDays = 7;
      datesExplicit = true;
    } else if (/monthly|\ba\s+month\b|شهر/i.test(brief)) {
      rentalDays = 30;
      datesExplicit = true;
    } else if (/weekend|عطلة نهاية الأسبوع|الويكند/i.test(brief)) {
      pickupDateObj = nextWeekdayFrom(today, 5, 1); // UAE Friday start
      rentalDays = 2;
      datesExplicit = true;
    }

    // Check weekday pair (e.g., "Saturday ... Friday")
    const foundWeekdays: Array<{ dow: number; index: number }> = [];
    for (const w of WEEKDAY_MAP) {
      const m = w.pattern.exec(brief);
      if (m) {
        foundWeekdays.push({ dow: w.dow, index: m.index });
      }
    }
    foundWeekdays.sort((a, b) => a.index - b.index);

    if (foundWeekdays.length >= 2) {
      const startW = foundWeekdays[0].dow;
      const endW = foundWeekdays[1].dow;
      pickupDateObj = nextWeekdayFrom(today, startW, 1);
      if (!dayMatch && !weekMatch && !monthMatch) {
        let span = (endW - startW + 7) % 7;
        if (span === 0) span = 7;
        // e.g. Saturday morning (6) -> next Friday evening (5) = 6 or 7 rental days depending on evening return
        if (/\bevening\b|\bnight\b|مساء/i.test(brief) && /\bmorning\b|صباح/i.test(brief)) {
          span = Math.min(30, span + 1);
        }
        rentalDays = Math.max(1, span);
      }
      datesExplicit = true;
    } else if (foundWeekdays.length === 1) {
      pickupDateObj = nextWeekdayFrom(today, foundWeekdays[0].dow, 1);
      datesExplicit = true;
    } else if (/\btoday\b|اليوم/i.test(brief)) {
      pickupDateObj = today;
    } else if (/\btomorrow\b|غداً|غدا|بكرة/i.test(brief)) {
      pickupDateObj = addUtcDays(today, 1);
    }

    if (!datesExplicit) {
      warnings.push(
        language === 'ar'
          ? 'تواريخ الاستلام والتسليم غير محددة بدقة؛ تم افتراض حجز لمدة 3 أيام يبدأ غداً.'
          : 'Exact pickup/return dates were not specified; defaulted to a 3-day rental starting tomorrow.',
      );
    }
  }

  const dropoffDateObj = addUtcDays(pickupDateObj, rentalDays);
  const pickupDate = formatIsoDate(pickupDateObj);
  const dropoffDate = formatIsoDate(dropoffDateObj);

  // 3. Pickup & Dropoff Locations
  let pickupLocation = 'Dubai Main Counter';
  let pickupLocationCode = 'DXB';
  let locationExplicit = true;

  const noAirport = /no\s+airport|بدون\s+مطار/i.test(brief);

  if (!noAirport && /\bdxb\b|dubai\s+(?:international\s+)?airport|مطار\s*دبي/i.test(brief)) {
    pickupLocation = 'Dubai International Airport (DXB)';
    pickupLocationCode = 'DXB';
  } else if (!noAirport && /\bdwc\b|al\s*maktoum|مطار\s*[آا]ل\s*مكتوم/i.test(brief)) {
    pickupLocation = 'Al Maktoum International Airport (DWC)';
    pickupLocationCode = 'DWC';
  } else if (!noAirport && /\bauh\b|abu\s*dhabi\s*airport|zayed\s*international|مطار\s*[أا]بو\s*ظبي/i.test(brief)) {
    pickupLocation = 'Zayed International Airport (AUH)';
    pickupLocationCode = 'AUH';
  } else if (!noAirport && /\bshj\b|sharjah\s*airport|مطار\s*الشارقة/i.test(brief)) {
    pickupLocation = 'Sharjah International Airport (SHJ)';
    pickupLocationCode = 'SHJ';
  } else if (/hotel.*dubai|dubai.*hotel|فندق\s*في\s*دبي|فندق.*دبي/i.test(brief)) {
    pickupLocation = 'Dubai Hotel Delivery';
    pickupLocationCode = 'DXB_CITY';
  } else if (/dubai\s*marina|مارينا\s*دبي|دبي\s*مارينا/i.test(brief)) {
    pickupLocation = 'Dubai Marina Branch';
    pickupLocationCode = 'DXB_MARINA';
  } else if (/dubai|دبي/i.test(brief)) {
    pickupLocation = 'Dubai City Branch';
    pickupLocationCode = 'DXB_CITY';
  } else if (/sharjah|الشارقة/i.test(brief)) {
    pickupLocation = 'Sharjah City Branch';
    pickupLocationCode = 'SHJ_CITY';
  } else if (/abu\s*dhabi|أبوظبي|ابوظبي|أبو ظبي/i.test(brief)) {
    pickupLocation = 'Abu Dhabi City Branch';
    pickupLocationCode = 'AUH_CITY';
  } else if (/ajman|عجمان/i.test(brief)) {
    pickupLocation = 'Ajman Branch';
    pickupLocationCode = 'AJM';
  } else if (/ras\s*al\s*khaimah|\brak\b|رأس\s*الخيمة/i.test(brief)) {
    pickupLocation = 'Ras Al Khaimah Branch';
    pickupLocationCode = 'RAK';
  } else {
    locationExplicit = false;
    warnings.push(
      language === 'ar'
        ? 'يرجى تأكيد فرع الاستلام والتسليم مع العميل.'
        : 'Confirm preferred pickup and return branch with the customer.',
    );
  }

  let dropoffLocation = pickupLocation;
  let dropoffLocationCode = pickupLocationCode;
  if (/(?:return|drop[-\s]?off)\s+(?:to|at)\s+abu\s*dhabi|تسليم\s*في\s*[أا]بو\s*ظبي/i.test(brief)) {
    dropoffLocation = 'Abu Dhabi City Branch';
    dropoffLocationCode = 'AUH_CITY';
  } else if (/(?:return|drop[-\s]?off)\s+(?:to|at)\s+dxb|تسليم\s*في\s*مطار\s*دبي/i.test(brief)) {
    dropoffLocation = 'Dubai International Airport (DXB)';
    dropoffLocationCode = 'DXB';
  }

  // 4. Customer Segment & Channel
  let customerType: ExtractedRentalIntent['customerType'] = 'INDIVIDUAL';
  let channel: ExtractedRentalIntent['channel'] = 'DIRECT';

  if (/corporate|company|b2b|consultants|direct\s+billing|شركة|شركات|مؤسسة/i.test(brief)) {
    customerType = 'CORPORATE';
    channel = 'CORPORATE';
  } else if (/airline|cabin\s*crew|طيران/i.test(brief)) {
    customerType = 'AIRLINE';
    channel = 'CORPORATE';
  } else if (/insurance\s*replacement|تأمين\s*بديل/i.test(brief)) {
    customerType = 'INSURANCE';
    channel = 'CORPORATE';
  } else if (/government|diplomat|embassy|حكومي|سفارة|دبلوماسي/i.test(brief)) {
    customerType = 'GOVERNMENT';
    channel = 'CORPORATE';
  } else if (/booking\.com|rentalcars|expedia|kayak|yango|selfdrive|oneclickdrive|hala|careem|travel\s*agent|\bota\b|وكالة/i.test(brief)) {
    channel = 'AGENCY';
  } else if (/\bonline\b|website|portal|أونلاين|الموقع/i.test(brief)) {
    channel = 'ONLINE';
  }

  // 5. Insurance Tier
  let insurancePlanCode: ExtractedRentalIntent['insurancePlanCode'] =
    vehicleCategory === 'LUXURY' || vehicleCategory === 'SPORTS' ? 'SUPER_CDW' : 'CDW';

  if (
    /full\s*insurance|super\s*cdw|\bscdw\b|zero\s*excess|all[-\s]?inclusive|comprehensive|تأمين\s*شامل|تامين\s*شامل|بدون\s*تحمل/i.test(
      brief,
    )
  ) {
    insurancePlanCode = 'SUPER_CDW';
  } else if (/\bldw\b|loss\s*damage/i.test(brief)) {
    insurancePlanCode = 'LDW';
  } else if (/basic\s*insurance|minimum|third[-\s]?party|\btpl\b|تأمين\s*أساسي|ضد\s*الغير/i.test(brief)) {
    insurancePlanCode = 'MINIMUM';
  } else if (/\bpai\b|personal\s*accident/i.test(brief)) {
    insurancePlanCode = 'PAI';
  }

  // 6. Requested Ancillaries & Cross-Border Intent
  const ancMap = new Map<string, number>();
  const addAnc = (code: string, qty = 1) => {
    ancMap.set(code, Math.max(ancMap.get(code) ?? 0, Math.max(1, Math.round(qty))));
  };

  const noExtras = /\bno\s+extras\b|بدون\s*إضافات/i.test(brief);
  let crossBorderDestination: ExtractedRentalIntent['crossBorderDestination'] = null;
  let youngDriverUnder25 = false;

  if (!noExtras) {
    if (/\bgps\b|navigation|sat\s*nav|ملاحة|جي\s*بي\s*اس/i.test(brief)) {
      addAnc('GPS', 1);
    }

    const childSeatQtyMatch =
      brief.match(/(\d+)\s*(?:child|baby|infant|kids?)\s*seats?/i) ??
      brief.match(/(\d+)\s*(?:كراسي|مقاعد|كرسي|مقعد)\s*(?:أطفال|اطفال|طفل|رضيع)/i);
    if (childSeatQtyMatch) {
      addAnc('CHILD_SEAT', Number(childSeatQtyMatch[1]));
    } else if (
      /child\s*seat|baby\s*seat|infant\s*seat|(?:كرسي|مقعد)\s*(?:أطفال|اطفال|طفل|رضيع)/i.test(brief)
    ) {
      addAnc('CHILD_SEAT', 1);
    }

    if (/booster\s*seat|مقعد\s*معزز/i.test(brief)) {
      addAnc('BOOSTER_SEAT', 1);
    }

    if (/additional\s*driver|extra\s*driver|second\s*driver|سائق\s*إضافي|سائق\s*ثاني/i.test(brief)) {
      addAnc('ADDITIONAL_DRIVER', 1);
    }

    if (/wifi|wi-fi|hotspot|واي\s*فاي|انترنت/i.test(brief)) {
      addAnc('WIFI_HOTSPOT', 1);
    }

    if (/pre[-\s]?paid\s*fuel|full\s*tank\s*option|وقود\s*مسبق/i.test(brief)) {
      addAnc('FUEL_PRE_PAID', 1);
    }

    if (/extra\s*km|unlimited\s*km|كيلومترات\s*إضافية/i.test(brief)) {
      addAnc('EXTRA_KM_PACK', 1);
    }

    if (/salik|darb|سالك|درب/i.test(brief)) {
      addAnc('SALIK_TAG', 1);
    }

    if (/hotel|deliver(?:y)?\s+to|doorstep|استلام\s*من\s*فندق|توصيل/i.test(brief)) {
      addAnc('DELIVERY_PICKUP', 1);
    }

    if (
      !noAirport &&
      (pickupLocationCode === 'DXB' ||
        pickupLocationCode === 'DWC' ||
        pickupLocationCode === 'AUH' ||
        pickupLocationCode === 'SHJ') &&
      /\bdxb\b|\bdwc\b|\bauh\b|\bshj\b|airport|مطار/i.test(brief)
    ) {
      addAnc('AIRPORT_PICKUP_FEE', 1);
    }
  }

  // Safety / regulatory surcharges apply even when "no extras" is mentioned
  if (/under\s*25|young\s*driver|\b2[1-4]\s*(?:yo|yrs|years\s*old)\b|أقل\s*من\s*25/i.test(brief)) {
    youngDriverUnder25 = true;
    addAnc('YOUNG_DRIVER_SURCHARGE', 1);
    if (vehicleCategory === 'LUXURY' || vehicleCategory === 'SPORTS') {
      warnings.push(
        language === 'ar'
          ? 'تنبيه أهليّة: الحد الأدنى لعمر السائق لفئة السيارات الفاخرة/الرياضية في الإمارات هو 25 سنة.'
          : 'UAE KYC Eligibility Warning: Luxury/Sports categories require minimum driver age of 25.',
      );
    }
  }

  if (/\boman\b|muscat|salalah|hatta\s*border|khasab|عُمان|عمان|مسقط|صلالة/i.test(brief)) {
    crossBorderDestination = 'OMAN';
    addAnc('CROSS_BORDER_OMAN', 1);
    warnings.push(
      language === 'ar'
        ? 'يتطلب السفر إلى سلطنة عُمان إصدار شهادة عدم ممانعة (NOC) والبطاقة البرتقالية للتأمين قبل التسليم.'
        : 'Cross-border travel to Oman requires an active Cross-Border NOC Permit and Orange Card insurance prior to checkout.',
    );
  } else if (
    /(?:to|into|visit|going\s+to|trip\s+to|drive\s+to|cross[-\s]?border)\s+(?:saudi|ksa|riyadh|jeddah|dammam)|إلى\s*السعودية|تصريح\s*السعودية|سفر.*السعودية/i.test(
      brief,
    )
  ) {
    crossBorderDestination = 'SAUDI';
    addAnc('CROSS_BORDER_SAUDI', 1);
    warnings.push(
      language === 'ar'
        ? 'يتطلب السفر عبر منفذ الغويفات إلى السعودية شهادة عدم ممانعة رسمية وتأمين شامل عابر للحدود.'
        : 'Cross-border travel via Ghuwaifat to Saudi Arabia requires a formal Cross-Border NOC Permit.',
    );
  } else if (/(?:to|into|visit|going\s+to|trip\s+to)\s+qatar|إلى\s*قطر/i.test(brief)) {
    crossBorderDestination = 'QATAR';
    addAnc('CROSS_BORDER_QATAR', 1);
  }

  // Multiple vehicles note
  const multiVehicleMatch = lower.match(/\b([2-9])\s+(?:cars?|vehicles?|sedans?|suvs?|vans?)\b/);
  if (multiVehicleMatch) {
    warnings.push(
      `Customer requested ${multiVehicleMatch[1]} vehicles — quote below is per vehicle; repeat or create a multi-vehicle corporate reservation.`,
    );
  }

  // Promo code
  let promoCode: string | null = null;
  const promoMatch = brief.match(/(?:promo(?:\s*code)?|coupon|discount\s*code|كود\s*خصم|رمز\s*ترويجي)\s*[:=#-]?\s*([A-Za-z0-9_-]{3,24})/i);
  if (promoMatch) {
    promoCode = promoMatch[1].toUpperCase();
  }

  const explicitScore = Number(catExplicit) + Number(datesExplicit) + Number(locationExplicit);
  const confidence: ExtractedRentalIntent['confidence'] =
    explicitScore >= 3 ? 'high' : explicitScore === 2 ? 'medium' : 'low';

  return {
    vehicleCategory,
    pickupDate,
    dropoffDate,
    rentalDays,
    pickupLocation,
    dropoffLocation,
    pickupLocationCode,
    dropoffLocationCode,
    customerType,
    channel,
    insurancePlanCode,
    requestedAncillaries: Array.from(ancMap.entries()).map(([code, quantity]) => ({
      code,
      quantity,
    })),
    promoCode,
    youngDriverUnder25,
    crossBorderDestination,
    language,
    detectedLanguage,
    confidence,
    warnings,
  };
}

/* ── Phase 1: LLM Intent Extraction (Strictly Outside `withTenantRls`) ──── */

const INTENT_EXTRACTION_SCHEMA_JSON: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'vehicleCategory',
    'pickupDate',
    'dropoffDate',
    'rentalDays',
    'pickupLocation',
    'dropoffLocation',
    'pickupLocationCode',
    'dropoffLocationCode',
    'customerType',
    'channel',
    'insurancePlanCode',
    'requestedAncillaries',
    'promoCode',
    'youngDriverUnder25',
    'crossBorderDestination',
    'detectedLanguage',
    'confidence',
    'warnings',
  ],
  properties: {
    vehicleCategory: {
      type: 'string',
      enum: [
        'ECONOMY',
        'COMPACT',
        'MID_SIZE',
        'FULL_SIZE',
        'COMPACT_SUV',
        'MID_SIZE_SUV',
        'FULL_SIZE_SUV',
        'LUXURY',
        'PREMIUM',
        'SPORTS',
        'VAN',
        'PICKUP',
        'BUS',
        'SPECIAL',
      ],
    },
    pickupDate: { type: 'string', description: 'ISO YYYY-MM-DD' },
    dropoffDate: { type: 'string', description: 'ISO YYYY-MM-DD' },
    rentalDays: { type: 'integer', minimum: 1, maximum: 365 },
    pickupLocation: { type: 'string' },
    dropoffLocation: { type: 'string' },
    pickupLocationCode: { type: 'string' },
    dropoffLocationCode: { type: 'string' },
    customerType: {
      type: 'string',
      enum: ['INDIVIDUAL', 'CORPORATE', 'AIRLINE', 'INSURANCE', 'FREQUENT_FLYER', 'GOVERNMENT'],
    },
    channel: {
      type: 'string',
      enum: ['DIRECT', 'CORPORATE', 'AGENCY', 'ONLINE'],
    },
    insurancePlanCode: {
      type: 'string',
      enum: ['MINIMUM', 'CDW', 'LDW', 'TP', 'PAI', 'SUPER_CDW'],
    },
    requestedAncillaries: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'quantity'],
        properties: {
          code: { type: 'string' },
          quantity: { type: 'integer', minimum: 1, maximum: 20 },
        },
      },
    },
    promoCode: { type: ['string', 'null'] },
    youngDriverUnder25: { type: 'boolean' },
    crossBorderDestination: {
      type: ['string', 'null'],
      enum: ['OMAN', 'SAUDI', 'QATAR', 'BAHRAIN', null],
    },
    detectedLanguage: { type: 'string', enum: ['en', 'ar', 'mixed'] },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

const INTENT_SYSTEM_PROMPT = `You are a UAE Rent-A-Car (RAC) intent extraction engine.
Extract ONLY structured rental parameters from the customer brief (English, Arabic, or mixed).
DO NOT output or invent any prices, rates, discounts, or currency figures — pricing is computed downstream by the deterministic rate engine.

Canonical vehicleCategory values:
ECONOMY, COMPACT, MID_SIZE, FULL_SIZE, COMPACT_SUV, MID_SIZE_SUV, FULL_SIZE_SUV, LUXURY, PREMIUM, SPORTS, VAN, PICKUP, BUS, SPECIAL.

Standard ancillary codes:
GPS, CHILD_SEAT, BOOSTER_SEAT, ADDITIONAL_DRIVER, YOUNG_DRIVER_SURCHARGE, CROSS_BORDER_OMAN, CROSS_BORDER_SAUDI, CROSS_BORDER_QATAR, SALIK_TAG, DELIVERY_PICKUP, AIRPORT_PICKUP_FEE, EXTRA_KM_PACK, FUEL_PRE_PAID, WIFI_HOTSPOT.

Note: "Saudi tourist family" indicates customer nationality, NOT cross-border travel to Saudi Arabia, unless the brief states driving to/visiting Saudi/KSA.
Resolve relative dates (e.g., "this Saturday", "next Friday", "10 days") relative to today's UAE date.`;

function sanitizeLlmIntent(
  raw: Record<string, unknown>,
  fallback: ExtractedRentalIntent,
): ExtractedRentalIntent {
  const cat = normalizeRentalCategory(String(raw.vehicleCategory ?? fallback.vehicleCategory)) || fallback.vehicleCategory;

  const pStr = typeof raw.pickupDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.pickupDate)
    ? raw.pickupDate
    : fallback.pickupDate;
  const pDate = new Date(`${pStr}T00:00:00.000Z`);
  const validP = !Number.isNaN(pDate.getTime()) ? pDate : new Date(`${fallback.pickupDate}T00:00:00.000Z`);

  let days = Number(raw.rentalDays);
  if (!Number.isFinite(days) || days < 1 || days > 365) {
    days = fallback.rentalDays;
  } else {
    days = Math.round(days);
  }

  let dDate = addUtcDays(validP, days);
  if (typeof raw.dropoffDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.dropoffDate)) {
    const parsedD = new Date(`${raw.dropoffDate}T00:00:00.000Z`);
    if (!Number.isNaN(parsedD.getTime()) && parsedD > validP) {
      dDate = parsedD;
      days = Math.max(1, Math.round((dDate.getTime() - validP.getTime()) / 86_400_000));
    }
  }

  const validCustomerTypes = new Set([
    'INDIVIDUAL',
    'CORPORATE',
    'AIRLINE',
    'INSURANCE',
    'FREQUENT_FLYER',
    'GOVERNMENT',
  ]);
  const customerType = validCustomerTypes.has(String(raw.customerType ?? ''))
    ? (String(raw.customerType) as ExtractedRentalIntent['customerType'])
    : fallback.customerType;

  const validChannels = new Set(['DIRECT', 'CORPORATE', 'AGENCY', 'ONLINE']);
  const channel = validChannels.has(String(raw.channel ?? ''))
    ? (String(raw.channel) as ExtractedRentalIntent['channel'])
    : fallback.channel;

  const validIns = new Set(['MINIMUM', 'CDW', 'LDW', 'TP', 'PAI', 'SUPER_CDW']);
  const insurancePlanCode = validIns.has(String(raw.insurancePlanCode ?? ''))
    ? (String(raw.insurancePlanCode) as ExtractedRentalIntent['insurancePlanCode'])
    : fallback.insurancePlanCode;

  const ancMap = new Map<string, number>();
  for (const item of fallback.requestedAncillaries) {
    ancMap.set(item.code.toUpperCase(), item.quantity);
  }
  if (Array.isArray(raw.requestedAncillaries)) {
    for (const item of raw.requestedAncillaries) {
      if (item && typeof item === 'object') {
        const c = String((item as { code?: unknown }).code ?? '').trim().toUpperCase();
        const q = Math.max(1, Math.min(20, Math.round(Number((item as { quantity?: unknown }).quantity ?? 1) || 1)));
        if (c) ancMap.set(c, q);
      }
    }
  }

  const detectedLanguage =
    raw.detectedLanguage === 'ar' || raw.detectedLanguage === 'en' || raw.detectedLanguage === 'mixed'
      ? raw.detectedLanguage
      : fallback.detectedLanguage;
  const language: 'en' | 'ar' =
    detectedLanguage === 'ar' ? 'ar' : fallback.language;

  const confidence =
    raw.confidence === 'high' || raw.confidence === 'medium' || raw.confidence === 'low'
      ? raw.confidence
      : fallback.confidence;

  const warnings = Array.isArray(raw.warnings)
    ? Array.from(
        new Set([
          ...raw.warnings.filter((w): w is string => typeof w === 'string' && w.trim().length > 0),
          ...fallback.warnings,
        ]),
      )
    : fallback.warnings;

  return {
    vehicleCategory: cat,
    pickupDate: formatIsoDate(validP),
    dropoffDate: formatIsoDate(dDate),
    rentalDays: days,
    pickupLocation:
      typeof raw.pickupLocation === 'string' && raw.pickupLocation.trim()
        ? raw.pickupLocation.trim()
        : fallback.pickupLocation,
    dropoffLocation:
      typeof raw.dropoffLocation === 'string' && raw.dropoffLocation.trim()
        ? raw.dropoffLocation.trim()
        : fallback.dropoffLocation,
    pickupLocationCode:
      typeof raw.pickupLocationCode === 'string' && raw.pickupLocationCode.trim()
        ? raw.pickupLocationCode.trim().toUpperCase()
        : fallback.pickupLocationCode,
    dropoffLocationCode:
      typeof raw.dropoffLocationCode === 'string' && raw.dropoffLocationCode.trim()
        ? raw.dropoffLocationCode.trim().toUpperCase()
        : fallback.dropoffLocationCode,
    customerType,
    channel,
    insurancePlanCode,
    requestedAncillaries: Array.from(ancMap.entries()).map(([code, quantity]) => ({
      code,
      quantity,
    })),
    promoCode:
      typeof raw.promoCode === 'string' && raw.promoCode.trim()
        ? raw.promoCode.trim().toUpperCase()
        : fallback.promoCode,
    youngDriverUnder25: Boolean(raw.youngDriverUnder25) || fallback.youngDriverUnder25,
    crossBorderDestination:
      raw.crossBorderDestination === 'OMAN' ||
      raw.crossBorderDestination === 'SAUDI' ||
      raw.crossBorderDestination === 'QATAR' ||
      raw.crossBorderDestination === 'BAHRAIN'
        ? raw.crossBorderDestination
        : fallback.crossBorderDestination,
    language,
    detectedLanguage,
    confidence,
    warnings,
  };
}

/**
 * Phase 1: Extracts structured rental intent from `brief` strictly OUTSIDE `withTenantRls`.
 * Cascades: Gemini 3.8 Flash -> OpenAI -> Deterministic Bilingual NLP Parser.
 */
export async function extractRentalIntent(
  brief: string,
): Promise<RentalIntentExtractionResult | RentalCopilotError> {
  if (!brief || brief.trim().length < 10) {
    return {
      ok: false,
      error: 'Brief is too short. Describe the rental needs in at least one sentence.',
    };
  }

  const t0 = Date.now();
  const today = formatIsoDate(getUaeTodayDate());
  const deterministicFallback = parseRentalIntentDeterministic(brief);

  // 1. Primary: Gemini 3.8 Flash Interactions REST API (zero extra npm dependency)
  const geminiKey =
    process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_AI_API_KEY?.trim() || '';
  if (geminiKey) {
    try {
      const geminiSchema = {
        type: 'object',
        properties: {
          vehicleCategory: { type: 'string' },
          pickupDate: { type: 'string' },
          dropoffDate: { type: 'string' },
          rentalDays: { type: 'integer' },
          pickupLocation: { type: 'string' },
          dropoffLocation: { type: 'string' },
          pickupLocationCode: { type: 'string' },
          dropoffLocationCode: { type: 'string' },
          customerType: { type: 'string' },
          channel: { type: 'string' },
          insurancePlanCode: { type: 'string' },
          requestedAncillaries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                quantity: { type: 'integer' },
              },
              required: ['code', 'quantity'],
            },
          },
          promoCode: { type: 'string' },
          youngDriverUnder25: { type: 'boolean' },
          crossBorderDestination: { type: 'string' },
          detectedLanguage: { type: 'string' },
          confidence: { type: 'string' },
          warnings: { type: 'array', items: { type: 'string' } },
        },
        required: [
          'vehicleCategory',
          'pickupDate',
          'dropoffDate',
          'rentalDays',
          'pickupLocation',
          'dropoffLocation',
          'customerType',
          'channel',
          'insurancePlanCode',
          'requestedAncillaries',
          'detectedLanguage',
          'confidence',
          'warnings',
        ],
      };

      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: {
          'x-goog-api-key': geminiKey,
          'Content-Type': 'application/json',
          'Api-Revision': '2026-05-20',
        },
        body: JSON.stringify({
          model: 'gemini-3.8-flash',
          system_instruction: INTENT_SYSTEM_PROMPT,
          input: `Today's date in UAE timezone (UTC+4): ${today}\n\nCustomer brief:\n${brief.trim()}`,
          store: false,
          response_format: {
            type: 'text',
            mime_type: 'application/json',
            schema: geminiSchema,
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (res.ok) {
        const data = (await res.json()) as {
          model?: string;
          steps?: Array<{
            type?: string;
            content?: Array<{ type?: string; text?: string }>;
          }>;
          usage?: {
            input_tokens?: number;
            output_tokens?: number;
            prompt_tokens?: number;
            completion_tokens?: number;
          };
        };

        const modelOutputs = (data.steps ?? []).filter((s) => s.type === 'model_output');
        const lastOutput = modelOutputs[modelOutputs.length - 1];
        const rawText = (lastOutput?.content ?? [])
          .filter((c) => c.type === 'text' && typeof c.text === 'string')
          .map((c) => c.text)
          .join('')
          .trim();

        if (rawText) {
          const parsed = JSON.parse(rawText) as Record<string, unknown>;
          return {
            ok: true,
            intent: sanitizeLlmIntent(parsed, deterministicFallback),
            modelUsed: data.model ?? 'gemini-3.8-flash',
            promptTokens: data.usage?.input_tokens ?? data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.output_tokens ?? data.usage?.completion_tokens ?? 0,
            durationMs: Date.now() - t0,
          };
        }
      }
    } catch (err) {
      console.warn(
        '[rental-copilot] Gemini intent extraction failed, cascading to fallback:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  // 2. Secondary: OpenAI Structured Outputs (Intent extraction ONLY — zero prices)
  if (hasOpenAI && env.OPENAI_API_KEY) {
    try {
      const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: INTENT_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Today's date in UAE timezone (UTC+4): ${today}\n\nCustomer brief:\n${brief.trim()}`,
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'extracted_rental_intent',
            strict: true,
            schema: INTENT_EXTRACTION_SCHEMA_JSON,
          },
        },
        temperature: 0.1,
        max_tokens: 900,
      });

      const raw = completion.choices[0]?.message?.content ?? '';
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return {
          ok: true,
          intent: sanitizeLlmIntent(parsed, deterministicFallback),
          modelUsed: completion.model,
          promptTokens: completion.usage?.prompt_tokens ?? 0,
          completionTokens: completion.usage?.completion_tokens ?? 0,
          durationMs: Date.now() - t0,
        };
      }
    } catch (err) {
      console.warn(
        '[rental-copilot] OpenAI intent extraction failed, using deterministic bilingual parser:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  // 3. Deterministic Bilingual (English + Arabic) NLP Parser
  return {
    ok: true,
    intent: deterministicFallback,
    modelUsed: 'deterministic-bilingual-nlp-v2',
    promptTokens: 0,
    completionTokens: 0,
    durationMs: Date.now() - t0,
  };
}

/* ── Phase 2: Grounded DB Quote Builder (Strictly Inside `withTenantRls`) ── */

interface RawAvailableVehicleRow {
  id: string;
  license_plate: string | null;
  make: string | null;
  model: string | null;
  year: number | bigint | string | null;
  category: string | null;
  vehicle_type: string | null;
  status: string | null;
  fuel_level: number | string | null;
  current_mileage: number | bigint | string | null;
  odometer_reading: number | bigint | string | null;
  branch_id: string | null;
}

interface CatalogueAncillaryRow {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  pricingType: string;
  unitPrice: number;
  applicableCategories: string | null;
}

function isOneTimePricingType(pricingType: string): boolean {
  const upper = pricingType.trim().toUpperCase();
  return (
    upper === 'FLAT' ||
    upper === 'ONE_TIME' ||
    upper === 'ONETIME' ||
    upper === 'PER_RENTAL' ||
    upper === 'PER_TRIP' ||
    upper === 'FIXED' ||
    upper === 'ONCE'
  );
}

function ancillaryAppliesToCategory(applicableCategories: string | null, category: string): boolean {
  if (!applicableCategories || !applicableCategories.trim()) return true;
  const upper = applicableCategories.trim().toUpperCase();
  if (upper === 'ALL' || upper === '*') return true;
  const tokens = upper
    .split(/[,;|]+/)
    .map((s) => normalizeRentalCategory(s.trim()))
    .filter(Boolean);
  return tokens.length === 0 || tokens.includes(category);
}

function matchCatalogueAncillary(
  requestedCode: string,
  catalogue: CatalogueAncillaryRow[],
  category: string,
): CatalogueAncillaryRow | null {
  const upperReq = requestedCode.trim().toUpperCase();
  const sysDef = SYSTEM_ANCILLARY_TARIFFS.find(
    (s) => s.code === upperReq || s.aliases.includes(upperReq),
  );
  const candidateCodes = new Set<string>([upperReq, ...(sysDef?.aliases ?? [])]);

  for (const row of catalogue) {
    if (!ancillaryAppliesToCategory(row.applicableCategories, category)) continue;
    const rowCode = row.code.trim().toUpperCase();
    if (candidateCodes.has(rowCode)) return row;
  }

  // Secondary fuzzy token match on code / nameEn
  for (const row of catalogue) {
    if (!ancillaryAppliesToCategory(row.applicableCategories, category)) continue;
    const hay = `${row.code} ${row.nameEn}`.toUpperCase();
    for (const alias of candidateCodes) {
      if (alias.length >= 3 && hay.includes(alias.replace(/_/g, ' '))) {
        return row;
      }
    }
  }

  return null;
}

function resolveBestInsuranceCodeForRule(
  requestedCode: string,
  pricingRules: PricingRuleRow[],
  vehicleCategory: string,
): string {
  if (requestedCode === 'MINIMUM') return 'MINIMUM';

  const aliasMap: Record<string, string[]> = {
    SUPER_CDW: ['SUPER_CDW', 'SCDW', 'FULL', 'ZERO_EXCESS', 'COMPREHENSIVE', 'ALL_INCLUSIVE'],
    CDW: ['CDW', 'STANDARD', 'BASIC_CDW', 'COLLISION'],
    LDW: ['LDW', 'LOSS_DAMAGE', 'CDW'],
    PAI: ['PAI', 'PERSONAL_ACCIDENT'],
    TP: ['TP', 'THEFT'],
  };
  const candidates = aliasMap[requestedCode] ?? [requestedCode];

  for (const r of pricingRules) {
    const rCat = normalizeRentalCategory(String(r.vehicle_category ?? r.vehicleCategory ?? ''));
    if (rCat && rCat !== vehicleCategory && rCat !== 'ALL') continue;
    const rawPlans = r.insurance_plans ?? r.insurancePlans;
    if (!rawPlans) continue;
    try {
      const plans = JSON.parse(String(rawPlans)) as Array<{ code?: string }>;
      for (const cand of candidates) {
        const found = plans.find((p) => String(p.code ?? '').trim().toUpperCase() === cand);
        if (found?.code) return found.code;
      }
    } catch {
      // ignore malformed JSON
    }
  }
  return requestedCode;
}

/**
 * Phase 2: Grounds an `ExtractedRentalIntent` inside `withTenantRls` using
 * real fleet availability, `rental_ancillaries`, `pricing_rules`, and `rate_events`.
 * All queries on `tx` execute strictly sequentially (never `Promise.all(tx.*)`).
 */
export async function buildGroundedRentalQuoteInTx(
  tx: TxClient,
  tenantId: string,
  intent: ExtractedRentalIntent,
): Promise<GroundedRentalQuotePayload> {
  const canonicalCategory = normalizeRentalCategory(intent.vehicleCategory) || 'MID_SIZE';
  const pickupDate = new Date(`${intent.pickupDate}T09:00:00.000Z`);
  const dropoffDate = new Date(`${intent.dropoffDate}T09:00:00.000Z`);
  const rentalDays = Math.max(
    1,
    Math.round((dropoffDate.getTime() - pickupDate.getTime()) / 86_400_000),
  );
  const warnings = [...intent.warnings];

  // 1. Sequential Query: Candidate non-conflicting vehicles in tenant
  const rawVehicles = await withSavepoint<RawAvailableVehicleRow[]>(
    tx,
    'copilot_avail_vehicles',
    () =>
      tx.$queryRawUnsafe<RawAvailableVehicleRow[]>(
        `SELECT v.id::text AS id,
                v.license_plate,
                v.make,
                v.model,
                v.year,
                v.category::text AS category,
                v.vehicle_type::text AS vehicle_type,
                v.status::text AS status,
                v.fuel_level,
                v.current_mileage,
                v.odometer_reading,
                v.branch_id::text AS branch_id
           FROM vehicles v
          WHERE v.tenant_id::text = $1
            AND v.deleted_at IS NULL
            AND COALESCE(v.is_active, true) = true
            AND UPPER(COALESCE(v.status::text, 'AVAILABLE')) NOT IN (
              'INACTIVE', 'SOLD', 'DECOMMISSIONED', 'MAINTENANCE', 'OUT_OF_SERVICE', 'GROUNDED'
            )
            AND NOT EXISTS (
              SELECT 1
                FROM rental_bookings rb
               WHERE rb.tenant_id::text = $1
                 AND rb.vehicle_id = v.id::text
                 AND rb.deleted_at IS NULL
                 AND rb.status IN ('CONFIRMED', 'ACTIVE')
                 AND rb.pickup_date < $3::timestamptz
                 AND rb.dropoff_date > $2::timestamptz
            )
            AND NOT EXISTS (
              SELECT 1
                FROM rental_agreements ra
               WHERE ra.tenant_id::text = $1
                 AND ra.vehicle_id = v.id::text
                 AND ra.deleted_at IS NULL
                 AND ra.status IN ('DRAFT', 'ACTIVE')
                 AND ra.start_date < $3::timestamptz
                 AND ra.end_date > $2::timestamptz
            )
          ORDER BY CASE WHEN UPPER(COALESCE(v.status::text, '')) = 'AVAILABLE' THEN 0 ELSE 1 END,
                   v.updated_at DESC NULLS LAST`,
        tenantId,
        pickupDate.toISOString(),
        dropoffDate.toISOString(),
      ),
    [],
  );

  // 2. Sequential Query: Exclude vehicles with open Workshop WorkOrders
  const openWoRows = await withSavepoint<Array<{ vehicle_id: string }>>(
    tx,
    'copilot_open_wo',
    () =>
      tx.$queryRawUnsafe<Array<{ vehicle_id: string }>>(
        `SELECT DISTINCT mr.vehicle_id::text AS vehicle_id
           FROM "WorkOrder" wo
           JOIN maintenance_requests mr ON mr.id::text = wo."requestId"::text
          WHERE wo.tenant_id::text = $1
            AND mr.deleted_at IS NULL
            AND UPPER(COALESCE(wo.status::text, '')) NOT IN ('COMPLETED', 'CLOSED', 'CANCELLED')`,
        tenantId,
      ),
    [],
  );
  const openWoSet = new Set(openWoRows.map((r) => r.vehicle_id));

  // 3. Sequential Query: Exclude vehicles allocated to active Lease contracts
  const leaseAllocatedRows = await withSavepoint<Array<{ vehicle_id: string }>>(
    tx,
    'copilot_lease_alloc',
    () =>
      tx.$queryRawUnsafe<Array<{ vehicle_id: string }>>(
        `SELECT lao.vehicle_id::text AS vehicle_id
           FROM lease_allocation_occurrences lao
          WHERE lao.tenant_id::text = $1
            AND lao.status = 'ACTIVE'
         UNION
         SELECT lcv.vehicle_id::text AS vehicle_id
           FROM lease_contract_vehicles lcv
           JOIN lease_contracts_v2 lc ON lc.id = lcv.contract_id
          WHERE lcv.tenant_id::text = $1
            AND COALESCE(lcv.status, 'ACTIVE') = 'ACTIVE'
            AND UPPER(COALESCE(lc.status, '')) IN ('ACTIVE', 'SIGNED', 'DISPATCHED')`,
        tenantId,
      ),
    [],
  );
  const leaseAllocatedSet = new Set(leaseAllocatedRows.map((r) => r.vehicle_id));

  // 4. Sequential Query: Exclude Fleet Grounding Blocks
  const candidateIds = rawVehicles.map((v) => v.id);
  const groundingMap =
    candidateIds.length > 0
      ? await withSavepoint(
          tx,
          'copilot_grounding_blocks',
          () => findGroundingBlocks(tx, tenantId, candidateIds),
          new Map(),
        )
      : new Map();

  const vehiclesByCategory = new Map<string, GroundedAvailableVehicle[]>();
  for (const v of rawVehicles) {
    if (openWoSet.has(v.id)) continue;
    if (leaseAllocatedSet.has(v.id)) continue;
    if ((groundingMap.get(v.id) ?? []).length > 0) continue;

    const normCat =
      normalizeRentalCategory(v.category ?? v.vehicle_type ?? 'ECONOMY') || 'ECONOMY';
    const mapped: GroundedAvailableVehicle = {
      id: v.id,
      licensePlate: String(v.license_plate ?? 'UNPLATED'),
      make: String(v.make ?? 'Fleet'),
      model: String(v.model ?? 'Vehicle'),
      year: v.year != null && Number.isFinite(Number(v.year)) ? Number(v.year) : null,
      category: normCat,
      status: String(v.status ?? 'AVAILABLE'),
      fuelPct: normalizeFuelPct(v.fuel_level) ?? 100,
      odometerKm:
        v.current_mileage != null && Number.isFinite(Number(v.current_mileage))
          ? Number(v.current_mileage)
          : v.odometer_reading != null && Number.isFinite(Number(v.odometer_reading))
            ? Number(v.odometer_reading)
            : null,
      branchId: v.branch_id ?? null,
    };

    const bucket = vehiclesByCategory.get(normCat) ?? [];
    bucket.push(mapped);
    vehiclesByCategory.set(normCat, bucket);
  }

  const availableVehicles = vehiclesByCategory.get(canonicalCategory) ?? [];

  // 5. Sequential Query: Tenant `rental_ancillaries` master catalogue (camelCase/snake_case safe)
  const rawAncillaryJsonRows = await withSavepoint<Array<{ row_json: Record<string, unknown> }>>(
    tx,
    'copilot_ancillaries_cat',
    () =>
      tx.$queryRawUnsafe<Array<{ row_json: Record<string, unknown> }>>(
        `SELECT to_jsonb(ra) AS row_json
           FROM rental_ancillaries ra
          WHERE ra.tenant_id::text = $1
            AND ra.deleted_at IS NULL`,
        tenantId,
      ),
    [],
  );

  const catalogueAncillaries: CatalogueAncillaryRow[] = [];
  for (const wrapper of rawAncillaryJsonRows) {
    const r = wrapper.row_json ?? {};
    const active =
      r.isActive !== undefined
        ? Boolean(r.isActive)
        : r.is_active !== undefined
          ? Boolean(r.is_active)
          : true;
    if (!active) continue;
    catalogueAncillaries.push({
      id: String(r.id ?? ''),
      code: String(r.code ?? '').trim(),
      nameEn: String(r.name_en ?? r.nameEn ?? r.code ?? 'Ancillary'),
      nameAr: r.name_ar != null ? String(r.name_ar) : r.nameAr != null ? String(r.nameAr) : null,
      pricingType: String(r.pricing_type ?? r.pricingType ?? 'PER_DAY'),
      unitPrice: Math.max(0, Number(r.unit_price ?? r.unitPrice ?? 0) || 0),
      applicableCategories:
        r.applicable_categories != null
          ? String(r.applicable_categories)
          : r.applicableCategories != null
            ? String(r.applicableCategories)
            : null,
    });
  }

  const groundedAncillaries: GroundedAncillaryLine[] = [];
  for (const reqAnc of intent.requestedAncillaries) {
    const matched = matchCatalogueAncillary(reqAnc.code, catalogueAncillaries, canonicalCategory);
    if (matched) {
      const isOneTime = isOneTimePricingType(matched.pricingType);
      const unitCharge = round2(matched.unitPrice);
      const totalCharge = round2(reqAnc.quantity * unitCharge * (isOneTime ? 1 : rentalDays));
      groundedAncillaries.push({
        ancillaryId: matched.id,
        code: matched.code,
        nameEn: matched.nameEn,
        nameAr: matched.nameAr,
        description:
          intent.language === 'ar' && matched.nameAr ? matched.nameAr : matched.nameEn,
        quantity: reqAnc.quantity,
        unitCharge,
        isOneTime,
        pricingType: matched.pricingType,
        totalCharge,
        source: 'TENANT_CATALOGUE',
      });
    } else {
      const sysTariff = SYSTEM_ANCILLARY_TARIFFS.find(
        (s) =>
          s.code === reqAnc.code.toUpperCase() || s.aliases.includes(reqAnc.code.toUpperCase()),
      );
      const unitCharge = sysTariff ? sysTariff.unitPrice : 0;
      const isOneTime = sysTariff ? sysTariff.isOneTime : false;
      const nameEn = sysTariff?.nameEn ?? reqAnc.code.replace(/_/g, ' ');
      const nameAr = sysTariff?.nameAr ?? null;
      const totalCharge = round2(reqAnc.quantity * unitCharge * (isOneTime ? 1 : rentalDays));
      groundedAncillaries.push({
        ancillaryId: null,
        code: reqAnc.code.toUpperCase(),
        nameEn,
        nameAr,
        description: intent.language === 'ar' && nameAr ? nameAr : nameEn,
        quantity: reqAnc.quantity,
        unitCharge,
        isOneTime,
        pricingType: isOneTime ? 'ONE_TIME' : 'PER_DAY',
        totalCharge,
        source: 'SYSTEM_TARIFF_FALLBACK',
      });
      warnings.push(
        intent.language === 'ar'
          ? `الإضافة (${nameAr ?? nameEn}) غير مسجلة في كتالوج الإضافات الخاص بالمستأجر؛ تم احتساب السعر المعياري (${unitCharge} درهم).`
          : `Ancillary "${nameEn}" is not yet configured in your Ancillaries Master; priced using standard tariff (AED ${unitCharge}).`,
      );
    }
  }

  // 6. Sequential Query: Active `pricing_rules` & `rate_events` metadata for transparency
  const activeRuleRows = await withSavepoint<PricingRuleRow[]>(
    tx,
    'copilot_pricing_rules_meta',
    () =>
      tx.$queryRawUnsafe<PricingRuleRow[]>(
        `SELECT * FROM pricing_rules
          WHERE tenant_id::text = $1 AND is_active = true
          ORDER BY priority DESC`,
        tenantId,
      ),
    [],
  );

  const activeEventRows = await withSavepoint<Record<string, unknown>[]>(
    tx,
    'copilot_rate_events_meta',
    () =>
      tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT *
           FROM rate_events
          WHERE tenant_id::text = $1
            AND deleted_at IS NULL
            AND is_active = true
            AND date_from <= $2::timestamptz
            AND date_to >= $3::timestamptz
          ORDER BY priority DESC`,
        tenantId,
        dropoffDate.toISOString(),
        pickupDate.toISOString(),
      ),
    [],
  );

  const resolvedInsCode = resolveBestInsuranceCodeForRule(
    intent.insurancePlanCode,
    activeRuleRows,
    canonicalCategory,
  );

  const extraOptions = groundedAncillaries.map((a) => ({
    name: `${a.nameEn}${a.quantity > 1 ? ` × ${a.quantity}` : ''}`,
    amount: a.totalCharge,
  }));

  // 7. Sequential Query: Authoritative `quoteRentalRateInTx`
  const primaryQuote = await quoteRentalRateInTx(tx, tenantId, {
    vehicleCategory: canonicalCategory,
    pickupDate,
    dropoffDate,
    pickupLocationCode: intent.pickupLocationCode,
    dropoffLocationCode: intent.dropoffLocationCode,
    customerType: intent.customerType,
    channel: intent.channel,
    promoCode: intent.promoCode ?? undefined,
    insurancePlanCode: resolvedInsCode,
    extraOptions,
    enableYieldLayers: true,
  });

  if (!primaryQuote.appliedRuleId) {
    warnings.push(
      intent.language === 'ar'
        ? `لا توجد قاعدة تسعير نشطة في شاشة الأسعار (/rental/rates) للفئة ${CATEGORY_ARABIC_LABELS[canonicalCategory] ?? canonicalCategory}.`
        : `No active PricingRule found in /rental/rates for ${formatRentalCategoryLabel(canonicalCategory, { short: true })}. Configure a tariff rule to avoid AED 0 base rates.`,
    );
  }

  const matchedRuleRow = primaryQuote.appliedRuleId
    ? activeRuleRows.find((r) => String(r.id) === primaryQuote.appliedRuleId) ?? null
    : null;

  const appliedPricingRule: GroundedPricingRuleMeta | null = matchedRuleRow
    ? {
        id: String(matchedRuleRow.id),
        name: String(matchedRuleRow.name ?? canonicalCategory),
        vehicleCategory: String(
          matchedRuleRow.vehicle_category ?? matchedRuleRow.vehicleCategory ?? canonicalCategory,
        ),
        baseDailyRate: Number(
          matchedRuleRow.base_daily_rate ?? matchedRuleRow.baseDailyRate ?? primaryQuote.dailyRate,
        ),
        weeklyRate:
          matchedRuleRow.weekly_rate != null
            ? Number(matchedRuleRow.weekly_rate)
            : matchedRuleRow.weeklyRate != null
              ? Number(matchedRuleRow.weeklyRate)
              : null,
        monthlyRate:
          matchedRuleRow.monthly_rate != null
            ? Number(matchedRuleRow.monthly_rate)
            : matchedRuleRow.monthlyRate != null
              ? Number(matchedRuleRow.monthlyRate)
              : null,
        includedKmPerDay: primaryQuote.includedKmPerDay,
        excessKmRate: primaryQuote.excessKmRate,
        gracePeriodMin: primaryQuote.gracePeriodMin,
      }
    : null;

  const activeRateEvents: GroundedRateEventMeta[] = activeEventRows.map((ev) => {
    const code = String(ev.event_code ?? ev.eventCode ?? ev.name ?? '');
    return {
      id: String(ev.id ?? ''),
      eventCode: code,
      name: String(ev.name ?? code),
      dateFrom: new Date(String(ev.date_from ?? ev.dateFrom ?? pickupDate.toISOString()))
        .toISOString()
        .slice(0, 10),
      dateTo: new Date(String(ev.date_to ?? ev.dateTo ?? dropoffDate.toISOString()))
        .toISOString()
        .slice(0, 10),
      multiplier: Number(ev.multiplier ?? 1),
      flatSurcharge: Number(ev.flat_surcharge ?? ev.flatSurcharge ?? 0),
      isApplied: primaryQuote.appliedEventCode === code,
    };
  });

  // 8. Nearest In-Stock Upgrade Alternative when requested category has 0 available vehicles
  let upgradeAlternative: GroundedUpgradeAlternative | null = null;
  if (availableVehicles.length === 0) {
    warnings.push(
      intent.language === 'ar'
        ? `لا توجد مركبات متاحة حالياً في الفئة المطلوبة (${CATEGORY_ARABIC_LABELS[canonicalCategory] ?? canonicalCategory}) خلال الفترة المحددة.`
        : `0 vehicles currently available in ${formatRentalCategoryLabel(canonicalCategory, { short: true })} for ${intent.pickupDate} → ${intent.dropoffDate}.`,
    );

    const ladder = [
      ...(RAC_UPGRADE_LADDER[canonicalCategory] ?? []),
      ...RENTAL_VEHICLE_CATEGORIES.map((c) => c.value),
    ];
    const seen = new Set<string>([canonicalCategory]);
    let chosenUpgradeCat: string | null = null;

    for (const candidateCat of ladder) {
      if (seen.has(candidateCat)) continue;
      seen.add(candidateCat);
      if ((vehiclesByCategory.get(candidateCat) ?? []).length > 0) {
        chosenUpgradeCat = candidateCat;
        break;
      }
    }

    if (chosenUpgradeCat) {
      const upgradeVehicles = vehiclesByCategory.get(chosenUpgradeCat) ?? [];
      const upgradeInsCode = resolveBestInsuranceCodeForRule(
        intent.insurancePlanCode,
        activeRuleRows,
        chosenUpgradeCat,
      );
      const upgradeQuote = await quoteRentalRateInTx(tx, tenantId, {
        vehicleCategory: chosenUpgradeCat,
        pickupDate,
        dropoffDate,
        pickupLocationCode: intent.pickupLocationCode,
        dropoffLocationCode: intent.dropoffLocationCode,
        customerType: intent.customerType,
        channel: intent.channel,
        promoCode: intent.promoCode ?? undefined,
        insurancePlanCode: upgradeInsCode,
        extraOptions,
        enableYieldLayers: true,
      });

      const sampleCar = upgradeVehicles[0];
      const catShortEn = formatRentalCategoryLabel(canonicalCategory, { short: true });
      const upShortEn = formatRentalCategoryLabel(chosenUpgradeCat, { short: true });
      const catAr = CATEGORY_ARABIC_LABELS[canonicalCategory] ?? canonicalCategory;
      const upAr = CATEGORY_ARABIC_LABELS[chosenUpgradeCat] ?? chosenUpgradeCat;

      upgradeAlternative = {
        vehicleCategory: chosenUpgradeCat,
        categoryLabel: formatRentalCategoryLabel(chosenUpgradeCat),
        availableCount: upgradeVehicles.length,
        availableVehicles: upgradeVehicles.slice(0, 6),
        quoteBreakdown: upgradeQuote,
        dailyRate: upgradeQuote.dailyRate,
        totalAmount: upgradeQuote.totalAmount,
        rateDeltaPerDay: round2(upgradeQuote.dailyRate - primaryQuote.dailyRate),
        totalDeltaAmount: round2(upgradeQuote.totalAmount - primaryQuote.totalAmount),
        reasonEn: `Requested ${catShortEn} has 0 available units for ${intent.pickupDate} → ${intent.dropoffDate}. Nearest in-stock class is ${upShortEn} (${upgradeVehicles.length} vehicle${upgradeVehicles.length === 1 ? '' : 's'} ready, e.g. ${sampleCar.make} ${sampleCar.model} · ${sampleCar.licensePlate}) at AED ${upgradeQuote.dailyRate.toFixed(2)}/day.`,
        reasonAr: `الفئة المطلوبة (${catAr}) لا تتوفر بها مركبات شاغرة من ${intent.pickupDate} إلى ${intent.dropoffDate}. أقرب فئة بديلة متوفرة في الأسطول هي (${upAr}) بعدد ${upgradeVehicles.length} مركبة جاهزة (مثل ${sampleCar.make} ${sampleCar.model} · ${sampleCar.licensePlate}) بسعر ${upgradeQuote.dailyRate.toFixed(2)} درهم/يوم.`,
      };
    }
  }

  // 9. Build Bilingual Grounded Explanation & Backward-Compatible `SuggestedRental`
  const baseCatalogDaily = appliedPricingRule?.baseDailyRate ?? primaryQuote.dailyRate;
  const lorDiscountPct =
    baseCatalogDaily > primaryQuote.dailyRate && baseCatalogDaily > 0
      ? round2(((baseCatalogDaily - primaryQuote.dailyRate) / baseCatalogDaily) * 100)
      : 0;

  const ancillariesTotal = round2(
    groundedAncillaries.reduce((sum, a) => sum + a.totalCharge, 0),
  );

  const defaultDeposit = CATEGORY_DEFAULT_DEPOSIT_AED[canonicalCategory] ?? 2000;
  const securityDeposit = Math.max(
    defaultDeposit,
    Math.ceil(primaryQuote.totalAmount / 500) * 500,
  );

  const realExampleVehicles =
    availableVehicles.length > 0
      ? Array.from(
          new Set(
            availableVehicles
              .slice(0, 5)
              .map((v) => `${v.make} ${v.model} (${v.licensePlate})`),
          ),
        )
      : CATEGORY_SAMPLE_MODELS[canonicalCategory] ?? ['Fleet Vehicle'];

  const ruleDescEn = appliedPricingRule
    ? `tariff "${appliedPricingRule.name}" (AED ${primaryQuote.dailyRate.toFixed(2)}/day, ${appliedPricingRule.includedKmPerDay} km/day included)`
    : `unmatched category tariff (AED ${primaryQuote.dailyRate.toFixed(2)}/day)`;
  const eventDescEn = primaryQuote.appliedEventName
    ? ` Active seasonal event "${primaryQuote.appliedEventName}" applied.`
    : '';
  const stockDescEn =
    availableVehicles.length > 0
      ? `${availableVehicles.length} fleet vehicle(s) verified available for ${intent.pickupDate} → ${intent.dropoffDate}.`
      : upgradeAlternative
        ? `0 units in ${formatRentalCategoryLabel(canonicalCategory, { short: true })}; ${upgradeAlternative.availableCount} unit(s) available in ${formatRentalCategoryLabel(upgradeAlternative.vehicleCategory, { short: true })}.`
        : `0 units currently available in ${formatRentalCategoryLabel(canonicalCategory, { short: true })}.`;

  const explanationEn = `Grounded quote computed from ${ruleDescEn} across ${rentalDays} day(s) for ${intent.customerType} (${intent.channel}) channel.${eventDescEn} Insurance (${intent.insurancePlanCode}: AED ${primaryQuote.insuranceCharge.toFixed(2)}) and ${groundedAncillaries.length} ancillary item(s) (AED ${ancillariesTotal.toFixed(2)}) plus 5% UAE VAT yield AED ${primaryQuote.totalAmount.toFixed(2)}. ${stockDescEn}`;

  const catArLabel = CATEGORY_ARABIC_LABELS[canonicalCategory] ?? canonicalCategory;
  const ruleDescAr = appliedPricingRule
    ? `التعرفة المعتمدة "${appliedPricingRule.name}" (${primaryQuote.dailyRate.toFixed(2)} درهم/يوم، شامل ${appliedPricingRule.includedKmPerDay} كم/يوم)`
    : `تعرفة الفئة ${catArLabel} (${primaryQuote.dailyRate.toFixed(2)} درهم/يوم)`;
  const eventDescAr = primaryQuote.appliedEventName
    ? ` تم تطبيق حدث التسعير الموسمي "${primaryQuote.appliedEventName}".`
    : '';
  const stockDescAr =
    availableVehicles.length > 0
      ? `تتوفر حالياً ${availableVehicles.length} مركبة جاهزة في الأسطول خلال الفترة من ${intent.pickupDate} إلى ${intent.dropoffDate}.`
      : upgradeAlternative
        ? `لا تتوفر مركبات شاغرة في فئة ${catArLabel}؛ تتوفر ${upgradeAlternative.availableCount} مركبة بديلة في فئة ${CATEGORY_ARABIC_LABELS[upgradeAlternative.vehicleCategory] ?? upgradeAlternative.vehicleCategory}.`
        : `لا تتوفر مركبات شاغرة حالياً في فئة ${catArLabel}.`;

  const explanationAr = `عرض سعر موثّق محسوب آلياً من محرك التسعير وفق ${ruleDescAr} لمدة ${rentalDays} يوم (${intent.channel}).${eventDescAr} يشمل التأمين (${intent.insurancePlanCode}: ${primaryQuote.insuranceCharge.toFixed(2)} درهم) وعدد ${groundedAncillaries.length} إضافات (${ancillariesTotal.toFixed(2)} درهم) وضريبة القيمة المضافة الإماراتية 5% بإجمالي ${primaryQuote.totalAmount.toFixed(2)} درهم. ${stockDescAr}`;

  const suggestion: SuggestedRental = {
    vehicleCategory: canonicalCategory as SuggestedRental['vehicleCategory'],
    exampleVehicles: realExampleVehicles,
    pickupLocation: intent.pickupLocation,
    dropoffLocation: intent.dropoffLocation,
    pickupDate: intent.pickupDate,
    dropoffDate: intent.dropoffDate,
    totalDays: rentalDays,
    channel: intent.channel,
    baseDailyRate: round2(baseCatalogDaily),
    appliedDailyRate: round2(primaryQuote.dailyRate),
    lorDiscountPct,
    baseRentalCharge: round2(primaryQuote.baseRentalCharge),
    insuranceTier: intent.insurancePlanCode,
    insuranceCharge: round2(primaryQuote.insuranceCharge),
    ancillaries: groundedAncillaries.map((a) => ({
      code: a.code,
      description: a.description,
      quantity: a.quantity,
      unitCharge: a.unitCharge,
      isOneTime: a.isOneTime,
      totalCharge: a.totalCharge,
    })),
    ancillariesTotal,
    subTotal: round2(primaryQuote.subtotal),
    vatPct: primaryQuote.taxRate,
    vatAmount: round2(primaryQuote.taxAmount),
    totalAmount: round2(primaryQuote.totalAmount),
    securityDeposit,
    pricingRationale: intent.language === 'ar' ? explanationAr : explanationEn,
    detectedLanguage: intent.detectedLanguage,
    confidence: intent.confidence,
    warnings: Array.from(new Set(warnings)),
  };

  return {
    intent: {
      ...intent,
      vehicleCategory: canonicalCategory,
      rentalDays,
      warnings: suggestion.warnings,
    },
    suggestion,
    quoteBreakdown: primaryQuote,
    availableVehicles,
    availableCount: availableVehicles.length,
    appliedPricingRule,
    activeRateEvents,
    ancillaries: groundedAncillaries,
    catalogueAncillariesCount: catalogueAncillaries.length,
    upgradeAlternative,
    explanation: {
      en: explanationEn,
      ar: explanationAr,
    },
  };
}

/* ── Legacy / Orchestrator Entrypoint (`generateRentalSuggestion`) ───────── */

export async function generateRentalSuggestion(
  brief: string,
  opts?: { tenantId?: string },
): Promise<RentalCopilotResult | RentalCopilotError> {
  const extracted = await extractRentalIntent(brief);
  if (!extracted.ok) {
    return extracted;
  }

  const t0 = Date.now();
  if (opts?.tenantId) {
    const grounded = await withTenantRls(prisma, opts.tenantId, (tx) =>
      buildGroundedRentalQuoteInTx(tx, opts.tenantId!, extracted.intent),
    );
    return {
      ok: true,
      suggestion: grounded.suggestion,
      grounded,
      modelUsed: extracted.modelUsed,
      promptTokens: extracted.promptTokens,
      completionTokens: extracted.completionTokens,
      durationMs: extracted.durationMs + (Date.now() - t0),
    };
  }

  // Stateless fallback when invoked without tenant DB context: uses deterministic rate engine with empty rule list
  const intent = extracted.intent;
  const pickupDate = new Date(`${intent.pickupDate}T09:00:00.000Z`);
  const dropoffDate = new Date(`${intent.dropoffDate}T09:00:00.000Z`);
  const ancillaries: Ancillary[] = intent.requestedAncillaries.map((reqAnc) => {
    const sys = SYSTEM_ANCILLARY_TARIFFS.find(
      (s) => s.code === reqAnc.code.toUpperCase() || s.aliases.includes(reqAnc.code.toUpperCase()),
    );
    const unitCharge = sys?.unitPrice ?? 0;
    const isOneTime = sys?.isOneTime ?? false;
    const totalCharge = round2(reqAnc.quantity * unitCharge * (isOneTime ? 1 : intent.rentalDays));
    return {
      code: reqAnc.code.toUpperCase(),
      description:
        intent.language === 'ar' && sys?.nameAr
          ? sys.nameAr
          : sys?.nameEn ?? reqAnc.code,
      quantity: reqAnc.quantity,
      unitCharge,
      isOneTime,
      totalCharge,
    };
  });

  const statelessQuote = calculateRate([], {
    vehicleCategory: intent.vehicleCategory,
    pickupDate,
    dropoffDate,
    customerType: intent.customerType,
    channel: intent.channel,
    insurancePlanCode: intent.insurancePlanCode,
    extraOptions: ancillaries.map((a) => ({ name: a.description, amount: a.totalCharge })),
    enableYieldLayers: true,
  });

  const ancillariesTotal = round2(ancillaries.reduce((s, a) => s + a.totalCharge, 0));
  const suggestion = enforceSuggestedRentalInvariants({
    vehicleCategory: intent.vehicleCategory as SuggestedRental['vehicleCategory'],
    exampleVehicles: CATEGORY_SAMPLE_MODELS[intent.vehicleCategory] ?? ['Fleet Vehicle'],
    pickupLocation: intent.pickupLocation,
    dropoffLocation: intent.dropoffLocation,
    pickupDate: intent.pickupDate,
    dropoffDate: intent.dropoffDate,
    totalDays: intent.rentalDays,
    channel: intent.channel,
    baseDailyRate: statelessQuote.dailyRate,
    appliedDailyRate: statelessQuote.dailyRate,
    lorDiscountPct: 0,
    baseRentalCharge: statelessQuote.baseRentalCharge,
    insuranceTier: intent.insurancePlanCode,
    insuranceCharge: statelessQuote.insuranceCharge,
    ancillaries,
    ancillariesTotal,
    subTotal: statelessQuote.subtotal,
    vatPct: 5,
    vatAmount: statelessQuote.taxAmount,
    totalAmount: statelessQuote.totalAmount,
    securityDeposit: CATEGORY_DEFAULT_DEPOSIT_AED[intent.vehicleCategory] ?? 2000,
    pricingRationale:
      'Stateless intent preview — pass tenantId or call /api/rental/bookings/copilot for grounded tariff & fleet availability.',
    detectedLanguage: intent.detectedLanguage,
    confidence: intent.confidence,
    warnings: intent.warnings,
  });

  return {
    ok: true,
    suggestion,
    modelUsed: extracted.modelUsed,
    promptTokens: extracted.promptTokens,
    completionTokens: extracted.completionTokens,
    durationMs: extracted.durationMs + (Date.now() - t0),
  };
}

/* ── AgentDefinition Adapter (Orchestrator / `registry.ts`) ──────────────── */

async function runRentalCopilotEvent(event: AgentEvent): Promise<AgentRunResult> {
  const t0 = Date.now();
  const brief = typeof event.payload?.brief === 'string' ? event.payload.brief : '';

  const result = await generateRentalSuggestion(brief, {
    tenantId: event.tenant_id || undefined,
  });

  if (!result.ok) {
    return {
      agentId: event.agent_id,
      tenantId: event.tenant_id,
      eventType: event.event_type,
      entityId: event.entity_id,
      status: 'FAILED',
      durationMs: Date.now() - t0,
      itemsProcessed: 0,
      actionsCreated: 0,
      output: null,
      error: result.error,
    };
  }

  return {
    agentId: event.agent_id,
    tenantId: event.tenant_id,
    eventType: event.event_type,
    entityId: event.entity_id,
    status: 'COMPLETED',
    durationMs: result.durationMs,
    itemsProcessed: 1,
    actionsCreated: 0,
    output: result.grounded ?? result.suggestion,
  };
}

export const RENTAL_COPILOT_AGENT: AgentDefinition = {
  id: 'rental-copilot',
  name: 'RAC Grounded Booking Co-pilot',
  description:
    'Extracts structured rental intent (EN/AR) and grounds quotes in live tenant PricingRules, RateEvents, Ancillaries Master, and physical fleet availability.',
  version: '2.0.0',
  agentType: 'INTERACTIVE_COPILOT',
  autonomyLevel: 'L1',
  subscribedEvents: ['rental.copilot_requested', 'manual.trigger'],
  supportsEntityScan: false,
  run: runRentalCopilotEvent,
};
