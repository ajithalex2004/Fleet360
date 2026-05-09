/**
 * Insurance claim state machine.
 *
 *  SUBMITTED ─→ UNDER_REVIEW ─→ APPROVED ─→ SETTLED (terminal)
 *      │             │
 *      └─→ REJECTED ─┘ (terminal)
 *
 * Pure functions — no DB calls.
 */

export type ClaimStatus =
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'SETTLED';

const VALID: Record<ClaimStatus, ClaimStatus[]> = {
  SUBMITTED:    ['UNDER_REVIEW', 'REJECTED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED:     ['SETTLED', 'REJECTED'],
  REJECTED:     [],
  SETTLED:      [],
};

export function isTerminalClaimStatus(s: ClaimStatus): boolean {
  return s === 'REJECTED' || s === 'SETTLED';
}

export interface ClaimTransitionResult {
  ok: boolean;
  from: ClaimStatus;
  to: ClaimStatus;
  reason?: string;
}

export function canTransitionClaim(from: ClaimStatus, to: ClaimStatus): ClaimTransitionResult {
  if (from === to) return { ok: true, from, to };
  if (!(from in VALID)) {
    return { ok: false, from, to, reason: `Unknown claim status: ${from}` };
  }
  const allowed = VALID[from];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      from,
      to,
      reason: `Illegal transition ${from} → ${to}. Valid next states: ${allowed.join(', ') || '(terminal)'}`,
    };
  }
  return { ok: true, from, to };
}
