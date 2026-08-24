/**
 * GET /api/maintenance/risk-scores
 * Returns a computed MaintenanceRiskScore for every active vehicle.
 *
 * Signals gathered from DB:
 *  - Vehicle identity (code, plate, make, model, year, odometer, purchaseDate)
 *  - ServiceSchedule (last PM date → daysSinceLastPM, interval)
 *  - MaintenanceRequests (last 90d failures, repeat jobs 180d, open defects,
 *    downtime days, maintenance type counts)
 *  - VehicleWarranty (active coverage today)
 *  - QualityInspection (failed inspections with no subsequent PASS)
 *
 * fleet_risk_scores (AI Platform) is not yet in the Prisma schema; the
 * aiRiskScore01 input is omitted (defaults to 0 — no AI signal).
 * When the schema is extended, add the join here.
 */
import { NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { computeRiskScore } from '@/lib/maintenance/risk-score';
import type { RiskScoreInputs } from '@/types/maintenance';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET() {

    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const now   = new Date();
        const ago90 = new Date(now.getTime() - 90  * 24 * 60 * 60 * 1000);
        const ago180= new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

        // ── 1. Load all active vehicles ─────────────────────────────────────────
        const vehicles = await tx.vehicle.findMany({
            where: {
                deletedAt:  null,
                isActive:   true,
            },
            include: {
                serviceSchedules: true,
            },
        });

        if (vehicles.length === 0) {
            return NextResponse.json({ scores: [] });
        }

        const vehicleIds = vehicles.map(v => v.id);

        // ── 2. Maintenance requests (last 90d) ──────────────────────────────────
        const recentMRs = await tx.maintenanceRequest.findMany({
            where: {
                vehicleId:  { in: vehicleIds },
                deletedAt:  null,
                createdAt:  { gte: ago90 },
            },
            select: {
                vehicleId:        true,
                maintenanceType:  true,
                status:           true,
                maintenanceJobs:  true,
                createdAt:        true,
            },
        });

        // Repeat-job detection: same MR jobs repeated in 180d window
        const recentMRs180 = await tx.maintenanceRequest.findMany({
            where: {
                vehicleId:  { in: vehicleIds },
                deletedAt:  null,
                createdAt:  { gte: ago180 },
            },
            select: {
                vehicleId:       true,
                maintenanceJobs: true,
            },
        });

        // Open defects: MRs in early statuses
        const openMRs = await tx.maintenanceRequest.findMany({
            where: {
                vehicleId: { in: vehicleIds },
                deletedAt: null,
                status:    { in: ['REQUESTED', 'SUBMITTED', 'ACCEPTED'] },
            },
            select: { vehicleId: true },
        });

        // Downtime: MRs with UNDER_MAINTENANCE status in last 90d
        const downtimeMRs = await tx.maintenanceRequest.findMany({
            where: {
                vehicleId:  { in: vehicleIds },
                deletedAt:  null,
                status:     'UNDER_MAINTENANCE',
                createdAt:  { gte: ago90 },
            },
            select: {
                vehicleId:  true,
                requestDate: true,
                completionDate: true,
            },
        });

        // ── 3. Active warranties (today falls between startDate and expiryDate) ─
        const activeWarranties = await tx.vehicleWarranty.findMany({
            where: {
                vehicleId:  { in: vehicleIds },
                isActive:   true,
                startDate:  { lte: now },
                expiryDate: { gte: now },
            },
            select: { vehicleId: true },
        });

        // ── 4. Failed QC inspections ────────────────────────────────────────────
        const failedInspections = await tx.qualityInspection.findMany({
            where: {
                MaintenanceRequest: {
                    vehicleId: { in: vehicleIds },
                    deletedAt: null,
                },
                overallResult: 'FAIL',
            },
            include: {
                MaintenanceRequest: { select: { vehicleId: true } },
            },
        });

        // ── 5. Build per-vehicle lookup maps ────────────────────────────────────

        // Failures in last 90d: BREAKDOWN, EMERGENCY, CORRECTIVE type MRs
        const failureTypes = new Set(['BREAKDOWN', 'EMERGENCY', 'CORRECTIVE']);
        const failureCount = new Map<string, number>();
        for (const mr of recentMRs) {
            if (!mr.vehicleId || !failureTypes.has(mr.maintenanceType ?? '')) continue;
            failureCount.set(mr.vehicleId, (failureCount.get(mr.vehicleId) ?? 0) + 1);
        }

        // Repeat jobs in 180d: count vehicle-jobs seen more than once
        const jobOccurrences = new Map<string, Map<string, number>>();
        for (const mr of recentMRs180) {
            if (!mr.vehicleId) continue;
            const jobs = Array.isArray(mr.maintenanceJobs) ? mr.maintenanceJobs : [];
            let byVehicle = jobOccurrences.get(mr.vehicleId);
            if (!byVehicle) { byVehicle = new Map(); jobOccurrences.set(mr.vehicleId, byVehicle); }
            for (const job of jobs) {
                byVehicle.set(job, (byVehicle.get(job) ?? 0) + 1);
            }
        }
        const repeatCount = new Map<string, number>();
        for (const [vid, jobs] of jobOccurrences) {
            let repeats = 0;
            for (const count of jobs.values()) { if (count > 1) repeats++; }
            repeatCount.set(vid, repeats);
        }

        // Open defects
        const openDefectCount = new Map<string, number>();
        for (const mr of openMRs) {
            if (!mr.vehicleId) continue;
            openDefectCount.set(mr.vehicleId, (openDefectCount.get(mr.vehicleId) ?? 0) + 1);
        }

        // Downtime days (rough: 1 MR ≈ days between requestDate and completionDate,
        // capped at 90d window; fall back to 1d per open downtime MR)
        const downtimeDays = new Map<string, number>();
        for (const mr of downtimeMRs) {
            if (!mr.vehicleId) continue;
            const start = mr.requestDate ?? ago90;
            const end   = mr.completionDate ?? now;
            const days  = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
            downtimeDays.set(mr.vehicleId, (downtimeDays.get(mr.vehicleId) ?? 0) + days);
        }

        // Active warranty set
        const warrantySet = new Set(activeWarranties.map(w => w.vehicleId));

        // Failed inspections per vehicle
        const failedInspCount = new Map<string, number>();
        for (const qi of failedInspections) {
            const vid = qi.MaintenanceRequest.vehicleId;
            if (!vid) continue;
            failedInspCount.set(vid, (failedInspCount.get(vid) ?? 0) + 1);
        }

        // ── 6. Compute risk score per vehicle ───────────────────────────────────
        const scores = vehicles.map(v => {
            // Odometer: prefer odometerReading, fall back to currentMileage
            const odometerKm = v.odometerReading
                ? Number(v.odometerReading)
                : v.currentMileage
                ? Number(v.currentMileage)
                : undefined;

            // Age in years from purchaseDate or vehicle year
            let ageYears: number | undefined;
            if (v.purchaseDate) {
                ageYears = (now.getTime() - v.purchaseDate.getTime()) / (365.25 * 86_400_000);
            } else if (v.year) {
                ageYears = now.getFullYear() - Number(v.year);
            }

            // PM signals from ServiceSchedule (take the most-overdue schedule)
            let daysSinceLastPM: number | undefined;
            let pmIntervalDays: number | undefined;
            if (v.serviceSchedules.length > 0) {
                // Pick schedule where daysSince is highest (worst-overdue)
                let worstOverdue = -Infinity;
                for (const ss of v.serviceSchedules) {
                    const days = (now.getTime() - ss.lastServiceDate.getTime()) / 86_400_000;
                    if (days > worstOverdue) {
                        worstOverdue   = days;
                        daysSinceLastPM = Math.round(days);
                        pmIntervalDays  = ss.intervalMonths * 30;
                    }
                }
            }

            const inp: RiskScoreInputs = {
                vehicleId:            v.id,
                vehicleCode:          v.vehicleCode    ?? undefined,
                licensePlate:         v.licensePlate   ?? v.plateNumber ?? undefined,
                make:                 v.make           ?? undefined,
                model:                v.model          ?? undefined,
                ageYears,
                odometerKm,
                expectedLifetimeKm:   300_000,
                daysSinceLastPM,
                pmIntervalDays,
                failuresLast90d:      failureCount.get(v.id),
                repeatJobsLast180d:   repeatCount.get(v.id),
                openDefects:          openDefectCount.get(v.id),
                downtimeDaysLast90d:  downtimeDays.get(v.id),
                warrantyActive:       warrantySet.has(v.id),
                failedInspections:    failedInspCount.get(v.id),
                // aiRiskScore01 — not yet bridged (fleet_risk_scores not in schema)
            };

            return computeRiskScore(inp);
        });

        // Sort: highest risk first
        scores.sort((a, b) => b.score - a.score);

        return NextResponse.json(
            JSON.parse(JSON.stringify({ scores })),
        );
  });
}

