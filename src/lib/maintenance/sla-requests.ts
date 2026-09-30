/**
 * Turns maintenance requests as the API returns them into the shape the SLA
 * engine reads: a status timeline built from each request's status history,
 * with statuses matched however they were written ("Under Maintenance",
 * "UNDER_MAINTENANCE", "under maintenance") and priority/type upper-cased.
 * Pure; used by the SLA screen.
 */
import { MaintenanceStatus, type MaintenanceRequest } from '@/types/maintenance';

/** Requests finished longer ago than this drop off the SLA screen. */
export const SLA_RECENT_DAYS = 30;

const norm = (s: string) => s.replace(/[_-]+/g, ' ').trim().toLowerCase();
const STATUS_BY_TEXT = new Map<string, MaintenanceStatus>();
for (const [key, value] of Object.entries(MaintenanceStatus)) {
  STATUS_BY_TEXT.set(norm(key), value);
  STATUS_BY_TEXT.set(norm(value), value);
}
export const toMaintenanceStatus = (s: unknown): MaintenanceStatus | null =>
  typeof s === 'string' ? STATUS_BY_TEXT.get(norm(s)) ?? null : null;

const FINISHED = new Set<MaintenanceStatus>([
  MaintenanceStatus.MAINTENANCE_COMPLETED, MaintenanceStatus.COMPLETED, MaintenanceStatus.CLOSED,
  MaintenanceStatus.REJECTED, MaintenanceStatus.REJECTED_BY_MAINTENANCE,
]);

const iso = (v: unknown): string | undefined => {
  if (typeof v !== 'string' && !(v instanceof Date)) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

export interface SlaRequestRow {
  id: string;
  workOrderNo?: string | null;
  description?: string | null;
  vehicleId?: string | null;
  status?: string | null;
  priority?: string | null;
  maintenanceType?: string | null;
  requestDate?: string | null;
  createdAt?: string | null;
  completionDate?: string | null;
  histories?: Array<{ status?: string | null; date?: string | null; createdAt?: string | null }>;
}

/** The request in the SLA engine's shape, with its earliest time in each status. */
export function toSlaRequest(r: SlaRequestRow): MaintenanceRequest {
  const timeline: Partial<Record<MaintenanceStatus, string>> = {};
  for (const h of r.histories ?? []) {
    const status = toMaintenanceStatus(h.status);
    const at = iso(h.date) ?? iso(h.createdAt);
    if (!status || !at) continue;
    if (!timeline[status] || at < timeline[status]!) timeline[status] = at;
  }
  const completed = iso(r.completionDate);
  if (completed && !timeline[MaintenanceStatus.MAINTENANCE_COMPLETED] && !timeline[MaintenanceStatus.COMPLETED]) {
    timeline[MaintenanceStatus.MAINTENANCE_COMPLETED] = completed;
  }
  return {
    id: r.id,
    workOrderNo: r.workOrderNo ?? undefined,
    description: r.description ?? '',
    vehicleId: r.vehicleId ?? '',
    status: toMaintenanceStatus(r.status) ?? MaintenanceStatus.REQUESTED,
    priority: (r.priority ?? 'MEDIUM').toUpperCase(),
    maintenanceType: (r.maintenanceType ?? '').toUpperCase(),
    requestDate: iso(r.requestDate) ?? iso(r.createdAt),
    completionDate: completed,
    statusTimeline: timeline,
  } as unknown as MaintenanceRequest;
}

/** Open requests, plus those finished within the last SLA_RECENT_DAYS. */
export function isSlaMonitored(r: SlaRequestRow, now: Date = new Date()): boolean {
  const status = toMaintenanceStatus(r.status);
  const done = iso(r.completionDate);
  if (!done && !(status && FINISHED.has(status))) return true;
  const at = done ?? iso(r.requestDate) ?? iso(r.createdAt);
  return !!at && now.getTime() - new Date(at).getTime() <= SLA_RECENT_DAYS * 86_400_000;
}
