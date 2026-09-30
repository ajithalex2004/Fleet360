/**
 * Vehicle warranties and warranty claims: input checks and the claim
 * workflow (PENDING -> APPROVED | REJECTED, APPROVED -> PAID). Pure
 * functions, shared by the API routes and the Warranties screen.
 */

export const WARRANTY_TYPES = ['MANUFACTURER', 'EXTENDED', 'THIRD_PARTY'] as const;
export type WarrantyTypeCode = (typeof WARRANTY_TYPES)[number];

export const CLAIM_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'PAID'] as const;
export type ClaimStatusCode = (typeof CLAIM_STATUSES)[number];

/** The status a claim may move to from each status. */
export const CLAIM_TRANSITIONS: Record<ClaimStatusCode, readonly ClaimStatusCode[]> = {
  PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: ['PAID'],
  REJECTED: [],
  PAID: [],
};

export const canMoveClaim = (from: string, to: string): boolean =>
  (CLAIM_TRANSITIONS as Record<string, readonly string[]>)[from]?.includes(to) ?? false;

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const toDate = (v: unknown): Date | null => {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
/** A non-negative amount; undefined when absent, NaN when invalid. */
const amount = (v: unknown): number | null | typeof NaN => {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};

export interface WarrantyInput {
  vehicleId: string;
  warrantyType: WarrantyTypeCode;
  provider: string | null;
  startDate: Date;
  expiryDate: Date;
  coverageDescription: string | null;
  maxClaimAmount: number | null;
}

export function parseWarrantyInput(body: Record<string, unknown>): Result<WarrantyInput> {
  const vehicleId = text(body.vehicleId, 64);
  if (!vehicleId) return { ok: false, error: 'Choose a vehicle.' };
  const warrantyType = String(body.warrantyType ?? '').toUpperCase();
  if (!(WARRANTY_TYPES as readonly string[]).includes(warrantyType)) {
    return { ok: false, error: `Warranty type must be one of ${WARRANTY_TYPES.join(', ')}.` };
  }
  const startDate = toDate(body.startDate);
  const expiryDate = toDate(body.expiryDate);
  if (!startDate || !expiryDate) return { ok: false, error: 'Start and expiry dates are required (YYYY-MM-DD).' };
  if (expiryDate < startDate) return { ok: false, error: 'The expiry date must be on or after the start date.' };
  const maxClaimAmount = amount(body.maxClaimAmount);
  if (Number.isNaN(maxClaimAmount)) return { ok: false, error: 'The claim limit must be a positive number.' };
  return {
    ok: true,
    data: {
      vehicleId,
      warrantyType: warrantyType as WarrantyTypeCode,
      provider: text(body.provider, 200),
      startDate,
      expiryDate,
      coverageDescription: text(body.coverageDescription, 2000),
      // 0 in the form means "no limit".
      maxClaimAmount: maxClaimAmount ? maxClaimAmount : null,
    },
  };
}

export interface ClaimInput {
  warrantyId: string;
  requestId: string | null;
  claimDate: Date;
  claimedAmount: number | null;
  description: string;
  referenceNumber: string | null;
}

export function parseClaimInput(body: Record<string, unknown>, today = new Date()): Result<ClaimInput> {
  const warrantyId = text(body.warrantyId, 64);
  if (!warrantyId) return { ok: false, error: 'warrantyId is required.' };
  const description = text(body.description, 2000);
  if (!description) return { ok: false, error: 'Describe the repair being claimed.' };
  const claimDate = body.claimDate === undefined || body.claimDate === '' ? today : toDate(body.claimDate);
  if (!claimDate) return { ok: false, error: 'The claim date must be YYYY-MM-DD.' };
  const claimedAmount = amount(body.claimedAmount);
  if (Number.isNaN(claimedAmount)) return { ok: false, error: 'The claimed amount must be a positive number.' };
  return {
    ok: true,
    data: {
      warrantyId,
      requestId: text(body.requestId, 64),
      claimDate,
      claimedAmount,
      description,
      referenceNumber: text(body.referenceNumber, 100),
    },
  };
}

/** Whether a warranty can take a new claim on `on` (a date). */
export function warrantyOpenForClaims(w: { isActive: boolean; startDate: Date | string; expiryDate: Date | string }, on: Date): boolean {
  const day = on.toISOString().slice(0, 10);
  const start = new Date(w.startDate).toISOString().slice(0, 10);
  const end = new Date(w.expiryDate).toISOString().slice(0, 10);
  return w.isActive && day >= start && day <= end;
}

export interface ClaimStatusChange { status: ClaimStatusCode; approvedAmount: number | null }

/**
 * The change a status update makes, or why it can't be made. Approving
 * records the approved amount (the claimed amount when none is given);
 * the approved amount can't exceed what was claimed.
 */
export function parseClaimStatusChange(
  current: { status: string; claimedAmount: number | null; approvedAmount: number | null },
  body: Record<string, unknown>,
): Result<ClaimStatusChange> {
  const status = String(body.status ?? '').toUpperCase();
  if (!(CLAIM_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: `Status must be one of ${CLAIM_STATUSES.join(', ')}.` };
  }
  if (!canMoveClaim(current.status, status)) {
    return { ok: false, error: `A ${current.status.toLowerCase()} claim can't be marked ${status.toLowerCase()}.` };
  }
  let approvedAmount = current.approvedAmount;
  if (status === 'APPROVED') {
    const given = amount(body.approvedAmount);
    if (Number.isNaN(given)) return { ok: false, error: 'The approved amount must be a positive number.' };
    approvedAmount = given ?? current.claimedAmount;
    if (approvedAmount !== null && current.claimedAmount !== null && approvedAmount > current.claimedAmount) {
      return { ok: false, error: 'The approved amount cannot exceed the claimed amount.' };
    }
  }
  return { ok: true, data: { status: status as ClaimStatusCode, approvedAmount } };
}
