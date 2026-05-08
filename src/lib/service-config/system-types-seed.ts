/**
 * Bootstrap data for the 7 system ticket types.
 *
 * This file replaces the runtime `TICKET_TYPE_CONFIG` map. It is read
 * **only** by `seedServiceConfigForTenant` to populate `service_categories`,
 * `service_types`, `service_module_mapping`, and `service_rules` for a
 * brand-new tenant. After seeding completes (which loadServiceConfig now
 * guarantees), every consumer reads through resolvers backed by the
 * database — there is no runtime fallback into this file.
 *
 * The icons are stored as Lucide names (strings), resolved client-side
 * via `src/lib/service-tickets/icons.ts`.
 */

import type { TicketType, FormFieldDef, TicketPriority } from '@/types/service-tickets';
import type { ServiceTone } from '@/types/service-config';

export interface SystemTicketTypeMeta {
  /** Short label for tabs / badges (was: TicketTypeConfig.label). */
  label: string;
  /** Long label for headers / tooltips (was: TicketTypeConfig.longLabel). */
  longLabel: string;
  description: string;
  /** Lucide icon name as a string — resolved at render time. */
  iconName: string;
  tone: ServiceTone;
  /** 3-letter code in the readable id (e.g. ST2026-MNT-0001). */
  prefix: string;
  defaultSlaHours: number;
  defaultPriority: TicketPriority;
  vehicleRequired: boolean;
  autoCreatesMaintenanceRequest: boolean;
  /** Approval rule. Translated to ApprovalRules at seed time. */
  requiresApproval?: { always?: boolean; highPriorityOnly?: boolean };
  formFields: FormFieldDef[];
}

export const SYSTEM_TICKET_TYPES: Record<TicketType, SystemTicketTypeMeta> = {
  MAINTENANCE: {
    label: 'Maintenance',
    longLabel: 'Maintenance Request',
    description: 'Vehicle breakdown, scheduled servicing, repairs. Acknowledging creates a formal Maintenance Request in the workshop queue.',
    iconName: 'Wrench',
    tone: 'blue',
    prefix: 'MNT',
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
    label: 'Renewal',
    longLabel: 'Renewal Request',
    description: 'Vehicle registration, road permits, driver licence and driver permit renewals. Predictable lead time.',
    iconName: 'Calendar',
    tone: 'gold',
    prefix: 'REN',
    defaultSlaHours: 168,
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
    label: 'Cleaning',
    longLabel: 'Vehicle Cleaning Request',
    description: 'Interior / exterior detailing, sanitisation, periodic deep cleaning.',
    iconName: 'Sparkles',
    tone: 'emerald',
    prefix: 'CLN',
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
    label: 'Support',
    longLabel: 'Support Ticket',
    description: 'Platform / app support — login problems, data corrections, configuration help.',
    iconName: 'LifeBuoy',
    tone: 'blue',
    prefix: 'SUP',
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
    label: 'Incident',
    longLabel: 'Incident Report',
    description: 'Accidents, safety incidents, on-road events. High priority — short SLA.',
    iconName: 'Siren',
    tone: 'rose',
    prefix: 'INC',
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
    label: 'Towing',
    longLabel: 'Towing & Recovery',
    description: 'Roadside breakdown recovery, jump-start, flat-tyre, vehicle relocation.',
    iconName: 'Truck',
    tone: 'amber',
    prefix: 'TOW',
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
    label: 'Complaint',
    longLabel: 'Complaint or Suggestion',
    description: 'Customer feedback, service complaints, improvement suggestions.',
    iconName: 'MessageSquareWarning',
    tone: 'violet',
    prefix: 'COM',
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

/** Ordered list of system types — used by the seed only. */
export const SYSTEM_TICKET_TYPES_ORDER: TicketType[] = [
  'MAINTENANCE', 'RENEWAL', 'CLEANING', 'SUPPORT', 'INCIDENT', 'TOWING', 'COMPLAINT',
];
