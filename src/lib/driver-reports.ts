/**
 * src/lib/driver-reports.ts
 *
 * Driver reports — the type catalogue, state machine, and small UI
 * helpers for the "Request" / "Incident" surface in the driver app.
 *
 * Two kinds:
 *   - REQUEST  — a service ask from the driver (maintenance, renewal,
 *                washing, etc.). The dispatcher reviews and acts.
 *                Each request type has its own sub-type catalogue
 *                (e.g. MAINTENANCE → PREVENTIVE / CORRECTIVE / …).
 *   - INCIDENT — a factual event that happened (accident, breakdown,
 *                traffic delay, passenger complaint). Logged for the
 *                audit trail and for the dispatcher dashboard.
 *                Each incident type has a default severity
 *                (e.g. ACCIDENT → HIGH) that the driver can override.
 *
 * Lifecycle:
 *   OPEN → ACK (dispatcher saw it) → IN_PROGRESS (work started)
 *                                  → RESOLVED (work done)
 *        or CANCELLED (driver or dispatcher withdraws)
 *
 * The driver can only:
 *   - Create a report (any kind) — starts at OPEN
 *   - Cancel their own OPEN reports
 *
 * The dispatcher / tenant admin can:
 *   - ACK      — OPEN → ACK
 *   - PROGRESS — ACK → IN_PROGRESS
 *   - RESOLVE  — IN_PROGRESS → RESOLVED
 *   - CANCEL   — any → CANCELLED (with reason)
 *
 * Severity is for incidents only. NULL for requests. The dispatcher
 * dashboard sorts OPEN reports by severity so HIGH / CRITICAL
 * incidents surface first.
 */

export const REQUEST_TYPES = ['MAINTENANCE', 'RENEWAL', 'WASHING'] as const;
export const INCIDENT_TYPES = [
  'ACCIDENT',
  'BREAKDOWN',
  'TRAFFIC_DELAY',
  'PASSENGER_COMPLAINT',
] as const;
export const INCIDENT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const REPORT_STATUSES = ['OPEN', 'ACK', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED'] as const;

// ── Request sub-type catalogues ────────────────────────────────────────────
// Every REQUEST type has its own sub-type set. The form shows the right
// picker when a request type is selected. sub-type is optional but
// strongly encouraged — the dispatcher uses it to route work (e.g.
// PREVENTIVE goes to the maintenance planner, INSURANCE goes to
// the fleet admin).

export const MAINTENANCE_SUBTYPES = [
  'PREVENTIVE',          // routine check / service
  'CORRECTIVE',          // fix a known issue (not breakdown)
  'SCHEDULED',           // planned service window (e.g. oil change)
  'BREAKDOWN_ACCIDENT',  // post-event repair from a breakdown / accident
] as const;

export const RENEWAL_SUBTYPES = [
  'INSURANCE',
  'REGISTRATION',
  'LICENSE',
  'PERMITS_CERTIFICATIONS',  // operating permits, fitness certs, etc.
] as const;

export const WASHING_SUBTYPES = [
  'BODY_WASH',   // exterior only
  'FULL_WASH',   // exterior + interior
  'INTERIOR',
  'EXTERIOR',
] as const;

export type MaintenanceSubtype = typeof MAINTENANCE_SUBTYPES[number];
export type RenewalSubtype     = typeof RENEWAL_SUBTYPES[number];
export type WashingSubtype     = typeof WASHING_SUBTYPES[number];
export type RequestSubtype     = MaintenanceSubtype | RenewalSubtype | WashingSubtype;

export function isMaintenanceSubtype(s: string): s is MaintenanceSubtype {
  return (MAINTENANCE_SUBTYPES as readonly string[]).includes(s);
}
export function isRenewalSubtype(s: string): s is RenewalSubtype {
  return (RENEWAL_SUBTYPES as readonly string[]).includes(s);
}
export function isWashingSubtype(s: string): s is WashingSubtype {
  return (WASHING_SUBTYPES as readonly string[]).includes(s);
}
export function isRequestSubtype(s: string): s is RequestSubtype {
  return isMaintenanceSubtype(s) || isRenewalSubtype(s) || isWashingSubtype(s);
}

/**
 * Return the sub-type catalogue that applies to a given request type.
 * Returns null for incident types (which don't have sub-types).
 */
export function getRequestSubtypeCatalogue(type: ReportType): readonly RequestSubtype[] | null {
  if (type === 'MAINTENANCE') return MAINTENANCE_SUBTYPES;
  if (type === 'RENEWAL')     return RENEWAL_SUBTYPES;
  if (type === 'WASHING')     return WASHING_SUBTYPES;
  return null;
}

export type ReportKind = 'REQUEST' | 'INCIDENT';
export type RequestType = typeof REQUEST_TYPES[number];
export type IncidentType = typeof INCIDENT_TYPES[number];
export type ReportType = RequestType | IncidentType;
export type Severity = typeof INCIDENT_SEVERITIES[number];
export type ReportStatus = typeof REPORT_STATUSES[number];

export function isRequestType(t: string): t is RequestType {
  return (REQUEST_TYPES as readonly string[]).includes(t);
}
export function isIncidentType(t: string): t is IncidentType {
  return (INCIDENT_TYPES as readonly string[]).includes(t);
}
export function isReportType(t: string): t is ReportType {
  return isRequestType(t) || isIncidentType(t);
}
export function isSeverity(s: string): s is Severity {
  return (INCIDENT_SEVERITIES as readonly string[]).includes(s);
}
export function isReportStatus(s: string): s is ReportStatus {
  return (REPORT_STATUSES as readonly string[]).includes(s);
}

/**
 * Default severity for an incident type. The form uses this to
 * pre-select the severity chip; the driver can always override
 * (e.g. a "major" accident bumps HIGH → CRITICAL).
 *
 *   ACCIDENT, BREAKDOWN            → HIGH
 *   TRAFFIC_DELAY, PASSENGER_COMPLAINT → LOW
 *
 * Returns null if the input isn't an incident type.
 */
export function defaultSeverity(incidentType: string): Severity | null {
  if (incidentType === 'ACCIDENT' || incidentType === 'BREAKDOWN') return 'HIGH';
  if (incidentType === 'TRAFFIC_DELAY' || incidentType === 'PASSENGER_COMPLAINT') return 'LOW';
  return null;
}

// ──────────────────────────────────────────────────────────────────────
// Per-type UI metadata — emoji + short label for the report form + list
// ──────────────────────────────────────────────────────────────────────

export interface ReportTypeMeta {
  emoji: string;
  label: string;
  hint: string;  // short description shown in the form
}

export const REQUEST_TYPE_META: Record<RequestType, ReportTypeMeta> = {
  MAINTENANCE: { emoji: '🔧', label: 'Maintenance',  hint: 'Engine, brakes, tires, or other mechanical issue' },
  RENEWAL:     { emoji: '📄', label: 'Renewal',      hint: 'Insurance, registration, or document renewal' },
  WASHING:     { emoji: '🧼', label: 'Washing',      hint: 'Vehicle needs a wash' },
};

export const INCIDENT_TYPE_META: Record<IncidentType, ReportTypeMeta> = {
  ACCIDENT:            { emoji: '🚨', label: 'Accident',           hint: 'Traffic accident — please provide location' },
  BREAKDOWN:           { emoji: '⚙️', label: 'Breakdown',          hint: 'Mechanical failure or vehicle not moving' },
  TRAFFIC_DELAY:       { emoji: '🚦', label: 'Traffic delay',      hint: 'Significant delay due to traffic' },
  PASSENGER_COMPLAINT: { emoji: '👤', label: 'Passenger complaint', hint: 'A passenger raised a concern' },
};

export const SEVERITY_META: Record<Severity, { label: string; cls: string; emoji: string }> = {
  LOW:      { label: 'Low',      cls: 'bg-slate-500/15 text-slate-300',      emoji: '·' },
  MEDIUM:   { label: 'Medium',   cls: 'bg-amber-500/15 text-amber-300',       emoji: '!' },
  HIGH:     { label: 'High',     cls: 'bg-orange-500/15 text-orange-300',     emoji: '!!' },
  CRITICAL: { label: 'Critical', cls: 'bg-rose-500/15 text-rose-300',         emoji: '!!!' },
};

export const STATUS_META: Record<ReportStatus, { label: string; cls: string }> = {
  OPEN:        { label: 'Open',        cls: 'bg-sky-500/15 text-sky-300' },
  ACK:         { label: 'Acknowledged', cls: 'bg-violet-500/15 text-violet-300' },
  IN_PROGRESS: { label: 'In progress', cls: 'bg-amber-500/15 text-amber-300' },
  RESOLVED:    { label: 'Resolved',    cls: 'bg-emerald-500/15 text-emerald-300' },
  CANCELLED:   { label: 'Cancelled',   cls: 'bg-slate-500/15 text-slate-300' },
};

export function getTypeMeta(kind: ReportKind, type: string): ReportTypeMeta | null {
  if (kind === 'REQUEST' && isRequestType(type)) return REQUEST_TYPE_META[type];
  if (kind === 'INCIDENT' && isIncidentType(type)) return INCIDENT_TYPE_META[type];
  return null;
}

// ──────────────────────────────────────────────────────────────────────
// Sub-type UI metadata — short label + hint for the form pickers
// ──────────────────────────────────────────────────────────────────────

export const MAINTENANCE_SUBTYPE_META: Record<MaintenanceSubtype, ReportTypeMeta> = {
  PREVENTIVE:        { emoji: '🧰', label: 'Preventive',                hint: 'Routine check / service before something fails' },
  CORRECTIVE:        { emoji: '🔩', label: 'Corrective',                hint: 'Fix a known issue that is not a breakdown' },
  SCHEDULED:         { emoji: '📅', label: 'Scheduled',                 hint: 'Planned service window (oil change, tyre rotation, …)' },
  BREAKDOWN_ACCIDENT:{ emoji: '🚧', label: 'Breakdown / Accident repair', hint: 'Post-event repair from a breakdown or accident' },
};

export const RENEWAL_SUBTYPE_META: Record<RenewalSubtype, ReportTypeMeta> = {
  INSURANCE:               { emoji: '🛡️', label: 'Insurance',                 hint: 'Vehicle insurance renewal' },
  REGISTRATION:            { emoji: '🚗', label: 'Registration',              hint: 'Vehicle / fleet registration' },
  LICENSE:                 { emoji: '🪪', label: 'License',                   hint: 'Operating / commercial license' },
  PERMITS_CERTIFICATIONS:  { emoji: '📜', label: 'Permits & Certifications',  hint: 'Operating permits, fitness certificates, …' },
};

export const WASHING_SUBTYPE_META: Record<WashingSubtype, ReportTypeMeta> = {
  BODY_WASH:  { emoji: '🧽', label: 'Body wash',   hint: 'Exterior only, light clean' },
  FULL_WASH:  { emoji: '🛁', label: 'Full wash',   hint: 'Exterior + interior, top to bottom' },
  INTERIOR:   { emoji: '🪟', label: 'Interior',    hint: 'Seats, dashboard, inside windows' },
  EXTERIOR:   { emoji: '🚙', label: 'Exterior',    hint: 'Body, wheels, outside windows' },
};

export function getSubtypeMeta(subtype: string): ReportTypeMeta | null {
  if (isMaintenanceSubtype(subtype)) return MAINTENANCE_SUBTYPE_META[subtype];
  if (isRenewalSubtype(subtype))     return RENEWAL_SUBTYPE_META[subtype];
  if (isWashingSubtype(subtype))     return WASHING_SUBTYPE_META[subtype];
  return null;
}

// ──────────────────────────────────────────────────────────────────────
// State machine
// ──────────────────────────────────────────────────────────────────────

export interface TransitionInput {
  currentStatus: ReportStatus;
  action: 'ACK' | 'PROGRESS' | 'RESOLVE' | 'CANCEL' | 'REOPEN';
}

export interface TransitionResult {
  allowed: boolean;
  nextStatus?: ReportStatus;
  reason?: string;
}

export function evaluateReportTransition(input: TransitionInput): TransitionResult {
  const { currentStatus, action } = input;

  if (action === 'ACK') {
    if (currentStatus === 'OPEN') return { allowed: true, nextStatus: 'ACK' };
    if (currentStatus === 'ACK') return { allowed: true, nextStatus: 'ACK' }; // idempotent
    if (currentStatus === 'IN_PROGRESS') return { allowed: false, reason: 'Already in progress' };
    if (currentStatus === 'RESOLVED') return { allowed: false, reason: 'Already resolved' };
    if (currentStatus === 'CANCELLED') return { allowed: false, reason: 'Report was cancelled' };
  }
  if (action === 'PROGRESS') {
    if (currentStatus === 'ACK') return { allowed: true, nextStatus: 'IN_PROGRESS' };
    if (currentStatus === 'IN_PROGRESS') return { allowed: true, nextStatus: 'IN_PROGRESS' };
    if (currentStatus === 'OPEN') return { allowed: false, reason: 'Acknowledge the report first' };
    if (currentStatus === 'RESOLVED') return { allowed: false, reason: 'Already resolved' };
    if (currentStatus === 'CANCELLED') return { allowed: false, reason: 'Report was cancelled' };
  }
  if (action === 'RESOLVE') {
    if (currentStatus === 'IN_PROGRESS') return { allowed: true, nextStatus: 'RESOLVED' };
    if (currentStatus === 'RESOLVED') return { allowed: true, nextStatus: 'RESOLVED' };
    if (currentStatus === 'ACK') return { allowed: false, reason: 'Mark in progress first' };
    if (currentStatus === 'OPEN') return { allowed: false, reason: 'Acknowledge the report first' };
    if (currentStatus === 'CANCELLED') return { allowed: false, reason: 'Report was cancelled' };
  }
  if (action === 'CANCEL') {
    // CANCEL is allowed only from OPEN or CANCELLED. Once the
    // dispatcher has acknowledged (ACK), progressed, or resolved
    // the report, the driver should reach out via the in-app chat
    // — silently cancelling would lose context.
    if (currentStatus === 'OPEN') return { allowed: true, nextStatus: 'CANCELLED' };
    if (currentStatus === 'CANCELLED') return { allowed: true, nextStatus: 'CANCELLED' }; // idempotent
    if (currentStatus === 'ACK') return { allowed: false, reason: 'Dispatcher has already seen this report. Contact them via chat to withdraw.' };
    if (currentStatus === 'IN_PROGRESS') return { allowed: false, reason: 'Dispatcher is already working on this report. Contact them via chat to withdraw.' };
    if (currentStatus === 'RESOLVED') return { allowed: false, reason: 'Report is resolved and cannot be cancelled' };
  }
  if (action === 'REOPEN') {
    // Not implemented — reports are terminal. Leave for a future iteration.
    return { allowed: false, reason: 'REOPEN not supported; create a new report' };
  }
  return { allowed: false, reason: `Unknown action: ${action}` };
}
