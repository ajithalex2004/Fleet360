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
import type {
  TicketType, TicketPriority, FormFieldDef, ApprovalRule,
} from '@/types/service-tickets';

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
  /** Per-type custom field schema (1C). Rendered in the create form and
   *  shown on the card. */
  formFields: FormFieldDef[];
  /** Approval rule (1C). When matched, the ticket starts in 'Awaiting
   *  Approval' instead of 'Pending'. */
  requiresApproval?: ApprovalRule;
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
    requiresApproval: { highPriorityOnly: true },
    formFields: [
      { key: 'serviceCategory', label: 'Service category', type: 'select', required: true, preview: true, display: 'badge',
        options: [
          { value: 'scheduled',  label: 'Scheduled service' },
          { value: 'breakdown',  label: 'Breakdown / unscheduled' },
          { value: 'accident',   label: 'Accident damage' },
          { value: 'rfq',        label: 'RFQ — multi-garage quote' },
        ] },
      { key: 'odometerReading', label: 'Odometer (km)', type: 'number', placeholder: 'e.g. 47200', min: 0 },
      { key: 'preferredGarage', label: 'Preferred garage / vendor', type: 'text', placeholder: 'Optional vendor name' },
    ],
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
    requiresApproval: { always: true },
    formFields: [
      { key: 'documentType', label: 'Document', type: 'select', required: true, preview: true, display: 'badge',
        options: [
          { value: 'mulkiya',     label: 'Mulkiya / vehicle registration' },
          { value: 'rta_permit',  label: 'RTA road permit' },
          { value: 'salik',       label: 'Salik tag / account' },
          { value: 'license',     label: 'Driver licence' },
          { value: 'driver_permit', label: 'Driver permit' },
          { value: 'insurance',   label: 'Insurance policy' },
          { value: 'other',       label: 'Other' },
        ] },
      { key: 'currentExpiryDate', label: 'Current expiry date', type: 'date', required: true, preview: true, display: 'text' },
      { key: 'documentNumber',    label: 'Document / plate number', type: 'text', placeholder: 'e.g. plate AA-12345' },
    ],
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
    formFields: [
      { key: 'cleaningType', label: 'Cleaning type', type: 'select', required: true, preview: true, display: 'badge',
        options: [
          { value: 'exterior',     label: 'Exterior wash' },
          { value: 'interior',     label: 'Interior detail' },
          { value: 'full_detail',  label: 'Full detail (interior + exterior)' },
          { value: 'sanitisation', label: 'Sanitisation / disinfection' },
        ] },
      { key: 'preferredTime', label: 'Preferred time', type: 'datetime' },
    ],
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
    formFields: [
      { key: 'category', label: 'Category', type: 'select', required: true, preview: true, display: 'badge',
        options: [
          { value: 'login',          label: 'Login / authentication' },
          { value: 'data_correction',label: 'Data correction' },
          { value: 'configuration',  label: 'Configuration help' },
          { value: 'integration',    label: 'Integration issue' },
          { value: 'bug_report',     label: 'Bug report' },
          { value: 'feature',        label: 'Feature question' },
          { value: 'other',          label: 'Other' },
        ] },
      { key: 'affectedModule', label: 'Affected module', type: 'select',
        options: [
          { value: 'fleet',          label: 'Fleet' },
          { value: 'maintenance',    label: 'Maintenance' },
          { value: 'leasing',        label: 'Leasing' },
          { value: 'rental',         label: 'Rent-a-Car' },
          { value: 'logistics',      label: 'Logistics' },
          { value: 'staff_transport',label: 'Staff Transport' },
          { value: 'school_bus',     label: 'School Bus' },
          { value: 'finance',        label: 'Finance' },
          { value: 'admin',          label: 'Admin' },
          { value: 'other',          label: 'Other' },
        ] },
    ],
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
    requiresApproval: { always: true },
    formFields: [
      { key: 'incidentDate', label: 'Date & time of incident', type: 'datetime', required: true, preview: true, display: 'text' },
      { key: 'location',     label: 'Location', type: 'text', required: true, placeholder: 'Address or coordinates' },
      { key: 'severity',     label: 'Severity', type: 'select', required: true, preview: true, display: 'badge',
        options: [
          { value: 'minor',    label: 'Minor — no injuries, drivable' },
          { value: 'major',    label: 'Major — drivable but damaged' },
          { value: 'critical', label: 'Critical — undrivable / injuries' },
        ] },
      { key: 'policeReportFiled', label: 'Police report filed', type: 'checkbox' },
      { key: 'thirdPartyInvolved', label: 'Third-party involved', type: 'checkbox' },
    ],
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
    formFields: [
      { key: 'pickupLocation',  label: 'Pickup location',  type: 'text', required: true, preview: true, display: 'text', placeholder: 'Where is the vehicle?' },
      { key: 'dropoffLocation', label: 'Drop-off location', type: 'text', required: true, placeholder: 'Garage / depot / address' },
      { key: 'vehicleStatus',   label: 'Vehicle condition', type: 'select', required: true, preview: true, display: 'badge',
        options: [
          { value: 'drivable',           label: 'Drivable but stranded' },
          { value: 'partially_drivable', label: 'Partially drivable' },
          { value: 'not_drivable',       label: 'Not drivable' },
        ] },
    ],
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
    formFields: [
      { key: 'category', label: 'Category', type: 'select', required: true, preview: true, display: 'badge',
        options: [
          { value: 'service_quality', label: 'Service quality' },
          { value: 'billing',         label: 'Billing / invoice' },
          { value: 'staff_conduct',   label: 'Staff conduct' },
          { value: 'vehicle_condition', label: 'Vehicle condition' },
          { value: 'suggestion',      label: 'Suggestion / improvement' },
          { value: 'other',           label: 'Other' },
        ] },
      { key: 'desiredOutcome', label: 'Desired outcome', type: 'textarea', placeholder: 'How would you like this resolved?' },
    ],
  },
};

/**
 * Compute the initial status for a new ticket — `Awaiting Approval` if
 * the type's approval rule matches, else `Pending`.
 */
export function initialStatusForType(
  type: TicketType,
  priority: TicketPriority,
): 'Awaiting Approval' | 'Pending' {
  const rule = TICKET_TYPE_CONFIG[type].requiresApproval;
  if (!rule) return 'Pending';
  if (rule.always) return 'Awaiting Approval';
  if (rule.highPriorityOnly && priority === 'High') return 'Awaiting Approval';
  return 'Pending';
}

/** Convenience: ordered array for grids, tabs, etc. */
export const TICKET_TYPE_LIST: TicketTypeConfig[] = (
  ['MAINTENANCE', 'RENEWAL', 'CLEANING', 'SUPPORT', 'INCIDENT', 'TOWING', 'COMPLAINT'] as TicketType[]
).map(t => TICKET_TYPE_CONFIG[t]);

/** Lookup by prefix (used when parsing a ticker like ST2026-MNT-0001). */
export function configByPrefix(prefix: string): TicketTypeConfig | null {
  const found = TICKET_TYPE_LIST.find(c => c.prefix === prefix.toUpperCase());
  return found ?? null;
}
