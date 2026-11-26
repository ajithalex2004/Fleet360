/**
 * service_tickets row shape and its API mapping, shared by the staff routes
 * (/api/service-tickets) and the Customer Portal routes.
 */

import { pickSlaHours, type SlaMatrix } from '@/lib/service-config/resolvers';
import type { TicketPriority } from '@/types/service-tickets';

export interface TicketRow {
  id: string;
  tenant_id: string;
  ticket_type: string;
  readable_id: string | null;
  requestor_id: string;
  requestor_name: string | null;
  vehicle_id: string | null;
  related_driver_id: string | null;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  due_date: string | null;
  assigned_to: string | null;
  maintenance_request_id: string | null;
  history: unknown;
  attachments: unknown;
  comments: unknown;
  custom_fields: unknown;
  created_at: string;
  updated_at: string;
  // Field Service request fields (migration 20261126100000). Read through
  // to_jsonb(...) so lists keep working before that migration runs.
  customer_id?: string | null;
  customer_site_id?: string | null;
  asset_id?: string | null;
  request_channel?: string | null;
  service_needed_at?: string | null;
  entitlement_type?: string | null;
}

export const TICKET_BASE_COLS = `id::text, tenant_id, ticket_type, readable_id, requestor_id, requestor_name,
  vehicle_id, related_driver_id, title, description, priority, status,
  due_date::text, assigned_to, maintenance_request_id, history, attachments, comments, custom_fields,
  created_at::text, updated_at::text`;

export const FSM_REQUEST_COLS = `
  to_jsonb(service_tickets) ->> 'customer_id'       AS customer_id,
  to_jsonb(service_tickets) ->> 'customer_site_id'  AS customer_site_id,
  to_jsonb(service_tickets) ->> 'asset_id'          AS asset_id,
  to_jsonb(service_tickets) ->> 'request_channel'   AS request_channel,
  to_jsonb(service_tickets) ->> 'service_needed_at' AS service_needed_at,
  to_jsonb(service_tickets) ->> 'entitlement_type'  AS entitlement_type`;

export function ticketRowToApi(r: TicketRow, matrix?: SlaMatrix) {
  const priority = r.priority as TicketPriority;
  const customFields = (r.custom_fields && typeof r.custom_fields === 'object') ? r.custom_fields as Record<string, unknown> : {};
  const assignedDepartment = (customFields.assignedDepartment as string | undefined) || 'OPERATIONS_TRIAGE';
  const source = (customFields.source as string | undefined) || 'WEB';
  return {
    id: r.id,
    tenantId: r.tenant_id,
    ticketType: r.ticket_type,
    readableId: r.readable_id,
    requestorId: r.requestor_id,
    requestorName: r.requestor_name,
    vehicleId: r.vehicle_id,
    relatedDriverId: r.related_driver_id,
    title: r.title,
    description: r.description,
    priority: r.priority,
    status: r.status,
    dueDate: r.due_date,
    assignedTo: r.assigned_to,
    maintenanceRequestId: r.maintenance_request_id,
    assignedDepartment,
    source,
    history: Array.isArray(r.history) ? r.history : [],
    attachments: Array.isArray(r.attachments) ? r.attachments : [],
    comments: Array.isArray(r.comments) ? r.comments : [],
    customFields,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    slaTargetHours: matrix ? pickSlaHours(matrix, priority) : undefined,
    customerId: r.customer_id ?? null,
    customerSiteId: r.customer_site_id ?? null,
    assetId: r.asset_id ?? null,
    requestChannel: r.request_channel ?? null,
    serviceNeededAt: r.service_needed_at ?? null,
    entitlementType: r.entitlement_type ?? null,
  };
}
export type ApiTicket = ReturnType<typeof ticketRowToApi>;
