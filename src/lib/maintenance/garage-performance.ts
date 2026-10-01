/**
 * Garage performance from the tenant's own maintenance requests. Pure: the
 * API route loads each garage's requests (with status history and quality
 * inspections), this turns them into the scorecard. A figure with nothing
 * to measure it from is null ("—" on screen), never a default.
 */

export const GARAGE_PERIOD_MONTHS = 12;

export interface GarageJob {
  garageId: string;
  garageName: string | null;
  requestDate: Date | null;
  createdAt: Date | null;
  completionDate: Date | null;
  expectedEndDate: Date | null;
  estimatedCost: number | null;
  actualCost: number | null;
  /** Status history (any spelling). */
  histories: Array<{ status: string | null; date: Date | null }>;
  /** Quality inspections: PASS | FAIL | PENDING. */
  inspections: Array<{ overallResult: string; inspectedAt: Date | null; createdAt: Date }>;
}

export interface GarageScorecard {
  garageId: string;
  garageName: string;
  totalJobs: number;
  completedJobs: number;
  avgCompletionDays: number | null;
  avgActualCost: number | null;
  /** Average of (actual − estimate) / estimate over jobs with both; negative = under estimate. */
  costVariancePct: number | null;
  /** Share of completed jobs with a promised date that finished by it. */
  onTimeRate: number | null;
  /** Share of inspected jobs whose first inspection passed. */
  qcFirstPassRate: number | null;
  /** Average hours from request to the garage accepting it. */
  responseHours: number | null;
  /** Mean of on-time rate and first-pass rate, whichever exist. */
  overallScore: number | null;
}

const round = (n: number, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const isAccepted = (s: string | null) => (s ?? '').replace(/[_-]+/g, ' ').trim().toLowerCase() === 'accepted';

export function scoreGarages(jobs: GarageJob[]): GarageScorecard[] {
  const byGarage = new Map<string, GarageJob[]>();
  for (const j of jobs) byGarage.set(j.garageId, [...(byGarage.get(j.garageId) ?? []), j]);

  const cards: GarageScorecard[] = [];
  for (const [garageId, list] of byGarage) {
    const completed = list.filter((j) => j.completionDate);
    const start = (j: GarageJob) => j.requestDate ?? j.createdAt;

    const days = completed
      .map((j) => (start(j) ? (j.completionDate!.getTime() - start(j)!.getTime()) / 86_400_000 : null))
      .filter((d): d is number => d != null && d >= 0);
    const costs = list.map((j) => j.actualCost).filter((c): c is number => c != null && c > 0);
    const variances = list
      .filter((j) => j.actualCost != null && j.estimatedCost != null && j.estimatedCost > 0)
      .map((j) => ((j.actualCost! - j.estimatedCost!) / j.estimatedCost!) * 100);
    const promised = completed.filter((j) => j.expectedEndDate);
    const onTime = promised.filter((j) => j.completionDate! <= j.expectedEndDate!);
    const inspected = list
      .map((j) => j.inspections.filter((i) => i.overallResult === 'PASS' || i.overallResult === 'FAIL')
        .sort((a, b) => (a.inspectedAt ?? a.createdAt).getTime() - (b.inspectedAt ?? b.createdAt).getTime())[0])
      .filter((i): i is GarageJob['inspections'][number] => !!i);
    const responses = list
      .map((j) => {
        const acc = j.histories.filter((h) => isAccepted(h.status) && h.date).map((h) => h.date!.getTime()).sort((a, b) => a - b)[0];
        return acc != null && start(j) ? (acc - start(j)!.getTime()) / 3_600_000 : null;
      })
      .filter((h): h is number => h != null && h >= 0);

    const onTimeRate = promised.length ? round((onTime.length / promised.length) * 100, 0) : null;
    const qcFirstPassRate = inspected.length ? round((inspected.filter((i) => i.overallResult === 'PASS').length / inspected.length) * 100, 0) : null;
    const parts = [onTimeRate, qcFirstPassRate].filter((x): x is number => x != null);

    const d = avg(days), c = avg(costs), v = avg(variances), r = avg(responses);
    cards.push({
      garageId,
      garageName: list.find((j) => j.garageName)?.garageName ?? 'Unnamed garage',
      totalJobs: list.length,
      completedJobs: completed.length,
      avgCompletionDays: d == null ? null : round(d),
      avgActualCost: c == null ? null : round(c, 0),
      costVariancePct: v == null ? null : round(v),
      onTimeRate,
      qcFirstPassRate,
      responseHours: r == null ? null : round(r),
      overallScore: parts.length ? round(avg(parts)!, 0) : null,
    });
  }
  // Scored garages first, best first; then by volume.
  return cards.sort((a, b) => (b.overallScore ?? -1) - (a.overallScore ?? -1) || b.totalJobs - a.totalJobs);
}
