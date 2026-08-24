/**
 * Shipper Portal — tracking visibility types and constants.
 *
 * This file contains only types and constants that can be safely imported
 * in client components. Server-side functions remain in visibility.ts.
 */

// ── Types ──────────────────────────────────────────────────────────────

export const TRACKING_LEVELS = ['NONE', 'STATUS_ONLY', 'STATUS_AND_ETA', 'FULL_TRACKING'] as const;
export type TrackingLevel = typeof TRACKING_LEVELS[number];

export function isTrackingLevel(s: string | null | undefined): s is TrackingLevel {
  return !!s && (TRACKING_LEVELS as readonly string[]).includes(s);
}

/** Hard fallback when nothing is configured at any level. */
export const DEFAULT_TRACKING_LEVEL: TrackingLevel = 'STATUS_ONLY';

// Terminal status names — used to filter timelines at NONE.
export const TERMINAL_STATUSES = new Set([
  'DRAFT', 'PENDING', 'ACKNOWLEDGED', 'APPROVED',
  'DELIVERED', 'POD_SUBMITTED', 'CLOSED', 'CANCELLED', 'REJECTED',
]);
