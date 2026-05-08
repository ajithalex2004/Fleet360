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
import { TICKET_TYPE_CONFIG } from '@/lib/service-tickets/config';
import { TICKET_TYPES_ORDER, type TicketType, type TicketPriority } from '@/types/service-tickets';
import { getTenantEnabledTypes } from '@/lib/service-tickets/access';
import {
  resolveTicketInitialStatus, resolveTicketPrefix,
  resolveTicketSlaMatrixBatch, pickSlaHours,
  resolveTicketFormFields,
  type SlaMatrix,
} from '@/lib/service-config/resolvers';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

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
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });

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
  const tenantId = req.headers.get('x-tenant-id');
  const userId   = req.headers.get('x-user-id');
  if (!tenantId || !userId) return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });

  let body: {
    ticketType?: string; title?: string; description?: string;
    priority?: string; vehicleId?: string; relatedDriverId?: string;
    dueDate?: string; requestorName?: string;
    customFields?: Record<string, unknown>;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const ticketType = body.ticketType as TicketType | undefined;
  const title       = String(body.title ?? '').trim();
  const description = String(body.description ?? '').trim();

  if (!ticketType || !TICKET_TYPES_ORDER.includes(ticketType)) {
    return NextResponse.json({ ok: false, error: 'Invalid or missing ticketType.' }, { status: 400 });
  }
  if (!title) return NextResponse.json({ ok: false, error: 'Title is required.' }, { status: 400 });

  // Enforce per-tenant access matrix.
  const enabled = await getTenantEnabledTypes(tenantId);
  if (!enabled.includes(ticketType)) {
    return NextResponse.json({
      ok: false,
      error: `${TICKET_TYPE_CONFIG[ticketType].longLabel} is not enabled for your tenant. Ask your administrator to enable it.`,
    }, { status: 403 });
  }

  const cfg = TICKET_TYPE_CONFIG[ticketType];
  const priority = (['Low', 'Medium', 'High'].includes(body.priority ?? '') ? body.priority : cfg.defaultPriority) as 'Low' | 'Medium' | 'High';

  // Vehicle requirement check.
  if (cfg.vehicleRequired && !body.vehicleId) {
    return NextResponse.json({ ok: false, error: `${cfg.longLabel} requires a vehicle.` }, { status: 400 });
  }

  // Validate per-type required fields. Phase 2B.formFields — schema now
  // resolved through service_rules with TICKET_TYPE_CONFIG.formFields as
  // the legacy fallback. Authority decided by resolveTicketFormFields.
  const customFields = (body.customFields && typeof body.customFields === 'object')
    ? body.customFields
    : {};
  const { fields: resolvedFormFields } = await resolveTicketFormFields(tenantId, ticketType);
  for (const f of resolvedFormFields) {
    if (!f.required) continue;
    const v = customFields[f.key];
    const empty = v === undefined || v === null || v === '' || v === false;
    if (empty && f.type !== 'checkbox') {
      return NextResponse.json({ ok: false, error: `${f.label} is required for ${cfg.longLabel}.` }, { status: 400 });
    }
  }

  // Phase 2C — initial status now resolved through the Service Configuration
  // Engine. The resolver consults service_rules.approval first, then falls
  // back to TICKET_TYPE_CONFIG.requiresApproval when no central row exists.
  const { status: initialStatus, source: statusSource } =
    await resolveTicketInitialStatus(tenantId, ticketType, priority as TicketPriority);

  try {
    await ensureServiceTicketsTable();
    // Phase 2C.x — prefix now resolved through the Service Configuration
    // Engine so admins can override the 3-letter code without a code change.
    const resolvedPrefix = await resolveTicketPrefix(tenantId, ticketType);
    const readableId = await nextReadableId(tenantId, ticketType, resolvedPrefix);
    const nowIso = new Date().toISOString();

    const initialHistory = [{
      status: initialStatus,
      date: nowIso,
      actor: body.requestorName ?? userId,
      note: initialStatus === 'Awaiting Approval' ? 'Submitted — awaiting approval' : 'Submitted',
    }];

    const inserted = await prisma.$queryRawUnsafe<Row[]>(
      `INSERT INTO service_tickets (
         tenant_id, ticket_type, readable_id, requestor_id, requestor_name,
         vehicle_id, related_driver_id, title, description, priority, status, due_date,
         history, custom_fields
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::date, $13::jsonb, $14::jsonb
       )
       RETURNING id::text, tenant_id, ticket_type, readable_id, requestor_id, requestor_name,
                 vehicle_id, related_driver_id, title, description, priority, status,
                 due_date::text, assigned_to, maintenance_request_id, history, attachments, comments, custom_fields,
                 created_at::text, updated_at::text`,
      tenantId, ticketType, readableId, userId, body.requestorName ?? null,
      body.vehicleId ?? null, body.relatedDriverId ?? null,
      title, description || null, priority, initialStatus, body.dueDate ?? null,
      JSON.stringify(initialHistory), JSON.stringify(customFields),
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
      details: `Created ${cfg.longLabel} ${readableId}: ${title} (${priority}) — initial status ${initialStatus} via ${statusSource}`,
    });

    // Enrich response with the resolved SLA target — single-type lookup.
    const matrices = await resolveTicketSlaMatrixBatch(tenantId, [ticketType]);
    return NextResponse.json({ ok: true, ticket: rowToApi(ticket, matrices.get(ticketType)) }, { status: 201 });
  } catch (err) {
    captureException(err, { context: 'service-tickets.create', tags: { tenantId, ticketType } });
    return NextResponse.json({ ok: false, error: 'Failed to create ticket' }, { status: 500 });
  }
}
