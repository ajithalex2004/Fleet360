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

/** Status workflow — Phase 1A uses the same set as Service Requests for
 *  every type. Phase 1C will allow per-type divergence. */
export type TicketStatus =
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
