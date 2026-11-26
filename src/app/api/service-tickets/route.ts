export const dynamic = 'force-dynamic';

/**
 * GET  /api/service-tickets                — list tickets for the current tenant
 *   Query params: type, status, department, search, from, to, limit, offset,
 *                 mine=1 (only tickets the caller raised)
 * POST /api/service-tickets                — create a new ticket
 *   Body: { ticketType, title, description, priority?, vehicleId?, relatedDriverId?, dueDate? }
 *   ticketType may be any catalogue service type linked to SERVICE_TICKETING
 *   (the seven system types or a tenant-defined one); priority is
 *   Low | Medium | High | Critical.
 *
 * Auth: x-tenant-id from middleware (any authenticated user). Tickets
 * are tenant-scoped; cross-tenant reads are not exposed by this route.
 *
 * Tenant-type access enforced on POST: unknown types return 400; types the
 * tenant disabled in tenant_ticket_types return 403.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { resolveHistoryActors } from '@/lib/service-tickets/history-actors';
import { TICKET_TYPE_KEY_RE, type TicketType } from '@/types/service-tickets';
import { resolveTicketSlaMatrixBatch } from '@/lib/service-config/resolvers';
import { createServiceTicket, type CreateTicketBody } from '@/lib/service-tickets/create-ticket';
import { FSM_REQUEST_COLS, ticketRowToApi, type TicketRow } from '@/lib/service-tickets/ticket-row';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

type Row = TicketRow;
const rowToApi = ticketRowToApi;

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId, userId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const sp = req.nextUrl.searchParams;
      const mine       = sp.get('mine') === '1';
      const type       = sp.get('type');         // TicketType or null = all
      const status     = sp.get('status');
      const department = sp.get('department');   // TicketDepartment or null = all
      const search     = sp.get('search')?.trim() ?? '';
      const from       = sp.get('from');
      const to         = sp.get('to');
      const limit      = Math.min(parseInt(sp.get('limit') ?? '500', 10), 1000);
      const offset     = Math.max(parseInt(sp.get('offset') ?? '0', 10), 0);

      const conditions = ['tenant_id = $1', 'deleted_at IS NULL'];
      const params: unknown[] = [tenantId];
      let p = 2;

      if (type   && TICKET_TYPE_KEY_RE.test(type)) { conditions.push(`ticket_type = $${p++}`); params.push(type); }
      if (mine) {
        if (!userId) return NextResponse.json({ ok: true, tickets: [] });
        conditions.push(`requestor_id = $${p++}`); params.push(userId);
      }
      if (status)                                                     { conditions.push(`status = $${p++}`);     params.push(status); }
      if (department) {
        if (department === 'OPERATIONS_TRIAGE') {
          conditions.push(`(custom_fields->>'assignedDepartment' = $${p} OR custom_fields->>'assignedDepartment' IS NULL)`);
          params.push(department);
          p++;
        } else {
          conditions.push(`custom_fields->>'assignedDepartment' = $${p++}`);
          params.push(department);
        }
      }
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
               created_at::text, updated_at::text, ${FSM_REQUEST_COLS}
        FROM service_tickets
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      const rows = await tx.$queryRawUnsafe<Row[]>(sql, ...params).catch(() => []);

      // Phase 2C.x — enrich each ticket with its resolved SLA target hours.
      // Batched per distinct ticket type so the cost is O(distinct_types).
      const distinctTypes = Array.from(new Set(rows.map(r => r.ticket_type as TicketType)));
      const matrices = await resolveTicketSlaMatrixBatch(tenantId, distinctTypes);

      return NextResponse.json({
        ok: true,
        // Lifecycle: resolve who made each change (history actor ids → names).
        tickets: await resolveHistoryActors(tx, rows.map(r => rowToApi(r, matrices.get(r.ticket_type as TicketType)))),
      });
  });
}


export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId, userId } = authz;

  let body: CreateTicketBody;
  try { body = stripTenantOwnershipFields(await req.json()) as CreateTicketBody; }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  // Validation, numbering and insert are shared with the Customer Portal.
  return withTenantRls(prisma, tenantId, (tx) => createServiceTicket(tx, { tenantId, actorId: userId ?? null, body }));
}
