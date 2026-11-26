/**
 * Customer Portal — the customer's view of their Field Service requests.
 *
 * Only requests with this customer_id are ever read, and they are mapped to
 * a narrow shape: the request, its site and asset, priority and SLA, and the
 * lifecycle as stage / time / who. Staff notes, comments, routing and costs
 * are not exposed. The assigned technician's contact is included on detail.
 */

import { prisma } from '@/lib/prisma';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { resolveHistoryActors } from '@/lib/service-tickets/history-actors';
import { resolveTechnician, type TechnicianContact } from '@/lib/service-tickets/customer-context';
import { FSM_REQUEST_COLS, TICKET_BASE_COLS, ticketRowToApi, type TicketRow } from '@/lib/service-tickets/ticket-row';

export const ACTIVE_STATUSES = ['Pending', 'Awaiting Approval', 'Acknowledged', 'Assigned', 'Escalated', 'In Progress'];

export interface CustomerRequest {
  id: string;
  readableId: string | null;
  title: string;
  description: string | null;
  ticketType: string;
  priority: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  serviceNeededAt: string | null;
  entitlementType: string | null;
  requestChannel: string | null;
  siteId: string | null;
  siteName: string | null;
  assetNo: string | null;
  assetName: string | null;
  serialNumber: string | null;
  sla: { responseHours: number | null; onSiteHours: number | null; resolutionHours: number | null } | null;
  photos: number;
  lifecycle: Array<{ status: string; at: string; by: string }>;
  technician?: TechnicianContact | null;
}

function toCustomerRequest(t: ReturnType<typeof ticketRowToApi> & { history: Array<Record<string, unknown>> }): CustomerRequest {
  const cf = t.customFields as Record<string, unknown>;
  const str = (k: string) => (typeof cf[k] === 'string' ? (cf[k] as string) : null);
  return {
    id: t.id, readableId: t.readableId, title: t.title, description: t.description, ticketType: t.ticketType,
    priority: t.priority, status: t.status, createdAt: t.createdAt, updatedAt: t.updatedAt,
    serviceNeededAt: t.serviceNeededAt, entitlementType: t.entitlementType, requestChannel: t.requestChannel,
    siteId: t.customerSiteId, siteName: str('siteName'), assetNo: str('assetNo'), assetName: str('assetName'),
    serialNumber: str('serialNumber'),
    sla: (cf.sla && typeof cf.sla === 'object') ? cf.sla as CustomerRequest['sla'] : null,
    photos: (t.attachments as Array<{ type?: string }>).filter((a) => a?.type === 'PHOTO').length,
    lifecycle: t.history.map((h) => ({
      status: String(h.status ?? ''),
      at: String(h.date ?? ''),
      by: String(h.actorName ?? h.actor ?? 'Service desk'),
    })),
  };
}

async function readTickets(tx: TxClient, tenantId: string, where: string, params: unknown[]) {
  const rows = await tx.$queryRawUnsafe<TicketRow[]>(
    `SELECT ${TICKET_BASE_COLS}, ${FSM_REQUEST_COLS}
       FROM service_tickets
      WHERE tenant_id = $1 AND deleted_at IS NULL AND (to_jsonb(service_tickets) ->> 'customer_id') = $2 ${where}
      ORDER BY created_at DESC
      LIMIT 500`,
    tenantId, ...params,
  );
  const tickets = await resolveHistoryActors(tx, rows.map((r) => ticketRowToApi(r)));
  return tickets as Array<ReturnType<typeof ticketRowToApi> & { history: Array<Record<string, unknown>> }>;
}

export async function listCustomerRequests(
  tenantId: string, customerId: string, filter: { scope?: string; status?: string; siteId?: string; from?: string; to?: string },
): Promise<CustomerRequest[]> {
  const cond: string[] = [];
  const params: unknown[] = [customerId];
  let p = 3;
  if (filter.scope === 'active') { cond.push(`status = ANY($${p++}::text[])`); params.push(ACTIVE_STATUSES); }
  if (filter.status) { cond.push(`status = $${p++}`); params.push(filter.status); }
  if (filter.siteId) { cond.push(`(to_jsonb(service_tickets) ->> 'customer_site_id') = $${p++}`); params.push(filter.siteId); }
  if (filter.from && !Number.isNaN(Date.parse(filter.from))) { cond.push(`created_at >= $${p++}::timestamptz`); params.push(filter.from); }
  if (filter.to && !Number.isNaN(Date.parse(filter.to))) { cond.push(`created_at <= $${p++}::timestamptz`); params.push(filter.to); }
  const where = cond.length ? `AND ${cond.join(' AND ')}` : '';
  return withTenantRls(prisma, tenantId, async (tx) => (await readTickets(tx, tenantId, where, params)).map(toCustomerRequest));
}

export async function getCustomerRequest(tenantId: string, customerId: string, id: string): Promise<CustomerRequest | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return withTenantRls(prisma, tenantId, async (tx) => {
    const [t] = await readTickets(tx, tenantId, 'AND id = $3::uuid', [customerId, id]);
    if (!t) return null;
    return { ...toCustomerRequest(t), technician: await resolveTechnician(tx, t.assignedTo ?? null) };
  });
}
