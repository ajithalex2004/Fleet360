/**
 * Browser-safe shared types, state-machine guards, geofence check-in evaluator,
 * schedule conflict detector, checklist completion evaluator, and slot recommender
 * for Field Service Dispatch, Multi-Visit Tasks, Checklists, Live Map & Mobile Execution.
 */

import { haversineKm, type FsmTeam, type FsmTechnician, type FsmTechnicianShift, type FsmTerritory } from './workforce';

// ── Enums & Constants ────────────────────────────────────────────────────────

export const VISIT_STATUSES = [
  'SCHEDULED',
  'DISPATCHED',
  'EN_ROUTE',
  'ON_SITE',
  'IN_PROGRESS',
  'PAUSED',
  'COMPLETED',
  'INCOMPLETE',
  'CANCELLED',
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const ACTIVE_VISIT_STATUSES = new Set<VisitStatus>([
  'SCHEDULED',
  'DISPATCHED',
  'EN_ROUTE',
  'ON_SITE',
  'IN_PROGRESS',
  'PAUSED',
]);

export const CREW_ROLES = ['LEAD', 'HELPER', 'SUPERVISOR'] as const;
export type CrewRole = (typeof CREW_ROLES)[number];

export const TASK_CATEGORIES = [
  'WORK_ORDER_TASK',
  'PERMIT',
  'SITE_SURVEY',
  'PARTS_PICKUP',
  'MEETING',
  'TRAINING',
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const TASK_STATUSES = ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TIME_LOG_TYPES = ['TRAVEL', 'WORK', 'BREAK', 'WAITING'] as const;
export type TimeLogType = (typeof TIME_LOG_TYPES)[number];

export const CHECKLIST_TYPES = ['PRE_WORK_SAFETY', 'JOB_SOP', 'QA_INSPECTION', 'HANDOVER'] as const;
export type ChecklistType = (typeof CHECKLIST_TYPES)[number];

export const CHECKLIST_ITEM_TYPES = ['BOOL', 'TEXT', 'NUMBER', 'PHOTO'] as const;
export type ChecklistItemType = (typeof CHECKLIST_ITEM_TYPES)[number];

export const ROOT_CAUSE_CODES = [
  'WEAR_AND_TEAR',
  'ELECTRICAL_FAULT',
  'MECHANICAL_FAILURE',
  'LEAKAGE_PLUMBING',
  'SENSOR_CONTROLS',
  'OPERATOR_MISUSE',
  'ENVIRONMENTAL',
  'PREVENTIVE_PM',
  'OTHER',
] as const;

export const REMEDY_CODES = [
  'REPAIRED_ON_SITE',
  'COMPONENT_REPLACED',
  'ADJUSTED_CALIBRATED',
  'CLEANED_SERVICED',
  'RESET_RECONFIGURED',
  'TEMPORARY_BYPASS',
  'ESCALATED_OEM',
  'NO_FAULT_FOUND',
] as const;

export const DEFAULT_GEOFENCE_RADIUS_M = 250;

// ── Shared Data Shapes ───────────────────────────────────────────────────────

export interface FsmVisitCrewMember {
  id: string;
  visitId: string;
  technicianId: string;
  fullName: string;
  email: string;
  employeeCode: string;
  availabilityStatus: string;
  role: CrewRole;
  acknowledgedAt: string | null;
}

export interface FsmVisitTimeLog {
  id: string;
  visitId: string;
  technicianId: string;
  technicianName?: string | null;
  logType: TimeLogType;
  startedAt: string;
  endedAt: string | null;
  durationMins: number | null;
  billable: boolean;
}

export interface FsmWorkVisit {
  id: string;
  tenantId: string;
  ticketId: string;
  ticketReadableId: string | null;
  ticketTitle: string;
  ticketType: string;
  ticketPriority: string;
  ticketStatus: string;
  ticketDepartment: string;
  siteId: string | null;
  siteName: string | null;
  siteAddress: string | null;
  siteLat: number | null;
  siteLng: number | null;
  visitNumber: number;
  teamId: string | null;
  teamName: string | null;
  status: VisitStatus;
  scheduledStartAt: string;
  scheduledEndAt: string;
  arrivalWindowStart: string | null;
  arrivalWindowEnd: string | null;
  estimatedDurationMins: number;
  actualTravelMins: number;
  actualWorkMins: number;
  enRouteAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  checkinLat: number | null;
  checkinLng: number | null;
  checkinDistanceM: number | null;
  geofenceOverrideReason: string | null;
  scannedAssetTag: string | null;
  resolutionSummary: string | null;
  incompleteReason: string | null;
  dispatchNotes: string | null;
  crew: FsmVisitCrewMember[];
  createdAt: string;
  updatedAt: string;
}

export interface FsmWorkTask {
  id: string;
  tenantId: string;
  ticketId: string | null;
  ticketReadableId: string | null;
  visitId: string | null;
  dependsOnTaskId: string | null;
  taskCategory: TaskCategory;
  title: string;
  description: string | null;
  assignedTechId: string | null;
  assignedTechName: string | null;
  assignedUserEmail: string | null;
  status: TaskStatus;
  dueAt: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  completedAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistItemDef {
  id: string;
  label: string;
  type: ChecklistItemType;
  required: boolean;
  failOnFalse?: boolean;
  unit?: string;
}

export interface FsmChecklistTemplate {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  checklistType: ChecklistType;
  serviceTypeKey: string | null;
  isMandatory: boolean;
  items: ChecklistItemDef[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistResponseItem {
  itemId: string;
  label: string;
  type: ChecklistItemType;
  required?: boolean;
  failOnFalse?: boolean;
  value: boolean | string | number | null;
  notes?: string | null;
}

export interface FsmChecklistRun {
  id: string;
  tenantId: string;
  ticketId: string;
  visitId: string | null;
  templateId: string | null;
  templateName: string;
  checklistType: ChecklistType;
  responses: ChecklistResponseItem[];
  status: 'IN_PROGRESS' | 'PASSED' | 'FAILED';
  completedBy: string | null;
  completedByName: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FsmServiceReport {
  id: string;
  tenantId: string;
  reportNumber: string;
  ticketId: string;
  ticketReadableId: string | null;
  ticketTitle: string | null;
  visitId: string | null;
  workPerformed: string;
  rootCauseCode: string | null;
  remedyCode: string | null;
  recommendations: string | null;
  beforePhotoUrls: string[];
  afterPhotoUrls: string[];
  customerSignerName: string | null;
  customerSignerTitle: string | null;
  customerSignatureUrl: string | null;
  technicianSignatureUrl: string | null;
  signedAt: string | null;
  createdAt: string;
}

export interface UnscheduledTicketCard {
  id: string;
  readableId: string | null;
  ticketType: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  assignedDepartment: string;
  assignedTo: string | null;
  primaryTechnicianId: string | null;
  assignedTeamId: string | null;
  territoryId: string | null;
  siteId: string | null;
  siteName: string | null;
  siteAddress: string | null;
  siteLat: number | null;
  siteLng: number | null;
  createdAt: string;
  dueDate: string | null;
  visitCount: number;
}

export interface DispatchBoardPayload {
  date: string;
  endDate: string;
  unscheduledTickets: UnscheduledTicketCard[];
  visits: FsmWorkVisit[];
  tasks: FsmWorkTask[];
  technicians: Array<FsmTechnician & { shifts: FsmTechnicianShift[] }>;
  teams: FsmTeam[];
  territories: FsmTerritory[];
}

// ── State Machine ────────────────────────────────────────────────────────────

export const VALID_VISIT_TRANSITIONS: Record<VisitStatus, readonly VisitStatus[]> = {
  SCHEDULED: ['DISPATCHED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS', 'CANCELLED'],
  DISPATCHED: ['SCHEDULED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS', 'CANCELLED'],
  EN_ROUTE: ['ON_SITE', 'IN_PROGRESS', 'PAUSED', 'DISPATCHED', 'CANCELLED'],
  ON_SITE: ['IN_PROGRESS', 'PAUSED', 'COMPLETED', 'INCOMPLETE', 'CANCELLED'],
  IN_PROGRESS: ['PAUSED', 'COMPLETED', 'INCOMPLETE', 'CANCELLED'],
  PAUSED: ['IN_PROGRESS', 'EN_ROUTE', 'ON_SITE', 'COMPLETED', 'INCOMPLETE', 'CANCELLED'],
  COMPLETED: ['IN_PROGRESS'], // supervisor reopen
  INCOMPLETE: ['SCHEDULED', 'DISPATCHED', 'IN_PROGRESS'],
  CANCELLED: ['SCHEDULED'],
};

export function canTransitionVisitStatus(from: VisitStatus, to: VisitStatus): boolean {
  if (from === to) return true;
  return VALID_VISIT_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Maps a visit status change to the synchronized parent service_ticket status. */
export function syncedTicketStatusForVisit(visitStatus: VisitStatus): string | null {
  switch (visitStatus) {
    case 'SCHEDULED':
    case 'DISPATCHED':
      return 'Assigned';
    case 'EN_ROUTE':
    case 'ON_SITE':
    case 'IN_PROGRESS':
    case 'PAUSED':
      return 'In Progress';
    case 'COMPLETED':
      return 'Resolved';
    default:
      return null;
  }
}

/** Maps a visit status change to the lead technician's live availability status. */
export function syncedTechAvailabilityForVisit(
  visitStatus: VisitStatus,
): 'AVAILABLE' | 'EN_ROUTE' | 'ON_JOB' | 'ON_BREAK' | null {
  switch (visitStatus) {
    case 'EN_ROUTE':
      return 'EN_ROUTE';
    case 'ON_SITE':
    case 'IN_PROGRESS':
      return 'ON_JOB';
    case 'PAUSED':
      return 'ON_BREAK';
    case 'COMPLETED':
    case 'INCOMPLETE':
    case 'CANCELLED':
      return 'AVAILABLE';
    default:
      return null;
  }
}

// ── Geofence Check-In Evaluation ─────────────────────────────────────────────

export interface GeofenceCheckResult {
  distanceMeters: number | null;
  withinGeofence: boolean;
  requiresOverride: boolean;
  radiusMeters: number;
}

export function evaluateGeofenceCheckIn(input: {
  techLat?: number | null;
  techLng?: number | null;
  siteLat?: number | null;
  siteLng?: number | null;
  radiusMeters?: number;
}): GeofenceCheckResult {
  const radiusMeters = input.radiusMeters ?? DEFAULT_GEOFENCE_RADIUS_M;
  if (
    typeof input.techLat !== 'number' ||
    typeof input.techLng !== 'number' ||
    typeof input.siteLat !== 'number' ||
    typeof input.siteLng !== 'number' ||
    !Number.isFinite(input.techLat) ||
    !Number.isFinite(input.techLng) ||
    !Number.isFinite(input.siteLat) ||
    !Number.isFinite(input.siteLng)
  ) {
    return {
      distanceMeters: null,
      withinGeofence: true,
      requiresOverride: false,
      radiusMeters,
    };
  }
  const distanceMeters = Math.round(haversineKm(input.techLat, input.techLng, input.siteLat, input.siteLng) * 1000);
  const withinGeofence = distanceMeters <= radiusMeters;
  return {
    distanceMeters,
    withinGeofence,
    requiresOverride: !withinGeofence,
    radiusMeters,
  };
}

// ── Schedule Conflict & Slot Recommendation ──────────────────────────────────

export interface ScheduleConflict {
  kind: 'VISIT_OVERLAP' | 'LEAVE_BLOCK';
  technicianId: string;
  conflictingId: string;
  label: string;
  startsAt: string;
  endsAt: string;
}

export function windowsOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}

export function detectVisitConflicts(input: {
  technicianIds: string[];
  startAt: string | Date;
  endAt: string | Date;
  excludeVisitId?: string;
  existingVisits: ReadonlyArray<{
    id: string;
    status: VisitStatus;
    ticketReadableId?: string | null;
    ticketTitle?: string;
    scheduledStartAt: string;
    scheduledEndAt: string;
    crew: ReadonlyArray<{ technicianId: string }>;
  }>;
  shiftsByTech?: ReadonlyMap<string, ReadonlyArray<Pick<FsmTechnicianShift, 'id' | 'entryType' | 'startsAt' | 'endsAt' | 'notes'>>>;
}): ScheduleConflict[] {
  const startMs = new Date(input.startAt).getTime();
  const endMs = new Date(input.endAt).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];

  const techSet = new Set(input.technicianIds);
  const conflicts: ScheduleConflict[] = [];

  for (const v of input.existingVisits) {
    if (v.id === input.excludeVisitId) continue;
    if (!ACTIVE_VISIT_STATUSES.has(v.status)) continue;
    const vStart = new Date(v.scheduledStartAt).getTime();
    const vEnd = new Date(v.scheduledEndAt).getTime();
    if (!windowsOverlap(startMs, endMs, vStart, vEnd)) continue;

    for (const c of v.crew) {
      if (techSet.has(c.technicianId)) {
        conflicts.push({
          kind: 'VISIT_OVERLAP',
          technicianId: c.technicianId,
          conflictingId: v.id,
          label: `${v.ticketReadableId ?? 'Visit'} — ${v.ticketTitle ?? 'Scheduled job'}`,
          startsAt: v.scheduledStartAt,
          endsAt: v.scheduledEndAt,
        });
      }
    }
  }

  if (input.shiftsByTech) {
    for (const techId of techSet) {
      const shifts = input.shiftsByTech.get(techId) ?? [];
      for (const s of shifts) {
        if (s.entryType !== 'LEAVE' && s.entryType !== 'BLOCKED') continue;
        const sStart = new Date(s.startsAt).getTime();
        const sEnd = new Date(s.endsAt).getTime();
        if (windowsOverlap(startMs, endMs, sStart, sEnd)) {
          conflicts.push({
            kind: 'LEAVE_BLOCK',
            technicianId: techId,
            conflictingId: s.id,
            label: s.entryType === 'LEAVE' ? 'Scheduled Leave' : `Blocked (${s.notes || 'Unavailable'})`,
            startsAt: s.startsAt,
            endsAt: s.endsAt,
          });
        }
      }
    }
  }

  return conflicts;
}

/**
 * Finds the earliest conflict-free slot on `dayIso` (YYYY-MM-DD) within
 * `[workdayStartHour, workdayEndHour]` in 30-minute increments.
 */
export function suggestNextAvailableSlot(input: {
  dayIso: string;
  technicianId: string;
  durationMins: number;
  existingVisits: ReadonlyArray<{
    id: string;
    status: VisitStatus;
    scheduledStartAt: string;
    scheduledEndAt: string;
    crew: ReadonlyArray<{ technicianId: string }>;
  }>;
  shifts?: ReadonlyArray<Pick<FsmTechnicianShift, 'id' | 'entryType' | 'startsAt' | 'endsAt' | 'notes'>>;
  workdayStartHour?: number;
  workdayEndHour?: number;
  tzOffsetMinutes?: number;
}): { startAt: string; endAt: string } | null {
  const startHour = input.workdayStartHour ?? 8;
  const endHour = input.workdayEndHour ?? 18;
  const durationMs = Math.max(15, input.durationMins) * 60_000;
  const shiftsByTech = new Map([[input.technicianId, input.shifts ?? []]]);

  const [y, m, d] = input.dayIso.split('-').map(Number);
  if (!y || !m || !d) return null;

  const offsetMs = (input.tzOffsetMinutes ?? 0) * 60_000;
  const dayStartUtc = Date.UTC(y, m - 1, d, startHour, 0, 0) - offsetMs;
  const dayEndUtc = Date.UTC(y, m - 1, d, endHour, 0, 0) - offsetMs;

  for (let cursor = dayStartUtc; cursor + durationMs <= dayEndUtc; cursor += 30 * 60_000) {
    const candidateStart = new Date(cursor);
    const candidateEnd = new Date(cursor + durationMs);
    const conflicts = detectVisitConflicts({
      technicianIds: [input.technicianId],
      startAt: candidateStart,
      endAt: candidateEnd,
      existingVisits: input.existingVisits,
      shiftsByTech,
    });
    if (conflicts.length === 0) {
      return { startAt: candidateStart.toISOString(), endAt: candidateEnd.toISOString() };
    }
  }
  return null;
}

// ── Checklist & Time Helpers ─────────────────────────────────────────────────

export function evaluateChecklistCompletion(
  responses: readonly ChecklistResponseItem[],
): {
  status: 'IN_PROGRESS' | 'PASSED' | 'FAILED';
  answeredCount: number;
  totalCount: number;
  missingRequired: string[];
  failedItems: string[];
} {
  const missingRequired: string[] = [];
  const failedItems: string[] = [];
  let answeredCount = 0;

  for (const r of responses) {
    const hasValue =
      r.value !== null &&
      r.value !== undefined &&
      (typeof r.value !== 'string' || r.value.trim().length > 0);
    if (hasValue) answeredCount++;
    if (r.required && !hasValue) {
      missingRequired.push(r.label);
    }
    if (r.type === 'BOOL' && r.failOnFalse && r.value === false) {
      failedItems.push(r.label);
    }
  }

  let status: 'IN_PROGRESS' | 'PASSED' | 'FAILED' = 'IN_PROGRESS';
  if (missingRequired.length === 0 && responses.length > 0) {
    status = failedItems.length > 0 ? 'FAILED' : 'PASSED';
  }
  return { status, answeredCount, totalCount: responses.length, missingRequired, failedItems };
}

export function computeElapsedMinutes(startIso: string | null | undefined, endIso: string | Date = new Date()): number {
  if (!startIso) return 0;
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  return Math.round((e - s) / 60_000);
}

/** Standard starter checklist templates for 1-click seeding by tenants. */
export const STARTER_CHECKLIST_TEMPLATES: Array<{
  code: string;
  name: string;
  checklistType: ChecklistType;
  serviceTypeKey: string | null;
  isMandatory: boolean;
  items: ChecklistItemDef[];
}> = [
  {
    code: 'PRE_WORK_HSE_SAFETY',
    name: 'Pre-Work Safety & LOTO Checklist',
    checklistType: 'PRE_WORK_SAFETY',
    serviceTypeKey: null,
    isMandatory: true,
    items: [
      { id: 'ppe', label: 'Technician wearing required PPE (gloves, boots, hi-vis)', type: 'BOOL', required: true, failOnFalse: true },
      { id: 'loto', label: 'Power / utility isolated and Lock-Out Tag-Out applied', type: 'BOOL', required: true, failOnFalse: true },
      { id: 'hazard', label: 'Work area barricaded and free of slip/trip hazards', type: 'BOOL', required: true, failOnFalse: true },
      { id: 'permit_no', label: 'Site work permit number (if applicable)', type: 'TEXT', required: false },
    ],
  },
  {
    code: 'HVAC_PM_SOP',
    name: 'HVAC / Chiller Diagnostic & Preventive SOP',
    checklistType: 'JOB_SOP',
    serviceTypeKey: 'FM_HVAC',
    isMandatory: true,
    items: [
      { id: 'filters', label: 'Air filters inspected / cleaned / replaced', type: 'BOOL', required: true },
      { id: 'drain', label: 'Condensate drain pan & line flushed and clear', type: 'BOOL', required: true },
      { id: 'supply_temp', label: 'Supply air temperature reading (°C)', type: 'NUMBER', required: true, unit: '°C' },
      { id: 'amp_draw', label: 'Compressor current draw (Amps)', type: 'NUMBER', required: false, unit: 'A' },
      { id: 'vibration', label: 'Abnormal fan/belt noise or vibration eliminated', type: 'BOOL', required: true, failOnFalse: true },
    ],
  },
  {
    code: 'ELECTRICAL_LV_SOP',
    name: 'Electrical LV Inspection & Testing SOP',
    checklistType: 'JOB_SOP',
    serviceTypeKey: 'FM_ELECTRICAL',
    isMandatory: true,
    items: [
      { id: 'voltage', label: 'Verified phase-to-neutral supply voltage (V)', type: 'NUMBER', required: true, unit: 'V' },
      { id: 'rcd', label: 'ELCB / RCD trip test passed', type: 'BOOL', required: true, failOnFalse: true },
      { id: 'thermal', label: 'Terminals tightened — no overheating or burning odor', type: 'BOOL', required: true, failOnFalse: true },
      { id: 'panel_label', label: 'Distribution board schedule updated & door secured', type: 'BOOL', required: true },
    ],
  },
  {
    code: 'CUSTOMER_HANDOVER_QA',
    name: 'Post-Work Quality & Site Handover',
    checklistType: 'HANDOVER',
    serviceTypeKey: null,
    isMandatory: false,
    items: [
      { id: 'tested', label: 'Asset/equipment functionally tested in customer presence', type: 'BOOL', required: true, failOnFalse: true },
      { id: 'clean', label: 'Work area cleaned and debris/packaging removed', type: 'BOOL', required: true },
      { id: 'notes', label: 'Handover remarks / follow-up recommendations', type: 'TEXT', required: false },
    ],
  },
];
