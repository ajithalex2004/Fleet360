import { assessChecklist, type ChecklistResultItem } from '@/lib/bus-pretrip-checklist';
export function inspectionAllowsDeparture(
  check: { vehicleId: string | null; driverId: string | null; performedAt: Date; overallPass: boolean; checkItems: unknown } | null,
  schedule: { vehicleId: string | null; driverId: string | null },
  now = new Date(),
): boolean {
  if (!check || !schedule.vehicleId || !schedule.driverId || !check.overallPass || check.vehicleId !== schedule.vehicleId
      || check.driverId !== schedule.driverId || check.performedAt > now
      || now.getTime() - check.performedAt.getTime() > 24 * 60 * 60_000) return false;
  try { return assessChecklist(check.checkItems as ChecklistResultItem[]).overallPass; }
  catch { return false; }
}
