/**
 * Rate engine — picks the best applicable rate contract for a shipment
 * and computes the customer-facing freight quote.
 *
 * Today operators hand-enter every customer_rate_amount, which means:
 *   - margin tracking is impossible (no canonical "contracted price")
 *   - rate-card breaches (operator quotes below contract) are silent
 *   - rebid/quote analytics have no baseline
 *
 * This module sits on top of the existing rate contracts table and the
 * existing matchLaneRateContracts() candidate-list function in domain.ts.
 * It adds:
 *   1. Specificity scoring   — customer-specific > generic, exact vehicle
 *      > any-vehicle, named service-level > unspecified.
 *   2. Effective-date gating — contracts with effective_from in the future
 *      or effective_to in the past are filtered out (matchLaneRateContracts
 *      only filters by ACTIVE status).
 *   3. Price computation     — base + fuel surcharge + min-charge floor.
 *
 * Day 1 stays narrow: scoring + computation + a preview endpoint + unit
 * tests. Wiring into createShipmentOrder lands on Day 2 so the engine can
 * be exercised in isolation first.
 */

import { matchLaneRateContracts } from './domain';

// ── Public types ────────────────────────────────────────────────────────────

export interface QuoteShipmentInput {
  tenantId: string;
  origin: string;
  destination: string;
  vehicleType?: string | null;
  serviceLevel?: string | null;
  customerId?: string | null;
  carrierId?: string | null;
  /** ISO date string — used to gate effective_from / effective_to. Defaults to "today". */
  shipmentDate?: string | null;
  /** Reserved for future per-km / per-kg pricing — Day 1 uses flat lane rates. */
  distanceKm?: number | null;
  weightKg?: number | null;
}

export type QuoteReason =
  | 'matched'
  | 'no-lane-match'      // no contract at all for this origin → destination
  | 'no-active-contract' // candidates exist but none in effective window
  | 'no-vehicle-match';  // lane matches but vehicleType filter excludes all

export interface QuoteShipmentResult {
  matched: boolean;
  reason: QuoteReason;

  // Identity of the winning contract (null when matched=false)
  contractId: string | null;
  contractNo: string | null;
  customerId: string | null;
  carrierId: string | null;
  currency: string;

  // Price breakdown — zeros when unmatched
  baseRate: number;
  fuelSurchargePct: number;
  fuelSurchargeAmount: number;
  minCharge: number;
  minChargeApplied: boolean;
  subtotal: number;     // baseRate + fuelSurchargeAmount
  total: number;        // max(subtotal, minCharge)

  // Audit trail
  accessorialRules: unknown;  // raw JSONB from the contract — Gap #2 consumes this
  alternates: Array<{
    contractId: string;
    contractNo: string;
    score: number;
    why: string;
  }>;
}

// ── Scoring ────────────────────────────────────────────────────────────────

/**
 * Specificity score for a contract relative to the request.
 * Higher = more specific. Used to break ties when multiple contracts apply.
 *
 * Customer match is most valuable (a customer-specific rate exists because
 * a deal was struck). Carrier and vehicle are next. Service-level last.
 */
export function scoreContract(args: {
  contract: {
    customerId: string | null;
    carrierId: string | null;
    vehicleType: string | null;
    serviceLevel: string | null;
  };
  request: {
    customerId?: string | null;
    carrierId?: string | null;
    vehicleType?: string | null;
    serviceLevel?: string | null;
  };
}): { score: number; why: string } {
  let score = 0;
  const reasons: string[] = [];

  // Customer: matching > generic; mismatching contract is filtered out earlier
  if (args.contract.customerId && args.request.customerId === args.contract.customerId) {
    score += 100;
    reasons.push('customer-specific');
  } else if (!args.contract.customerId) {
    score += 10;
    reasons.push('generic-customer');
  }

  if (args.contract.carrierId && args.request.carrierId === args.contract.carrierId) {
    score += 40;
    reasons.push('carrier-specific');
  } else if (!args.contract.carrierId) {
    score += 5;
    reasons.push('any-carrier');
  }

  if (args.contract.vehicleType && args.request.vehicleType
      && args.contract.vehicleType.toUpperCase() === args.request.vehicleType.toUpperCase()) {
    score += 30;
    reasons.push('exact-vehicle');
  } else if (!args.contract.vehicleType) {
    score += 5;
    reasons.push('any-vehicle');
  }

  if (args.contract.serviceLevel && args.request.serviceLevel
      && args.contract.serviceLevel.toUpperCase() === args.request.serviceLevel.toUpperCase()) {
    score += 15;
    reasons.push('exact-service-level');
  } else if (!args.contract.serviceLevel) {
    score += 3;
    reasons.push('any-service-level');
  }

  return { score, why: reasons.join('+') };
}

// ── Effective-date gate ────────────────────────────────────────────────────

export function isContractActiveOn(
  contract: { effectiveFrom: string | null; effectiveTo: string | null; status: string },
  isoDate: string,
): boolean {
  if (contract.status !== 'ACTIVE') return false;
  const d = isoDate.slice(0, 10);
  if (contract.effectiveFrom && d < contract.effectiveFrom.slice(0, 10)) return false;
  if (contract.effectiveTo && d > contract.effectiveTo.slice(0, 10)) return false;
  return true;
}

// ── Price computation ──────────────────────────────────────────────────────

export interface PricedQuote {
  baseRate: number;
  fuelSurchargePct: number;
  fuelSurchargeAmount: number;
  minCharge: number;
  minChargeApplied: boolean;
  subtotal: number;
  total: number;
}

export function computePrice(contract: {
  baseRate: number;
  fuelSurchargePct: number | null;
  minCharge: number | null;
}): PricedQuote {
  const baseRate = Math.max(0, contract.baseRate);
  const fuelSurchargePct = Math.max(0, contract.fuelSurchargePct ?? 0);
  const fuelSurchargeAmount = round2(baseRate * fuelSurchargePct / 100);
  const subtotal = round2(baseRate + fuelSurchargeAmount);
  const minCharge = Math.max(0, contract.minCharge ?? 0);
  const total = Math.max(subtotal, minCharge);
  return {
    baseRate,
    fuelSurchargePct,
    fuelSurchargeAmount,
    minCharge,
    minChargeApplied: total > subtotal,
    subtotal,
    total: round2(total),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Top-level entry point ──────────────────────────────────────────────────

function emptyResultBase(): Omit<QuoteShipmentResult, 'matched' | 'reason' | 'currency'> {
  return {
    contractId: null,
    contractNo: null,
    customerId: null,
    carrierId: null,
    baseRate: 0,
    fuelSurchargePct: 0,
    fuelSurchargeAmount: 0,
    minCharge: 0,
    minChargeApplied: false,
    subtotal: 0,
    total: 0,
    accessorialRules: null,
    alternates: [],
  };
}

const DEFAULT_CURRENCY = 'AED';

export async function quoteShipment(input: QuoteShipmentInput): Promise<QuoteShipmentResult> {
  const shipmentDate = (input.shipmentDate ?? new Date().toISOString()).slice(0, 10);

  // 1) Candidate lookup — matchLaneRateContracts handles lane string matching
  //    and ACTIVE filtering. We deliberately DON'T pass customerId/carrierId
  //    here: the underlying listRateContracts SQL filter excludes generic
  //    contracts when a specific id is provided (it does `customer_id = $3`
  //    instead of `customer_id = $3 OR customer_id IS NULL`). Pulling all
  //    candidates and scoping in JS lets generic + customer-specific compete.
  //    It also keeps the engine independent of that SQL quirk.
  const candidates = await matchLaneRateContracts({
    tenantId: input.tenantId,
    origin: input.origin,
    destination: input.destination,
    vehicleType: input.vehicleType,
    serviceLevel: input.serviceLevel,
    limit: 50,
  });

  if (!candidates.length) {
    return { ...emptyResultBase(), matched: false, reason: 'no-lane-match', currency: DEFAULT_CURRENCY };
  }

  // 2) Drop contracts that don't apply on the shipment date.
  //    Drop contracts that are customer-locked to a DIFFERENT customer
  //    (matchLaneRateContracts filters by customerId only when supplied;
  //    when the request has a customer it returns BOTH that customer's
  //    contracts AND generic ones — but it never excludes other-customer
  //    contracts, so we double-check here).
  const inWindow = candidates.filter(c =>
    isContractActiveOn(
      { effectiveFrom: toIsoDate(c.effectiveFrom), effectiveTo: toIsoDate(c.effectiveTo), status: c.status },
      shipmentDate,
    ),
  );

  if (!inWindow.length) {
    return { ...emptyResultBase(), matched: false, reason: 'no-active-contract', currency: DEFAULT_CURRENCY };
  }

  // A contract locked to a specific customer only applies when that
  // customer is the requester. If the request has no customerId we
  // exclude all customer-locked contracts — operator quote previews
  // should never accidentally apply someone else's private rate.
  const correctCustomer = inWindow.filter(c =>
    !c.customerId || c.customerId === input.customerId,
  );

  if (!correctCustomer.length) {
    return { ...emptyResultBase(), matched: false, reason: 'no-active-contract', currency: DEFAULT_CURRENCY };
  }

  // 3) Score every remaining contract and pick the highest.
  const scored = correctCustomer.map(contract => {
    const { score, why } = scoreContract({
      contract: {
        customerId: contract.customerId,
        carrierId: contract.carrierId,
        vehicleType: contract.vehicleType,
        serviceLevel: contract.serviceLevel,
      },
      request: {
        customerId: input.customerId,
        carrierId: input.carrierId,
        vehicleType: input.vehicleType,
        serviceLevel: input.serviceLevel,
      },
    });
    return { contract, score, why };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie-breaker: most recently updated contract wins so corrections take
    // effect immediately — sort by createdAt desc as a stable proxy.
    return (b.contract.createdAt ?? '').localeCompare(a.contract.createdAt ?? '');
  });

  const winner = scored[0];
  const price = computePrice({
    baseRate: winner.contract.baseRate,
    fuelSurchargePct: winner.contract.fuelSurchargePct,
    minCharge: winner.contract.minCharge,
  });

  return {
    matched: true,
    reason: 'matched',
    contractId: winner.contract.id,
    contractNo: winner.contract.contractNo,
    customerId: winner.contract.customerId,
    carrierId: winner.contract.carrierId,
    currency: winner.contract.currency || DEFAULT_CURRENCY,
    ...price,
    accessorialRules: winner.contract.accessorialRules ?? null,
    alternates: scored.slice(1, 6).map(s => ({
      contractId: s.contract.id,
      contractNo: s.contract.contractNo,
      score: s.score,
      why: s.why,
    })),
  };
}

function toIsoDate(d: string | Date | null | undefined): string | null {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

// ── Wiring helper for createShipmentOrder callers ──────────────────────────

/**
 * The minimal shape of a shipment-create input that the engine cares about.
 * Kept structural (not importing LogisticsShipmentCreateInput) so we don't
 * introduce a circular dep between rate-engine ↔ domain.
 */
export interface ShipmentInputForQuote {
  tenantId: string;
  cargoOwnerCustomerId?: string | null;
  originName?: string | null;
  originAddress?: string | null;
  originCity?: string | null;
  destinationName?: string | null;
  destinationAddress?: string | null;
  destinationCity?: string | null;
  requestedVehicleType?: string | null;
  shipmentType?: string | null;
  bookingMode?: string | null;
  customerRateAmount?: number | null;
  carrierCostAmount?: number | null;
  currency?: string | null;
  pickupWindowFrom?: string | Date | null;
  metadata?: Record<string, unknown> | null;
  assignedCarrierId?: string | null;
}

/**
 * Decide whether the input deserves an auto-quote and (if so) return a
 * patched copy with customer_rate_amount and quote-audit metadata filled in.
 *
 * The caller is the API endpoint that's about to invoke createShipmentOrder.
 * Returning a patched COPY (rather than mutating in place) keeps the engine
 * pure — easier to test, easier to reason about when something looks wrong.
 *
 * Skip rules — return the input unchanged:
 *   - customerRateAmount already set (operator entered a manual price)
 *   - origin/destination not yet known (form is mid-fill)
 *   - bookingMode is explicitly 'SPOT' or 'MARKETPLACE' — those go through
 *     the RFQ / spot-bidding paths, not contracts
 *
 * Mismatches (no-lane-match, no-active-contract) DON'T fail the caller —
 * the input comes back unchanged but with a `quoteMissReason` in metadata so
 * the operator can see why no rate was applied.
 */
export async function applyContractQuoteToInput<T extends ShipmentInputForQuote>(
  input: T,
): Promise<{ input: T & { metadata: Record<string, unknown> }; quote: QuoteShipmentResult | null }> {
  const withMetadata = { ...input, metadata: input.metadata ?? {} };

  if (input.customerRateAmount != null && input.customerRateAmount > 0) {
    return { input: withMetadata, quote: null };
  }

  const mode = (input.bookingMode || 'CONTRACT').toUpperCase();
  if (mode === 'SPOT' || mode === 'MARKETPLACE') {
    return { input: withMetadata, quote: null };
  }

  const origin = (input.originName || input.originAddress || input.originCity || '').trim();
  const destination = (input.destinationName || input.destinationAddress || input.destinationCity || '').trim();
  if (!origin || !destination) return { input: withMetadata, quote: null };

  const quote = await quoteShipment({
    tenantId: input.tenantId,
    origin,
    destination,
    vehicleType: input.requestedVehicleType ?? null,
    serviceLevel: input.shipmentType ?? null,
    customerId: input.cargoOwnerCustomerId ?? null,
    carrierId: input.assignedCarrierId ?? null,
    shipmentDate: toIsoDate(input.pickupWindowFrom) ?? null,
  });

  // Always record what happened (matched or not) — silent quote failures
  // are how silent margin loss starts.
  const auditPatch = {
    rateQuote: {
      matched: quote.matched,
      reason: quote.reason,
      contractId: quote.contractId,
      contractNo: quote.contractNo,
      baseRate: quote.baseRate,
      fuelSurchargePct: quote.fuelSurchargePct,
      fuelSurchargeAmount: quote.fuelSurchargeAmount,
      subtotal: quote.subtotal,
      total: quote.total,
      currency: quote.currency,
      appliedAt: new Date().toISOString(),
    },
  };

  const patched = {
    ...input,
    metadata: { ...(input.metadata ?? {}), ...auditPatch },
    ...(quote.matched
      ? { customerRateAmount: quote.total, currency: quote.currency }
      : {}),
  };

  return { input: patched, quote };
}
