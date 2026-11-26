/**
 * Creates a service ticket / Field Service request. Shared by the staff API
 * (POST /api/service-tickets) and the Customer Portal
 * (POST /api/customer-portal/fsm/requests) so both validate and number
 * requests the same way.
 *
 * Portal mode (`portal` set): the request is locked to the signed-in
 * customer, only Field Service catalogue types are allowed, the channel is
 * Customer Portal, and fields the server owns (department, source, SLA,
 * priority, vehicle) cannot be supplied by the caller.
 *
 * Returns the NextResponse to send (201 with the ticket, or an error).
 */

import { NextResponse } from 'next/server';
import type { TxClient } from '@/lib/rls';
import { nextReadableId } from '@/lib/service-tickets/schema';
import { resolveHistoryActors } from '@/lib/service-tickets/history-actors';
import {
  CustomerContextError, getCustomer, getCustomerAsset, getCustomerSite,
  isEntitlementType, isRequestChannel, nextServiceRequestNumber,
} from '@/lib/service-tickets/customer-context';
import { TICKET_TYPE_KEY_RE, isTicketPriority, type TicketType, type TicketPriority } from '@/types/service-tickets';
import { listEnabledTicketTypes } from '@/lib/service-tickets/catalogue';
import { loadServiceConfig } from '@/lib/service-config/load';
import { resolveTicketInitialStatus, resolveTicketSlaMatrixBatch } from '@/lib/service-config/resolvers';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { FSM_REQUEST_COLS, TICKET_BASE_COLS, ticketRowToApi, type TicketRow } from './ticket-row';

export interface CreateTicketBody {
  ticketType?: string; title?: string; description?: string;
  priority?: string; vehicleId?: string; relatedDriverId?: string;
  dueDate?: string; requestorName?: string;
  customFields?: Record<string, unknown>;
  customerId?: string; customerSiteId?: string; assetId?: string;
  requestChannel?: string; serviceNeededAt?: string; entitlementType?: string;
}

/** customFields keys only the server may set. */
const SERVER_OWNED_FIELDS = [
  'assignedDepartment', 'source', 'trackingToken', 'sla', 'customerName', 'customerCode',
  'siteName', 'siteAddress', 'contactPerson', 'contactMobile', 'assetNo', 'assetName', 'serialNumber',
];

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function createServiceTicket(
  tx: TxClient,
  args: {
    tenantId: string;
    /** Staff user id, or the portal user id in portal mode. */
    actorId: string | null;
    /** Name shown on the ticket and its first lifecycle stage. */
    actorName?: string | null;
    body: CreateTicketBody;
    portal?: { customerId: string };
  },
): Promise<NextResponse> {
  const { tenantId, actorId, portal } = args;
  const body: CreateTicketBody = portal
    ? {
        ticketType: args.body.ticketType, title: args.body.title, description: args.body.description,
        dueDate: args.body.dueDate, customFields: args.body.customFields,
        customerId: portal.customerId, customerSiteId: args.body.customerSiteId, assetId: args.body.assetId,
        requestChannel: 'CUSTOMER_PORTAL', serviceNeededAt: args.body.serviceNeededAt,
        entitlementType: args.body.entitlementType,
      }
    : args.body;
  const requestorName = portal ? (args.actorName ?? null) : (body.requestorName ?? args.actorName ?? null);

  const ticketType = body.ticketType as TicketType | undefined;
  const title = String(body.title ?? '').trim();
  const description = String(body.description ?? '').trim();

  if (!ticketType || !TICKET_TYPE_KEY_RE.test(ticketType)) return bad('Invalid or missing ticketType.');
  if (!title) return bad('Title is required.');
  if (title.length > 200) return bad('Title must be 200 characters or fewer.');

  // Central service config (auto-seeds the tenant on first call).
  const cfg = await loadServiceConfig(tenantId, ticketType);
  if (!cfg || cfg.mapping?.linkedModule !== 'SERVICE_TICKETING') return bad(`Unknown service type ${ticketType}.`);
  const longLabel = cfg.type.name;

  const enabled = await listEnabledTicketTypes(tenantId);
  if (!enabled.some((e) => e.key === ticketType)) {
    return bad(`${longLabel} is not enabled for your tenant. Ask your administrator to enable it.`, 403);
  }

  // Field Service catalogue types carry an on-site arrival SLA; their priority
  // comes from the master and the SLA timers are recorded on the request.
  const slaRules = cfg.rules.sla;
  const catalogSla = typeof slaRules?.onSiteArrivalHours === 'number'
    ? {
        responseHours: slaRules.responseSlaMinutes != null ? slaRules.responseSlaMinutes / 60 : null,
        onSiteHours: slaRules.onSiteArrivalHours,
        resolutionHours: slaRules.resolutionSlaHours ?? null,
      }
    : null;
  if (portal && (!catalogSla || cfg.rules.vehicle.vehicleRequired)) {
    return bad(`${longLabel} cannot be requested from the Customer Portal.`, 403);
  }

  const priority: TicketPriority = catalogSla
    ? cfg.type.defaultPriority
    : isTicketPriority(body.priority) ? body.priority : cfg.type.defaultPriority;

  if (cfg.rules.vehicle.vehicleRequired && !body.vehicleId) return bad(`${longLabel} requires a vehicle.`);
  // A supplied vehicleId must be a real vehicle of this tenant.
  if (body.vehicleId) {
    const [vehicleRow] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id::text FROM vehicles WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      body.vehicleId, tenantId,
    ).catch(() => []);
    if (!vehicleRow) return bad('Vehicle not found for this tenant.');
  }

  const customFields: Record<string, unknown> = (body.customFields && typeof body.customFields === 'object')
    ? { ...body.customFields }
    : {};
  if (portal) for (const k of SERVER_OWNED_FIELDS) delete customFields[k];
  if (!customFields.assignedDepartment) customFields.assignedDepartment = 'OPERATIONS_TRIAGE';
  if (portal) customFields.source = 'CUSTOMER_PORTAL';
  else if (!customFields.source) customFields.source = 'WEB';
  if (!customFields.trackingToken) customFields.trackingToken = crypto.randomUUID().replace(/-/g, '');
  if (catalogSla) customFields.sla = catalogSla;
  else delete customFields.sla;

  for (const f of cfg.rules.formFields.fields ?? []) {
    if (!f.required) continue;
    const v = customFields[f.key];
    if ((v === undefined || v === null || v === '' || v === false) && f.type !== 'checkbox') {
      return bad(`${f.label} is required for ${longLabel}.`);
    }
  }

  const { status: initialStatus, source: statusSource } = await resolveTicketInitialStatus(tenantId, ticketType, priority);

  // Customer → entity/site → asset, all in this tenant and consistent.
  let fsm: null | {
    customer: Awaited<ReturnType<typeof getCustomer>>;
    siteId: string | null; assetId: string | null;
    channel: string; serviceNeededAt: string | null; entitlement: string | null;
  } = null;
  if (body.customerId) {
    try {
      const customer = await getCustomer(tx, tenantId, String(body.customerId));
      let siteId: string | null = null;
      if (body.customerSiteId) {
        const site = await getCustomerSite(tx, tenantId, String(body.customerSiteId));
        if (site.customerId !== customer.id) return bad('That entity / site belongs to another customer.');
        siteId = site.id;
        Object.assign(customFields, {
          siteName: site.name, siteAddress: site.address ?? undefined,
          contactPerson: site.contactPerson ?? undefined, contactMobile: site.contactMobile ?? undefined,
        });
      } else if (portal) {
        return bad('Select the entity / site where the service is needed.');
      }
      let assetId: string | null = null;
      if (body.assetId) {
        const asset = await getCustomerAsset(tx, tenantId, String(body.assetId));
        if (asset.customerId !== customer.id || (siteId && asset.customerSiteId && asset.customerSiteId !== siteId)) {
          return bad('That asset is not registered at this customer / site.');
        }
        assetId = asset.id;
        Object.assign(customFields, {
          assetNo: asset.assetNo, assetName: asset.name,
          serialNumber: asset.serialNumber ?? asset.tagId ?? undefined,
        });
      }
      let serviceNeededAt: string | null = null;
      if (body.serviceNeededAt) {
        const t = new Date(String(body.serviceNeededAt));
        if (Number.isNaN(t.getTime())) return bad('Service needed date & time is not valid.');
        serviceNeededAt = t.toISOString();
      }
      if (body.entitlementType && !isEntitlementType(body.entitlementType)) return bad('Unknown entitlement / billing type.');
      fsm = {
        customer, siteId, assetId, serviceNeededAt,
        channel: isRequestChannel(body.requestChannel) ? body.requestChannel : 'CUSTOMER_PORTAL',
        entitlement: body.entitlementType ? String(body.entitlementType) : null,
      };
      Object.assign(customFields, { customerName: customer.name, customerCode: customer.code });
    } catch (err) {
      if (err instanceof CustomerContextError) return bad(err.message, err.status);
      throw err;
    }
  }

  try {
    // FSM requests with a customer are numbered FSM-SR-<customer code>-YYXXXX
    // (one yearly series per tenant); other tickets keep the type prefix.
    const resolvedPrefix = (cfg.rules.ticketing.ticketPrefix?.trim()) || 'GEN';
    const readableId = fsm
      ? await nextServiceRequestNumber(tx, tenantId, fsm.customer.code)
      : await nextReadableId(tenantId, ticketType, resolvedPrefix);

    const initialHistory = [{
      status: initialStatus,
      date: new Date().toISOString(),
      actor: portal ? (requestorName ? `${requestorName} (customer)` : 'Customer') : (requestorName ?? actorId),
      note: initialStatus === 'Awaiting Approval' ? 'Submitted — awaiting approval' : 'Submitted',
    }];

    const inserted = await tx.$queryRawUnsafe<TicketRow[]>(
      `INSERT INTO service_tickets (
         tenant_id, ticket_type, readable_id, requestor_id, requestor_name,
         vehicle_id, related_driver_id, title, description, priority, status, due_date,
         history, custom_fields
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::date, $13::jsonb, $14::jsonb
       )
       RETURNING ${TICKET_BASE_COLS}`,
      tenantId, ticketType, readableId, actorId, requestorName,
      body.vehicleId ?? null, body.relatedDriverId ?? null,
      title, description || null, priority, initialStatus, body.dueDate ?? null,
      JSON.stringify(initialHistory), JSON.stringify(customFields),
    );

    let ticket = inserted[0];
    if (!ticket) throw new Error('Insert returned no row');

    if (fsm) {
      const [withFsm] = await tx.$queryRawUnsafe<TicketRow[]>(
        `UPDATE service_tickets
            SET customer_id = $3, customer_site_id = $4::uuid, asset_id = $5::uuid,
                request_channel = $6, service_needed_at = $7::timestamptz, entitlement_type = $8
          WHERE id = $1::uuid AND tenant_id = $2
          RETURNING ${TICKET_BASE_COLS}, ${FSM_REQUEST_COLS}`,
        ticket.id, tenantId, fsm.customer.id, fsm.siteId, fsm.assetId,
        fsm.channel, fsm.serviceNeededAt, fsm.entitlement,
      );
      if (withFsm) ticket = withFsm;
    }

    void logAudit({
      tenantId,
      userId: actorId ?? undefined,
      userRole: portal ? 'CUSTOMER_PORTAL' : 'USER',
      entityType: 'ServiceTicket',
      entityId: ticket.id,
      entityName: readableId,
      action: 'CREATE',
      details: `Created ${longLabel} ${readableId}: ${title} (${priority}) — initial status ${initialStatus} via ${statusSource}${portal ? ' from the Customer Portal' : ''}`,
    });

    const matrices = await resolveTicketSlaMatrixBatch(tenantId, [ticketType]);
    const [created] = await resolveHistoryActors(tx, [ticketRowToApi(ticket, matrices.get(ticketType))]);
    return NextResponse.json({ ok: true, ticket: created }, { status: 201 });
  } catch (err) {
    captureException(err, { context: 'service-tickets.create', tags: { tenantId, ticketType } });
    return NextResponse.json({ ok: false, error: 'Failed to create ticket' }, { status: 500 });
  }
}
