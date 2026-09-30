/**
 * Maintenance analytics from the tenant's maintenance requests. Pure: the
 * API route loads the rows, this turns them into the figures the
 * Maintenance Analytics screen shows. Costs are actual (invoiced) costs
 * only; estimates never count.
 */

export const ANALYTICS_PERIODS = [3, 6, 12] as const;
export type AnalyticsMonths = (typeof ANALYTICS_PERIODS)[number];

/** Statuses after which a request no longer holds a vehicle. */
const FINISHED = new Set([
  'Maintenance Completed', 'Completed', 'Closed', 'Ready For Service', 'Pending Invoice', 'Invoice Submitted',
  'Rejected', 'Rejected By Maintenance', 'Cancelled', 'CANCELLED', 'COMPLETED', 'CLOSED', 'REJECTED',
]);

export interface AnalyticsRow {
  vehicleId: string | null;
  maintenanceType: string | null;
  status: string | null;
  requestDate: Date | null;
  completionDate: Date | null;
  createdAt: Date | null;
  actualCost: number | null;
  maintenanceJobs: string[];
}

export interface MaintenanceAnalytics {
  months: AnalyticsMonths;
  from: string;
  requests: number;
  completed: number;
  openRequests: number;
  vehiclesServiced: number;
  totalCost: number;
  avgCostPerVehicle: number | null;
  downtimeDays: number | null;
  costByMonth: Array<{ month: string; label: string; cost: number }>;
  byType: Array<{ type: string; count: number; pct: number }>;
  topJobs: Array<{ job: string; occurrences: number; avgCost: number | null }>;
}

const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** First day (UTC) of the month `months - 1` months before `now`'s month. */
export function periodStart(now: Date, months: AnalyticsMonths): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
}

export const parseMonths = (v: string | null): AnalyticsMonths => {
  const n = Number(v);
  return (ANALYTICS_PERIODS as readonly number[]).includes(n) ? (n as AnalyticsMonths) : 6;
};

const round = (n: number, dp = 0) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * `rows` are the requests dated inside the period (by completion, else
 * request, else creation date) plus any still open. A request's cost and
 * month come from that same date.
 */
export function summariseMaintenance(rows: AnalyticsRow[], now: Date, months: AnalyticsMonths): MaintenanceAnalytics {
  const from = periodStart(now, months);
  const dated = (r: AnalyticsRow) => r.completionDate ?? r.requestDate ?? r.createdAt;
  const inPeriod = rows.filter((r) => {
    const d = dated(r);
    return d != null && d >= from && d <= now;
  });

  const costByMonth = Array.from({ length: months }, (_, i) => {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1));
    return { month: monthKey(d), label: `${MONTH_LABEL[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`, cost: 0 };
  });
  const monthIndex = new Map(costByMonth.map((m, i) => [m.month, i]));

  let totalCost = 0;
  const costedVehicles = new Set<string>();
  const serviced = new Set<string>();
  const types = new Map<string, number>();
  const jobs = new Map<string, { occurrences: number; cost: number; costed: number }>();
  let completed = 0;
  let downtimeMs = 0;
  let downtimeCount = 0;

  for (const r of inPeriod) {
    const cost = r.actualCost != null && Number.isFinite(r.actualCost) ? r.actualCost : null;
    if (r.vehicleId) serviced.add(r.vehicleId);
    if (cost != null) {
      totalCost += cost;
      if (r.vehicleId) costedVehicles.add(r.vehicleId);
      const i = monthIndex.get(monthKey(dated(r)!));
      if (i !== undefined) costByMonth[i].cost += cost;
    }
    const type = (r.maintenanceType || 'UNSPECIFIED').toUpperCase();
    types.set(type, (types.get(type) ?? 0) + 1);
    for (const raw of r.maintenanceJobs ?? []) {
      const job = raw.trim();
      if (!job) continue;
      const j = jobs.get(job) ?? { occurrences: 0, cost: 0, costed: 0 };
      j.occurrences += 1;
      if (cost != null) { j.cost += cost; j.costed += 1; }
      jobs.set(job, j);
    }
    if (r.completionDate) {
      completed += 1;
      const start = r.requestDate ?? r.createdAt;
      if (start && r.completionDate > start) {
        downtimeMs += r.completionDate.getTime() - start.getTime();
        downtimeCount += 1;
      }
    }
  }

  const openRequests = rows.filter((r) => !r.completionDate && !FINISHED.has(r.status ?? '')).length;
  const total = inPeriod.length;

  return {
    months,
    from: from.toISOString(),
    requests: total,
    completed,
    openRequests,
    vehiclesServiced: serviced.size,
    totalCost: round(totalCost, 2),
    avgCostPerVehicle: costedVehicles.size ? round(totalCost / costedVehicles.size) : null,
    downtimeDays: downtimeCount ? round(downtimeMs / 86_400_000, 1) : null,
    costByMonth: costByMonth.map((m) => ({ ...m, cost: round(m.cost, 2) })),
    byType: [...types.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count, pct: total ? round((count / total) * 100) : 0 })),
    topJobs: [...jobs.entries()]
      .sort((a, b) => b[1].occurrences - a[1].occurrences || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([job, j]) => ({ job, occurrences: j.occurrences, avgCost: j.costed ? round(j.cost / j.costed) : null })),
  };
}
