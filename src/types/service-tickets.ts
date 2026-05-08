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

/** All seven ticket types supported by the module. */
export type TicketType =
  | 'MAINTENANCE'
  | 'RENEWAL'
  | 'CLEANING'
  | 'SUPPORT'
  | 'INCIDENT'
  | 'TOWING'
  | 'COMPLAINT';

export const TICKET_TYPES_ORDER: TicketType[] = [
  'MAINTENANCE',
  'RENEWAL',
  'CLEANING',
  'SUPPORT',
  'INCIDENT',
  'TOWING',
  'COMPLAINT',
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

export type TicketPriority = 'Low' | 'Medium' | 'High';

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
  note?: string;
}

/** Attachment — same shape as MaintenanceRequest.attachments. */
export interface TicketAttachment {
  id: string;
  type: string;
  fileName: string;
  url: string;
  uploadedAt: string;
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

  history?: TicketHistoryEntry[];
  attachments?: TicketAttachment[];
  comments?: TicketComment[];
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
