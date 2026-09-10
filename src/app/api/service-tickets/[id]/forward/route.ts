export const dynamic = 'force-dynamic';

/**
 * POST /api/service-tickets/[id]/forward
 *
 * Operations Team Triage & Forwarding Engine:
 * Forwards an inbound ticket from OPERATIONS_TRIAGE to the designated department:
 * - WORKSHOP_MAINTENANCE: Auto-provisions linked MaintenanceRequest work order
 * - RECOVERY_DISPATCH: Ready for 1-click towing / recovery vendor dispatch
 * - SAFETY_COMPLIANCE: Safety, risk, insurance & accident investigation
 * - CUSTOMER_SERVICE: Passenger & client communications
 * - FACILITIES_CLEANING: Depot turnaround & sanitization
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import {
  TICKET_DEPARTMENTS,
  type TicketDepartment,
  type TicketPriority,
} from '@/types/service-tickets';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

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

const SELECT_COLS = `id::text, tenant_id, ticket_type, readable_id, requestor_id, requestor_name,
  vehicle_id, related_driver_id, title, description, priority, status, due_date::text,
  assigned_to, maintenance_request_id, history, attachments, comments, custom_fields,
  created_at::text, updated_at::text`;

function rowToApi(r: Row) {
  const customFields = (r.custom_fields && typeof r.custom_fields === 'object')
    ? (r.custom_fields as Record<string, unknown>)
    : {};
  const assignedDepartment = (customFields.assignedDepartment as TicketDepartment) || 'OPERATIONS_TRIAGE';
  const source = (customFields.source as 'DRIVER_APP' | 'WHATSAPP' | 'DVIR' | 'WEB' | 'TELEMATICS') || 'WEB';

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
  };
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  const { tenantId, userId } = authz;
  const { id } = await params;

  return withTenantRls(prisma, tenantId, async (tx) => {
    let body: {
      department?: TicketDepartment;
      forwardNotes?: string;
      assignee?: string;
      priority?: TicketPriority;
    };

    try {
      const bodyRaw = await req.json();
      body = stripTenantOwnershipFields(bodyRaw);
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
    }

    const department = body.department;
    const deptDef = TICKET_DEPARTMENTS.find((d) => d.key === department);
    if (!department || !deptDef) {
      return NextResponse.json(
        {
          ok: false,
          error: `Invalid or missing department. Must be one of: ${TICKET_DEPARTMENTS.map((d) => d.key).join(', ')}`,
        },
        { status: 400 }
      );
    }

    // Load existing ticket
    const rows = await tx.$queryRawUnsafe<Row[]>(
      `SELECT ${SELECT_COLS}
       FROM service_tickets
       WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
      id,
      tenantId
    ).catch(() => []);

    const existing = rows[0];
    if (!existing) {
      return NextResponse.json({ ok: false, error: 'Ticket not found' }, { status: 404 });
    }

    let maintenanceRequestId = existing.maintenance_request_id;
    let createdMr: any = null;

    // WORKSHOP_MAINTENANCE: Auto-provision linked MaintenanceRequest if not already
    // created. Skipped while the ticket is still Awaiting Approval — a real work
    // order is a physical-world side effect that shouldn't fire before approval.
    if (department === 'WORKSHOP_MAINTENANCE' && !maintenanceRequestId && existing.status !== 'Awaiting Approval') {
      try {
        const workOrderNo = `WO-${existing.readable_id || existing.id.substring(0, 8).toUpperCase()}`;
        createdMr = await tx.maintenanceRequest.create({
          data: {
            tenantId,
            vehicleId: existing.vehicle_id || null,
            driverId: existing.related_driver_id || null,
            description: `[Forwarded from Service Ticket ${existing.readable_id || existing.id}] ${existing.title}${body.forwardNotes ? `\n\nNotes: ${body.forwardNotes}` : ''}`,
            status: 'Open',
            priority: (body.priority || existing.priority || 'Medium'),
            maintenanceType: 'Corrective',
            workOrderNo,
            requestDate: new Date(),
          },
        });
        maintenanceRequestId = createdMr.id;
      } catch (mrErr) {
        console.error('Failed to auto-create maintenance request upon forwarding:', mrErr);
        // We log but continue, so ticket forwarding doesn't fail catastrophically
      }
    }

    // Compose History Entry
    const noteSegments: string[] = [`Forwarded to ${deptDef.label}`];
    if (body.assignee) noteSegments.push(`Assignee: ${body.assignee}`);
    if (body.forwardNotes) noteSegments.push(`Note: ${body.forwardNotes}`);
    if (createdMr) noteSegments.push(`Created Work Order #${createdMr.workOrderNo || createdMr.id}`);

    const newHistoryEntry = {
      status: 'Assigned',
      date: new Date().toISOString(),
      actor: userId || 'Operations Dispatcher',
      note: noteSegments.join(' — '),
    };

    const updatedHistory = [
      ...(Array.isArray(existing.history) ? existing.history : []),
      newHistoryEntry,
    ];

    // Update custom_fields
    const existingCustom = (existing.custom_fields && typeof existing.custom_fields === 'object')
      ? (existing.custom_fields as Record<string, unknown>)
      : {};

    const updatedCustom = {
      ...existingCustom,
      assignedDepartment: department,
      forwardedAt: new Date().toISOString(),
      forwardedBy: userId || 'Operations Dispatcher',
      forwardNotes: body.forwardNotes || existingCustom.forwardNotes,
    };

    // Transition status to 'Assigned' if in an early state. A ticket
    // 'Awaiting Approval' must stay gated — forwarding it to a department
    // records where it should go next, but must not be a side-channel
    // around the segregation-of-duties approval check in PATCH /[id].
    const nextStatus = existing.status === 'Awaiting Approval'
      ? existing.status
      : ['Pending', 'Acknowledged'].includes(existing.status)
        ? 'Assigned'
        : existing.status;

    const nextAssignee = body.assignee?.trim() || existing.assigned_to;
    const nextPriority = body.priority || existing.priority;

    try {
      const updatedRows = await tx.$queryRawUnsafe<Row[]>(
        `UPDATE service_tickets
         SET custom_fields = $1::jsonb,
             status = $2,
             assigned_to = $3,
             priority = $4,
             maintenance_request_id = $5,
             history = $6::jsonb,
             updated_at = NOW()
         WHERE id = $7::uuid AND tenant_id = $8 AND deleted_at IS NULL
         RETURNING ${SELECT_COLS}`,
        JSON.stringify(updatedCustom),
        nextStatus,
        nextAssignee,
        nextPriority,
        maintenanceRequestId,
        JSON.stringify(updatedHistory),
        id,
        tenantId
      );

      const updated = updatedRows[0];
      if (!updated) {
        return NextResponse.json({ ok: false, error: 'Update failed' }, { status: 500 });
      }

      void logAudit({
        tenantId,
        userId,
        entityType: 'ServiceTicket',
        entityId: updated.id,
        entityName: updated.readable_id ?? updated.id,
        action: 'FORWARD',
        details: `Forwarded ${updated.readable_id || updated.id} to ${deptDef.label}${nextAssignee ? ` (${nextAssignee})` : ''}`,
      });

      return NextResponse.json({
        ok: true,
        ticket: rowToApi(updated),
        maintenanceRequest: createdMr || undefined,
      });
    } catch (err) {
      captureException(err, { context: 'service-tickets.forward', tags: { tenantId, id } });
      return NextResponse.json({ ok: false, error: 'Failed to forward ticket' }, { status: 500 });
    }
  });
}
