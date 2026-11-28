/**
 * Server-side PostgreSQL repository for Field Service Management Dispatch,
 * Multi-Visit Scheduling, Crew, Sub-Tasks, Time Logs, Digital Checklists,
 * Field Service Reports (FSR), and Live GPS Tracking.
 *
 * Every function runs inside a `withTenantRls(prisma, tenantId, ...)` transaction
 * and explicitly scopes queries by `tenant_id`.
 */

import type { TxClient } from '@/lib/rls';
import { normalizeCode, type FsmTechnicianShift } from './workforce';
import { WorkforceError, listTeams, listTechnicians, listTerritories } from './workforce-db';
import {
  CHECKLIST_TYPES,
  CREW_ROLES,
  STARTER_CHECKLIST_TEMPLATES,
  TASK_CATEGORIES,
  TASK_STATUSES,
  VISIT_STATUSES,
  canTransitionVisitStatus,
  computeElapsedMinutes,
  detectVisitConflicts,
  evaluateChecklistCompletion,
  evaluateGeofenceCheckIn,
  syncedTechAvailabilityForVisit,
  syncedTicketStatusForVisit,
  type ChecklistItemDef,
  type ChecklistResponseItem,
  type ChecklistType,
  type CrewRole,
  type DispatchBoardPayload,
  type FsmChecklistRun,
  type FsmChecklistTemplate,
  type FsmServiceReport,
  type FsmVisitCrewMember,
  type FsmVisitTimeLog,
  type FsmWorkTask,
  type FsmWorkVisit,
  type TaskCategory,
  type TaskStatus,
  type TimeLogType,
  type UnscheduledTicketCard,
  type VisitStatus,
} from './dispatch';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(v: unknown, label: string): string {
  const s = String(v ?? '').trim();
  if (!UUID_RE.test(s)) throw new WorkforceError(`Invalid ${label} ID.`, 400);
  return s;
}

function optUuid(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  return UUID_RE.test(s) ? s : null;
}

function optText(v: unknown, max = 500): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function toNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function assertTimestamp(v: unknown, label: string): Date {
  const d = new Date(String(v ?? ''));
  if (Number.isNaN(d.getTime())) throw new WorkforceError(`Invalid ${label} timestamp.`, 400);
  return d;
}

// ── Row Mappers ──────────────────────────────────────────────────────────────

interface VisitRow {
  id: string;
  tenant_id: string;
  ticket_id: string;
  ticket_readable_id: string | null;
  ticket_title: string;
  ticket_type: string;
  ticket_priority: string;
  ticket_status: string;
  ticket_custom_fields: unknown;
  site_id: string | null;
  site_name: string | null;
  site_address: string | null;
  site_lat: string | number | null;
  site_lng: string | number | null;
  visit_number: number;
  team_id: string | null;
  team_name: string | null;
  status: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
  arrival_window_start: string | null;
  arrival_window_end: string | null;
  estimated_duration_mins: number;
  actual_travel_mins: number;
  actual_work_mins: number;
  en_route_at: string | null;
  arrived_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  checkin_lat: string | number | null;
  checkin_lng: string | number | null;
  checkin_distance_m: number | null;
  geofence_override_reason: string | null;
  scanned_asset_tag: string | null;
  resolution_summary: string | null;
  incomplete_reason: string | null;
  dispatch_notes: string | null;
  created_at: string;
  updated_at: string;
}

interface CrewRow {
  id: string;
  visit_id: string;
  technician_id: string;
  full_name: string;
  email: string;
  employee_code: string;
  availability_status: string;
  role: string;
  acknowledged_at: string | null;
}

function mapVisit(r: VisitRow, crew: FsmVisitCrewMember[]): FsmWorkVisit {
  const cf =
    r.ticket_custom_fields && typeof r.ticket_custom_fields === 'object'
      ? (r.ticket_custom_fields as Record<string, unknown>)
      : {};
  const ticketDepartment =
    typeof cf.assignedDepartment === 'string' && cf.assignedDepartment
      ? cf.assignedDepartment
      : 'OPERATIONS_TRIAGE';
  return {
    id: r.id,
    tenantId: r.tenant_id,
    ticketId: r.ticket_id,
    ticketReadableId: r.ticket_readable_id,
    ticketTitle: r.ticket_title,
    ticketType: r.ticket_type,
    ticketPriority: r.ticket_priority,
    ticketStatus: r.ticket_status,
    ticketDepartment,
    siteId: r.site_id,
    siteName: r.site_name,
    siteAddress: r.site_address,
    siteLat: toNum(r.site_lat),
    siteLng: toNum(r.site_lng),
    visitNumber: Number(r.visit_number),
    teamId: r.team_id,
    teamName: r.team_name,
    status: (VISIT_STATUSES as readonly string[]).includes(r.status) ? (r.status as VisitStatus) : 'SCHEDULED',
    scheduledStartAt: r.scheduled_start_at,
    scheduledEndAt: r.scheduled_end_at,
    arrivalWindowStart: r.arrival_window_start,
    arrivalWindowEnd: r.arrival_window_end,
    estimatedDurationMins: Number(r.estimated_duration_mins),
    actualTravelMins: Number(r.actual_travel_mins ?? 0),
    actualWorkMins: Number(r.actual_work_mins ?? 0),
    enRouteAt: r.en_route_at,
    arrivedAt: r.arrived_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    checkinLat: toNum(r.checkin_lat),
    checkinLng: toNum(r.checkin_lng),
    checkinDistanceM: r.checkin_distance_m !== null ? Number(r.checkin_distance_m) : null,
    geofenceOverrideReason: r.geofence_override_reason,
    scannedAssetTag: r.scanned_asset_tag,
    resolutionSummary: r.resolution_summary,
    incompleteReason: r.incomplete_reason,
    dispatchNotes: r.dispatch_notes,
    crew,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const VISIT_SELECT = `
  v.id::text, v.tenant_id, v.ticket_id::text,
  st.readable_id AS ticket_readable_id,
  st.title AS ticket_title,
  st.ticket_type,
  st.priority AS ticket_priority,
  st.status AS ticket_status,
  st.custom_fields AS ticket_custom_fields,
  st.customer_site_id::text AS site_id,
  cs.name AS site_name,
  cs.address AS site_address,
  cs.latitude AS site_lat,
  cs.longitude AS site_lng,
  v.visit_number, v.team_id::text, tm.name AS team_name,
  v.status,
  v.scheduled_start_at::text, v.scheduled_end_at::text,
  v.arrival_window_start::text, v.arrival_window_end::text,
  v.estimated_duration_mins, v.actual_travel_mins, v.actual_work_mins,
  v.en_route_at::text, v.arrived_at::text, v.started_at::text, v.completed_at::text,
  v.checkin_lat, v.checkin_lng, v.checkin_distance_m,
  v.geofence_override_reason, v.scanned_asset_tag,
  v.resolution_summary, v.incomplete_reason, v.dispatch_notes,
  v.created_at::text, v.updated_at::text
`;

async function hydrateVisits(tx: TxClient, tenantId: string, rows: VisitRow[]): Promise<FsmWorkVisit[]> {
  if (rows.length === 0) return [];
  const visitIds = rows.map((r) => r.id);
  const crewRows = await tx.$queryRawUnsafe<CrewRow[]>(
    `SELECT c.id::text, c.visit_id::text, c.technician_id::text,
            ft.full_name, ft.email, ft.employee_code, ft.availability_status,
            c.role, c.acknowledged_at::text
       FROM fsm_visit_crew c
       JOIN fsm_technicians ft ON ft.id = c.technician_id AND ft.deleted_at IS NULL
      WHERE c.tenant_id = $1 AND c.visit_id = ANY($2::uuid[])
      ORDER BY CASE c.role WHEN 'LEAD' THEN 0 WHEN 'SUPERVISOR' THEN 1 ELSE 2 END, ft.full_name ASC`,
    tenantId,
    visitIds,
  );
  const crewByVisit = new Map<string, FsmVisitCrewMember[]>();
  for (const cr of crewRows) {
    const list = crewByVisit.get(cr.visit_id) ?? [];
    list.push({
      id: cr.id,
      visitId: cr.visit_id,
      technicianId: cr.technician_id,
      fullName: cr.full_name,
      email: cr.email,
      employeeCode: cr.employee_code,
      availabilityStatus: cr.availability_status,
      role: (CREW_ROLES as readonly string[]).includes(cr.role) ? (cr.role as CrewRole) : 'HELPER',
      acknowledgedAt: cr.acknowledged_at,
    });
    crewByVisit.set(cr.visit_id, list);
  }
  return rows.map((r) => mapVisit(r, crewByVisit.get(r.id) ?? []));
}

// ── Visits CRUD ──────────────────────────────────────────────────────────────

export async function listWorkVisits(
  tx: TxClient,
  tenantId: string,
  opts?: {
    ticketId?: string;
    technicianId?: string;
    startIso?: string;
    endIso?: string;
    status?: string;
  },
): Promise<FsmWorkVisit[]> {
  const where: string[] = ['v.tenant_id = $1', 'st.deleted_at IS NULL'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (opts?.ticketId) {
    where.push(`v.ticket_id = $${idx}::uuid`);
    params.push(assertUuid(opts.ticketId, 'ticket'));
    idx++;
  }
  if (opts?.technicianId) {
    where.push(
      `EXISTS (SELECT 1 FROM fsm_visit_crew fc WHERE fc.tenant_id = v.tenant_id AND fc.visit_id = v.id AND fc.technician_id = $${idx}::uuid)`,
    );
    params.push(assertUuid(opts.technicianId, 'technician'));
    idx++;
  }
  if (opts?.startIso) {
    where.push(`v.scheduled_end_at >= $${idx}::timestamptz`);
    params.push(assertTimestamp(opts.startIso, 'start').toISOString());
    idx++;
  }
  if (opts?.endIso) {
    where.push(`v.scheduled_start_at <= $${idx}::timestamptz`);
    params.push(assertTimestamp(opts.endIso, 'end').toISOString());
    idx++;
  }
  if (opts?.status && (VISIT_STATUSES as readonly string[]).includes(opts.status)) {
    where.push(`v.status = $${idx}`);
    params.push(opts.status);
    idx++;
  }

  const rows = await tx.$queryRawUnsafe<VisitRow[]>(
    `SELECT ${VISIT_SELECT}
       FROM fsm_work_visits v
       JOIN service_tickets st ON st.id = v.ticket_id
       LEFT JOIN customer_sites cs ON cs.id = st.customer_site_id AND cs.deleted_at IS NULL
       LEFT JOIN fsm_teams tm ON tm.id = v.team_id AND tm.deleted_at IS NULL
      WHERE ${where.join(' AND ')}
      ORDER BY v.scheduled_start_at ASC, v.visit_number ASC
      LIMIT 300`,
    ...params,
  );
  return hydrateVisits(tx, tenantId, rows);
}

export async function getWorkVisit(tx: TxClient, tenantId: string, visitId: string): Promise<FsmWorkVisit> {
  const id = assertUuid(visitId, 'visit');
  const rows = await tx.$queryRawUnsafe<VisitRow[]>(
    `SELECT ${VISIT_SELECT}
       FROM fsm_work_visits v
       JOIN service_tickets st ON st.id = v.ticket_id
       LEFT JOIN customer_sites cs ON cs.id = st.customer_site_id AND cs.deleted_at IS NULL
       LEFT JOIN fsm_teams tm ON tm.id = v.team_id AND tm.deleted_at IS NULL
      WHERE v.id = $1::uuid AND v.tenant_id = $2`,
    id,
    tenantId,
  );
  if (!rows[0]) throw new WorkforceError('Work visit not found.', 404);
  const [visit] = await hydrateVisits(tx, tenantId, rows);
  return visit;
}

export async function listVisitTimeLogs(
  tx: TxClient,
  tenantId: string,
  visitId: string,
): Promise<FsmVisitTimeLog[]> {
  const id = assertUuid(visitId, 'visit');
  const rows = await tx.$queryRawUnsafe<
    Array<{
      id: string;
      visit_id: string;
      technician_id: string;
      full_name: string | null;
      log_type: string;
      started_at: string;
      ended_at: string | null;
      duration_mins: number | null;
      billable: boolean;
    }>
  >(
    `SELECT l.id::text, l.visit_id::text, l.technician_id::text,
            ft.full_name, l.log_type, l.started_at::text, l.ended_at::text,
            l.duration_mins, l.billable
       FROM fsm_visit_time_logs l
       LEFT JOIN fsm_technicians ft ON ft.id = l.technician_id
      WHERE l.tenant_id = $1 AND l.visit_id = $2::uuid
      ORDER BY l.started_at ASC`,
    tenantId,
    id,
  );
  return rows.map((r) => ({
    id: r.id,
    visitId: r.visit_id,
    technicianId: r.technician_id,
    technicianName: r.full_name,
    logType: r.log_type as TimeLogType,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationMins: r.duration_mins !== null ? Number(r.duration_mins) : null,
    billable: r.billable,
  }));
}

async function appendTicketHistory(
  tx: TxClient,
  tenantId: string,
  ticketId: string,
  entry: { status: string; actor: string; note: string },
) {
  const entryJson = JSON.stringify([
    {
      status: entry.status,
      date: new Date().toISOString(),
      actor: entry.actor,
      note: entry.note,
    },
  ]);
  await tx.$executeRawUnsafe(
    `UPDATE service_tickets
        SET history = COALESCE(history, '[]'::jsonb) || $3::jsonb,
            updated_at = NOW()
      WHERE id = $1::uuid AND tenant_id = $2`,
    ticketId,
    tenantId,
    entryJson,
  );
}

export async function createWorkVisit(
  tx: TxClient,
  tenantId: string,
  actor: string,
  input: Record<string, unknown>,
): Promise<{ visit: FsmWorkVisit; warnings: string[] }> {
  const ticketId = assertUuid(input.ticketId, 'ticket');
  const start = assertTimestamp(input.scheduledStartAt, 'scheduledStartAt');
  const end = assertTimestamp(input.scheduledEndAt, 'scheduledEndAt');
  if (end.getTime() <= start.getTime()) {
    throw new WorkforceError('Visit end time must be after start time.', 400);
  }
  const estimatedDurationMins = Math.max(
    15,
    Math.min(1440, Math.round(Number(input.estimatedDurationMins ?? (end.getTime() - start.getTime()) / 60_000))),
  );
  const teamId = optUuid(input.teamId);
  const statusRaw = String(input.status ?? 'DISPATCHED').toUpperCase();
  const status: VisitStatus = statusRaw === 'SCHEDULED' ? 'SCHEDULED' : 'DISPATCHED';

  // Confirm ticket exists
  const [ticket] = await tx.$queryRawUnsafe<Array<{ id: string; status: string; readable_id: string | null }>>(
    `SELECT id::text, status, readable_id FROM service_tickets WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
    ticketId,
    tenantId,
  );
  if (!ticket) throw new WorkforceError('Service ticket not found.', 404);

  // Build crew list (explicit crew array, leadTechnicianId, or team members)
  const crewSpecs: Array<{ technicianId: string; role: CrewRole }> = [];
  const seenTech = new Set<string>();
  const addCrew = (tid: string | null, role: CrewRole) => {
    if (!tid || seenTech.has(tid)) return;
    seenTech.add(tid);
    crewSpecs.push({ technicianId: tid, role });
  };

  if (Array.isArray(input.crew)) {
    for (const item of input.crew as Array<Record<string, unknown>>) {
      const tid = optUuid(item.technicianId);
      const r = String(item.role ?? 'HELPER').toUpperCase();
      addCrew(tid, (CREW_ROLES as readonly string[]).includes(r) ? (r as CrewRole) : 'HELPER');
    }
  }
  if (input.leadTechnicianId) {
    addCrew(assertUuid(input.leadTechnicianId, 'lead technician'), 'LEAD');
  }
  if (teamId && crewSpecs.length === 0) {
    const members = await tx.$queryRawUnsafe<Array<{ technician_id: string; role: string }>>(
      `SELECT technician_id::text, role FROM fsm_team_members WHERE tenant_id = $1 AND team_id = $2::uuid`,
      tenantId,
      teamId,
    );
    for (const m of members) {
      addCrew(m.technician_id, m.role === 'LEAD' ? 'LEAD' : 'HELPER');
    }
  }

  // Ensure at least one LEAD if crew exists
  if (crewSpecs.length > 0 && !crewSpecs.some((c) => c.role === 'LEAD')) {
    crewSpecs[0].role = 'LEAD';
  }

  // Conflict check against existing active visits & leave shifts
  const warnings: string[] = [];
  if (crewSpecs.length > 0) {
    const techIds = crewSpecs.map((c) => c.technicianId);
    const dayStart = new Date(start.getTime() - 24 * 3_600_000).toISOString();
    const dayEnd = new Date(end.getTime() + 24 * 3_600_000).toISOString();
    const nearbyVisits = await listWorkVisits(tx, tenantId, { startIso: dayStart, endIso: dayEnd });
    const shiftRows = await tx.$queryRawUnsafe<
      Array<{ id: string; technician_id: string; entry_type: string; starts_at: string; ends_at: string; notes: string | null }>
    >(
      `SELECT id::text, technician_id::text, entry_type, starts_at::text, ends_at::text, notes
         FROM fsm_technician_shifts
        WHERE tenant_id = $1 AND technician_id = ANY($2::uuid[])
          AND ends_at >= $3::timestamptz AND starts_at <= $4::timestamptz`,
      tenantId,
      techIds,
      start.toISOString(),
      end.toISOString(),
    );
    const shiftsByTech = new Map<string, FsmTechnicianShift[]>();
    for (const sr of shiftRows) {
      const list = shiftsByTech.get(sr.technician_id) ?? [];
      list.push({
        id: sr.id,
        technicianId: sr.technician_id,
        entryType: sr.entry_type as FsmTechnicianShift['entryType'],
        startsAt: sr.starts_at,
        endsAt: sr.ends_at,
        notes: sr.notes,
      });
      shiftsByTech.set(sr.technician_id, list);
    }
    const conflicts = detectVisitConflicts({
      technicianIds: techIds,
      startAt: start,
      endAt: end,
      existingVisits: nearbyVisits,
      shiftsByTech,
    });
    if (conflicts.length > 0) {
      if (input.allowConflicts !== true) {
        throw new WorkforceError(
          `Schedule conflict detected: ${conflicts.map((c) => c.label).join('; ')}. Enable override to double-book.`,
          409,
        );
      }
      for (const c of conflicts) warnings.push(`Overlap override: ${c.label}`);
    }
  }

  // Compute next visit_number for this ticket
  const [maxRow] = await tx.$queryRawUnsafe<Array<{ max_num: number | null }>>(
    `SELECT MAX(visit_number) AS max_num FROM fsm_work_visits WHERE tenant_id = $1 AND ticket_id = $2::uuid`,
    tenantId,
    ticketId,
  );
  const visitNumber = Number(maxRow?.max_num ?? 0) + 1;

  const arrivalStart = input.arrivalWindowStart ? assertTimestamp(input.arrivalWindowStart, 'arrivalWindowStart').toISOString() : null;
  const arrivalEnd = input.arrivalWindowEnd ? assertTimestamp(input.arrivalWindowEnd, 'arrivalWindowEnd').toISOString() : null;

  const [created] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO fsm_work_visits (
       tenant_id, ticket_id, visit_number, team_id, status,
       scheduled_start_at, scheduled_end_at, arrival_window_start, arrival_window_end,
       estimated_duration_mins, dispatch_notes, created_by
     ) VALUES (
       $1, $2::uuid, $3, $4::uuid, $5,
       $6::timestamptz, $7::timestamptz, $8::timestamptz, $9::timestamptz,
       $10, $11, $12
     ) RETURNING id::text`,
    tenantId,
    ticketId,
    visitNumber,
    teamId,
    status,
    start.toISOString(),
    end.toISOString(),
    arrivalStart,
    arrivalEnd,
    estimatedDurationMins,
    optText(input.dispatchNotes, 1000),
    actor,
  );

  for (const c of crewSpecs) {
    await tx.$executeRawUnsafe(
      `INSERT INTO fsm_visit_crew (tenant_id, visit_id, technician_id, role)
       VALUES ($1, $2::uuid, $3::uuid, $4)
       ON CONFLICT (tenant_id, visit_id, technician_id) DO UPDATE SET role = EXCLUDED.role`,
      tenantId,
      created.id,
      c.technicianId,
      c.role,
    );
  }

  // Sync parent service_ticket scheduled window & primary technician / status
  const leadId = crewSpecs.find((c) => c.role === 'LEAD')?.technicianId ?? null;
  let leadEmail: string | null = null;
  let leadName: string | null = null;
  if (leadId) {
    const [lt] = await tx.$queryRawUnsafe<Array<{ email: string; full_name: string }>>(
      `SELECT email, full_name FROM fsm_technicians WHERE id = $1::uuid AND tenant_id = $2`,
      leadId,
      tenantId,
    );
    leadEmail = lt?.email ?? null;
    leadName = lt?.full_name ?? null;
  }

  const nextTicketStatus =
    ['Pending', 'Acknowledged', 'Escalated'].includes(ticket.status) ? 'Assigned' : ticket.status;
  await tx.$executeRawUnsafe(
    `UPDATE service_tickets
        SET status = $3,
            scheduled_start_at = $4::timestamptz,
            scheduled_end_at = $5::timestamptz,
            dispatched_at = COALESCE(dispatched_at, NOW()),
            primary_technician_id = COALESCE($6::uuid, primary_technician_id),
            assigned_team_id = COALESCE($7::uuid, assigned_team_id),
            assigned_to = COALESCE($8, assigned_to),
            updated_at = NOW()
      WHERE id = $1::uuid AND tenant_id = $2`,
    ticketId,
    tenantId,
    nextTicketStatus,
    start.toISOString(),
    end.toISOString(),
    leadId,
    teamId,
    leadEmail,
  );

  await appendTicketHistory(tx, tenantId, ticketId, {
    status: nextTicketStatus,
    actor,
    note: `Scheduled Visit #${visitNumber}${leadName ? ` with ${leadName}` : ''} (${start.toISOString().slice(0, 16).replace('T', ' ')})`,
  });

  const visit = await getWorkVisit(tx, tenantId, created.id);
  return { visit, warnings };
}

export async function updateWorkVisit(
  tx: TxClient,
  tenantId: string,
  visitId: string,
  actor: string,
  input: Record<string, unknown>,
): Promise<FsmWorkVisit> {
  const existing = await getWorkVisit(tx, tenantId, visitId);
  const start = input.scheduledStartAt
    ? assertTimestamp(input.scheduledStartAt, 'scheduledStartAt')
    : new Date(existing.scheduledStartAt);
  const end = input.scheduledEndAt
    ? assertTimestamp(input.scheduledEndAt, 'scheduledEndAt')
    : new Date(existing.scheduledEndAt);
  if (end.getTime() <= start.getTime()) {
    throw new WorkforceError('Visit end time must be after start time.', 400);
  }

  const teamId = input.teamId !== undefined ? optUuid(input.teamId) : existing.teamId;
  const durationMins =
    input.estimatedDurationMins !== undefined
      ? Math.max(15, Math.min(1440, Math.round(Number(input.estimatedDurationMins))))
      : Math.max(15, Math.round((end.getTime() - start.getTime()) / 60_000));
  const dispatchNotes =
    input.dispatchNotes !== undefined ? optText(input.dispatchNotes, 1000) : existing.dispatchNotes;

  await tx.$executeRawUnsafe(
    `UPDATE fsm_work_visits
        SET scheduled_start_at = $3::timestamptz,
            scheduled_end_at = $4::timestamptz,
            estimated_duration_mins = $5,
            team_id = $6::uuid,
            dispatch_notes = $7,
            updated_at = NOW()
      WHERE id = $1::uuid AND tenant_id = $2`,
    existing.id,
    tenantId,
    start.toISOString(),
    end.toISOString(),
    durationMins,
    teamId,
    dispatchNotes,
  );

  // Replace crew if provided
  if (Array.isArray(input.crew) || input.leadTechnicianId !== undefined) {
    const newCrew: Array<{ technicianId: string; role: CrewRole }> = [];
    const seen = new Set<string>();
    if (Array.isArray(input.crew)) {
      for (const item of input.crew as Array<Record<string, unknown>>) {
        const tid = optUuid(item.technicianId);
        if (!tid || seen.has(tid)) continue;
        seen.add(tid);
        const r = String(item.role ?? 'HELPER').toUpperCase();
        newCrew.push({
          technicianId: tid,
          role: (CREW_ROLES as readonly string[]).includes(r) ? (r as CrewRole) : 'HELPER',
        });
      }
    } else if (input.leadTechnicianId) {
      const tid = assertUuid(input.leadTechnicianId, 'lead technician');
      newCrew.push({ technicianId: tid, role: 'LEAD' });
      seen.add(tid);
      for (const old of existing.crew) {
        if (old.role !== 'LEAD' && !seen.has(old.technicianId)) {
          seen.add(old.technicianId);
          newCrew.push({ technicianId: old.technicianId, role: old.role });
        }
      }
    }

    await tx.$executeRawUnsafe(
      `DELETE FROM fsm_visit_crew WHERE tenant_id = $1 AND visit_id = $2::uuid`,
      tenantId,
      existing.id,
    );
    for (const c of newCrew) {
      await tx.$executeRawUnsafe(
        `INSERT INTO fsm_visit_crew (tenant_id, visit_id, technician_id, role)
         VALUES ($1, $2::uuid, $3::uuid, $4)`,
        tenantId,
        existing.id,
        c.technicianId,
        c.role,
      );
    }

    const leadId = newCrew.find((c) => c.role === 'LEAD')?.technicianId ?? null;
    if (leadId) {
      const [lt] = await tx.$queryRawUnsafe<Array<{ email: string }>>(
        `SELECT email FROM fsm_technicians WHERE id = $1::uuid AND tenant_id = $2`,
        leadId,
        tenantId,
      );
      await tx.$executeRawUnsafe(
        `UPDATE service_tickets
            SET primary_technician_id = $3::uuid,
                assigned_to = COALESCE($4, assigned_to),
                scheduled_start_at = $5::timestamptz,
                scheduled_end_at = $6::timestamptz,
                updated_at = NOW()
          WHERE id = $1::uuid AND tenant_id = $2`,
        existing.ticketId,
        tenantId,
        leadId,
        lt?.email ?? null,
        start.toISOString(),
        end.toISOString(),
      );
    }
  } else {
    await tx.$executeRawUnsafe(
      `UPDATE service_tickets
          SET scheduled_start_at = $3::timestamptz,
              scheduled_end_at = $4::timestamptz,
              updated_at = NOW()
        WHERE id = $1::uuid AND tenant_id = $2`,
      existing.ticketId,
      tenantId,
      start.toISOString(),
      end.toISOString(),
    );
  }

  await appendTicketHistory(tx, tenantId, existing.ticketId, {
    status: existing.ticketStatus,
    actor,
    note: `Rescheduled Visit #${existing.visitNumber} to ${start.toISOString().slice(0, 16).replace('T', ' ')}`,
  });

  return getWorkVisit(tx, tenantId, existing.id);
}

export async function deleteWorkVisit(tx: TxClient, tenantId: string, visitId: string): Promise<void> {
  const id = assertUuid(visitId, 'visit');
  const count = await tx.$executeRawUnsafe(
    `DELETE FROM fsm_work_visits WHERE id = $1::uuid AND tenant_id = $2`,
    id,
    tenantId,
  );
  if (!count) throw new WorkforceError('Work visit not found.', 404);
}

// ── Field Execution State Machine & GPS Check-In ─────────────────────────────

async function closeOpenTimeLogs(
  tx: TxClient,
  tenantId: string,
  visitId: string,
  logType?: TimeLogType,
): Promise<number> {
  const openLogs = await tx.$queryRawUnsafe<Array<{ id: string; started_at: string }>>(
    `SELECT id::text, started_at::text
       FROM fsm_visit_time_logs
      WHERE tenant_id = $1 AND visit_id = $2::uuid AND ended_at IS NULL
        ${logType ? 'AND log_type = $3' : ''}`,
    ...(logType ? [tenantId, visitId, logType] : [tenantId, visitId]),
  );
  let totalAdded = 0;
  const now = new Date();
  for (const log of openLogs) {
    const mins = computeElapsedMinutes(log.started_at, now);
    totalAdded += mins;
    await tx.$executeRawUnsafe(
      `UPDATE fsm_visit_time_logs
          SET ended_at = $3::timestamptz, duration_mins = $4
        WHERE id = $1::uuid AND tenant_id = $2`,
      log.id,
      tenantId,
      now.toISOString(),
      mins,
    );
  }
  return totalAdded;
}

export async function upsertTechnicianGpsLocation(
  tx: TxClient,
  tenantId: string,
  technicianId: string,
  input: {
    latitude: number;
    longitude: number;
    accuracyM?: number | null;
    batteryPct?: number | null;
    availabilityStatus?: string | null;
  },
): Promise<void> {
  const tid = assertUuid(technicianId, 'technician');
  if (!Number.isFinite(input.latitude) || Math.abs(input.latitude) > 90) {
    throw new WorkforceError('Invalid latitude.', 400);
  }
  if (!Number.isFinite(input.longitude) || Math.abs(input.longitude) > 180) {
    throw new WorkforceError('Invalid longitude.', 400);
  }
  await tx.$executeRawUnsafe(
    `INSERT INTO fsm_technician_locations (tenant_id, technician_id, latitude, longitude, accuracy_m, battery_pct, recorded_at, updated_at)
     VALUES ($1, $2::uuid, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (technician_id) DO UPDATE
       SET latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           accuracy_m = EXCLUDED.accuracy_m,
           battery_pct = EXCLUDED.battery_pct,
           recorded_at = NOW(),
           updated_at = NOW()`,
    tenantId,
    tid,
    input.latitude,
    input.longitude,
    input.accuracyM ?? null,
    input.batteryPct ?? null,
  );
  if (input.availabilityStatus) {
    await tx.$executeRawUnsafe(
      `UPDATE fsm_technicians SET availability_status = $3, updated_at = NOW()
        WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
      tid,
      tenantId,
      input.availabilityStatus,
    );
  }
}

export async function transitionWorkVisit(
  tx: TxClient,
  tenantId: string,
  visitId: string,
  actor: string,
  input: Record<string, unknown>,
): Promise<{ visit: FsmWorkVisit; idempotentReplay: boolean; geofenceDistanceM: number | null }> {
  const id = assertUuid(visitId, 'visit');
  const idempotencyKey = optUuid(input.idempotencyKey);

  // Idempotent replay check for offline mobile retries
  if (idempotencyKey) {
    const [prior] = await tx.$queryRawUnsafe<Array<{ response_body: unknown }>>(
      `SELECT response_body FROM fsm_mobile_sync_events WHERE tenant_id = $1 AND idempotency_key = $2::uuid`,
      tenantId,
      idempotencyKey,
    );
    if (prior) {
      const visit = await getWorkVisit(tx, tenantId, id);
      return { visit, idempotentReplay: true, geofenceDistanceM: visit.checkinDistanceM };
    }
  }

  const current = await getWorkVisit(tx, tenantId, id);
  const nextStatusRaw = String(input.status ?? '').trim().toUpperCase();
  if (!(VISIT_STATUSES as readonly string[]).includes(nextStatusRaw)) {
    throw new WorkforceError(`Invalid visit status "${nextStatusRaw}".`, 400);
  }
  const nextStatus = nextStatusRaw as VisitStatus;
  if (!canTransitionVisitStatus(current.status, nextStatus)) {
    throw new WorkforceError(`Cannot transition visit from ${current.status} to ${nextStatus}.`, 400);
  }

  const actingTechId =
    optUuid(input.technicianId) ?? current.crew.find((c) => c.role === 'LEAD')?.technicianId ?? current.crew[0]?.technicianId ?? null;
  const lat = toNum(input.latitude as string | number | null | undefined);
  const lng = toNum(input.longitude as string | number | null | undefined);
  const accuracyM = toNum(input.accuracyM as string | number | null | undefined);
  const batteryPct = toNum(input.batteryPct as string | number | null | undefined);

  let geofenceDistanceM: number | null = current.checkinDistanceM;
  let overrideReason: string | null = current.geofenceOverrideReason;

  // Evaluate geofence on ON_SITE check-in
  if (nextStatus === 'ON_SITE') {
    const geo = evaluateGeofenceCheckIn({
      techLat: lat,
      techLng: lng,
      siteLat: current.siteLat,
      siteLng: current.siteLng,
    });
    geofenceDistanceM = geo.distanceMeters;
    const providedOverride = optText(input.geofenceOverrideReason, 300);
    if (geo.requiresOverride && !providedOverride && input.bypassGeofence !== true) {
      throw new WorkforceError(
        `Check-in GPS is ${geo.distanceMeters}m from site (limit ${geo.radiusMeters}m). Provide a geofence override reason to proceed.`,
        409,
      );
    }
    if (providedOverride) overrideReason = providedOverride;
  }

  // Upsert technician GPS location if coordinates were supplied
  const nextTechAvail = syncedTechAvailabilityForVisit(nextStatus);
  if (actingTechId && lat !== null && lng !== null) {
    await upsertTechnicianGpsLocation(tx, tenantId, actingTechId, {
      latitude: lat,
      longitude: lng,
      accuracyM,
      batteryPct: batteryPct !== null ? Math.round(batteryPct) : null,
      availabilityStatus: nextTechAvail,
    });
  } else if (actingTechId && nextTechAvail) {
    await tx.$executeRawUnsafe(
      `UPDATE fsm_technicians SET availability_status = $3, updated_at = NOW()
        WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
      actingTechId,
      tenantId,
      nextTechAvail,
    );
  }

  // Manage travel / work time logs
  let addedTravel = 0;
  let addedWork = 0;
  const nowIso = new Date().toISOString();

  if (nextStatus === 'EN_ROUTE' && actingTechId) {
    await closeOpenTimeLogs(tx, tenantId, id);
    await tx.$executeRawUnsafe(
      `INSERT INTO fsm_visit_time_logs (tenant_id, visit_id, technician_id, log_type, started_at, billable)
       VALUES ($1, $2::uuid, $3::uuid, 'TRAVEL', $4::timestamptz, TRUE)`,
      tenantId,
      id,
      actingTechId,
      nowIso,
    );
  } else if (nextStatus === 'ON_SITE') {
    addedTravel = await closeOpenTimeLogs(tx, tenantId, id, 'TRAVEL');
  } else if (nextStatus === 'IN_PROGRESS' && actingTechId) {
    addedTravel = await closeOpenTimeLogs(tx, tenantId, id, 'TRAVEL');
    await closeOpenTimeLogs(tx, tenantId, id, 'WORK');
    await tx.$executeRawUnsafe(
      `INSERT INTO fsm_visit_time_logs (tenant_id, visit_id, technician_id, log_type, started_at, billable)
       VALUES ($1, $2::uuid, $3::uuid, 'WORK', $4::timestamptz, TRUE)`,
      tenantId,
      id,
      actingTechId,
      nowIso,
    );
  } else if (nextStatus === 'PAUSED' || nextStatus === 'COMPLETED' || nextStatus === 'INCOMPLETE' || nextStatus === 'CANCELLED') {
    addedTravel = await closeOpenTimeLogs(tx, tenantId, id, 'TRAVEL');
    addedWork = await closeOpenTimeLogs(tx, tenantId, id, 'WORK');
  }

  const scannedAssetTag =
    input.scannedAssetTag !== undefined ? optText(input.scannedAssetTag, 120) : current.scannedAssetTag;
  const resolutionSummary =
    input.resolutionSummary !== undefined ? optText(input.resolutionSummary, 2000) : current.resolutionSummary;
  const incompleteReason =
    input.incompleteReason !== undefined ? optText(input.incompleteReason, 1000) : current.incompleteReason;

  await tx.$executeRawUnsafe(
    `UPDATE fsm_work_visits
        SET status = $3,
            actual_travel_mins = actual_travel_mins + $4,
            actual_work_mins = actual_work_mins + $5,
            en_route_at = CASE WHEN $3 = 'EN_ROUTE' THEN COALESCE(en_route_at, NOW()) ELSE en_route_at END,
            arrived_at = CASE WHEN $3 = 'ON_SITE' THEN COALESCE(arrived_at, NOW()) ELSE arrived_at END,
            started_at = CASE WHEN $3 = 'IN_PROGRESS' THEN COALESCE(started_at, NOW()) ELSE started_at END,
            completed_at = CASE WHEN $3 IN ('COMPLETED', 'INCOMPLETE') THEN NOW() ELSE completed_at END,
            checkin_lat = COALESCE($6, checkin_lat),
            checkin_lng = COALESCE($7, checkin_lng),
            checkin_distance_m = COALESCE($8, checkin_distance_m),
            geofence_override_reason = COALESCE($9, geofence_override_reason),
            scanned_asset_tag = $10,
            resolution_summary = $11,
            incomplete_reason = $12,
            updated_at = NOW()
      WHERE id = $1::uuid AND tenant_id = $2`,
    id,
    tenantId,
    nextStatus,
    addedTravel,
    addedWork,
    nextStatus === 'ON_SITE' ? lat : null,
    nextStatus === 'ON_SITE' ? lng : null,
    nextStatus === 'ON_SITE' ? geofenceDistanceM : null,
    overrideReason,
    scannedAssetTag,
    resolutionSummary,
    incompleteReason,
  );

  // Sync parent service_ticket milestones & status
  const syncedTicketStatus = syncedTicketStatusForVisit(nextStatus);
  await tx.$executeRawUnsafe(
    `UPDATE service_tickets
        SET status = COALESCE($3, status),
            en_route_at = CASE WHEN $4 = 'EN_ROUTE' THEN COALESCE(en_route_at, NOW()) ELSE en_route_at END,
            arrived_on_site_at = CASE WHEN $4 = 'ON_SITE' THEN COALESCE(arrived_on_site_at, NOW()) ELSE arrived_on_site_at END,
            work_started_at = CASE WHEN $4 = 'IN_PROGRESS' THEN COALESCE(work_started_at, NOW()) ELSE work_started_at END,
            resolved_at = CASE WHEN $4 = 'COMPLETED' THEN COALESCE(resolved_at, NOW()) ELSE resolved_at END,
            first_time_fix = CASE
              WHEN $4 = 'COMPLETED' THEN COALESCE(first_time_fix, ($5 = 1))
              WHEN $4 = 'INCOMPLETE' THEN FALSE
              ELSE first_time_fix
            END,
            updated_at = NOW()
      WHERE id = $1::uuid AND tenant_id = $2`,
    current.ticketId,
    tenantId,
    syncedTicketStatus,
    nextStatus,
    current.visitNumber,
  );

  const noteParts = [`Visit #${current.visitNumber} → ${nextStatus.replace('_', ' ')}`];
  if (nextStatus === 'ON_SITE' && geofenceDistanceM !== null) {
    noteParts.push(`GPS check-in (${geofenceDistanceM}m from site)`);
  }
  if (overrideReason && nextStatus === 'ON_SITE') noteParts.push(`Override: ${overrideReason}`);
  if (resolutionSummary && nextStatus === 'COMPLETED') noteParts.push(resolutionSummary);
  if (incompleteReason && nextStatus === 'INCOMPLETE') noteParts.push(`Incomplete: ${incompleteReason}`);

  await appendTicketHistory(tx, tenantId, current.ticketId, {
    status: syncedTicketStatus ?? current.ticketStatus,
    actor,
    note: noteParts.join(' · '),
  });

  const updated = await getWorkVisit(tx, tenantId, id);

  if (idempotencyKey) {
    await tx.$executeRawUnsafe(
      `INSERT INTO fsm_mobile_sync_events (tenant_id, idempotency_key, technician_id, event_type, visit_id, response_status, response_body)
       VALUES ($1, $2::uuid, $3::uuid, $4, $5::uuid, 200, $6::jsonb)
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`,
      tenantId,
      idempotencyKey,
      actingTechId,
      `VISIT_${nextStatus}`,
      id,
      JSON.stringify({ visitId: id, status: nextStatus }),
    );
  }

  return { visit: updated, idempotentReplay: false, geofenceDistanceM };
}

// ── Work Order Sub-Tasks & Non-Job Technician Activities ─────────────────────

interface TaskRow {
  id: string;
  tenant_id: string;
  ticket_id: string | null;
  ticket_readable_id: string | null;
  visit_id: string | null;
  depends_on_task_id: string | null;
  task_category: string;
  title: string;
  description: string | null;
  assigned_tech_id: string | null;
  assigned_tech_name: string | null;
  assigned_user_email: string | null;
  status: string;
  due_at: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  completed_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function mapTask(r: TaskRow): FsmWorkTask {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    ticketId: r.ticket_id,
    ticketReadableId: r.ticket_readable_id,
    visitId: r.visit_id,
    dependsOnTaskId: r.depends_on_task_id,
    taskCategory: (TASK_CATEGORIES as readonly string[]).includes(r.task_category)
      ? (r.task_category as TaskCategory)
      : 'WORK_ORDER_TASK',
    title: r.title,
    description: r.description,
    assignedTechId: r.assigned_tech_id,
    assignedTechName: r.assigned_tech_name,
    assignedUserEmail: r.assigned_user_email,
    status: (TASK_STATUSES as readonly string[]).includes(r.status) ? (r.status as TaskStatus) : 'OPEN',
    dueAt: r.due_at,
    scheduledStartAt: r.scheduled_start_at,
    scheduledEndAt: r.scheduled_end_at,
    completedAt: r.completed_at,
    sortOrder: Number(r.sort_order ?? 10),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listWorkTasks(
  tx: TxClient,
  tenantId: string,
  opts?: { ticketId?: string; visitId?: string; technicianId?: string; startIso?: string; endIso?: string },
): Promise<FsmWorkTask[]> {
  const where: string[] = ['t.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (opts?.ticketId) {
    where.push(`t.ticket_id = $${idx}::uuid`);
    params.push(assertUuid(opts.ticketId, 'ticket'));
    idx++;
  }
  if (opts?.visitId) {
    where.push(`t.visit_id = $${idx}::uuid`);
    params.push(assertUuid(opts.visitId, 'visit'));
    idx++;
  }
  if (opts?.technicianId) {
    where.push(`t.assigned_tech_id = $${idx}::uuid`);
    params.push(assertUuid(opts.technicianId, 'technician'));
    idx++;
  }
  if (opts?.startIso && opts?.endIso) {
    where.push(
      `t.scheduled_start_at IS NOT NULL AND t.scheduled_end_at >= $${idx}::timestamptz AND t.scheduled_start_at <= $${idx + 1}::timestamptz`,
    );
    params.push(assertTimestamp(opts.startIso, 'start').toISOString());
    params.push(assertTimestamp(opts.endIso, 'end').toISOString());
    idx += 2;
  }

  const rows = await tx.$queryRawUnsafe<TaskRow[]>(
    `SELECT t.id::text, t.tenant_id, t.ticket_id::text, st.readable_id AS ticket_readable_id,
            t.visit_id::text, t.depends_on_task_id::text, t.task_category, t.title, t.description,
            t.assigned_tech_id::text, ft.full_name AS assigned_tech_name, t.assigned_user_email,
            t.status, t.due_at::text, t.scheduled_start_at::text, t.scheduled_end_at::text,
            t.completed_at::text, t.sort_order, t.created_at::text, t.updated_at::text
       FROM fsm_work_tasks t
       LEFT JOIN service_tickets st ON st.id = t.ticket_id
       LEFT JOIN fsm_technicians ft ON ft.id = t.assigned_tech_id AND ft.deleted_at IS NULL
      WHERE ${where.join(' AND ')}
      ORDER BY t.sort_order ASC, t.created_at ASC
      LIMIT 300`,
    ...params,
  );
  return rows.map(mapTask);
}

export async function createWorkTask(
  tx: TxClient,
  tenantId: string,
  input: Record<string, unknown>,
): Promise<FsmWorkTask> {
  const title = optText(input.title, 200);
  if (!title) throw new WorkforceError('Task title is required.', 400);
  const catRaw = String(input.taskCategory ?? 'WORK_ORDER_TASK').toUpperCase();
  const taskCategory: TaskCategory = (TASK_CATEGORIES as readonly string[]).includes(catRaw)
    ? (catRaw as TaskCategory)
    : 'WORK_ORDER_TASK';
  const ticketId = optUuid(input.ticketId);
  const visitId = optUuid(input.visitId);
  const dependsOnTaskId = optUuid(input.dependsOnTaskId);
  const assignedTechId = optUuid(input.assignedTechId);
  const dueAt = input.dueAt ? assertTimestamp(input.dueAt, 'dueAt').toISOString() : null;
  const scheduledStartAt = input.scheduledStartAt ? assertTimestamp(input.scheduledStartAt, 'scheduledStartAt').toISOString() : null;
  const scheduledEndAt = input.scheduledEndAt ? assertTimestamp(input.scheduledEndAt, 'scheduledEndAt').toISOString() : null;
  if (scheduledStartAt && scheduledEndAt && new Date(scheduledEndAt) <= new Date(scheduledStartAt)) {
    throw new WorkforceError('Task end time must be after start time.', 400);
  }

  const [row] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO fsm_work_tasks (
       tenant_id, ticket_id, visit_id, depends_on_task_id, task_category,
       title, description, assigned_tech_id, assigned_user_email,
       due_at, scheduled_start_at, scheduled_end_at, sort_order
     ) VALUES (
       $1, $2::uuid, $3::uuid, $4::uuid, $5,
       $6, $7, $8::uuid, $9,
       $10::timestamptz, $11::timestamptz, $12::timestamptz, $13
     ) RETURNING id::text`,
    tenantId,
    ticketId,
    visitId,
    dependsOnTaskId,
    taskCategory,
    title,
    optText(input.description, 1000),
    assignedTechId,
    optText(input.assignedUserEmail, 160),
    dueAt,
    scheduledStartAt,
    scheduledEndAt,
    Number.isFinite(Number(input.sortOrder)) ? Math.round(Number(input.sortOrder)) : 10,
  );
  const tasks = await listWorkTasks(tx, tenantId, ticketId ? { ticketId } : undefined);
  const found = tasks.find((t) => t.id === row.id);
  if (found) return found;
  const [single] = await tx.$queryRawUnsafe<TaskRow[]>(
    `SELECT t.id::text, t.tenant_id, t.ticket_id::text, st.readable_id AS ticket_readable_id,
            t.visit_id::text, t.depends_on_task_id::text, t.task_category, t.title, t.description,
            t.assigned_tech_id::text, ft.full_name AS assigned_tech_name, t.assigned_user_email,
            t.status, t.due_at::text, t.scheduled_start_at::text, t.scheduled_end_at::text,
            t.completed_at::text, t.sort_order, t.created_at::text, t.updated_at::text
       FROM fsm_work_tasks t
       LEFT JOIN service_tickets st ON st.id = t.ticket_id
       LEFT JOIN fsm_technicians ft ON ft.id = t.assigned_tech_id AND ft.deleted_at IS NULL
      WHERE t.id = $1::uuid AND t.tenant_id = $2`,
    row.id,
    tenantId,
  );
  return mapTask(single);
}

export async function updateWorkTask(
  tx: TxClient,
  tenantId: string,
  taskId: string,
  input: Record<string, unknown>,
): Promise<FsmWorkTask> {
  const id = assertUuid(taskId, 'task');
  const [existing] = await tx.$queryRawUnsafe<Array<{ id: string; status: string; depends_on_task_id: string | null }>>(
    `SELECT id::text, status, depends_on_task_id::text FROM fsm_work_tasks WHERE id = $1::uuid AND tenant_id = $2`,
    id,
    tenantId,
  );
  if (!existing) throw new WorkforceError('Task not found.', 404);

  const nextStatusRaw = input.status !== undefined ? String(input.status).toUpperCase() : existing.status;
  if (!(TASK_STATUSES as readonly string[]).includes(nextStatusRaw)) {
    throw new WorkforceError('Invalid task status.', 400);
  }
  const nextStatus = nextStatusRaw as TaskStatus;

  // Enforce task dependency before completion
  if (nextStatus === 'COMPLETED' && existing.depends_on_task_id) {
    const [dep] = await tx.$queryRawUnsafe<Array<{ title: string; status: string }>>(
      `SELECT title, status FROM fsm_work_tasks WHERE id = $1::uuid AND tenant_id = $2`,
      existing.depends_on_task_id,
      tenantId,
    );
    if (dep && dep.status !== 'COMPLETED') {
      throw new WorkforceError(`Cannot complete task while prerequisite "${dep.title}" is ${dep.status}.`, 409);
    }
  }

  const sets: string[] = ['status = $3', 'updated_at = NOW()'];
  const params: unknown[] = [id, tenantId, nextStatus];
  let idx = 4;

  if (nextStatus === 'COMPLETED') {
    sets.push(`completed_at = COALESCE(completed_at, NOW())`);
  } else if (input.status !== undefined) {
    sets.push(`completed_at = NULL`);
  }
  if (input.title !== undefined) {
    const t = optText(input.title, 200);
    if (!t) throw new WorkforceError('Task title cannot be empty.', 400);
    sets.push(`title = $${idx++}`);
    params.push(t);
  }
  if (input.description !== undefined) {
    sets.push(`description = $${idx++}`);
    params.push(optText(input.description, 1000));
  }
  if (input.assignedTechId !== undefined) {
    sets.push(`assigned_tech_id = $${idx++}::uuid`);
    params.push(optUuid(input.assignedTechId));
  }
  if (input.scheduledStartAt !== undefined) {
    sets.push(`scheduled_start_at = $${idx++}::timestamptz`);
    params.push(input.scheduledStartAt ? assertTimestamp(input.scheduledStartAt, 'scheduledStartAt').toISOString() : null);
  }
  if (input.scheduledEndAt !== undefined) {
    sets.push(`scheduled_end_at = $${idx++}::timestamptz`);
    params.push(input.scheduledEndAt ? assertTimestamp(input.scheduledEndAt, 'scheduledEndAt').toISOString() : null);
  }

  await tx.$executeRawUnsafe(
    `UPDATE fsm_work_tasks SET ${sets.join(', ')} WHERE id = $1::uuid AND tenant_id = $2`,
    ...params,
  );

  const [updated] = await tx.$queryRawUnsafe<TaskRow[]>(
    `SELECT t.id::text, t.tenant_id, t.ticket_id::text, st.readable_id AS ticket_readable_id,
            t.visit_id::text, t.depends_on_task_id::text, t.task_category, t.title, t.description,
            t.assigned_tech_id::text, ft.full_name AS assigned_tech_name, t.assigned_user_email,
            t.status, t.due_at::text, t.scheduled_start_at::text, t.scheduled_end_at::text,
            t.completed_at::text, t.sort_order, t.created_at::text, t.updated_at::text
       FROM fsm_work_tasks t
       LEFT JOIN service_tickets st ON st.id = t.ticket_id
       LEFT JOIN fsm_technicians ft ON ft.id = t.assigned_tech_id AND ft.deleted_at IS NULL
      WHERE t.id = $1::uuid AND t.tenant_id = $2`,
    id,
    tenantId,
  );
  return mapTask(updated);
}

export async function deleteWorkTask(tx: TxClient, tenantId: string, taskId: string): Promise<void> {
  const id = assertUuid(taskId, 'task');
  const count = await tx.$executeRawUnsafe(
    `DELETE FROM fsm_work_tasks WHERE id = $1::uuid AND tenant_id = $2`,
    id,
    tenantId,
  );
  if (!count) throw new WorkforceError('Task not found.', 404);
}

// ── Checklist Templates & Runs ───────────────────────────────────────────────

interface TemplateRow {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  checklist_type: string;
  service_type_key: string | null;
  is_mandatory: boolean;
  items: unknown;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function mapTemplate(r: TemplateRow): FsmChecklistTemplate {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    code: r.code,
    name: r.name,
    checklistType: (CHECKLIST_TYPES as readonly string[]).includes(r.checklist_type)
      ? (r.checklist_type as ChecklistType)
      : 'JOB_SOP',
    serviceTypeKey: r.service_type_key,
    isMandatory: r.is_mandatory,
    items: Array.isArray(r.items) ? (r.items as ChecklistItemDef[]) : [],
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listChecklistTemplates(
  tx: TxClient,
  tenantId: string,
  serviceTypeKey?: string,
): Promise<FsmChecklistTemplate[]> {
  const rows = await tx.$queryRawUnsafe<TemplateRow[]>(
    `SELECT id::text, tenant_id, code, name, checklist_type, service_type_key,
            is_mandatory, items, is_active, created_at::text, updated_at::text
       FROM fsm_checklist_templates
      WHERE tenant_id = $1 AND deleted_at IS NULL
        ${serviceTypeKey ? 'AND (service_type_key IS NULL OR service_type_key = $2)' : ''}
      ORDER BY is_mandatory DESC, name ASC`,
    ...(serviceTypeKey ? [tenantId, serviceTypeKey] : [tenantId]),
  );
  return rows.map(mapTemplate);
}

export async function seedStarterChecklistTemplates(
  tx: TxClient,
  tenantId: string,
): Promise<FsmChecklistTemplate[]> {
  for (const tpl of STARTER_CHECKLIST_TEMPLATES) {
    await tx.$executeRawUnsafe(
      `INSERT INTO fsm_checklist_templates (tenant_id, code, name, checklist_type, service_type_key, is_mandatory, items)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (tenant_id, code) WHERE deleted_at IS NULL DO NOTHING`,
      tenantId,
      tpl.code,
      tpl.name,
      tpl.checklistType,
      tpl.serviceTypeKey,
      tpl.isMandatory,
      JSON.stringify(tpl.items),
    );
  }
  return listChecklistTemplates(tx, tenantId);
}

export async function createChecklistTemplate(
  tx: TxClient,
  tenantId: string,
  input: Record<string, unknown>,
): Promise<FsmChecklistTemplate> {
  const name = optText(input.name, 160);
  if (!name) throw new WorkforceError('Checklist template name is required.', 400);
  const code = normalizeCode(String(input.code || name), 48);
  if (!code) throw new WorkforceError('Valid checklist code is required.', 400);
  const typeRaw = String(input.checklistType ?? 'JOB_SOP').toUpperCase();
  const checklistType: ChecklistType = (CHECKLIST_TYPES as readonly string[]).includes(typeRaw)
    ? (typeRaw as ChecklistType)
    : 'JOB_SOP';
  const items = Array.isArray(input.items) ? input.items : [];

  try {
    const [row] = await tx.$queryRawUnsafe<TemplateRow[]>(
      `INSERT INTO fsm_checklist_templates (tenant_id, code, name, checklist_type, service_type_key, is_mandatory, items)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id::text, tenant_id, code, name, checklist_type, service_type_key,
                 is_mandatory, items, is_active, created_at::text, updated_at::text`,
      tenantId,
      code,
      name,
      checklistType,
      optText(input.serviceTypeKey, 64),
      input.isMandatory !== false,
      JSON.stringify(items),
    );
    return mapTemplate(row);
  } catch (err) {
    if (err instanceof Error && /unique/i.test(err.message)) {
      throw new WorkforceError(`Checklist code "${code}" already exists.`, 409);
    }
    throw err;
  }
}

export async function deleteChecklistTemplate(tx: TxClient, tenantId: string, id: string): Promise<void> {
  const tplId = assertUuid(id, 'template');
  const count = await tx.$executeRawUnsafe(
    `UPDATE fsm_checklist_templates SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
    tplId,
    tenantId,
  );
  if (!count) throw new WorkforceError('Checklist template not found.', 404);
}

interface RunRow {
  id: string;
  tenant_id: string;
  ticket_id: string;
  visit_id: string | null;
  template_id: string | null;
  template_name: string;
  checklist_type: string;
  responses: unknown;
  status: string;
  completed_by: string | null;
  completed_by_name: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapRun(r: RunRow): FsmChecklistRun {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    ticketId: r.ticket_id,
    visitId: r.visit_id,
    templateId: r.template_id,
    templateName: r.template_name,
    checklistType: (CHECKLIST_TYPES as readonly string[]).includes(r.checklist_type)
      ? (r.checklist_type as ChecklistType)
      : 'JOB_SOP',
    responses: Array.isArray(r.responses) ? (r.responses as ChecklistResponseItem[]) : [],
    status: r.status === 'PASSED' || r.status === 'FAILED' ? r.status : 'IN_PROGRESS',
    completedBy: r.completed_by,
    completedByName: r.completed_by_name,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listChecklistRuns(
  tx: TxClient,
  tenantId: string,
  opts: { ticketId?: string; visitId?: string },
): Promise<FsmChecklistRun[]> {
  const where: string[] = ['r.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;
  if (opts.ticketId) {
    where.push(`r.ticket_id = $${idx++}::uuid`);
    params.push(assertUuid(opts.ticketId, 'ticket'));
  }
  if (opts.visitId) {
    where.push(`r.visit_id = $${idx++}::uuid`);
    params.push(assertUuid(opts.visitId, 'visit'));
  }
  const rows = await tx.$queryRawUnsafe<RunRow[]>(
    `SELECT r.id::text, r.tenant_id, r.ticket_id::text, r.visit_id::text,
            r.template_id::text, r.template_name, r.checklist_type, r.responses,
            r.status, r.completed_by::text, ft.full_name AS completed_by_name,
            r.completed_at::text, r.created_at::text, r.updated_at::text
       FROM fsm_checklist_runs r
       LEFT JOIN fsm_technicians ft ON ft.id = r.completed_by
      WHERE ${where.join(' AND ')}
      ORDER BY r.created_at ASC`,
    ...params,
  );
  return rows.map(mapRun);
}

export async function saveChecklistRun(
  tx: TxClient,
  tenantId: string,
  input: Record<string, unknown>,
): Promise<FsmChecklistRun> {
  const runId = optUuid(input.id);
  const idempotencyKey = optUuid(input.idempotencyKey);

  if (idempotencyKey && !runId) {
    const [existingIdemp] = await tx.$queryRawUnsafe<RunRow[]>(
      `SELECT r.id::text, r.tenant_id, r.ticket_id::text, r.visit_id::text,
              r.template_id::text, r.template_name, r.checklist_type, r.responses,
              r.status, r.completed_by::text, ft.full_name AS completed_by_name,
              r.completed_at::text, r.created_at::text, r.updated_at::text
         FROM fsm_checklist_runs r
         LEFT JOIN fsm_technicians ft ON ft.id = r.completed_by
        WHERE r.tenant_id = $1 AND r.idempotency_key = $2::uuid`,
      tenantId,
      idempotencyKey,
    );
    if (existingIdemp) return mapRun(existingIdemp);
  }

  const responses = Array.isArray(input.responses) ? (input.responses as ChecklistResponseItem[]) : [];
  const evalResult = evaluateChecklistCompletion(responses);
  const completedBy = optUuid(input.completedBy);

  if (runId) {
    const count = await tx.$executeRawUnsafe(
      `UPDATE fsm_checklist_runs
          SET responses = $3::jsonb,
              status = $4,
              completed_by = COALESCE($5::uuid, completed_by),
              completed_at = CASE WHEN $4 IN ('PASSED', 'FAILED') THEN COALESCE(completed_at, NOW()) ELSE NULL END,
              updated_at = NOW()
        WHERE id = $1::uuid AND tenant_id = $2`,
      runId,
      tenantId,
      JSON.stringify(responses),
      evalResult.status,
      completedBy,
    );
    if (!count) throw new WorkforceError('Checklist run not found.', 404);
    const [row] = await tx.$queryRawUnsafe<RunRow[]>(
      `SELECT r.id::text, r.tenant_id, r.ticket_id::text, r.visit_id::text,
              r.template_id::text, r.template_name, r.checklist_type, r.responses,
              r.status, r.completed_by::text, ft.full_name AS completed_by_name,
              r.completed_at::text, r.created_at::text, r.updated_at::text
         FROM fsm_checklist_runs r
         LEFT JOIN fsm_technicians ft ON ft.id = r.completed_by
        WHERE r.id = $1::uuid AND r.tenant_id = $2`,
      runId,
      tenantId,
    );
    return mapRun(row);
  }

  const ticketId = assertUuid(input.ticketId, 'ticket');
  const visitId = optUuid(input.visitId);
  const templateId = optUuid(input.templateId);

  let templateName = optText(input.templateName, 160) ?? 'Field Checklist';
  let checklistType = String(input.checklistType ?? 'JOB_SOP').toUpperCase();
  let initialResponses = responses;

  if (templateId) {
    const [tpl] = await tx.$queryRawUnsafe<TemplateRow[]>(
      `SELECT id::text, tenant_id, code, name, checklist_type, service_type_key,
              is_mandatory, items, is_active, created_at::text, updated_at::text
         FROM fsm_checklist_templates
        WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
      templateId,
      tenantId,
    );
    if (tpl) {
      templateName = tpl.name;
      checklistType = tpl.checklist_type;
      if (initialResponses.length === 0 && Array.isArray(tpl.items)) {
        initialResponses = (tpl.items as ChecklistItemDef[]).map((item) => ({
          itemId: item.id,
          label: item.label,
          type: item.type,
          required: item.required,
          failOnFalse: item.failOnFalse,
          value: null,
          notes: null,
        }));
      }
    }
  }

  const finalEval = evaluateChecklistCompletion(initialResponses);
  const [created] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO fsm_checklist_runs (
       tenant_id, ticket_id, visit_id, template_id, template_name, checklist_type,
       responses, status, completed_by, completed_at, idempotency_key
     ) VALUES (
       $1, $2::uuid, $3::uuid, $4::uuid, $5, $6,
       $7::jsonb, $8, $9::uuid, $10::timestamptz, $11::uuid
     ) RETURNING id::text`,
    tenantId,
    ticketId,
    visitId,
    templateId,
    templateName,
    checklistType,
    JSON.stringify(initialResponses),
    finalEval.status,
    completedBy,
    finalEval.status === 'IN_PROGRESS' ? null : new Date().toISOString(),
    idempotencyKey,
  );

  const [row] = await tx.$queryRawUnsafe<RunRow[]>(
    `SELECT r.id::text, r.tenant_id, r.ticket_id::text, r.visit_id::text,
            r.template_id::text, r.template_name, r.checklist_type, r.responses,
            r.status, r.completed_by::text, ft.full_name AS completed_by_name,
            r.completed_at::text, r.created_at::text, r.updated_at::text
       FROM fsm_checklist_runs r
       LEFT JOIN fsm_technicians ft ON ft.id = r.completed_by
      WHERE r.id = $1::uuid AND r.tenant_id = $2`,
    created.id,
    tenantId,
  );
  return mapRun(row);
}

// ── Field Service Reports (FSR) & e-Signatures ───────────────────────────────

interface ReportRow {
  id: string;
  tenant_id: string;
  report_number: string;
  ticket_id: string;
  ticket_readable_id: string | null;
  ticket_title: string | null;
  visit_id: string | null;
  work_performed: string;
  root_cause_code: string | null;
  remedy_code: string | null;
  recommendations: string | null;
  before_photo_urls: string[] | null;
  after_photo_urls: string[] | null;
  customer_signer_name: string | null;
  customer_signer_title: string | null;
  customer_signature_url: string | null;
  technician_signature_url: string | null;
  signed_at: string | null;
  created_at: string;
}

function mapReport(r: ReportRow): FsmServiceReport {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    reportNumber: r.report_number,
    ticketId: r.ticket_id,
    ticketReadableId: r.ticket_readable_id,
    ticketTitle: r.ticket_title,
    visitId: r.visit_id,
    workPerformed: r.work_performed,
    rootCauseCode: r.root_cause_code,
    remedyCode: r.remedy_code,
    recommendations: r.recommendations,
    beforePhotoUrls: Array.isArray(r.before_photo_urls) ? r.before_photo_urls : [],
    afterPhotoUrls: Array.isArray(r.after_photo_urls) ? r.after_photo_urls : [],
    customerSignerName: r.customer_signer_name,
    customerSignerTitle: r.customer_signer_title,
    customerSignatureUrl: r.customer_signature_url,
    technicianSignatureUrl: r.technician_signature_url,
    signedAt: r.signed_at,
    createdAt: r.created_at,
  };
}

export async function listServiceReports(
  tx: TxClient,
  tenantId: string,
  opts?: { ticketId?: string; visitId?: string },
): Promise<FsmServiceReport[]> {
  const where: string[] = ['r.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;
  if (opts?.ticketId) {
    where.push(`r.ticket_id = $${idx++}::uuid`);
    params.push(assertUuid(opts.ticketId, 'ticket'));
  }
  if (opts?.visitId) {
    where.push(`r.visit_id = $${idx++}::uuid`);
    params.push(assertUuid(opts.visitId, 'visit'));
  }
  const rows = await tx.$queryRawUnsafe<ReportRow[]>(
    `SELECT r.id::text, r.tenant_id, r.report_number, r.ticket_id::text,
            st.readable_id AS ticket_readable_id, st.title AS ticket_title,
            r.visit_id::text, r.work_performed, r.root_cause_code, r.remedy_code,
            r.recommendations, r.before_photo_urls, r.after_photo_urls,
            r.customer_signer_name, r.customer_signer_title,
            r.customer_signature_url, r.technician_signature_url,
            r.signed_at::text, r.created_at::text
       FROM fsm_service_reports r
       LEFT JOIN service_tickets st ON st.id = r.ticket_id
      WHERE ${where.join(' AND ')}
      ORDER BY r.created_at DESC
      LIMIT 100`,
    ...params,
  );
  return rows.map(mapReport);
}

function sanitizeDataUrlOrUrl(v: unknown, maxLen = 180_000): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > maxLen) return null;
  if (s.startsWith('data:image/') || s.startsWith('https://') || s.startsWith('http://') || s.startsWith('/')) {
    return s;
  }
  return null;
}

export async function createServiceReport(
  tx: TxClient,
  tenantId: string,
  actor: string,
  input: Record<string, unknown>,
): Promise<FsmServiceReport> {
  const idempotencyKey = optUuid(input.idempotencyKey);
  if (idempotencyKey) {
    const [prior] = await tx.$queryRawUnsafe<ReportRow[]>(
      `SELECT r.id::text, r.tenant_id, r.report_number, r.ticket_id::text,
              st.readable_id AS ticket_readable_id, st.title AS ticket_title,
              r.visit_id::text, r.work_performed, r.root_cause_code, r.remedy_code,
              r.recommendations, r.before_photo_urls, r.after_photo_urls,
              r.customer_signer_name, r.customer_signer_title,
              r.customer_signature_url, r.technician_signature_url,
              r.signed_at::text, r.created_at::text
         FROM fsm_service_reports r
         LEFT JOIN service_tickets st ON st.id = r.ticket_id
        WHERE r.tenant_id = $1 AND r.idempotency_key = $2::uuid`,
      tenantId,
      idempotencyKey,
    );
    if (prior) return mapReport(prior);
  }

  const ticketId = assertUuid(input.ticketId, 'ticket');
  const visitId = optUuid(input.visitId);
  const workPerformed = optText(input.workPerformed, 4000);
  if (!workPerformed) throw new WorkforceError('Work performed summary is required.', 400);

  const year = new Date().getFullYear();
  const [cntRow] = await tx.$queryRawUnsafe<Array<{ cnt: string | number }>>(
    `SELECT COUNT(*) AS cnt FROM fsm_service_reports WHERE tenant_id = $1 AND report_number LIKE $2`,
    tenantId,
    `FSR-${year}-%`,
  );
  const seq = Number(cntRow?.cnt ?? 0) + 1;
  const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
  const reportNumber = `FSR-${year}-${String(seq).padStart(4, '0')}-${suffix}`;

  const customerSig = sanitizeDataUrlOrUrl(input.customerSignatureUrl);
  const techSig = sanitizeDataUrlOrUrl(input.technicianSignatureUrl);
  const signedAt = customerSig || techSig ? new Date().toISOString() : null;

  const beforePhotos = Array.isArray(input.beforePhotoUrls)
    ? (input.beforePhotoUrls as unknown[]).map((u) => sanitizeDataUrlOrUrl(u)).filter(Boolean) as string[]
    : [];
  const afterPhotos = Array.isArray(input.afterPhotoUrls)
    ? (input.afterPhotoUrls as unknown[]).map((u) => sanitizeDataUrlOrUrl(u)).filter(Boolean) as string[]
    : [];

  const [created] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO fsm_service_reports (
       tenant_id, report_number, ticket_id, visit_id,
       work_performed, root_cause_code, remedy_code, recommendations,
       before_photo_urls, after_photo_urls,
       customer_signer_name, customer_signer_title,
       customer_signature_url, technician_signature_url,
       signed_at, idempotency_key
     ) VALUES (
       $1, $2, $3::uuid, $4::uuid,
       $5, $6, $7, $8,
       $9::text[], $10::text[],
       $11, $12,
       $13, $14,
       $15::timestamptz, $16::uuid
     ) RETURNING id::text`,
    tenantId,
    reportNumber,
    ticketId,
    visitId,
    workPerformed,
    optText(input.rootCauseCode, 60),
    optText(input.remedyCode, 60),
    optText(input.recommendations, 2000),
    beforePhotos,
    afterPhotos,
    optText(input.customerSignerName, 120),
    optText(input.customerSignerTitle, 120),
    customerSig,
    techSig,
    signedAt,
    idempotencyKey,
  );

  // Optionally mark visit COMPLETED when FSR is signed
  if (visitId && input.completeVisit === true) {
    try {
      await transitionWorkVisit(tx, tenantId, visitId, actor, {
        status: 'COMPLETED',
        resolutionSummary: workPerformed,
      });
    } catch {
      // Visit may already be completed; keep FSR creation successful.
    }
  } else {
    await appendTicketHistory(tx, tenantId, ticketId, {
      status: 'In Progress',
      actor,
      note: `Field Service Report ${reportNumber} submitted${input.customerSignerName ? ` (signed by ${String(input.customerSignerName)})` : ''}`,
    });
  }

  const reports = await listServiceReports(tx, tenantId, { ticketId });
  return reports.find((r) => r.id === created.id)!;
}

// ── Dispatch Board Composite Query ───────────────────────────────────────────

export async function getDispatchBoard(
  tx: TxClient,
  tenantId: string,
  opts: { date: string; endDate: string; territoryId?: string; department?: string },
): Promise<DispatchBoardPayload> {
  const startIso = `${opts.date}T00:00:00.000Z`;
  const endIso = `${opts.endDate}T23:59:59.999Z`;

  const [technicians, teams, territories, visits, tasks] = await Promise.all([
    listTechnicians(tx, tenantId, {
      activeOnly: true,
      territoryId: opts.territoryId,
      department: opts.department,
    }),
    listTeams(tx, tenantId),
    listTerritories(tx, tenantId),
    listWorkVisits(tx, tenantId, { startIso, endIso }),
    listWorkTasks(tx, tenantId, { startIso, endIso }),
  ]);

  // Attach shifts overlapping the board range for each technician
  const techIds = technicians.map((t) => t.id);
  const shiftsByTech = new Map<string, FsmTechnicianShift[]>();
  if (techIds.length > 0) {
    const shiftRows = await tx.$queryRawUnsafe<
      Array<{
        id: string;
        technician_id: string;
        entry_type: string;
        starts_at: string;
        ends_at: string;
        notes: string | null;
      }>
    >(
      `SELECT id::text, technician_id::text, entry_type, starts_at::text, ends_at::text, notes
         FROM fsm_technician_shifts
        WHERE tenant_id = $1 AND technician_id = ANY($2::uuid[])
          AND ends_at >= $3::timestamptz AND starts_at <= $4::timestamptz
        ORDER BY starts_at ASC`,
      tenantId,
      techIds,
      startIso,
      endIso,
    );
    for (const sr of shiftRows) {
      const list = shiftsByTech.get(sr.technician_id) ?? [];
      list.push({
        id: sr.id,
        technicianId: sr.technician_id,
        entryType: sr.entry_type as FsmTechnicianShift['entryType'],
        startsAt: sr.starts_at,
        endsAt: sr.ends_at,
        notes: sr.notes,
      });
      shiftsByTech.set(sr.technician_id, list);
    }
  }

  // Open tickets needing scheduling (or with no active upcoming visit)
  const ticketRows = await tx.$queryRawUnsafe<
    Array<{
      id: string;
      readable_id: string | null;
      ticket_type: string;
      title: string;
      description: string | null;
      priority: string;
      status: string;
      custom_fields: unknown;
      assigned_to: string | null;
      primary_technician_id: string | null;
      assigned_team_id: string | null;
      territory_id: string | null;
      customer_site_id: string | null;
      site_name: string | null;
      site_address: string | null;
      site_lat: string | number | null;
      site_lng: string | number | null;
      created_at: string;
      due_date: string | null;
      visit_count: string | number;
    }>
  >(
    `SELECT st.id::text, st.readable_id, st.ticket_type, st.title, st.description,
            st.priority, st.status, st.custom_fields, st.assigned_to,
            st.primary_technician_id::text, st.assigned_team_id::text, st.territory_id::text,
            st.customer_site_id::text,
            cs.name AS site_name, cs.address AS site_address,
            cs.latitude AS site_lat, cs.longitude AS site_lng,
            st.created_at::text, st.due_date::text,
            (SELECT COUNT(*) FROM fsm_work_visits v
              WHERE v.tenant_id = st.tenant_id AND v.ticket_id = st.id
                AND v.status NOT IN ('CANCELLED')) AS visit_count
       FROM service_tickets st
       LEFT JOIN customer_sites cs ON cs.id = st.customer_site_id AND cs.deleted_at IS NULL
      WHERE st.tenant_id = $1
        AND st.deleted_at IS NULL
        AND st.status NOT IN ('Resolved', 'Completed', 'Closed', 'Rejected')
      ORDER BY CASE st.priority WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
               st.created_at ASC
      LIMIT 120`,
    tenantId,
  );

  const unscheduledTickets: UnscheduledTicketCard[] = ticketRows
    .map((r) => {
      const cf = r.custom_fields && typeof r.custom_fields === 'object' ? (r.custom_fields as Record<string, unknown>) : {};
      const assignedDepartment =
        typeof cf.assignedDepartment === 'string' && cf.assignedDepartment
          ? cf.assignedDepartment
          : 'OPERATIONS_TRIAGE';
      return {
        id: r.id,
        readableId: r.readable_id,
        ticketType: r.ticket_type,
        title: r.title,
        description: r.description,
        priority: r.priority,
        status: r.status,
        assignedDepartment,
        assignedTo: r.assigned_to,
        primaryTechnicianId: r.primary_technician_id,
        assignedTeamId: r.assigned_team_id,
        territoryId: r.territory_id,
        siteId: r.customer_site_id,
        siteName: r.site_name,
        siteAddress: r.site_address,
        siteLat: toNum(r.site_lat),
        siteLng: toNum(r.site_lng),
        createdAt: r.created_at,
        dueDate: r.due_date,
        visitCount: Number(r.visit_count ?? 0),
      };
    })
    .filter((t) => (!opts.department || t.assignedDepartment === opts.department))
    .filter((t) => (!opts.territoryId || !t.territoryId || t.territoryId === opts.territoryId));

  return {
    date: opts.date,
    endDate: opts.endDate,
    unscheduledTickets,
    visits,
    tasks,
    technicians: technicians.map((t) => ({ ...t, shifts: shiftsByTech.get(t.id) ?? [] })),
    teams: teams.filter((tm) => tm.isActive),
    territories: territories.filter((tr) => tr.isActive),
  };
}
