export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { PartnerServiceDomain } from '@prisma/client';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { OutsourceEngine } from '@/lib/exchange/outsource-engine';
import { MarketplaceService } from '@/lib/exchange/marketplace-service';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
/**
 * Full incident lifecycle: REPORTED → UNDER_INVESTIGATION → ESCALATED → RESOLVED → CLOSED
 *
 * PATCH /api/incidents/:id  — advance status, add notes, escalate, or outsource recovery to Exchange
 * GET   /api/incidents/:id  — full incident detail with notes
 */

const VALID_STATUS = ['REPORTED', 'OPEN', 'UNDER_INVESTIGATION', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED'];

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const { action } = body;

      if (action === 'outsource_recovery') {
        type IncidentLookupRow = {
          id: string;
          incident_no: string | null;
          incident_type: string | null;
          severity: string | null;
          description: string | null;
          location: string | null;
        };
        const [inc] = await tx.$queryRawUnsafe<IncidentLookupRow[]>(
          `SELECT id, incident_no, incident_type, severity, description, location
             FROM operations.incidents
            WHERE id = $1 AND tenant_id::text = $2
            LIMIT 1`,
          params.id,
          tenantId,
        );
        if (!inc) {
          return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
        }

        const recoveryType = typeof body.recoveryType === 'string' && body.recoveryType.trim()
          ? body.recoveryType.trim()
          : 'FLATBED';
        const destinationWorkshop = typeof body.destinationWorkshop === 'string' && body.destinationWorkshop.trim()
          ? body.destinationWorkshop.trim()
          : 'Central Fleet Workshop';
        const pickupLocation = inc.location || 'Roadside Incident Location';

        const actorUserId = req.headers.get('x-user-id') || 'system';
        const rfq = await OutsourceEngine.createOutsourceRequest({
          tenantId,
          domain: PartnerServiceDomain.RECOVERY,
          sourceReferenceType: 'RECOVERY_INCIDENT',
          sourceReferenceId: params.id,
          serviceDate: new Date().toISOString().slice(0, 10),
          pickupTime: inc.severity === 'CRITICAL' ? 'Immediate Dispatch' : new Date().toTimeString().slice(0, 5),
          pickupLocation,
          dropoffLocation: destinationWorkshop,
          requiredCapacity: 1,
          vehicleTypeRequired: recoveryType,
          specialInstructions: inc.description || `Incident ${inc.incident_no || params.id} (${inc.incident_type})`,
          invitedPartnerIds: Array.isArray(body.partnerIds) ? (body.partnerIds as string[]) : [],
          createdByUserId: actorUserId,
        });

        const opportunity = await MarketplaceService.publishOpportunity({
          outsourceRequestId: rfq.id,
          tenantId,
          createdByUserId: actorUserId,
          requirementsPayload: {
            recoveryType,
            urgency: inc.severity === 'CRITICAL' ? 'EMERGENCY_HIGHWAY' : 'URGENT',
            destinationWorkshop,
          },
        });

        await tx.$executeRawUnsafe(
          `UPDATE operations.incidents
              SET status = 'IN_PROGRESS', updated_at = NOW()
            WHERE id = $1 AND tenant_id::text = $2`,
          params.id,
          tenantId,
        );

        await tx.$executeRawUnsafe(
          `INSERT INTO incident_notes (incident_id, note_type, content, author, tenant_id)
           VALUES ($1, 'UPDATE', $2, $3, $4)`,
          params.id,
          `Outsourced roadside recovery to Private Partner Exchange Network (RFQ ${rfq.requestNumber} · ${recoveryType} → ${destinationWorkshop})`,
          req.headers.get('x-user-id') || 'Dispatch Desk',
          tenantId,
        );

        return NextResponse.json({
          success: true,
          id: params.id,
          status: 'IN_PROGRESS',
          exchangeRequest: {
            id: rfq.id,
            requestNumber: rfq.requestNumber,
            opportunityId: opportunity.id,
          },
        });
      }

      if (action === 'transition' || (!action && body.status)) {
        const status          = body.status;
        const resolvedBy      = body.resolvedBy;
        const resolutionNotes = body.resolutionNotes;
        const escalationLevel = body.escalationLevel;
        const assignedTo      = body.assignedTo;

        if (!status || !VALID_STATUS.includes(status)) {
          return NextResponse.json({ error: `Invalid status. Allowed: ${VALID_STATUS.join(', ')}` }, { status: 400 });
        }

        const setClauses: string[] = ['status = $2', 'updated_at = NOW()'];
        const values: unknown[] = [params.id, status];

        if (status === 'RESOLVED' || status === 'CLOSED') {
          setClauses.push('resolved_at = NOW()');
        }
        if (status === 'ESCALATED') {
          setClauses.push('escalated_at = NOW()');
        }
        if (status === 'UNDER_INVESTIGATION') {
          setClauses.push('investigation_started_at = NOW()');
        }
        if (resolvedBy)      { values.push(resolvedBy);      setClauses.push(`resolved_by = $${values.length}`); }
        if (resolutionNotes) { values.push(resolutionNotes); setClauses.push(`resolution_notes = $${values.length}`); }
        if (escalationLevel) { values.push(escalationLevel); setClauses.push(`escalation_level = $${values.length}`); }
        if (assignedTo)      { values.push(assignedTo);      setClauses.push(`assigned_to = $${values.length}`); }

        values.push(tenantId);
        const updated = await tx.$executeRawUnsafe(
          `UPDATE operations.incidents SET ${setClauses.join(', ')}
            WHERE id = $1 AND tenant_id::text = $${values.length}`,
          ...values,
        );
        if (updated === 0) {
          return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
        }

        const noteContent = resolutionNotes
          ? `Status changed to ${status}. ${resolutionNotes}`
          : `Status changed to ${status}${assignedTo ? ` — Assigned to ${assignedTo}` : ''}`;

        await tx.$executeRawUnsafe(
          `INSERT INTO incident_notes (incident_id, note_type, content, author, tenant_id)
           VALUES ($1, $2, $3, $4, $5)`,
          params.id,
          status === 'ESCALATED' ? 'ESCALATION' : status === 'RESOLVED' ? 'RESOLUTION' : 'UPDATE',
          noteContent,
          resolvedBy || assignedTo || 'System',
          tenantId,
        );

        return NextResponse.json({ success: true, id: params.id, status });
      }

      if (action === 'update_details') {
        const { severity, description, location } = body;
        const setClauses: string[] = ['updated_at = NOW()'];
        const values: unknown[] = [params.id];
        if (severity)    { values.push(severity);    setClauses.push(`severity = $${values.length}`); }
        if (description) { values.push(description); setClauses.push(`description = $${values.length}`); }
        if (location)    { values.push(location);    setClauses.push(`location = $${values.length}`); }
        values.push(tenantId);
        const updated = await tx.$executeRawUnsafe(
          `UPDATE operations.incidents SET ${setClauses.join(', ')}
            WHERE id = $1 AND tenant_id::text = $${values.length}`,
          ...values,
        );
        if (updated === 0) {
          return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true });
      }

      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch (err) {
      console.error('[incidents PATCH]', err);
      return NextResponse.json({ error: 'Failed to update incident' }, { status: 500 });
    }
  });
}

export async function GET(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: _.headers, nextUrl: _.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      type IncidentRow = Record<string, unknown>;
      const [incident] = await tx.$queryRawUnsafe<IncidentRow[]>(
        `SELECT i.*,
                v.plate_number AS vehicle_plate,
                CONCAT(d.first_name, ' ', d.last_name) AS driver_name
           FROM operations.incidents i
           LEFT JOIN vehicles v ON v.id = i.vehicle_id
           LEFT JOIN drivers d  ON d.id = i.driver_id
          WHERE i.id = $1 LIMIT 1`,
        params.id
      );
      if (!incident) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      type NoteRow = { id: string; note_type: string; content: string; author: string | null; created_at: string };
      const notes = await tx.$queryRawUnsafe<NoteRow[]>(
        `SELECT id, note_type, content, author, created_at
           FROM incident_notes WHERE incident_id::text = $1 ORDER BY created_at ASC`,
        params.id
      ).catch(() => [] as NoteRow[]);

      return NextResponse.json({
        ...incident,
        incident_date: (incident.incident_date as Date)?.toISOString?.() ?? incident.incident_date,
        created_at:    (incident.created_at    as Date)?.toISOString?.() ?? incident.created_at,
        updated_at:    (incident.updated_at    as Date)?.toISOString?.() ?? incident.updated_at,
        notes,
      });
    } catch (err) {
      console.error('[incidents GET/:id]', err);
      return NextResponse.json({ error: 'Failed to fetch incident' }, { status: 500 });
    }
  });
}
