/**
 * RAC Booking State Machine + Penalty Calculator.
 *
 * Two responsibilities:
 *   1. Validate state transitions (e.g. you can't go ACTIVE → PENDING).
 *   2. Detect overdue bookings + compute no-show / late-return penalties.
 *
 * Pure functions — no DB calls. The caller fetches bookings and passes them in.
 *
 * State graph:
 *
 *     ┌── CANCELLED (terminal)
 *     │
 *   PENDING ──┐
 *     │       ▼
 *     │     NO_SHOW (terminal — auto-billed)
 *     │
 *     ▼
 *   CONFIRMED ──┐
 *     │         ▼
 *     │       NO_SHOW
 *     │
 *     ▼
 *    ACTIVE ──→ COMPLETED (terminal — may be late, billed accordingly)
 *
 * EXPIRED is a soft state for bookings that never confirmed past their
 * pickup window — same effect as NO_SHOW but no fee.
 */

export type BookingStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'EXPIRED';

const VALID_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  PENDING:   ['CONFIRMED', 'CANCELLED', 'NO_SHOW', 'EXPIRED'],
  CONFIRMED: ['ACTIVE', 'CANCELLED', 'NO_SHOW'],
  ACTIVE:    ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW:   [],
  EXPIRED:   [],
};

export function isTerminal(status: BookingStatus): boolean {
  return ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED'].includes(status);
}

export interface TransitionResult {
  ok: boolean;
  from: BookingStatus;
  to: BookingStatus;
  reason?: string;
}

export function canTransition(from: BookingStatus, to: BookingStatus): TransitionResult {
  if (from === to) return { ok: true, from, to };
  if (!(from in VALID_TRANSITIONS)) {
    return { ok: false, from, to, reason: `Unknown source status: ${from}` };
  }
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      from,
      to,
      reason: `Illegal transition from ${from} to ${to}. Valid next states: ${allowed.join(', ') || '(terminal)'}`,
    };
  }
  return { ok: true, from, to };
}

/* ── Penalty configuration (overridable per-tenant in v1.1) ─────────────── */

export interface PenaltyPolicy {
  /** No-show: charge X days of rental as a fee. */
  noShowDayFeeMultiplier: number;
  /** Hours after pickupDate before a PENDING/CONFIRMED booking flips to NO_SHOW. */
  noShowDetectionHours: number;
  /** Minutes past dropoffDate before late-return fees start. */
  lateReturnGraceMinutes: number;
  /** Late return: % of daily rate charged per hour past grace. */
  lateReturnPctPerHour: number;
  /** Cap late-return fee at this multiple of daily rate per day late. */
  lateReturnCapPerDayMultiplier: number;
}

export const DEFAULT_PENALTY_POLICY: PenaltyPolicy = {
  noShowDayFeeMultiplier: 1.0,         // charge 1 day's rate
  noShowDetectionHours: 4,             // 4 hours after pickup time
  lateReturnGraceMinutes: 30,
  lateReturnPctPerHour: 10,            // 10% of daily rate per hour
  lateReturnCapPerDayMultiplier: 1.5,  // capped at 1.5× daily rate per day
};

/* ── Detection ──────────────────────────────────────────────────────────── */

export interface BookingForPenalty {
  id: string;
  bookingRef: string | null;
  status: BookingStatus | string;
  pickupDate: Date;
  dropoffDate: Date;
  dailyRate: number | null;
  totalAmount: number | null;
  totalDays: number | null;
  currency: string;
}

export type PenaltyKind = 'NO_SHOW' | 'LATE_RETURN';

export interface PenaltyAssessment {
  bookingId: string;
  bookingRef: string | null;
  kind: PenaltyKind;
  /** Recommended new status if we apply the penalty. */
  newStatus: BookingStatus;
  /** Penalty amount in the booking's currency. */
  feeAmount: number;
  feeCurrency: string;
  /** Human-readable explanation. */
  rationale: string;
  /** Hours past detection threshold (for late return: hours past grace). */
  hoursPast: number;
}

export interface DetectInput {
  bookings: BookingForPenalty[];
  asOf?: Date;
  policy?: Partial<PenaltyPolicy>;
}

export function detectPenalties(input: DetectInput): PenaltyAssessment[] {
  const policy: PenaltyPolicy = { ...DEFAULT_PENALTY_POLICY, ...(input.policy ?? {}) };
  const asOf = input.asOf ?? new Date();
  const out: PenaltyAssessment[] = [];

  for (const b of input.bookings) {
    const status = b.status as BookingStatus;
    const dailyRate = Number(b.dailyRate ?? 0);
    if (dailyRate <= 0) continue; // can't compute penalty without a rate

    // ── No-show: PENDING/CONFIRMED bookings still un-activated past grace ──
    if (['PENDING', 'CONFIRMED'].includes(status)) {
      const cutoff = new Date(b.pickupDate.getTime() + policy.noShowDetectionHours * 3_600_000);
      if (asOf >= cutoff) {
        const hoursPast = (asOf.getTime() - cutoff.getTime()) / 3_600_000;
        const fee = round2(dailyRate * policy.noShowDayFeeMultiplier);
        out.push({
          bookingId: b.id,
          bookingRef: b.bookingRef,
          kind: 'NO_SHOW',
          newStatus: 'NO_SHOW',
          feeAmount: fee,
          feeCurrency: b.currency,
          rationale: `Customer did not collect vehicle by ${cutoff.toISOString().slice(0, 16).replace('T', ' ')} UTC (${hoursPast.toFixed(1)}h past). Standard no-show fee = ${policy.noShowDayFeeMultiplier} × daily rate.`,
          hoursPast: round2(hoursPast),
        });
      }
      continue;
    }

    // ── Late return: ACTIVE bookings past dropoff + grace ──────────────────
    if (status === 'ACTIVE') {
      const graceCutoff = new Date(b.dropoffDate.getTime() + policy.lateReturnGraceMinutes * 60_000);
      if (asOf >= graceCutoff) {
        const hoursPast = (asOf.getTime() - graceCutoff.getTime()) / 3_600_000;
        const daysPast = Math.ceil(hoursPast / 24);
        // fee = days × daily rate × cap multiplier (cap), OR hours × hourlyPct of daily, whichever is lower
        const hourlyFee = (dailyRate * policy.lateReturnPctPerHour) / 100;
        const uncappedFee = hourlyFee * hoursPast;
        const capPerDay = dailyRate * policy.lateReturnCapPerDayMultiplier;
        const cappedFee = capPerDay * daysPast;
        const fee = round2(Math.min(uncappedFee, cappedFee));
        out.push({
          bookingId: b.id,
          bookingRef: b.bookingRef,
          kind: 'LATE_RETURN',
          newStatus: 'ACTIVE', // status stays ACTIVE until manually completed
          feeAmount: fee,
          feeCurrency: b.currency,
          rationale: `Vehicle ${hoursPast.toFixed(1)}h past dropoff + ${policy.lateReturnGraceMinutes}-min grace. Fee = min(${policy.lateReturnPctPerHour}%/hr × ${hoursPast.toFixed(1)}h, ${policy.lateReturnCapPerDayMultiplier}× daily × ${daysPast} day${daysPast === 1 ? '' : 's'}) = ${fee} ${b.currency}.`,
          hoursPast: round2(hoursPast),
        });
      }
    }
  }

  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ── Charge type for RentalAdditionalCharge insert ─────────────────────── */

export function chargeTypeFor(kind: PenaltyKind): string {
  return kind === 'NO_SHOW' ? 'NO_SHOW_FEE' : 'LATE_RETURN_FEE';
}
