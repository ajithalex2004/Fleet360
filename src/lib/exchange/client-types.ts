/**
 * Client-side row shapes for the Fleet360 Exchange pages.
 *
 * These describe the JSON the /api/exchange/* routes return, as the partner
 * portal pages read it. Prisma Decimal columns arrive serialised, so money
 * fields are `number | string`; dates arrive as ISO strings. Fields the pages
 * don't read are left out. Loosely-shaped JSON columns (commercial snapshots,
 * disclosure payloads) keep an index signature for keys not listed here.
 */

export type Money = number | string;

export interface RateCardSnapshot {
  version?: number | string;
  snapshotHash?: string | null;
  ancillaryCharges?: {
    freeWaitingMinutes?: number;
    waitingFeePerHour?: number;
    cancellationFeePct?: number;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

/** OutsourceAward.commercialSnapshot (JSON). */
export interface CommercialSnapshot {
  commercialModel?: 'AGENCY' | 'PRINCIPAL' | string;
  platformFeePct?: number | string | null;
  platformFeeAmount?: number | string | null;
  netPartnerPayout?: number | string | null;
  buyerAgreedPrice?: number | string | null;
  snapshotHash?: string | null;
  failoverPromotedAt?: string | null;
  failoverHistory?: unknown;
  rateCardSnapshot?: RateCardSnapshot | null;
  [key: string]: unknown;
}

export interface PartnerQuoteRow {
  id: string;
  revisionNo: number;
  amount: Money;
  vatAmount: Money;
  totalAmount: Money;
  currency: string;
  status: string;
  notes?: string | null;
}

export interface OutsourceRequestRow {
  id: string;
  requestNumber: string;
  domain: string;
  pricingMethod: string;
  status: string;
  serviceDate: string;
  pickupTime: string;
  pickupLocation: string;
  dropoffLocation: string;
  requiredCapacity: number;
  vehicleTypeRequired?: string | null;
  specialInstructions?: string | null;
  opportunity?: {
    closesAt?: string | null;
    disclosurePayload?: { originCity?: string; destinationCity?: string; [key: string]: unknown } | null;
  } | null;
  quotes?: PartnerQuoteRow[];
  invitedPartners?: Array<{ status: string; declineReason?: string | null }>;
}

export interface PartnerAssignmentRow {
  id: string;
  vehiclePlate?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  isTokenRevoked?: boolean | null;
  reachedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  lastLat?: number | null;
  lastLng?: number | null;
  pod?: {
    passengerCount?: number | null;
    signedByName?: string | null;
    sealNumber?: string | null;
    deliveredWeightKg?: number | null;
    damageConditionNotes?: string | null;
  } | null;
  events?: Array<{
    id: string;
    eventType: string;
    latitude?: number | null;
    longitude?: number | null;
    createdAt: string;
  }>;
}

export interface OutsourceAwardRow {
  id: string;
  status: string;
  totalAwarded: Money;
  awardedPrice?: Money | null;
  awardedAmount?: Money | null;
  partnerId: string;
  commercialSnapshot?: CommercialSnapshot | null;
  request?: OutsourceRequestRow | null;
  assignment?: PartnerAssignmentRow | null;
}

export interface PartnerVehicleRow {
  id: string;
  licensePlate: string;
  vehicleType: string;
  mulkiyaExpiry?: string | null;
}

export interface PartnerDriverRow {
  id: string;
  fullName: string;
  mobileNumber: string;
  licenseExpiry?: string | null;
  permitExpiry?: string | null;
}

export interface PartnerComplianceDocRow {
  id: string;
  status: string;
  expiryDate?: string | null;
}

export interface PartnerInvoiceRow {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  status: string;
  verificationStatus?: string | null;
  subtotalAmount?: Money | null;
  vatAmount?: Money | null;
  totalAmount: Money;
  awardId?: string | null;
  items?: unknown[];
  award?: {
    commercialSnapshot?: CommercialSnapshot | null;
    request?: Pick<OutsourceRequestRow, 'requestNumber' | 'pickupLocation' | 'dropoffLocation'> | null;
  } | null;
}

export interface SettlementStatementRow {
  id: string;
  statementNumber: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  grossAmount: Money;
  vatAmount: Money;
  totalDeductions: Money;
  netPayable: Money;
  platformFeePct?: number | string | null;
  commercialModel?: string | null;
  partnerTrn?: string | null;
  tenantTrn?: string | null;
  partnerId?: string;
  partner?: { legalName?: string | null } | null;
  invoices?: PartnerInvoiceRow[];
}

/** A partner's own quote, with the request it answers. */
export interface PartnerQuoteWithRequestRow extends PartnerQuoteRow {
  requestId: string;
  validUntil?: string | null;
  request?: OutsourceRequestRow | null;
}

export interface MarketplaceOpportunityRow {
  id: string;
  outsourceRequestId: string;
  domain: string;
  closesAt: string;
  emirateMatch?: boolean;
  matchedZoneLabel?: string | null;
  request?: { requestNumber?: string; quotes?: PartnerQuoteRow[] } | null;
  [key: string]: unknown;
}

export interface PartnerScorecardRow {
  tier?: string | null;
  compositeScore?: number | null;
  evaluatedAt?: string | null;
  onTimePerformance?: number | null;
  quoteResponseRate?: number | null;
  exceptionRate?: number | null;
  disputeRate?: number | null;
  podQualityRate?: number | null;
  totalAwardedTrips?: number | null;
  completedTrips?: number | null;
  onTimeTrips?: number | null;
  lateTrips?: number | null;
  quotesInvited?: number | null;
  quotesSubmitted?: number | null;
  exceptionsCount?: number | null;
  disputesCount?: number | null;
  [key: string]: unknown;
}

export interface PartnerExceptionRow {
  id: string;
  type: string;
  severity: string;
  status: string;
  description?: string | null;
  resolutionNotes?: string | null;
  createdAt: string;
  award?: { request?: { requestNumber?: string } | null } | null;
}

export interface PartnerServiceAreaRow {
  emirate: string;
  zones?: string[];
}

export interface PartnerProfileRow {
  partnerCode?: string | null;
  legalName?: string | null;
  tradeName?: string | null;
  address?: string | null;
  city?: string | null;
  onboardingStatus?: string | null;
  primaryContactName?: string | null;
  primaryContactEmail?: string | null;
  primaryContactPhone?: string | null;
  taxRegistrationNumber?: string | null;
  tradeLicenseNumber?: string | null;
  serviceAreas?: PartnerServiceAreaRow[];
  capabilities?: Array<{ domain: string; isApproved?: boolean }>;
  [key: string]: unknown;
}
