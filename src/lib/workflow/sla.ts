/**
 * Where an approval level stands against its SLA, for the Approvals Inbox
 * and the email decision page.
 *
 *   ESCALATED   its escalation contact has been emailed (workflow-escalation job)
 *   OVERDUE     past its due time (the level's SLA hours, from when it opened)
 *   DUE_SOON    under a quarter of its SLA window left, or under 4 hours
 *   ON_TRACK    otherwise
 *   NO_SLA      the level has no due time
 *
 * escalatesAt: when it will be escalated, for a level with an escalation
 * contact that has not been escalated yet.
 */
export type SlaState = 'ESCALATED' | 'OVERDUE' | 'DUE_SOON' | 'ON_TRACK' | 'NO_SLA';

export interface SlaStatus {
  state: SlaState;
  /** Hours to the due time (negative once overdue), one decimal; null with no SLA. */
  hoursLeft: number | null;
  escalatesAt: string | null;
}

const DUE_SOON_HOURS = 4;
const DUE_SOON_SHARE = 0.25;

const time = (v: Date | string | null | undefined): number | null => {
  if (v == null) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};

export function slaStatus(level: {
  dueAt: Date | string | null;
  openedAt?: Date | string | null;
  escalatedAt?: Date | string | null;
  /** Hours after opening the level escalates (0 / null: never). */
  escalationHours?: number | null;
  /** Whether the level has an escalation contact. */
  escalates?: boolean;
}, now: number = Date.now()): SlaStatus {
  const due = time(level.dueAt);
  const opened = time(level.openedAt);
  const hoursLeft = due == null ? null : Math.round(((due - now) / 3_600_000) * 10) / 10;
  const escalated = time(level.escalatedAt) != null;
  const escHours = Number(level.escalationHours ?? 0);
  const escalatesAt = !escalated && level.escalates && opened != null && escHours > 0
    ? new Date(opened + escHours * 3_600_000).toISOString()
    : null;

  let state: SlaState;
  if (escalated) state = 'ESCALATED';
  else if (due == null) state = 'NO_SLA';
  else if (due <= now) state = 'OVERDUE';
  else {
    const window = opened != null && due > opened ? due - opened : null;
    const left = due - now;
    state = left <= DUE_SOON_HOURS * 3_600_000 || (window != null && left <= window * DUE_SOON_SHARE)
      ? 'DUE_SOON' : 'ON_TRACK';
  }
  return { state, hoursLeft, escalatesAt };
}

/** Most urgent first: escalated, overdue, due soon, on track (soonest due first), then no SLA. */
export const SLA_RANK: Record<SlaState, number> = { ESCALATED: 0, OVERDUE: 1, DUE_SOON: 2, ON_TRACK: 3, NO_SLA: 4 };
