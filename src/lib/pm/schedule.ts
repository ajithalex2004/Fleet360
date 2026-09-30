/**
 * The tenant-wide PM schedule: for every active plan and every vehicle it
 * applies to, when the next service is due.
 *
 * The baseline for each plan/vehicle pair is, in order:
 *   1. its pm_schedule_items row, when one exists;
 *   2. the vehicle's latest completed maintenance request for that plan
 *      (requests made from the schedule carry the plan name as their job);
 *   3. nothing: the pair is listed as "no service on record" rather than
 *      being given an invented date or odometer.
 * Pure: the API route loads the rows.
 */
import { calculateDue } from '@/lib/pm/due-calculator';
import { PMItemStatus, PMTriggerType, type MaintenancePlan, type PMTrigger } from '@/types/maintenance';

export const NO_HISTORY = 'NO_HISTORY' as const;
export type ScheduleStatus = PMItemStatus.OVERDUE | PMItemStatus.DUE | PMItemStatus.UPCOMING | typeof NO_HISTORY;

export interface SchedulePlan {
  id: string;
  name: string;
  maintenanceType: string | null;
  applicability: unknown;
  gracePeriodDays: number | null;
  earlyWindowDays: number | null;
  earlyWindowKm: number | null;
  triggers: Array<{ id: string; triggerType: string; intervalValue: number; intervalUnit: string }>;
}
export interface ScheduleVehicle {
  id: string;
  licensePlate: string | null;
  make: string | null;
  model: string | null;
  type: string | null;
  odometerKm: number | null;
}
export interface ScheduleRequest {
  id: string;
  vehicleId: string | null;
  maintenanceJobs: string[];
  completionDate: Date | null;
  requestDate: Date | null;
  createdAt: Date | null;
  odometer: number | null;
  status: string | null;
}
export interface ScheduleItemRow {
  planId: string;
  vehicleId: string;
  lastServiceDate: Date | null;
  lastOdometerKm: number | null;
  nextDueDateCalc: Date | null;
  nextDueOdometerKm: number | null;
  status: string;
}

export interface ScheduleEntry {
  id: string;
  planId: string;
  planName: string;
  vehicleId: string;
  vehiclePlate: string;
  vehicleModel: string;
  status: ScheduleStatus;
  triggeringFactor: 'ODOMETER' | 'CALENDAR' | 'BOTH' | 'NONE';
  daysUntilDue?: number;
  kmUntilDue?: number;
  urgencyScore: number;
  lastServiceDate?: string;
  lastOdometerKm?: number;
  /** An open request already raised for this plan and vehicle. */
  openRequestId?: string;
}

/** Statuses after which a request no longer counts as open. */
const FINISHED = new Set(['MAINTENANCE COMPLETED', 'COMPLETED', 'CLOSED', 'READY FOR SERVICE', 'PENDING INVOICE',
  'INVOICE SUBMITTED', 'REJECTED', 'REJECTED BY MAINTENANCE', 'CANCELLED']);
const isOpen = (r: ScheduleRequest) => !r.completionDate && !FINISHED.has((r.status ?? '').replace(/_/g, ' ').toUpperCase());

/** Whether a plan covers a vehicle (all vehicles, listed ids, or listed types). */
export function planApplies(applicability: unknown, v: ScheduleVehicle): boolean {
  const a = (applicability && typeof applicability === 'object' ? applicability : { allVehicles: true }) as {
    allVehicles?: boolean; vehicleIds?: unknown; vehicleTypes?: unknown;
  };
  if (a.allVehicles !== false) return true;
  if (Array.isArray(a.vehicleIds) && a.vehicleIds.includes(v.id)) return true;
  if (Array.isArray(a.vehicleTypes) && v.type && a.vehicleTypes.includes(v.type)) return true;
  return false;
}

/** The job name that ties a maintenance request to a plan. */
export const planJob = (planName: string) => planName.trim();

export function buildPmSchedule(args: {
  plans: SchedulePlan[];
  vehicles: ScheduleVehicle[];
  requests: ScheduleRequest[];
  items: ScheduleItemRow[];
  now?: Date;
}): ScheduleEntry[] {
  const now = args.now ?? new Date();
  const itemByPair = new Map(args.items.map((i) => [`${i.planId}:${i.vehicleId}`, i]));
  const out: ScheduleEntry[] = [];

  for (const plan of args.plans) {
    const job = planJob(plan.name).toLowerCase();
    const forPlan = args.requests.filter((r) => r.maintenanceJobs.some((j) => j.trim().toLowerCase() === job));
    const typedPlan: MaintenancePlan = {
      id: plan.id,
      tenantId: '',
      name: plan.name,
      maintenanceType: (plan.maintenanceType ?? 'PREVENTIVE') as MaintenancePlan['maintenanceType'],
      applicability: { allVehicles: true },
      gracePeriodDays: plan.gracePeriodDays ?? undefined,
      earlyWindowDays: plan.earlyWindowDays ?? undefined,
      earlyWindowKm: plan.earlyWindowKm ?? undefined,
      isActive: true,
      triggers: plan.triggers.map((t) => ({
        id: t.id, planId: plan.id, triggerType: t.triggerType as PMTriggerType,
        intervalValue: t.intervalValue, intervalUnit: t.intervalUnit as PMTrigger['intervalUnit'],
      })),
    };

    for (const v of args.vehicles) {
      if (!planApplies(plan.applicability, v)) continue;
      const mine = forPlan.filter((r) => r.vehicleId === v.id);
      const open = mine.find(isOpen);
      const lastDone = mine
        .filter((r) => r.completionDate)
        .sort((a, b) => b.completionDate!.getTime() - a.completionDate!.getTime())[0];
      const row = itemByPair.get(`${plan.id}:${v.id}`);

      const lastServiceDate = row?.lastServiceDate ?? lastDone?.completionDate ?? null;
      const lastOdometerKm = row?.lastOdometerKm ?? lastDone?.odometer ?? null;
      const base = {
        id: `${plan.id}:${v.id}`,
        planId: plan.id,
        planName: plan.name,
        vehicleId: v.id,
        vehiclePlate: v.licensePlate || v.id,
        vehicleModel: [v.make, v.model].filter(Boolean).join(' '),
        ...(open ? { openRequestId: open.id } : {}),
      };

      if (!row && !lastDone) {
        out.push({ ...base, status: NO_HISTORY, triggeringFactor: 'NONE', urgencyScore: 0 });
        continue;
      }

      const calc = calculateDue(
        {
          id: base.id, tenantId: '', planId: plan.id, vehicleId: v.id,
          lastServiceDate: lastServiceDate?.toISOString(),
          lastOdometerKm: lastOdometerKm ?? undefined,
          nextDueDateCalc: row?.nextDueDateCalc?.toISOString(),
          nextDueOdometerKm: row?.nextDueOdometerKm ?? undefined,
          status: PMItemStatus.UPCOMING,
        },
        typedPlan,
        // Without a current reading the odometer trigger can't be judged;
        // using the last-service reading leaves it as "not yet due".
        { id: v.id, currentOdometerKm: v.odometerKm ?? lastOdometerKm ?? 0 },
        now,
      );
      out.push({
        ...base,
        status: calc.effectiveStatus as ScheduleStatus,
        triggeringFactor: calc.triggeringFactor,
        ...(calc.daysUntilDue !== undefined ? { daysUntilDue: calc.daysUntilDue } : {}),
        ...(calc.kmUntilDue !== undefined ? { kmUntilDue: calc.kmUntilDue } : {}),
        urgencyScore: Math.round(calc.urgencyScore),
        ...(lastServiceDate ? { lastServiceDate: lastServiceDate.toISOString() } : {}),
        ...(lastOdometerKm != null ? { lastOdometerKm } : {}),
      });
    }
  }
  return out.sort((a, b) => b.urgencyScore - a.urgencyScore);
}

/** The maintenance-request body for servicing a vehicle under a plan. */
export function pmRequestBody(entry: Pick<ScheduleEntry, 'vehicleId' | 'planName' | 'status' | 'daysUntilDue' | 'kmUntilDue'>) {
  const reason =
    entry.status === PMItemStatus.OVERDUE ? 'overdue'
    : entry.status === PMItemStatus.DUE ? 'due soon'
    : entry.status === NO_HISTORY ? 'no service on record'
    : 'scheduled';
  return {
    vehicleId: entry.vehicleId,
    description: `Preventive maintenance — ${entry.planName} (${reason})`,
    maintenanceType: 'PREVENTIVE',
    priority: entry.status === PMItemStatus.OVERDUE ? 'HIGH' : 'MEDIUM',
    status: 'Requested',
    maintenanceJobs: [planJob(entry.planName)],
  };
}
