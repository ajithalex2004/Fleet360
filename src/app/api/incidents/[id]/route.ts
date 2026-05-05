import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * Full incident lifecycle: REPORTED → UNDER_INVESTIGATION → ESCALATED → RESOLVED → CLOSED
 *
 * PATCH /api/incidents/:id  — advance status, add notes, escalate
 * GET   /api/incidents/:id  — full incident detail with notes
 */

const VALID_STATUS = ['REPORTED', 'OPEN', 'UNDER_INVESTIGATION', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED'];

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { action } = body;

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

      // Try with extended columns, fall back to minimal
      await prisma.$executeRawUnsafe(
        `UPDATE trip_incidents SET ${setClauses.join(', ')} WHERE id = $1`,
        ...values
      ).catch(async () => {
        // Minimal columns only
        const minSet = ['status = $2', 'updated_at = NOW()'];
        const minVals: unknown[] = [params.id, status];
        if (status === 'RESOLVED' || status === 'CLOSED') minSet.push('resolved_at = NOW()');
        if (resolutionNotes) { minVals.push(resolutionNotes); minSet.push(`resolution_notes = $${minVals.length}`); }
        await prisma.$executeRawUnsafe(`UPDATE trip_incidents SET ${minSet.join(', ')} WHERE id = $1`, ...minVals);
      });

      // Auto-add status change note
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS incident_notes (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          incident_id UUID NOT NULL, note_type TEXT NOT NULL DEFAULT 'UPDATE',
          content TEXT NOT NULL, author TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `).catch(() => {});

      const noteContent = resolutionNotes
        ? `Status changed to ${status}. ${resolutionNotes}`
        : `Status changed to ${status}${assignedTo ? ` — Assigned to ${assignedTo}` : ''}`;

      await prisma.$executeRawUnsafe(
        `INSERT INTO incident_notes (incident_id, note_type, content, author)
         VALUES ($1, $2, $3, $4)`,
        params.id,
        status === 'ESCALATED' ? 'ESCALATION' : status === 'RESOLVED' ? 'RESOLUTION' : 'UPDATE',
        noteContent,
        resolvedBy || assignedTo || 'System'
      ).catch(() => {});

      return NextResponse.json({ success: true, id: params.id, status });
    }

    if (action === 'update_details') {
      const { severity, description, location } = body;
      const setClauses: string[] = ['updated_at = NOW()'];
      const values: unknown[] = [params.id];
      if (severity)    { values.push(severity);    setClauses.push(`severity = $${values.length}`); }
      if (description) { values.push(description); setClauses.push(`description = $${values.length}`); }
      if (location)    { values.push(location);    setClauses.push(`location = $${values.length}`); }
      await prisma.$executeRawUnsafe(`UPDATE trip_incidents SET ${setClauses.join(', ')} WHERE id = $1`, ...values);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('[incidents PATCH]', err);
    return NextResponse.json({ error: 'Failed to update incident' }, { status: 500 });
  }
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    type IncidentRow = Record<string, unknown>;
    const [incident] = await prisma.$queryRawUnsafe<IncidentRow[]>(
      `SELECT i.*,
              v.plate_number AS vehicle_plate,
              CONCAT(d.first_name, ' ', d.last_name) AS driver_name
         FROM trip_incidents i
         LEFT JOIN vehicles v ON v.id = i.vehicle_id
         LEFT JOIN drivers d  ON d.id = i.driver_id
        WHERE i.id = $1 LIMIT 1`,
      params.id
    );
    if (!incident) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Load notes
    type NoteRow = { id: string; note_type: string; content: string; author: string | null; created_at: string };
    const notes = await prisma.$queryRawUnsafe<NoteRow[]>(
      `SELECT id, note_type, content, author, created_at
         FROM incident_notes WHERE incident_id = $1 ORDER BY created_at ASC`,
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
}
