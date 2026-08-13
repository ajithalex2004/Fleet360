/**
 * Shared status metadata for bus-ops UIs.
 *
 * Extracted (audit risk #19) to eliminate the palette drift that was
 * developing across dispatch / live-map / trips-detail pages, each of
 * which had its own `STATUS_CONFIG`/`STAGES`/`TRIP_PILL` object with
 * slightly different colours for the same status.
 *
 * Palette conventions match what shipped on Trip Monitor first
 * (dispatch/page.tsx) and were mirrored to Live Fleet Map's Trip
 * Status pill: blue Scheduled, amber Departed, orange In Transit,
 * emerald Completed, red Cancelled.
 */

import type { TripScheduleStatus, TripPassengerStatus } from './state-machines';

// ── Trip status ─────────────────────────────────────────────────────────

export interface StatusMeta {
  label: string;
  /** Tailwind text-* class */    text:   string;
  /** Tailwind bg-* class */      bg:     string;
  /** Tailwind border-* class */  border: string;
  /** Tailwind bg-* for the dot marker */ dot: string;
}

export const TRIP_STATUS_META: Record<TripScheduleStatus, StatusMeta> = {
  SCHEDULED:  { label: 'Scheduled',  text: 'text-blue-300',    bg: 'bg-blue-500/15',    border: 'border-blue-500/30',    dot: 'bg-blue-400'    },
  DEPARTED:   { label: 'Departed',   text: 'text-amber-300',   bg: 'bg-amber-500/15',   border: 'border-amber-500/30',   dot: 'bg-amber-400'   },
  IN_TRANSIT: { label: 'In Transit', text: 'text-orange-300',  bg: 'bg-orange-500/15',  border: 'border-orange-500/30',  dot: 'bg-orange-400'  },
  COMPLETED:  { label: 'Completed',  text: 'text-emerald-300', bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', dot: 'bg-emerald-400' },
  CANCELLED:  { label: 'Cancelled',  text: 'text-red-300',     bg: 'bg-red-500/15',     border: 'border-red-500/30',     dot: 'bg-red-400'     },
};

// ── Passenger status ────────────────────────────────────────────────────

export const PASSENGER_STATUS_META: Record<TripPassengerStatus, StatusMeta> = {
  CONFIRMED:  { label: 'Confirmed',  text: 'text-blue-300',    bg: 'bg-blue-500/20',    border: 'border-blue-500/40',    dot: 'bg-blue-400'    },
  BOARDED:    { label: 'Boarded',    text: 'text-emerald-300', bg: 'bg-emerald-500/20', border: 'border-emerald-500/40', dot: 'bg-emerald-400' },
  ALIGHTED:   { label: 'Alighted',   text: 'text-cyan-300',    bg: 'bg-cyan-500/20',    border: 'border-cyan-500/40',    dot: 'bg-cyan-400'    },
  ABSENT:     { label: 'Absent',     text: 'text-rose-300',    bg: 'bg-rose-500/20',    border: 'border-rose-500/40',    dot: 'bg-rose-400'    },
  NO_SHOW:    { label: 'No Show',    text: 'text-slate-400',   bg: 'bg-slate-500/20',   border: 'border-slate-500/40',   dot: 'bg-slate-400'   },
  CANCELLED:  { label: 'Cancelled',  text: 'text-slate-400',   bg: 'bg-slate-500/20',   border: 'border-slate-500/40',   dot: 'bg-slate-400'   },
  WAITLISTED: { label: 'Waitlisted', text: 'text-amber-300',   bg: 'bg-amber-500/20',   border: 'border-amber-500/40',   dot: 'bg-amber-400'   },
};

/**
 * Compose a pill className from a StatusMeta entry. Consumers can also
 * spread the fields inline if they need custom composition.
 */
export function pillClass(meta: StatusMeta): string {
  return `${meta.bg} ${meta.text} ${meta.border}`;
}
