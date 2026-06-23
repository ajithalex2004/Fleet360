/**
 * GET  /api/service-tickets                — list tickets for the current tenant
 *   Query params: type, status, search, from, to, limit, offset
 * POST /api/service-tickets                — create a new ticket
 *   Body: { ticketType, title, description, priority?, vehicleId?, relatedDriverId?, dueDate? }
 *
 * Auth: x-tenant-id from middleware (any authenticated user). Tickets
 * are tenant-scoped; cross-tenant reads are not exposed by this route.
 *
 * Tenant-type access enforced on POST: if the tenant has the requested
 * ticket type disabled in their tenant_ticket_types matrix, returns 403.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureServiceTicketsTable, nextReadableId } from '@/lib/service-tickets/schema';
import { TICKET_TYPES_ORDER, type TicketType, type TicketPriority } from '@/types/service-tickets';
import { getTenantEnabledTypes } from '@/lib/service-tickets/access';
import { loadServiceConfig } from '@/lib/service-config/load';
import {
  resolveTicketInitialStatus,
  resolveTicketSlaMatrixBatch, pickSlaHours,
  type SlaMatrix,
} from '@/lib/service-config/resolvers';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { applyBindings } from '@/lib/service-tickets/field-resolver';
import { recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';

export const runtime = 'nodejs';

// Row shape from raw SQL — snake_case columns, camelCase out.
interface Row {
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
}

function rowToApi(r: Row, matrix?: SlaMatrix) {
  const priority = r.priority as TicketPriority;
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
    history: Array.isArray(r.history) ? r.history : [],
    attachments: Array.isArray(r.attachments) ? r.attachments : [],
    comments: Array.isArray(r.comments) ? r.comments : [],
    customFields: (r.custom_fields && typeof r.custom_fields === 'object') ? r.custom_fields as Record<string, unknown> : {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    slaTargetHours: matrix ? pickSlaHours(matrix, priority) : undefined,
  };
}

export async function GET(req: NextRequest) {
  const ctx = requireOperationalContext(req, 'service_tickets');
  if (ctx instanceof NextResponse) return ctx;
  const tenantId = ctx.tenantId;

  const sp = req.nextUrl.searchParams;
  const type   = sp.get('type');         // TicketType or null = all
  const status = sp.get('status');
  const search = sp.get('search')?.trim() ?? '';
  const from   = sp.get('from');
  const to     = sp.get('to');
  const limit  = Math.min(parseInt(sp.get('limit') ?? '500', 10), 1000);
  const offset = Math.max(parseInt(sp.get('offset') ?? '0', 10), 0);

  await ensureServiceTicketsTable();

  const conditions = ['tenant_id = $1', 'deleted_at IS NULL'];
  const params: unknown[] = [tenantId];
  let p = 2;

  if (type   && TICKET_TYPES_ORDER.includes(type as TicketType)) { conditions.push(`ticket_type = $${p++}`); params.push(type); }
  if (status)                                                     { conditions.push(`status = $${p++}`);     params.push(status); }
  if (search) {
    conditions.push(`(LOWER(title) LIKE $${p} OR LOWER(description) LIKE $${p} OR LOWER(readable_id) LIKE $${p})`);
    params.push(`%${search.toLowerCase()}%`); p++;
  }
  if (from) { conditions.push(`created_at >= $${p++}::timestamptz`); params.push(from); }
  if (to)   { conditions.push(`created_at <= $${p++}::timestamptz`); params.push(to); }

  const sql = `
    SELECT id::text, tenant_id, ticket_type, readable_id, requestor_id, requestor_name,
           vehicle_id, related_driver_id, title, description, priority, status,
           due_date::text, assigned_to, maintenance_request_id, history, attachments, comments, custom_fields,
           created_at::text, updated_at::text
    FROM service_tickets
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  const rows = await prisma.$queryRawUnsafe<Row[]>(sql, ...params).catch(() => []);

  // Phase 2C.x — enrich each ticket with its resolved SLA target hours.
  // Batched per distinct ticket type so the cost is O(distinct_types).
  const distinctTypes = Array.from(new Set(rows.map(r => r.ticket_type as TicketType)));
  const matrices = await resolveTicketSlaMatrixBatch(tenantId, distinctTypes);

  return NextResponse.json({
    ok: true,
    tickets: rows.map(r => rowToApi(r, matrices.get(r.ticket_type as TicketType))),
  });
}

export async function POST(req: NextRequest) {
  const ctx = requireOperationalContext(req, 'service_tickets', { write: true });
  if (ctx instanceof NextResponse) return ctx;
  const tenantId = ctx.tenantId;
  const userId = ctx.userId;

  let body: {
    ticketType?: string; title?: string; description?: string;
    priority?: string; vehicleId?: string; relatedDriverId?: string;
    dueDate?: string; requestorName?: string;
    customFields?: Record<string, unknown>;
    /** Phase B+ — id of the selected MaintenanceType row for fields whose
     *  source reads from `maintenanceType.*`. Optional; only meaningful for
     *  MAINTENANCE tickets that use the Maintenance Type Master. */
    maintenanceTypeId?: string;
    /** Phase B — multi-attachment uploads. Each item carries the
     *  AttachmentType code (from the Attachment Master) plus the file
     *  metadata. Stored as-is in service_tickets.attachments JSONB. */
    attachments?: Array<{ id?: string; type: string; fileName: string; url: string; uploadedAt?: string }>;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const ticketType = body.ticketType as TicketType | undefined;
  const title       = String(body.title ?? '').trim();
  const description = String(body.description ?? '').trim();

  if (!ticketType || !TICKET_TYPES_ORDER.includes(ticketType)) {
    return NextResponse.json({ ok: false, error: 'Invalid or missing ticketType.' }, { status: 400 });
  }
  if (!title) return NextResponse.json({ ok: false, error: 'Title is required.' }, { status: 400 });

  // Load the central service config once. This auto-seeds the tenant on
  // first call and gives us everything we need (longLabel, defaults,
  // vehicleRequired, formFields, prefix) without round-tripping the
  // resolvers. The initial-status resolver still runs separately so its
  // emergency-bypass logic stays in one place.
  const cfg = await loadServiceConfig(tenantId, ticketType);
  if (!cfg) {
    return NextResponse.json({ ok: false, error: `Unknown service type ${ticketType}.` }, { status: 400 });
  }
  const longLabel = cfg.type.name;

  // Enforce per-tenant access matrix.
  const enabled = await getTenantEnabledTypes(tenantId);
  if (!enabled.includes(ticketType)) {
    return NextResponse.json({
      ok: false,
      error: `${longLabel} is not enabled for your tenant. Ask your administrator to enable it.`,
    }, { status: 403 });
  }

  // Default priority lives on the service_types row.
  const priority = (['Low', 'Medium', 'High'].includes(body.priority ?? '')
    ? body.priority : cfg.type.defaultPriority) as 'Low' | 'Medium' | 'High';

  // Vehicle requirement check.
  if (cfg.rules.vehicle.vehicleRequired && !body.vehicleId) {
    return NextResponse.json({ ok: false, error: `${longLabel} requires a vehicle.` }, { status: 400 });
  }

  // ── Phase B+ — apply field bindings before validation ─────────────────
  // Sources (currentUser.*, vehicle.*, maintenanceType.*, …) overwrite
  // whatever the client sent; bindTo redirects values from the JSONB blob
  // into the named top-level columns. Required-field validation runs
  // against the post-binding values so server-supplied data satisfies
  // requireds without the client having to send it.
  const incomingCustomFields = (body.customFields && typeof body.customFields === 'object')
    ? body.customFields as Record<string, unknown>
    : {};
  const resolvedFormFields = cfg.rules.formFields.fields ?? [];
  const binding = await applyBindings(resolvedFormFields, incomingCustomFields, {
    tenantId,
    userId,
    selectedVehicleId:         body.vehicleId ?? null,
    selectedMaintenanceTypeId: body.maintenanceTypeId ?? null,
  });
  if (binding.warnings.length) {
    console.warn('[service-tickets POST] field-binding warnings:', binding.warnings);
  }
  const customFields = binding.customFields;

  // Pull bound values out into typed locals — these win over body fields
  // when present. The form's "Requested by" with bindTo='requestorName'
  // routes here, for example.
  const boundRequestorName  = binding.columnOverrides.requestorName  as string | undefined;
  const boundRequestorId    = binding.columnOverrides.requestorId    as string | undefined;
  const boundAssignedTo     = binding.columnOverrides.assignedTo     as string | undefined;
  const boundPriority       = binding.columnOverrides.priority       as string | undefined;
  const boundDueDate        = binding.columnOverrides.dueDate        as string | undefined;
  const boundVehicleId      = binding.columnOverrides.vehicleId      as string | undefined;
  const boundRelatedDriverId = binding.columnOverrides.relatedDriverId as string | undefined;

  // Validate required form fields against the post-binding values.
  for (const f of resolvedFormFields) {
    if (!f.required) continue;
    // Skip fields whose value is now living in a top-level column rather
    // than customFields — those are checked via column existence below.
    const target = f.bindTo ?? 'customFields';
    const v = target === 'customFields'
      ? customFields[f.key]
      : binding.columnOverrides[target as Exclude<typeof target, 'customFields'>];
    const empty = v === undefined || v === null || v === '' || v === false;
    if (empty && f.type !== 'checkbox') {
      return NextResponse.json({ ok: false, error: `${f.label} is required for ${longLabel}.` }, { status: 400 });
    }
  }

  // Initial status — approval gate lives in resolveTicketInitialStatus.
  const { status: initialStatus, source: statusSource } =
    await resolveTicketInitialStatus(tenantId, ticketType, priority as TicketPriority);

  try {
    await ensureServiceTicketsTable();
    // Prefix lives on the resolved ticketing rules.
    const resolvedPrefix = (cfg.rules.ticketing.ticketPrefix?.trim()) || 'GEN';
    const readableId = await nextReadableId(tenantId, ticketType, resolvedPrefix);
    const nowIso = new Date().toISOString();

    // Apply column overrides from the bindings layer. Each `boundX` wins
    // over the corresponding body field; the body field wins over the
    // hard-coded default. Validates the boundPriority is one of the
    // allowed values (the resolver could return any string for a
    // misconfigured maintenanceType.defaultPriority source).
    const finalRequestorId    = boundRequestorId    ?? userId;
    const finalRequestorName  = boundRequestorName  ?? body.requestorName       ?? null;
    const finalVehicleId      = boundVehicleId      ?? body.vehicleId           ?? null;
    const finalRelatedDriver  = boundRelatedDriverId ?? body.relatedDriverId    ?? null;
    const finalDueDate        = boundDueDate        ?? body.dueDate             ?? null;
    const finalAssignedTo     = boundAssignedTo                                  ?? null;
    const finalPriority       = (['Low', 'Medium', 'High'].includes(boundPriority ?? '')
                                 ? boundPriority : priority) as 'Low' | 'Medium' | 'High';

    // Phase B — multi-attachment payload. Each item is { id?, type, fileName, url, uploadedAt? }
    // matching TicketAttachment. Dedup IDs and stamp uploadedAt server-side
    // so clients can't fake creation times.
    const attachments = Array.isArray(body.attachments)
      ? body.attachments.map((a, i) => ({
          id:         a.id ?? `att-${nowIso}-${i}`,
          type:       String(a.type ?? 'OTHER'),
          fileName:   String(a.fileName ?? 'file'),
          url:        String(a.url ?? ''),
          uploadedAt: nowIso,
        }))
      : [];

    const initialHistory = [{
      status: initialStatus,
      date: nowIso,
      actor: finalRequestorName ?? finalRequestorId,
      note: initialStatus === 'Awaiting Approval' ? 'Submitted — awaiting approval' : 'Submitted',
    }];

    const inserted = await prisma.$queryRawUnsafe<Row[]>(
      `INSERT INTO service_tickets (
         tenant_id, ticket_type, readable_id, requestor_id, requestor_name,
         vehicle_id, related_driver_id, title, description, priority, status, due_date,
         history, custom_fields, attachments, assigned_to
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::date,
         $13::jsonb, $14::jsonb, $15::jsonb, $16
       )
       RETURNING id::text, tenant_id, ticket_type, readable_id, requestor_id, requestor_name,
                 vehicle_id, related_driver_id, title, description, priority, status,
                 due_date::text, assigned_to, maintenance_request_id, history, attachments, comments, custom_fields,
                 created_at::text, updated_at::text`,
      tenantId, ticketType, readableId, finalRequestorId, finalRequestorName,
      finalVehicleId, finalRelatedDriver,
      title, description || null, finalPriority, initialStatus, finalDueDate,
      JSON.stringify(initialHistory), JSON.stringify(customFields),
      JSON.stringify(attachments), finalAssignedTo,
    );

    const ticket = inserted[0];
    if (!ticket) throw new Error('Insert returned no row');

    void logAudit({
      tenantId,
      userId,
      userRole: 'USER',
      entityType: 'ServiceTicket',
      entityId: ticket.id,
      entityName: readableId,
      action: 'CREATE',
      details: `Created ${longLabel} ${readableId}: ${title} (${priority}) — initial status ${initialStatus} via ${statusSource}`,
    });
    void recordOperationalChange({
      req,
      ctx,
      entityType: 'ServiceTicket',
      entityId: ticket.id,
      action: 'CREATE',
      after: rowToApi(ticket),
      summary: `Created ${longLabel} ${readableId}: ${title}.`,
    });

    // Enrich response with the resolved SLA target — single-type lookup.
    const matrices = await resolveTicketSlaMatrixBatch(tenantId, [ticketType]);
    return NextResponse.json({ ok: true, ticket: rowToApi(ticket, matrices.get(ticketType)) }, { status: 201 });
  } catch (err) {
    captureException(err, { context: 'service-tickets.create', tags: { tenantId, ticketType } });
    return NextResponse.json({ ok: false, error: 'Failed to create ticket' }, { status: 500 });
  }
}
