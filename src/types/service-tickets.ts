/**
 * Service & Support Ticketing — shared types.
 *
 * One module, multiple ticket types. Phase 1A defines the contract;
 * Phase 1B+ wires up storage + UI + per-type forms/workflows.
 *
 * The same engines (status workflow, SLA, assignment, notification,
 * attachments/comments, history audit) drive every type. What differs
 * per type is: prefix, default SLA, default priority, form fields,
 * approval rules. See src/lib/service-tickets/config.ts for the
 * per-type configuration table.
 */

/** The seven built-in (system) ticket types seeded for every tenant. */
export type SystemTicketType =
  | 'MAINTENANCE'
  | 'RENEWAL'
  | 'CLEANING'
  | 'SUPPORT'
  | 'INCIDENT'
  | 'TOWING'
  | 'COMPLAINT';

/**
 * A ticket type key. Any `service_types.key` in the tenant's catalogue that is
 * linked to the SERVICE_TICKETING module is a valid ticket type — the seven
 * system types plus tenant-defined ones (e.g. the Field Service Management catalogue).
 * `(string & {})` keeps editor autocompletion for the system keys.
 */
export type TicketType = SystemTicketType | (string & {});

/** Shape of a catalogue key: upper-case letters, digits, underscore. */
export const TICKET_TYPE_KEY_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

export const TICKET_TYPES_ORDER: SystemTicketType[] = [
  'MAINTENANCE',
  'RENEWAL',
  'CLEANING',
  'SUPPORT',
  'INCIDENT',
  'TOWING',
  'COMPLAINT',
];

/** The six system departments for the Operations forwarding workflow. */
export type SystemTicketDepartment =
  | 'OPERATIONS_TRIAGE'
  | 'WORKSHOP_MAINTENANCE'
  | 'RECOVERY_DISPATCH'
  | 'SAFETY_COMPLIANCE'
  | 'CUSTOMER_SERVICE'
  | 'FACILITIES_CLEANING';

/** A department key — a system department or a tenant-defined one
 *  (stored in `service_departments`). */
export type TicketDepartment = SystemTicketDepartment | (string & {});

/** Triage is the landing hopper every new ticket starts in. */
export const TRIAGE_DEPARTMENT: SystemTicketDepartment = 'OPERATIONS_TRIAGE';

export type DepartmentTone = 'slate' | 'amber' | 'rose' | 'emerald' | 'blue' | 'violet' | 'cyan' | 'gold';

export interface TicketDepartmentDef {
  key: TicketDepartment;
  label: string;
  shortLabel: string;
  description: string;
  tone: DepartmentTone;
  /** True for the six built-in departments (cannot be deleted). */
  isSystem?: boolean;
}

/** Built-in departments. Tenants can rename/hide these and add their own;
 *  the resolved list comes from src/lib/service-tickets/departments.ts. */
export const TICKET_DEPARTMENTS: TicketDepartmentDef[] = [
  {
    key: 'OPERATIONS_TRIAGE',
    label: 'Operations Triage',
    shortLabel: 'Triage',
    description: 'Initial landing hopper for newly ingested field & support tickets',
    tone: 'slate',
  },
  {
    key: 'WORKSHOP_MAINTENANCE',
    label: 'Workshop & Maintenance',
    shortLabel: 'Workshop',
    description: 'Vehicle maintenance, job cards, inspections, and repairs',
    tone: 'amber',
  },
  {
    key: 'RECOVERY_DISPATCH',
    label: 'Recovery & Roadside Assistance',
    shortLabel: 'Recovery',
    description: 'Breakdown flatbed towing, mobile mechanics, and vehicle swaps',
    tone: 'rose',
  },
  {
    key: 'SAFETY_COMPLIANCE',
    label: 'Safety, Risk & Compliance',
    shortLabel: 'Compliance',
    description: 'Traffic accidents, police reports, RTA/DOT mulkiya, insurance claims',
    tone: 'violet',
  },
  {
    key: 'CUSTOMER_SERVICE',
    label: 'Customer Relations & Accounts',
    shortLabel: 'Customer Care',
    description: 'Passenger feedback, client inquiries, contract SLAs, dispute billing',
    tone: 'blue',
  },
  {
    key: 'FACILITIES_CLEANING',
    label: 'Depot & Facilities Cleaning',
    shortLabel: 'Cleaning',
    description: 'Cabin washing, sanitization, detailing, and depot turnaround',
    tone: 'emerald',
  },
];

/** Status workflow — common across types. Approval-gated types start in
 *  'Awaiting Approval' instead of 'Pending'; once approved they enter the
 *  normal flow. The user's spec keeps the core workflow consistent — per-
 *  type intermediate states are deferred. */
export type TicketStatus =
  | 'Awaiting Approval'   // 1C: approval-gated initial state
  | 'Pending'
  | 'Acknowledged'
  | 'Assigned'
  | 'Escalated'
  | 'In Progress'
  | 'Resolved'
  | 'Completed'
  | 'Rejected'
  | 'Closed';

export type TicketPriority = 'Low' | 'Medium' | 'High' | 'Critical';

/** Priorities in ascending order of urgency. */
export const TICKET_PRIORITIES: TicketPriority[] = ['Low', 'Medium', 'High', 'Critical'];

export function isTicketPriority(v: unknown): v is TicketPriority {
  return typeof v === 'string' && (TICKET_PRIORITIES as string[]).includes(v);
}

/** Form field schema for per-type custom fields (1C). Renders dynamically
 *  in the create form and surfaces on the card. */
export interface FormFieldDef {
  /** stable key used in customFields JSONB */
  key: string;
  /** human label */
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number' | 'date' | 'datetime' | 'checkbox';
  required?: boolean;
  /** for type === 'select' */
  options?: { value: string; label: string }[];
  placeholder?: string;
  /** for type === 'number' */
  min?: number;
  max?: number;
  /** show this field on the card preview (top 1-2 only — others stay
   *  in the detail drawer) */
  preview?: boolean;
  /** how to display on cards: 'text' (verbatim), 'badge' (pill) */
  display?: 'text' | 'badge';
}

/** Approval rule (1C) — when set on a TicketTypeConfig, matching tickets
 *  start in 'Awaiting Approval' instead of 'Pending'. Approval is
 *  surfaced as Approve/Reject buttons (TENANT_ADMIN role). */
export interface ApprovalRule {
  /** All tickets of this type require approval before entering the
   *  normal workflow. */
  always?: boolean;
  /** Only tickets with priority === 'High' require approval. */
  highPriorityOnly?: boolean;
}

/** History entry — same shape as ServiceRequest.history so the
 *  TimelineModal component can read both. */
export interface TicketHistoryEntry {
  status: string;
  date: string;          // ISO
  actor?: string;
  /** Display name for `actor` (resolved by the API when actor is a user id). */
  actorName?: string;
  note?: string;
}

/** Attachment — same shape as MaintenanceRequest.attachments. */
export interface TicketAttachment {
  id: string;
  type: string;
  fileName: string;
  url: string;
  uploadedAt: string;
  size?: number;
  mimeType?: string;
  uploadedBy?: string | null;
}

/** Comment — Phase 1B+ ships the comments engine. */
export interface TicketComment {
  id: string;
  authorId: string;
  authorName?: string;
  body: string;
  createdAt: string;
}

export interface ServiceTicket {
  id: string;
  /** Human-friendly ticker like "ST2026-MNT-0001". */
  readableId?: string;

  ticketType: TicketType;
  tenantId: string;

  requestorId: string;
  /** Optional vehicle reference — populated for MAINTENANCE / TOWING / CLEANING. */
  vehicleId?: string;
  /** Optional driver reference — populated for renewals tied to a person. */
  relatedDriverId?: string;

  /** Free-text title (was 'serviceType' on ServiceRequest). */
  title: string;
  description: string;

  priority: TicketPriority;
  status: TicketStatus;

  /** ISO date the requestor wants the work done by. */
  dueDate?: string;

  /** When the requestor submitted the ticket (ISO). */
  createdAt: string;

  /** Email or user ID of the assignee. */
  assignedTo?: string;
  /** Optional linked FSM technician, team/squad, and service territory (Phase 1 PR 1). */
  primaryTechnicianId?: string | null;
  assignedTeamId?: string | null;
  territoryId?: string | null;
  /** Optional parent Service Order, scheduled dispatch window & FTFR flag (Phase 1 PR 2). */
  parentTicketId?: string | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  firstTimeFix?: boolean | null;

  /** Per-type custom field values (1C). Schema lives in
   *  TicketTypeConfig.formFields; values are keyed by FormFieldDef.key.
   *  e.g. { documentType: 'mulkiya', currentExpiryDate: '2026-09-01' }
   *  for a RENEWAL ticket. */
  customFields?: Record<string, unknown>;

  /** Resolved SLA target in hours for this ticket's priority (Phase 2C.x).
   *  Populated by API responses via the Service Configuration Engine —
   *  authority order: service_rules.ticketing.priorityMatrix → legacy
   *  TICKET_TYPE_CONFIG.defaultSlaHours. UI uses this for the aging
   *  badge thresholds (warn at 50%, breach at 100%). */
  slaTargetHours?: number;

  /** For MAINTENANCE tickets only — link to the formal MaintenanceRequest
   *  created on Acknowledge (preserves existing /maintenance/requests
   *  cross-module behaviour). */
  maintenanceRequestId?: string;

  /** Assigned department after triage forwarding. Defaults to 'OPERATIONS_TRIAGE'. */
  assignedDepartment?: TicketDepartment;

  /** Ingestion source: DRIVER_APP, WHATSAPP, DVIR, WEB, TELEMATICS, BOOKING_PORTAL */
  source?: 'DRIVER_APP' | 'WHATSAPP' | 'DVIR' | 'WEB' | 'TELEMATICS' | 'BOOKING_PORTAL';

  history?: TicketHistoryEntry[];
  attachments?: TicketAttachment[];
  comments?: TicketComment[];

  /** Display name of the assignee (resolved by the API). */
  assignedToName?: string | null;
  // Field Service request (revamped Service Request form)
  customerId?: string | null;
  customerSiteId?: string | null;
  assetId?: string | null;
  /** CUSTOMER_PORTAL | WHATSAPP | EMAIL | IOT */
  requestChannel?: string | null;
  serviceNeededAt?: string | null;
  /** AMC | WARRANTY | SLA_CONTRACT | CHARGEABLE | GOODWILL */
  entitlementType?: string | null;
}

/** Per-tenant access toggle row. */
export interface TenantTicketTypeAccess {
  tenantId: string;
  ticketType: TicketType;
  enabled: boolean;
  /** Optional per-tenant override of default SLA hours. */
  slaOverrideHours?: number | null;
  updatedAt?: string;
}
