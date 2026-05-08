/**
 * Per-type configuration for the Service & Support Ticketing module.
 *
 * One row per ticket type. All UI / SLA / numbering / theming reads
 * from this table — adding a new type is a single object here.
 *
 * Phase 1A: prefix, label, icon, tone, default SLA, default priority.
 * Phase 1C will extend with per-type form fields and per-type
 * workflow state machines.
 */

import {
  Wrench, Calendar, Sparkles, LifeBuoy, Siren, Truck, MessageSquareWarning,
  type LucideIcon,
} from 'lucide-react';
import type { TicketType, TicketPriority } from '@/types/service-tickets';

export interface TicketTypeConfig {
  type: TicketType;
  /** 3-letter code in the ticker: ST2026-MNT-0001 etc. */
  prefix: string;
  /** Short label for tabs / badges. */
  label: string;
  /** Long label for headers / tooltips. */
  longLabel: string;
  description: string;
  icon: LucideIcon;
  /** Tone key from page-theme accents (gold/blue/emerald/amber/rose/slate). */
  tone: 'gold' | 'blue' | 'emerald' | 'amber' | 'rose' | 'slate' | 'violet';
  /** Default SLA — first-response target in hours from creation. */
  defaultSlaHours: number;
  /** Default priority when the requestor doesn't pick one. */
  defaultPriority: TicketPriority;
  /** Whether tickets of this type can be linked to a vehicle. */
  vehicleRequired: boolean;
  /** Whether Acknowledge auto-creates a back-office MaintenanceRequest. */
  autoCreatesMaintenanceRequest: boolean;
}

export const TICKET_TYPE_CONFIG: Record<TicketType, TicketTypeConfig> = {
  MAINTENANCE: {
    type: 'MAINTENANCE',
    prefix: 'MNT',
    label: 'Maintenance',
    longLabel: 'Maintenance Request',
    description: 'Vehicle breakdown, scheduled servicing, repairs. Acknowledging creates a formal Maintenance Request in the workshop queue.',
    icon: Wrench,
    tone: 'blue',
    defaultSlaHours: 24,
    defaultPriority: 'Medium',
    vehicleRequired: true,
    autoCreatesMaintenanceRequest: true,
  },
  RENEWAL: {
    type: 'RENEWAL',
    prefix: 'REN',
    label: 'Renewal',
    longLabel: 'Renewal Request',
    description: 'Vehicle registration, road permits, driver licence and driver permit renewals. Predictable lead time.',
    icon: Calendar,
    tone: 'gold',
    defaultSlaHours: 168, // 7 days
    defaultPriority: 'Low',
    vehicleRequired: false,
    autoCreatesMaintenanceRequest: false,
  },
  CLEANING: {
    type: 'CLEANING',
    prefix: 'CLN',
    label: 'Cleaning',
    longLabel: 'Vehicle Cleaning Request',
    description: 'Interior / exterior detailing, sanitisation, periodic deep cleaning.',
    icon: Sparkles,
    tone: 'emerald',
    defaultSlaHours: 48,
    defaultPriority: 'Low',
    vehicleRequired: true,
    autoCreatesMaintenanceRequest: false,
  },
  SUPPORT: {
    type: 'SUPPORT',
    prefix: 'SUP',
    label: 'Support',
    longLabel: 'Support Ticket',
    description: 'Platform / app support — login problems, data corrections, configuration help.',
    icon: LifeBuoy,
    tone: 'blue',
    defaultSlaHours: 24,
    defaultPriority: 'Medium',
    vehicleRequired: false,
    autoCreatesMaintenanceRequest: false,
  },
  INCIDENT: {
    type: 'INCIDENT',
    prefix: 'INC',
    label: 'Incident',
    longLabel: 'Incident Report',
    description: 'Accidents, safety incidents, on-road events. High priority — short SLA.',
    icon: Siren,
    tone: 'rose',
    defaultSlaHours: 2,
    defaultPriority: 'High',
    vehicleRequired: true,
    autoCreatesMaintenanceRequest: false,
  },
  TOWING: {
    type: 'TOWING',
    prefix: 'TOW',
    label: 'Towing',
    longLabel: 'Towing & Recovery',
    description: 'Roadside breakdown recovery, jump-start, flat-tyre, vehicle relocation.',
    icon: Truck,
    tone: 'amber',
    defaultSlaHours: 1,
    defaultPriority: 'High',
    vehicleRequired: true,
    autoCreatesMaintenanceRequest: false,
  },
  COMPLAINT: {
    type: 'COMPLAINT',
    prefix: 'COM',
    label: 'Complaint',
    longLabel: 'Complaint or Suggestion',
    description: 'Customer feedback, service complaints, improvement suggestions.',
    icon: MessageSquareWarning,
    tone: 'violet',
    defaultSlaHours: 72,
    defaultPriority: 'Medium',
    vehicleRequired: false,
    autoCreatesMaintenanceRequest: false,
  },
};

/** Convenience: ordered array for grids, tabs, etc. */
export const TICKET_TYPE_LIST: TicketTypeConfig[] = (
  ['MAINTENANCE', 'RENEWAL', 'CLEANING', 'SUPPORT', 'INCIDENT', 'TOWING', 'COMPLAINT'] as TicketType[]
).map(t => TICKET_TYPE_CONFIG[t]);

/** Lookup by prefix (used when parsing a ticker like ST2026-MNT-0001). */
export function configByPrefix(prefix: string): TicketTypeConfig | null {
  const found = TICKET_TYPE_LIST.find(c => c.prefix === prefix.toUpperCase());
  return found ?? null;
}
