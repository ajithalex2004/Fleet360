/**
 * Alert rules (alert_configs): input checks shared by the alert-config API
 * routes and the Alert Configuration screen. A rule says what to watch
 * (a vehicle or driver item), how often it recurs, and how far ahead to
 * warn.
 */

export const ALERT_TYPES = {
  Vehicle: ['Maintenance Service', 'Registration Renewal', 'Insurance Renewal', 'Permit Renewal'],
  Driver: ['License Renewal', 'Medical Certificate', 'Training Due'],
} as const;
export type AlertFor = keyof typeof ALERT_TYPES;

export const ALERT_FREQUENCIES = {
  'By Odometer': { unit: 'km', thresholds: ['Odometer Before', 'Odometer After'] },
  'By Date': { unit: 'days', thresholds: ['Days Before', 'Days After'] },
  'By Time': { unit: 'hours', thresholds: ['Hours Before', 'Hours After'] },
} as const;
export type AlertFrequency = keyof typeof ALERT_FREQUENCIES;

export interface AlertConfigInput {
  alertFor?: AlertFor;
  alertType?: string;
  frequency?: AlertFrequency;
  frequencyValue?: number;
  dueAlertThreshold?: string;
  thresholdValue?: number;
  notificationEnabled?: boolean;
  whatsappEnabled?: boolean;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const MAX_VALUE = 10_000_000;

const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;

/**
 * Checks a rule body (camelCase or the older snake_case keys). On create
 * (`partial` false) every field is required; on update only the fields
 * sent are checked and returned. Returns only known fields, so a body can
 * never set tenantId, id or timestamps. The type must belong to the
 * alertFor and the threshold to the frequency; on a partial update the
 * route re-checks the merged rule with `checkAlertConfigPair`.
 */
export function parseAlertConfigInput(body: unknown, partial: boolean): Result<AlertConfigInput> {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid request body' };
  const b = body as Record<string, unknown>;
  const get = (camel: string, snake: string) => (b[camel] !== undefined ? b[camel] : b[snake]);
  const out: AlertConfigInput = {};

  const alertFor = get('alertFor', 'alert_for');
  if (alertFor !== undefined || !partial) {
    const v = pick(alertFor, Object.keys(ALERT_TYPES) as AlertFor[]);
    if (!v) return { ok: false, error: 'Alert for must be Vehicle or Driver' };
    out.alertFor = v;
  }
  const alertType = get('alertType', 'alert_type');
  if (alertType !== undefined || !partial) {
    if (typeof alertType !== 'string' || !alertType.trim()) return { ok: false, error: 'Alert type is required' };
    out.alertType = alertType.trim();
  }
  const frequency = get('frequency', 'frequency');
  if (frequency !== undefined || !partial) {
    const v = pick(frequency, Object.keys(ALERT_FREQUENCIES) as AlertFrequency[]);
    if (!v) return { ok: false, error: 'Unknown frequency' };
    out.frequency = v;
  }
  const threshold = get('dueAlertThreshold', 'due_alert_threshold');
  if (threshold !== undefined || !partial) {
    if (typeof threshold !== 'string' || !threshold.trim()) return { ok: false, error: 'Due alert threshold is required' };
    out.dueAlertThreshold = threshold.trim();
  }
  for (const [key, snake, label] of [
    ['frequencyValue', 'frequency_value', 'Frequency value'],
    ['thresholdValue', 'threshold_value', 'Threshold value'],
  ] as const) {
    const raw = get(key, snake);
    if (raw === undefined && partial) continue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > MAX_VALUE) {
      return { ok: false, error: `${label} must be a whole number between 0 and ${MAX_VALUE.toLocaleString('en')}` };
    }
    out[key] = n;
  }
  for (const [key, snake] of [
    ['notificationEnabled', 'notification_enabled'],
    ['whatsappEnabled', 'whatsapp_enabled'],
  ] as const) {
    const raw = get(key, snake);
    if (raw === undefined) {
      if (!partial) out[key] = false;
      continue;
    }
    if (typeof raw !== 'boolean') return { ok: false, error: `${key} must be true or false` };
    out[key] = raw;
  }

  const pair = checkAlertConfigPair(out);
  return pair ? { ok: false, error: pair } : { ok: true, data: out };
}

/**
 * The type must be one listed for its alertFor, and the threshold one
 * listed for its frequency. Checks only the pairs whose both halves are
 * present. Returns an error message, or null when consistent.
 */
export function checkAlertConfigPair(c: {
  alertFor?: string | null; alertType?: string | null; frequency?: string | null; dueAlertThreshold?: string | null;
}): string | null {
  if (c.alertFor && c.alertType) {
    const types = (ALERT_TYPES as Record<string, readonly string[]>)[c.alertFor];
    if (types && !types.includes(c.alertType)) return `${c.alertType} is not a ${c.alertFor} alert`;
  }
  if (c.frequency && c.dueAlertThreshold) {
    const f = (ALERT_FREQUENCIES as Record<string, { thresholds: readonly string[] }>)[c.frequency];
    if (f && !f.thresholds.includes(c.dueAlertThreshold)) return `${c.dueAlertThreshold} does not match ${c.frequency}`;
  }
  return null;
}
