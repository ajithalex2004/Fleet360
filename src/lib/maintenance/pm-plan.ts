/**
 * Preventive-maintenance plans: input checks shared by the PM plan API
 * routes. A plan is a name plus one or more triggers (every N km, days or
 * hours); the unit always follows the trigger type.
 */

export const PM_TRIGGER_TYPES = ['ODOMETER', 'CALENDAR', 'ENGINE_HOURS', 'OPERATING_HOURS', 'COMPONENT_LIFE'] as const;
export type PmTriggerTypeCode = (typeof PM_TRIGGER_TYPES)[number];

export const PM_TRIGGER_UNIT: Record<PmTriggerTypeCode, 'KM' | 'DAYS' | 'HOURS'> = {
  ODOMETER: 'KM',
  CALENDAR: 'DAYS',
  ENGINE_HOURS: 'HOURS',
  OPERATING_HOURS: 'HOURS',
  COMPONENT_LIFE: 'DAYS',
};

export const PM_MAINTENANCE_TYPES = ['PREVENTIVE', 'INSPECTION', 'CORRECTIVE', 'PREDICTIVE'] as const;

export interface PmTriggerInput {
  triggerType: PmTriggerTypeCode;
  intervalValue: number;
  intervalUnit: 'KM' | 'DAYS' | 'HOURS';
}

export interface PmPlanInput {
  name?: string;
  description?: string | null;
  maintenanceType?: string;
  gracePeriodDays?: number;
  earlyWindowDays?: number;
  earlyWindowKm?: number;
  notifyDaysBefore?: number;
  isActive?: boolean;
  triggers?: PmTriggerInput[];
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const WHOLE_FIELDS = [
  ['gracePeriodDays', 'Grace period', 365],
  ['earlyWindowDays', 'Early window (days)', 365],
  ['earlyWindowKm', 'Early window (km)', 100_000],
  ['notifyDaysBefore', 'Notify days before', 365],
] as const;

/** A whole number in [0, max]; undefined when absent, null when invalid. */
function whole(v: unknown, max: number): number | undefined | null {
  if (v === undefined) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
}

/**
 * Checks a plan body. On create (`partial` false) a name is required and
 * missing fields take their defaults; on update only the fields sent are
 * checked and returned, so a toggle of isActive leaves the rest untouched.
 * The screen asks for at least one trigger; a plan without one never fires.
 */
export function parsePmPlanInput(body: unknown, partial: boolean): Result<PmPlanInput> {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid request body' };
  const b = body as Record<string, unknown>;
  const out: PmPlanInput = {};

  if (b.name !== undefined || !partial) {
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) return { ok: false, error: 'Plan name is required' };
    out.name = name.slice(0, 200);
  }
  if (b.description !== undefined) {
    out.description = typeof b.description === 'string' && b.description.trim() ? b.description.trim().slice(0, 2000) : null;
  }
  if (b.maintenanceType !== undefined || !partial) {
    const t = b.maintenanceType ?? 'PREVENTIVE';
    if (typeof t !== 'string' || !(PM_MAINTENANCE_TYPES as readonly string[]).includes(t)) {
      return { ok: false, error: 'Unknown maintenance type' };
    }
    out.maintenanceType = t;
  }
  for (const [key, label, max] of WHOLE_FIELDS) {
    const n = whole(b[key], max);
    if (n === null) return { ok: false, error: `${label} must be a whole number between 0 and ${max}` };
    if (n !== undefined) out[key] = n;
  }
  if (b.isActive !== undefined) {
    if (typeof b.isActive !== 'boolean') return { ok: false, error: 'isActive must be true or false' };
    out.isActive = b.isActive;
  }
  if (b.triggers !== undefined || !partial) {
    const list = b.triggers ?? [];
    if (!Array.isArray(list)) return { ok: false, error: 'triggers must be a list' };
    const triggers: PmTriggerInput[] = [];
    for (const raw of list) {
      const t = (raw ?? {}) as Record<string, unknown>;
      const type = t.triggerType;
      if (typeof type !== 'string' || !(PM_TRIGGER_TYPES as readonly string[]).includes(type)) {
        return { ok: false, error: 'Unknown trigger type' };
      }
      const value = typeof t.intervalValue === 'number' ? t.intervalValue : Number(t.intervalValue);
      if (!Number.isInteger(value) || value <= 0 || value > 10_000_000) {
        return { ok: false, error: 'Each trigger needs a whole-number interval above 0' };
      }
      const triggerType = type as PmTriggerTypeCode;
      triggers.push({ triggerType, intervalValue: value, intervalUnit: PM_TRIGGER_UNIT[triggerType] });
    }
    out.triggers = triggers;
  }
  return { ok: true, data: out };
}
