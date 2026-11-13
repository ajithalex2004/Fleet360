import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { TxClient } from '@/lib/rls';
import { RateLimiter } from '@/lib/rate-limiter';
import { getRateLimiter } from '@/lib/rate-limit-scope';
import {
  requireRacPortal,
  type RacPortalRequestContext,
} from '@/lib/rac-portal/auth';
import type { RacPortalRole } from '@/lib/rac-portal/portal-users-store';
import {
  categoriesMatch,
  normalizeRentalCategory,
  quoteRentalRateInTx,
  type RateBreakdownLine,
  type RateResult,
} from '@/lib/rental-rate-engine';
import { withSavepoint } from '@/lib/rental/locks';

// ── Sliding-window Rate Limiters & Role Guards (`PORTAL-02`, `PORTAL-04`, `PORTAL-07`) ──

const FIFTEEN_MINUTES_MS = 15 * 60_000;
const _racPortal15MinLimiter = new RateLimiter({
  windowMs: FIFTEEN_MINUTES_MS,
  maxRequests: 25,
});

export const ALL_RAC_PORTAL_ROLES: readonly RacPortalRole[] = [
  'RAC_B2B_VIEWER',
  'RAC_B2B_BOOKER',
  'RAC_B2B_USER',
  'RAC_B2B_FINANCE',
  'RAC_B2B_ADMIN',
];

export const BOOKING_RAC_PORTAL_ROLES: readonly RacPortalRole[] = [
  'RAC_B2B_BOOKER',
  'RAC_B2B_USER',
  'RAC_B2B_ADMIN',
];

export const PREAUTH_RAC_PORTAL_ROLES: readonly RacPortalRole[] = [
  'RAC_B2B_BOOKER',
  'RAC_B2B_USER',
  'RAC_B2B_FINANCE',
  'RAC_B2B_ADMIN',
];

export const FINANCE_SIGN_RAC_PORTAL_ROLES: readonly RacPortalRole[] = [
  'RAC_B2B_FINANCE',
  'RAC_B2B_ADMIN',
];

export const ADMIN_RAC_PORTAL_ROLES: readonly RacPortalRole[] = ['RAC_B2B_ADMIN'];

export function extractClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first.slice(0, 128);
  }
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp.slice(0, 128);
  return '127.0.0.1';
}

function buildRateLimitResponse(
  message: string,
  limit: number,
  remaining: number,
  resetMs: number,
  scope: string,
): NextResponse {
  const retryAfterSec = Math.max(1, Math.ceil((resetMs - Date.now()) / 1000));
  return NextResponse.json(
    {
      error: message,
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: retryAfterSec,
      scope,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSec),
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': String(remaining),
        'X-RateLimit-Reset': String(Math.ceil(resetMs / 1000)),
        'X-RateLimit-Scope': scope,
      },
    },
  );
}

/**
 * Login rate limit: max 8 attempts / 15 min per `(ip, lower(email))`
 * and max 25 attempts / 15 min per `ip`.
 */
export async function enforceRacPortalLoginRateLimit(
  req: NextRequest,
  email?: string | null,
): Promise<NextResponse | null> {
  const ip = extractClientIp(req);
  const ipCheck = await _racPortal15MinLimiter.check(`rac-portal:login:ip:${ip}`, 25);
  if (!ipCheck.allowed) {
    return buildRateLimitResponse(
      'Too many sign-in attempts from this network. Please wait before trying again.',
      25,
      ipCheck.remaining,
      ipCheck.resetMs,
      'rac-portal-login-ip',
    );
  }

  const normEmail = (email ?? '').trim().toLowerCase().slice(0, 254);
  if (normEmail) {
    const pairCheck = await _racPortal15MinLimiter.check(
      `rac-portal:login:ip-email:${ip}:${normEmail}`,
      8,
    );
    if (!pairCheck.allowed) {
      return buildRateLimitResponse(
        'Too many sign-in attempts for this account. Please wait before trying again.',
        8,
        pairCheck.remaining,
        pairCheck.resetMs,
        'rac-portal-login-account',
      );
    }
  }
  return null;
}

/**
 * Invitation setup rate limit: max 10 POST / 30 GET attempts per 15 min per `ip`,
 * plus per-token hash rate limiting to block distributed token probing.
 */
export async function enforceRacPortalSetupRateLimit(
  req: NextRequest,
  bucket: 'post' | 'preview' | 'post-token' = 'post',
  token?: string | null,
): Promise<NextResponse | null> {
  if (bucket !== 'post-token') {
    const ip = extractClientIp(req);
    const limit = bucket === 'post' ? 10 : 30;
    const check = await _racPortal15MinLimiter.check(
      `rac-portal:setup:${bucket}:ip:${ip}`,
      limit,
    );
    if (!check.allowed) {
      return buildRateLimitResponse(
        'Too many account setup attempts. Please wait before trying again.',
        limit,
        check.remaining,
        check.resetMs,
        'rac-portal-setup-ip',
      );
    }
  }

  const trimmedToken = (token ?? '').trim();
  if (trimmedToken) {
    const tokenHash = crypto
      .createHash('sha256')
      .update(trimmedToken)
      .digest('hex')
      .slice(0, 24);
    const tokenBucket = bucket === 'preview' ? 'preview' : 'post';
    const tokenLimit = tokenBucket === 'post' ? 8 : 20;
    const tokenCheck = await _racPortal15MinLimiter.check(
      `rac-portal:setup:${tokenBucket}:token:${tokenHash}`,
      tokenLimit,
    );
    if (!tokenCheck.allowed) {
      return buildRateLimitResponse(
        'Too many attempts for this invitation link. Please wait before trying again.',
        tokenLimit,
        tokenCheck.remaining,
        tokenCheck.resetMs,
        'rac-portal-setup-token',
      );
    }
  }

  return null;
}

/**
 * Payment & card pre-authorization rate limit: max 15 attempts / 15 min per `customerId`
 * (prevents automated card-testing via corporate accounts).
 */
export async function enforceRacPortalPaymentRateLimit(
  customerId: string,
): Promise<NextResponse | null> {
  const check = await _racPortal15MinLimiter.check(
    `rac-portal:payment:customer:${customerId}`,
    15,
  );
  if (!check.allowed) {
    return buildRateLimitResponse(
      'Too many card authorization or payment attempts for this corporate account. Please retry later.',
      15,
      check.remaining,
      check.resetMs,
      'rac-portal-payment-customer',
    );
  }
  return null;
}

/**
 * General authenticated B2B portal rate limit: max 180 requests / minute per `userId`
 * using the shared `getRateLimiter()` singleton (`windowMs = 60_000`).
 */
export async function enforceRacPortalUserRateLimit(
  userId: string,
): Promise<NextResponse | null> {
  const limiter = getRateLimiter();
  const check = await limiter.check(`rac-portal:user:${userId}`, 180);
  if (!check.allowed) {
    return buildRateLimitResponse(
      'Too many portal requests. Please slow down and try again shortly.',
      180,
      check.remaining,
      check.resetMs,
      'rac-portal-user',
    );
  }
  return null;
}

/**
 * Authenticates the B2B portal session (including `session_version` check),
 * enforces the 180 req/min per-user rate limit, and verifies that the caller's
 * corporate portal role is in `allowedRoles`.
 */
export async function requireRacPortalRole(
  req: NextRequest,
  allowedRoles: readonly RacPortalRole[],
  forbiddenMessage?: string,
): Promise<RacPortalRequestContext | NextResponse> {
  const ctx = await requireRacPortal(req);
  if (ctx instanceof NextResponse) return ctx;

  const rl = await enforceRacPortalUserRateLimit(ctx.userId);
  if (rl) return rl;

  if (!allowedRoles.includes(ctx.user.role)) {
    const defaultMsg = `Insufficient corporate portal permissions. Required role: ${allowedRoles.join(' or ')}.`;
    return NextResponse.json(
      { error: forbiddenMessage ?? defaultMsg, requiredRoles: allowedRoles },
      { status: 403 },
    );
  }

  return ctx;
}

const CORPORATE_STANDARD_DAILY_AED: Record<string, number> = {
  ECONOMY: 145,
  COMPACT: 165,
  MID_SIZE: 210,
  SEDAN: 210,
  FULL_SIZE: 260,
  COMPACT_SUV: 275,
  MID_SIZE_SUV: 320,
  SUV: 320,
  FULL_SIZE_SUV: 450,
  LUXURY: 690,
  PREMIUM: 540,
  SPORTS: 850,
  VAN: 360,
  PICKUP: 280,
  COMMERCIAL: 280,
  BUS: 620,
  SPECIAL: 450,
};

const INSURANCE_TIER_DAILY_AED: Record<string, { label: string; dailyRate: number }> = {
  BASIC: { label: 'Basic Third-Party & Standard Excess', dailyRate: 0 },
  STANDARD: { label: 'Standard CDW (Reduced Corporate Excess)', dailyRate: 35 },
  FULL_ZERO_EXCESS: { label: 'Super CDW — Full Zero Excess Cover', dailyRate: 75 },
};

export const BUILTIN_ANCILLARIES: Record<string, { code: string; name: string; dailyRate: number }> = {
  GPS: { code: 'GPS', name: 'Fleet Navigation & Live Traffic Unit', dailyRate: 20 },
  CHILD_SEAT: { code: 'CHILD_SEAT', name: 'ISOFIX Child Safety Seat', dailyRate: 25 },
  ADDITIONAL_DRIVER: { code: 'ADDITIONAL_DRIVER', name: 'Additional Corporate Driver', dailyRate: 30 },
  WIFI_HOTSPOT: { code: 'WIFI_HOTSPOT', name: 'In-Vehicle 5G Wi-Fi Hotspot', dailyRate: 35 },
};

export interface CorporatePreAuthSizing {
  securityDeposit: number;
  estimatedRentalTotal: number;
  requiredPreAuthAmount: number;
  recommendedHoldAmount: number;
}

export interface CorporateRateQuote extends RateResult {
  days: number;
  total: number;
  depositRequired: number;
  preAuthSizing: CorporatePreAuthSizing;
}

export function baseSecurityDepositForCategory(
  rawCategory: string,
  insuranceTier?: string | null,
): number {
  const norm = normalizeRentalCategory(rawCategory);
  let deposit = 1000;
  if (['LUXURY', 'SPORTS', 'PREMIUM', 'FULL_SIZE_SUV', 'SPECIAL'].includes(norm)) {
    deposit = 2500;
  } else if (['MID_SIZE_SUV', 'SUV', 'COMPACT_SUV', 'VAN', 'BUS', 'PICKUP'].includes(norm)) {
    deposit = 1500;
  }
  if (insuranceTier === 'FULL_ZERO_EXCESS') {
    deposit = Math.max(1000, Math.round(deposit * 0.6));
  }
  return deposit;
}

export function computePreAuthSizing(
  rawCategory: string,
  rentalTotal: number,
  insuranceTier?: string | null,
): CorporatePreAuthSizing {
  const securityDeposit = baseSecurityDepositForCategory(rawCategory, insuranceTier);
  const estimatedRentalTotal = Number(rentalTotal.toFixed(2));
  const halfRentalBounded = Math.min(3500, Math.max(1000, Math.round(estimatedRentalTotal * 0.5)));
  const requiredPreAuthAmount = Math.max(securityDeposit, halfRentalBounded);
  const recommendedHoldAmount = Math.max(
    requiredPreAuthAmount,
    Math.min(5000, Math.round(securityDeposit + Math.min(1500, estimatedRentalTotal * 0.25))),
  );
  return {
    securityDeposit,
    estimatedRentalTotal,
    requiredPreAuthAmount,
    recommendedHoldAmount,
  };
}

export async function quoteCorporatePortalRateInTx(
  tx: TxClient,
  tenantId: string,
  args: {
    category: string;
    pickupDate: Date;
    dropoffDate: Date;
    pickupLocationCode?: string | null;
    customerId: string;
    insuranceTier?: string | null;
    ancillaryCodes?: string[];
  },
): Promise<CorporateRateQuote> {
  const ms = args.dropoffDate.getTime() - args.pickupDate.getTime();
  const estDays = Math.max(1, Math.ceil(Math.ceil(ms / 3_600_000) / 24));

  // Resolve optional ancillaries from tenant DB catalogue or built-in defaults
  const extraOptions: { name: string; amount: number }[] = [];
  const requestedCodes = (args.ancillaryCodes ?? [])
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);

  if (requestedCodes.length > 0) {
    const dbAncillaries = await withSavepoint<
      Array<{ code: string; name_en: string; pricing_type: string; unit_price: string | number }>
    >(
      tx,
      'rac_portal_ancillaries',
      () =>
        tx.$queryRawUnsafe<
          Array<{ code: string; name_en: string; pricing_type: string; unit_price: string | number }>
        >(
          `SELECT code, name_en, pricing_type, unit_price
             FROM rental_ancillaries
            WHERE tenant_id::text = $1
              AND deleted_at IS NULL
              AND COALESCE(is_active, true) = true`,
          tenantId,
        ),
      [],
    );

    for (const code of requestedCodes) {
      const dbMatch = dbAncillaries.find((a) => a.code.toUpperCase() === code);
      if (dbMatch) {
        const unit = Number(dbMatch.unit_price ?? 0);
        const isPerDay = String(dbMatch.pricing_type ?? 'DAILY').toUpperCase() !== 'FLAT';
        extraOptions.push({
          name: dbMatch.name_en,
          amount: Number((isPerDay ? unit * estDays : unit).toFixed(2)),
        });
      } else if (BUILTIN_ANCILLARIES[code]) {
        const b = BUILTIN_ANCILLARIES[code];
        extraOptions.push({
          name: b.name,
          amount: Number((b.dailyRate * estDays).toFixed(2)),
        });
      }
    }
  }

  const tierCode = (args.insuranceTier ?? 'BASIC').toUpperCase();
  const extraTotal = Number(extraOptions.reduce((sum, opt) => sum + opt.amount, 0).toFixed(2));
  const estHours = Math.max(1, Math.ceil(ms / 3_600_000));

  const fallbackEmptyQuote: RateResult = {
    appliedRuleId: null,
    ruleName: 'Corporate Standard',
    vehicleCategory: args.category,
    totalDays: estDays,
    totalHours: estHours,
    currency: 'AED',
    dailyRate: 0,
    baseRentalCharge: 0,
    insurancePlanCode: null,
    insuranceDailyRate: 0,
    insuranceCharge: 0,
    extraCharges: extraTotal,
    subtotal: extraTotal,
    promoCode: null,
    discountPct: 0,
    discountAmount: 0,
    taxablAmount: extraTotal,
    taxRate: 5,
    taxAmount: Number((extraTotal * 0.05).toFixed(2)),
    totalAmount: Number((extraTotal * 1.05).toFixed(2)),
    breakdown: extraOptions.map((o) => ({
      label: o.name,
      qty: 1,
      unitLabel: 'item',
      unitPrice: o.amount,
      amount: o.amount,
      type: 'EXTRA' as const,
    })),
    gracePeriodMin: 60,
    lateFeePerHour: 0,
    lateFeeCap: 0,
    includedKmPerDay: 250,
    excessKmRate: 0.75,
    appliedAt: new Date().toISOString(),
  };

  let quote = await withSavepoint<RateResult>(
    tx,
    'rac_portal_quote_rate',
    () =>
      quoteRentalRateInTx(tx, tenantId, {
        vehicleCategory: args.category,
        pickupDate: args.pickupDate,
        dropoffDate: args.dropoffDate,
        pickupLocationCode: args.pickupLocationCode ?? undefined,
        customerType: 'CORPORATE',
        corporateAccountId: args.customerId,
        channel: 'ONLINE',
        insurancePlanCode: tierCode,
        currency: 'AED',
        extraOptions,
      }),
    fallbackEmptyQuote,
  );

  // Fallback corporate tariff if tenant has not yet seeded pricing_rules for this category
  const normCat = normalizeRentalCategory(args.category);
  let dailyRate = quote.dailyRate;
  let baseRentalCharge = quote.baseRentalCharge;
  let ruleName = quote.ruleName;
  const breakdown: RateBreakdownLine[] = [...quote.breakdown];

  if (dailyRate <= 0) {
    dailyRate = CORPORATE_STANDARD_DAILY_AED[normCat] ?? 210;
    baseRentalCharge = Number((dailyRate * quote.totalDays).toFixed(2));
    ruleName = `Corporate Master Tariff (${normCat})`;
    const rentalIdx = breakdown.findIndex((b) => b.type === 'RENTAL');
    const rentalLine: RateBreakdownLine = {
      label: `Corporate vehicle rental — ${args.category} (${quote.totalDays} day${quote.totalDays > 1 ? 's' : ''})`,
      qty: quote.totalDays,
      unitLabel: 'day',
      unitPrice: dailyRate,
      amount: baseRentalCharge,
      type: 'RENTAL',
    };
    if (rentalIdx >= 0) breakdown[rentalIdx] = rentalLine;
    else breakdown.unshift(rentalLine);
  }

  // Ensure selected insurance tier is reflected even if pricing_rule had no insurance_plans JSON
  let insurancePlanCode = quote.insurancePlanCode;
  let insuranceDailyRate = quote.insuranceDailyRate;
  let insuranceCharge = quote.insuranceCharge;
  const tierDef = INSURANCE_TIER_DAILY_AED[tierCode];
  if (tierDef && tierDef.dailyRate > 0 && insuranceCharge <= 0) {
    insurancePlanCode = tierCode;
    insuranceDailyRate = tierDef.dailyRate;
    insuranceCharge = Number((tierDef.dailyRate * quote.totalDays).toFixed(2));
    const taxIdx = breakdown.findIndex((b) => b.type === 'TAX');
    const insLine: RateBreakdownLine = {
      label: tierDef.label,
      qty: quote.totalDays,
      unitLabel: 'day',
      unitPrice: insuranceDailyRate,
      amount: insuranceCharge,
      type: 'INSURANCE',
    };
    if (taxIdx >= 0) breakdown.splice(taxIdx, 0, insLine);
    else breakdown.push(insLine);
  }

  const subtotalBeforeDiscount = Number(
    (baseRentalCharge + insuranceCharge + quote.extraCharges).toFixed(2),
  );
  const subtotal = Number((subtotalBeforeDiscount - quote.discountAmount).toFixed(2));
  const taxAmount = Number(((subtotal * quote.taxRate) / 100).toFixed(2));
  const totalAmount = Number((subtotal + taxAmount).toFixed(2));

  const taxIdx = breakdown.findIndex((b) => b.type === 'TAX');
  const taxLine: RateBreakdownLine = {
    label: `UAE VAT (${quote.taxRate}%)`,
    qty: 1,
    unitLabel: 'flat',
    unitPrice: taxAmount,
    amount: taxAmount,
    type: 'TAX',
  };
  if (taxIdx >= 0) breakdown[taxIdx] = taxLine;
  else breakdown.push(taxLine);

  quote = {
    ...quote,
    ruleName,
    dailyRate,
    baseRentalCharge,
    insurancePlanCode,
    insuranceDailyRate,
    insuranceCharge,
    subtotal,
    taxablAmount: subtotal,
    taxAmount,
    totalAmount,
    breakdown,
  };

  const preAuthSizing = computePreAuthSizing(args.category, quote.totalAmount, tierCode);

  return {
    ...quote,
    days: quote.totalDays,
    total: quote.totalAmount,
    depositRequired: preAuthSizing.securityDeposit,
    preAuthSizing,
  };
}

/**
 * Returns the canonical `RENTAL_VEHICLE_CATEGORIES` code aligned with
 * `pricing_rules.vehicle_category` and `normalizeRentalCategory`.
 */
export function canonicalPortalCategory(raw: string | null | undefined): string {
  return normalizeRentalCategory(raw || 'MID_SIZE') || 'MID_SIZE';
}

/**
 * Matches a vehicle's category against a requested category filter, supporting
 * both exact canonical `RENTAL_VEHICLE_CATEGORIES` codes (`COMPACT_SUV`, `MID_SIZE`, etc.)
 * and legacy umbrella aliases (`SEDAN`, `SUV`, `COMMERCIAL`).
 */
export function portalCategoriesMatch(
  vehicleCatRaw: string | null | undefined,
  filterCatRaw: string | null | undefined,
): boolean {
  if (!filterCatRaw || filterCatRaw.trim().toUpperCase() === 'ALL') return true;
  if (categoriesMatch(vehicleCatRaw ?? '', filterCatRaw)) return true;

  const vNorm = normalizeRentalCategory(vehicleCatRaw || 'MID_SIZE');
  const fUpper = filterCatRaw.trim().toUpperCase();
  if (fUpper === 'SEDAN' && (vNorm === 'MID_SIZE' || vNorm === 'FULL_SIZE')) return true;
  if (
    fUpper === 'SUV' &&
    (vNorm === 'COMPACT_SUV' || vNorm === 'MID_SIZE_SUV' || vNorm === 'FULL_SIZE_SUV')
  ) {
    return true;
  }
  if (fUpper === 'COMMERCIAL' && (vNorm === 'PICKUP' || vNorm === 'BUS' || vNorm === 'VAN')) {
    return true;
  }
  return false;
}
