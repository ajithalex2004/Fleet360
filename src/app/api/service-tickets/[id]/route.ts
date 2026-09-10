export const dynamic = 'force-dynamic';

/**
 * GET    /api/service-tickets/[id]    — fetch a single ticket
 * PATCH  /api/service-tickets/[id]    — update fields (status, assignedTo,
 *                                       priority, description, due_date, history,
 *                                       attachments, comments). History is
 *                                       always appended, never overwritten.
 * DELETE /api/service-tickets/[id]    — soft-delete (sets deleted_at).
 *
 * All responses are tenant-scoped — a request from tenant A can't read
 * or mutate tenant B's ticket even with a guessed UUID.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import type { TicketType, TicketPriority } from '@/types/service-tickets';
import { loadServiceConfig } from '@/lib/service-config/load';
import {
  resolveTicketSlaMatrixBatch, pickSlaHours, type SlaMatrix,
} from '@/lib/service-config/resolvers';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string }>; }

interface Row {
  id: string; tenant_id: string; ticket_type: string; readable_id: string | null;
  requestor_id: string; requestor_name: string | null;
  vehicle_id: string | null; related_driver_id: string | null;
  title: string; description: string | null;
  priority: string; status: string; due_date: string | null;
  assigned_to: string | null; maintenance_request_id: string | null;
  history: unknown; attachments: unknown; comments: unknown; custom_fields: unknown;
  created_at: string; updated_at: string;
}

function rowToApi(r: Row, matrix?: SlaMatrix) {
  const priority = r.priority as TicketPriority;
  const customFields = (r.custom_fields && typeof r.custom_fields === 'object') ? r.custom_fields as Record<string, unknown> : {};
  const assignedDepartment = (customFields.assignedDepartment as any) || 'OPERATIONS_TRIAGE';
  const source = (customFields.source as any) || 'WEB';
  return {
    id: r.id, tenantId: r.tenant_id, ticketType: r.ticket_type, readableId: r.readable_id,
    requestorId: r.requestor_id, requestorName: r.requestor_name,
    vehicleId: r.vehicle_id, relatedDriverId: r.related_driver_id,
    title: r.title, description: r.description, priority: r.priority, status: r.status,
    dueDate: r.due_date, assignedTo: r.assigned_to,
    maintenanceRequestId: r.maintenance_request_id,
    assignedDepartment,
    source,
    history:     Array.isArray(r.history)     ? r.history     : [],
    attachments: Array.isArray(r.attachments) ? r.attachments : [],
    comments:    Array.isArray(r.comments)    ? r.comments    : [],
    customFields,
    createdAt: r.created_at, updatedAt: r.updated_at,
    slaTargetHours: matrix ? pickSlaHours(matrix, priority) : undefined,
  };
}

/** Resolve the SLA matrix for one ticket's type — used by GET / PATCH. */
async function matrixFor(tenantId: string, ticketType: string): Promise<SlaMatrix | undefined> {
  const m = await resolveTicketSlaMatrixBatch(tenantId, [ticketType as TicketType]);
  return m.get(ticketType as TicketType);
}

const SELECT_COLS = `id::text, tenant_id, ticket_type, readable_id, requestor_id, requestor_name,
  vehicle_id, related_driver_id, title, description, priority, status, due_date::text,
  assigned_to, maintenance_request_id, history, attachments, comments, custom_fields,
  created_at::text, updated_at::text`;

async function loadTicket(tenantId: string, id: string): Promise<Row | null> {
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT ${SELECT_COLS}
     FROM service_tickets
     WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
    id, tenantId,
  ).catch(() => []);
  return rows[0] ?? null;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;
  const { id } = await params;

  const row = await loadTicket(tenantId, id);
  if (!row) return NextResponse.json({ ok: false, error: 'Ticket not found' }, { status: 404 });
  const matrix = await matrixFor(tenantId, row.ticket_type);
  return NextResponse.json({ ok: true, ticket: rowToApi(row, matrix) });
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId, userId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const { id } = await params;

      let body: Record<string, unknown>;
      try { const bodyRaw = await req.json(); body = stripTenantOwnershipFields(bodyRaw); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

      const existing = await loadTicket(tenantId, id);
      if (!existing) return NextResponse.json({ ok: false, error: 'Ticket not found' }, { status: 404 });

      // P0 Governance: Segregation of Duties & Approval Authorization
      if (body.status === 'Approved' || body.status === 'Rejected') {
        // 1. Requesters cannot approve/reject their own tickets
        if (userId && existing.requestor_id && userId === existing.requestor_id) {
          return NextResponse.json(
            { ok: false, error: 'Requesters cannot approve or reject their own service tickets (segregation of duties).' },
            { status: 403 }
          );
        }

        // 2. Caller must have an approval role.
        // x-user-role is set unconditionally by middleware from the trusted session
        // (src/middleware.ts) and cannot be forged by the client. Do not also trust
        // an x-user-permissions header here — middleware never sets one, so it would
        // pass through client input verbatim and let any caller grant themselves
        // approver status.
        const userRole = req.headers.get('x-user-role') || '';
        const isApprover = ['TENANT_ADMIN', 'FLEET_MANAGER', 'OPERATIONS_MANAGER', 'SUPER_ADMIN'].includes(userRole);

        if (!isApprover) {
          return NextResponse.json(
            { ok: false, error: 'You do not have authorization to approve or reject service tickets.' },
            { status: 403 }
          );
        }

        // 3. State transition validity check
        const validSourceStatuses = ['Pending', 'Awaiting Approval', 'Escalated', 'Open'];
        if (!validSourceStatuses.includes(existing.status)) {
          return NextResponse.json(
            { ok: false, error: `Invalid state transition: ticket in '${existing.status}' cannot be transitioned to '${body.status}'.` },
            { status: 400 }
          );
        }
      }

      // P0 Safety: If ticket is resolved/completed and vehicle was linked, check if vehicle can be ungrounded
      if ((body.status === 'Resolved' || body.status === 'Completed') && existing.vehicle_id) {
        try {
          const otherCritical = await tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id FROM service_tickets
             WHERE tenant_id = $1
               AND vehicle_id = $2
               AND id != $3::uuid
               AND priority = 'CRITICAL'
               AND status NOT IN ('Resolved', 'Completed', 'Closed', 'Rejected')
               AND deleted_at IS NULL
             LIMIT 1`,
            tenantId,
            existing.vehicle_id,
            id
          );

          if (!otherCritical || otherCritical.length === 0) {
            await tx.vehicle.updateMany({
              where: { id: existing.vehicle_id, status: 'GROUNDED' },
              data: { status: 'AVAILABLE', isActive: true },
            });
          }
        } catch (unGroundErr) {
          console.warn('[service-tickets] Failed to check/unground vehicle:', unGroundErr);
        }
      }

      // Build dynamic UPDATE
      const sets: string[] = [];
      const params2: unknown[] = [];
      let p = 1;

      const setIf = (col: string, value: unknown, cast = '') => {
        if (value === undefined) return;
        sets.push(`${col} = $${p}${cast}`);
        params2.push(value);
        p++;
      };

      setIf('status',                 body.status);
      setIf('priority',               body.priority);
      setIf('title',                  body.title);
      setIf('description',            body.description);
      setIf('due_date',               body.dueDate, '::date');
      setIf('assigned_to',            body.assignedTo);
      setIf('vehicle_id',             body.vehicleId);
      setIf('related_driver_id',      body.relatedDriverId);
      setIf('maintenance_request_id', body.maintenanceRequestId);
      if (body.history      !== undefined) { sets.push(`history = $${p}::jsonb`);       params2.push(JSON.stringify(body.history));      p++; }
      if (body.attachments  !== undefined) { sets.push(`attachments = $${p}::jsonb`);   params2.push(JSON.stringify(body.attachments));  p++; }
      if (body.comments     !== undefined) { sets.push(`comments = $${p}::jsonb`);      params2.push(JSON.stringify(body.comments));     p++; }
      if (body.customFields !== undefined) { sets.push(`custom_fields = $${p}::jsonb`); params2.push(JSON.stringify(body.customFields)); p++; }

      if (sets.length === 0) {
        return NextResponse.json({ ok: false, error: 'No updatable fields in body' }, { status: 400 });
      }
      sets.push(`updated_at = NOW()`);

      params2.push(id, tenantId);

      try {
        const updated = await tx.$queryRawUnsafe<Row[]>(
          `UPDATE service_tickets
             SET ${sets.join(', ')}
           WHERE id = $${p}::uuid AND tenant_id = $${p + 1} AND deleted_at IS NULL
           RETURNING ${SELECT_COLS}`,
          ...params2,
        );
        const ticket = updated[0];
        if (!ticket) return NextResponse.json({ ok: false, error: 'Update affected no rows' }, { status: 404 });

        // Resolve the ticket's type label from the central catalogue for the
        // audit log. Cheap: hits the in-process tenant cache after first call.
        const cfg = await loadServiceConfig(tenantId, ticket.ticket_type as TicketType);
        void logAudit({
          tenantId,
          userId,
          entityType: 'ServiceTicket',
          entityId: ticket.id,
          entityName: ticket.readable_id ?? ticket.id,
          action: 'UPDATE',
          details: `${cfg?.type.name ?? 'Ticket'} ${ticket.readable_id ?? ticket.id}: ${
            Object.keys(body).filter(k => k !== 'history' && k !== 'attachments' && k !== 'comments').join(', ') || 'updated'
          } → ${ticket.status}`,
        });

        const matrix = await matrixFor(tenantId, ticket.ticket_type);
        return NextResponse.json({ ok: true, ticket: rowToApi(ticket, matrix) });
        } catch (err) {
        captureException(err, { context: 'service-tickets.update', tags: { tenantId, id } });
        return NextResponse.json({ ok: false, error: 'Update failed' }, { status: 500 });
      }
  });
}


export async function DELETE(req: NextRequest, { params }: RouteParams) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId, userId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const { id } = await params;

      const result = await tx.$executeRawUnsafe(
        `UPDATE service_tickets SET deleted_at = NOW() WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
        id, tenantId,
      );

      void logAudit({
        tenantId, userId, entityType: 'ServiceTicket', entityId: id,
        action: 'DELETE', details: 'Soft-deleted ticket',
      });

      return NextResponse.json({ ok: true, changed: result });
  });
}

