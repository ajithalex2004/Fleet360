/**
 * Field Service priority tiers (P1–P4) and SLA display helpers. Shared by the
 * Service Catalog & SLA master, the New Request form and the server; no
 * server-only imports so client components can use it.
 */

import type { TicketPriority } from '@/types/service-tickets';

export interface PriorityTier {
  tier: 'P1' | 'P2' | 'P3' | 'P4';
  priority: TicketPriority;
  label: string;
  definition: string;
}

export const PRIORITY_TIERS: PriorityTier[] = [
  { tier: 'P1', priority: 'Critical', label: 'P1 - Critical', definition: 'Complete system outage, safety hazard, or critical business stoppage' },
  { tier: 'P2', priority: 'High',     label: 'P2 - High',     definition: 'Major degradation, single-site outage, regulatory deadline, or SLA breach risk' },
  { tier: 'P3', priority: 'Medium',   label: 'P3 - Medium',   definition: 'Standard operational issue, planned installation, or routine scheduled maintenance' },
  { tier: 'P4', priority: 'Low',      label: 'P4 - Low',      definition: 'Non-urgent request, routine audit, preventive upkeep, or scheduled decommissioning' },
];

export function priorityLabel(p: string): string {
  return PRIORITY_TIERS.find((t) => t.priority === p)?.label ?? p;
}

/** 0.25 → "15 min", 4 → "4 h", 168 → "168 h (7 d)". */
export function formatSlaHours(h: number | null | undefined): string {
  if (h === null || h === undefined || !Number.isFinite(h)) return '—';
  if (h < 1) return `${Math.round(h * 60)} min`;
  const hours = Math.round(h * 100) / 100;
  return hours >= 24 && hours % 24 === 0 ? `${hours} h (${hours / 24} d)` : `${hours} h`;
}
