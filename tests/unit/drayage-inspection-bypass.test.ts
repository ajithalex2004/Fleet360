import { describe, expect, it, vi } from 'vitest';
import {
  type DrayageDbClient,
  doesDrayageJobRequireInspection,
  hasAnyDrayageInspectionFlag,
  resolveDrayageInspectionStatus,
  updateDrayageJobExecutionStatus,
} from '@/lib/logistics/drayage-domain';

describe('Port & Container Drayage — Regulatory Inspection Clearance Bypass & Hold Logic', () => {
  it('auto-bypasses UNDER_INSPECTION when NO regulatory inspection flags are enabled', () => {
    const greenChannelJob = {
      customsInspection: false,
      municipalityInspection: false,
      cpipInspection: false,
      mercInspection: false,
      boxcareInspection: false,
      inspectionStatus: 'CLEARED',
      status: 'CONTAINER_PICKED',
      jobPhase: 'L1',
      jobCode: 'DRY-2026-0001',
    };

    expect(hasAnyDrayageInspectionFlag(greenChannelJob)).toBe(false);
    expect(resolveDrayageInspectionStatus(greenChannelJob)).toBe('CLEARED');
    expect(doesDrayageJobRequireInspection(greenChannelJob)).toBe(false);
  });

  it('enforces HOLD_PENDING and requires UNDER_INSPECTION when ONLY customsInspection (Dubai Customs) is enabled — even if SQL column defaulted to CLEARED', () => {
    const dubaiCustomsJob = {
      customs_inspection: true,
      municipality_inspection: false,
      cpip_inspection: false,
      merc_inspection: false,
      boxcare_inspection: false,
      inspection_status: 'CLEARED', // Legacy SQL DEFAULT 'CLEARED'
      status: 'CONTAINER_PICKED',
      job_phase: 'L1',
      job_code: 'DRY-2026-0002',
    };

    expect(hasAnyDrayageInspectionFlag(dubaiCustomsJob)).toBe(true);
    expect(resolveDrayageInspectionStatus(dubaiCustomsJob)).toBe('HOLD_PENDING');
    expect(doesDrayageJobRequireInspection(dubaiCustomsJob)).toBe(true);
  });

  it('requires UNDER_INSPECTION when any single regulatory flag (Municipality, CPIP, Merc, or Boxcare) is enabled', () => {
    for (const flagKey of [
      'municipalityInspection',
      'cpipInspection',
      'mercInspection',
      'boxcareInspection',
    ] as const) {
      const job = {
        [flagKey]: true,
        inspectionStatus: 'CLEARED',
        status: flagKey === 'boxcareInspection' ? 'ARRIVED_AT_PORT' : 'CONTAINER_PICKED',
        jobPhase: flagKey === 'boxcareInspection' ? 'L2' : 'L1',
        jobCode: flagKey === 'boxcareInspection' ? 'DRY-2026-0003-L2' : 'DRY-2026-0003',
      };
      expect(resolveDrayageInspectionStatus(job)).toBe('HOLD_PENDING');
      expect(doesDrayageJobRequireInspection(job)).toBe(true);
    }
  });

  it('resolves inspectionStatus to CLEARED once the job exits UNDER_INSPECTION into EN_ROUTE_WAREHOUSE (Stage >= 4)', () => {
    const postInspectionJob = {
      customsInspection: true,
      inspectionStatus: 'CLEARED',
      status: 'EN_ROUTE_WAREHOUSE',
      jobPhase: 'L1',
      jobCode: 'DRY-2026-0002',
    };

    expect(resolveDrayageInspectionStatus(postInspectionJob)).toBe('CLEARED');
  });

  it('allows direct L1 Stage 2 (CONTAINER_PICKED) -> Stage 4 (EN_ROUTE_WAREHOUSE) transition without operatorOverride when 0 flags are enabled and logs INSPECTION_SKIPPED', async () => {
    const executedSql: Array<{ sql: string; params: unknown[] }> = [];
    const mockDb: DrayageDbClient = {
      $executeRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
        executedSql.push({ sql, params });
        return 1;
      }),
      $queryRawUnsafe: vi.fn(async <T = unknown>(sql: string) => {
        if (sql.includes('FROM logistics_drayage_jobs WHERE id = $1')) {
          return [
            {
              id: 'job-green-1',
              tenant_id: 'tenant-1',
              job_code: 'DRY-2026-0100',
              job_phase: 'L1',
              shipment_type: 'IMPORT',
              status: 'CONTAINER_PICKED',
              terminal_name: 'DP World Jebel Ali T1',
              warehouse_name: 'Al Futtaim JAFZA South',
              container_id: 'cnt-green-1',
              container_number: 'MSCU1234567',
              customs_inspection: false,
              municipality_inspection: false,
              cpip_inspection: false,
              merc_inspection: false,
              boxcare_inspection: false,
              inspection_status: 'CLEARED',
              trailer_detached: false,
            },
          ] as unknown as T;
        }
        return [] as unknown as T;
      }) as DrayageDbClient['$queryRawUnsafe'],
    };

    const res = await updateDrayageJobExecutionStatus(mockDb, {
      tenantId: 'tenant-1',
      jobId: 'job-green-1',
      status: 'EN_ROUTE_WAREHOUSE',
      actor: 'Dispatch Console',
      operatorOverride: false,
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe('EN_ROUTE_WAREHOUSE');
    const skippedLogInsert = executedSql.find(
      (q) =>
        q.sql.includes('INSERT INTO logistics_drayage_status_logs') &&
        q.sql.includes("'INSPECTION_SKIPPED'"),
    );
    expect(skippedLogInsert).toBeDefined();
  });

  it('blocks skipping Stage 3 (UNDER_INSPECTION) from Dispatch Console without operatorOverride when customsInspection is enabled, and allows stepping into UNDER_INSPECTION', async () => {
    const mockJobRow = {
      id: 'job-customs-1',
      tenant_id: 'tenant-1',
      job_code: 'DRY-2026-0101',
      job_phase: 'L1',
      shipment_type: 'IMPORT',
      status: 'CONTAINER_PICKED',
      terminal_name: 'DP World Jebel Ali T1',
      warehouse_name: 'Al Futtaim JAFZA South',
      container_id: 'cnt-customs-1',
      container_number: 'MAEU7654321',
      customs_inspection: true,
      municipality_inspection: false,
      cpip_inspection: false,
      merc_inspection: false,
      boxcare_inspection: false,
      inspection_status: 'CLEARED', // Even with SQL default CLEARED, customs_inspection = true enforces hold!
      trailer_detached: false,
    };

    const mockDb: DrayageDbClient = {
      $executeRawUnsafe: vi.fn(async () => 1),
      $queryRawUnsafe: vi.fn(async <T = unknown>(sql: string) => {
        if (sql.includes('FROM logistics_drayage_jobs WHERE id = $1')) {
          return [mockJobRow] as unknown as T;
        }
        return [] as unknown as T;
      }) as DrayageDbClient['$queryRawUnsafe'],
    };

    await expect(
      updateDrayageJobExecutionStatus(mockDb, {
        tenantId: 'tenant-1',
        jobId: 'job-customs-1',
        status: 'EN_ROUTE_WAREHOUSE',
        actor: 'Dispatch Console',
        operatorOverride: false,
      }),
    ).rejects.toThrow(/Sequential stage progression required/);

    const stepIntoInspection = await updateDrayageJobExecutionStatus(mockDb, {
      tenantId: 'tenant-1',
      jobId: 'job-customs-1',
      status: 'UNDER_INSPECTION',
      actor: 'Dispatch Console',
      operatorOverride: false,
    });
    expect(stepIntoInspection.ok).toBe(true);
    expect(stepIntoInspection.status).toBe('UNDER_INSPECTION');
  });
});
