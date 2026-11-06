export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import crypto from 'crypto';
import {
  getDrayageWorkspaceData,
  createDrayageJobsBatch,
  updateDrayageJobDetails,
  updateDrayageReturnTerminal,
  assignDrayageJob,
  updateDrayageJobExecutionStatus,
  activateL2EmptyReturnJob,
  extendDrayageJobEtcTime,
  checkAndAutoActivateExpiredEtcJobs,
  setTenantAutoL2DispatchMode,
  getTenantAutomationConfig,
  saveTenantAutomationConfig,
  ensureDrayageSchema,
  verifyPortEdiForJob,
  appendDrayageItineraryLeg,
  sendDispatchChatMessage,
  acknowledgeDrayageAlert,
  extendContainerDeliveryOrder,
  calculateMissingAllowances,
  adjustDriverAllowance,
  submitDriverExpenseReceipt,
  settleDriverAllowancesPayout,
  recordDrayageStatusLog,
  findStreetTurnCandidates,
  executeStreetTurnTriangulation,
  findBogiePairCandidates,
  executeBogiePairDispatch,
  consigneeConfirmEmptyReady,
  submitJobPodEvidence,
  bookPcsToken,
  clearPortInspection,
  revalidateDeliveryOrder,
  rebookPcsTokenForTrafficDelay,
  swapTractorForPortSlotRescue,
  simulatePortSlotTrafficRisk,
  dispatchDrayageCustomerMilestoneAlert,
  updateDrayageCustomerAlertPreferences,
} from '@/lib/logistics/drayage-domain';
import {
  getCachedDrayageWorkspace,
  setCachedDrayageWorkspace,
  emitDrayageEvent,
  resetEtcAutoActivationThrottle,
} from '@/lib/logistics/drayage-events';
import {
  recordDrayageApiMetric,
  buildServerTimingHeader,
} from '@/lib/logistics/drayage-observability';

let drayageSchemaEnsured = false;

function filterWorkspaceByScope(data: Record<string, unknown>, scope: string): Record<string, unknown> {
  switch (scope) {
    case 'jobs':
      return {
        summary: data.summary,
        automationConfig: data.automationConfig,
        jobs: data.jobs,
        containers: data.containers,
        vehicles: data.vehicles,
        drivers: data.drivers,
        trailers: data.trailers,
        alerts: data.alerts,
      };
    case 'master':
      return {
        terminals: data.terminals,
        warehouses: data.warehouses,
        clients: data.clients,
        customers: data.customers,
        geofences: data.geofences,
        trailers: data.trailers,
        automationConfig: data.automationConfig,
      };
    case 'telemetry':
      return {
        summary: data.summary,
        jobs: data.jobs,
        vehicles: data.vehicles,
        trailers: data.trailers,
        geofences: data.geofences,
        statusLogs: data.statusLogs,
        messages: data.messages,
        alerts: data.alerts,
      };
    default:
      return data;
  }
}

function safeNum(val: unknown, fallback: number): number {
  if (val === null || val === undefined || val === '') return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function safeIso(val: unknown, fallbackMsOffset = 0): string {
  if (val && typeof val === 'string' && val.trim()) {
    const d = new Date(val.trim());
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date(Date.now() + fallbackMsOffset).toISOString();
}

export async function GET(req: NextRequest) {
  const t0 = performance.now();
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const scope = (req.nextUrl.searchParams.get('scope') || 'full').toLowerCase();
  const ifNoneMatch = req.headers.get('if-none-match');

  const cached = getCachedDrayageWorkspace(tenantId);
  if (cached) {
    const totalMs = performance.now() - t0;
    if (ifNoneMatch && ifNoneMatch === cached.etag) {
      recordDrayageApiMetric({
        tenantId,
        route: '/api/logistics/drayage',
        method: 'GET',
        actionOrScope: `scope:${scope}`,
        durationMs: totalMs,
        dbMs: 0,
        status: 304,
        cacheStatus: 'HIT-304',
      });
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: cached.etag,
          'X-Cache': 'HIT-304',
          'Cache-Control': 'private, max-age=4, stale-while-revalidate=8',
          'Server-Timing': buildServerTimingHeader({
            totalMs,
            dbMs: 0,
            cacheStatus: 'HIT-304',
            scope,
          }),
        },
      });
    }
    const payload = filterWorkspaceByScope(cached.data, scope);
    recordDrayageApiMetric({
      tenantId,
      route: '/api/logistics/drayage',
      method: 'GET',
      actionOrScope: `scope:${scope}`,
      durationMs: totalMs,
      dbMs: 0,
      status: 200,
      cacheStatus: 'HIT',
    });
    return NextResponse.json(payload, {
      headers: {
        ETag: cached.etag,
        'X-Cache': 'HIT',
        'X-Drayage-Scope': scope,
        'Cache-Control': 'private, max-age=4, stale-while-revalidate=8',
        'Server-Timing': buildServerTimingHeader({
          totalMs,
          dbMs: 0,
          cacheStatus: 'HIT',
          scope,
        }),
      },
    });
  }

  if (!drayageSchemaEnsured) {
    await ensureDrayageSchema(prisma).catch(() => {});
    drayageSchemaEnsured = true;
  }

  try {
    const dbStart = performance.now();
    const data = await withTenantRls(prisma, tenantId, async (tx) => {
      return getDrayageWorkspaceData(tx, tenantId);
    }, { timeoutMs: 30000 });
    const dbMs = performance.now() - dbStart;
    const entry = setCachedDrayageWorkspace(tenantId, data as unknown as Record<string, unknown>);
    const totalMs = performance.now() - t0;

    if (ifNoneMatch && ifNoneMatch === entry.etag) {
      recordDrayageApiMetric({
        tenantId,
        route: '/api/logistics/drayage',
        method: 'GET',
        actionOrScope: `scope:${scope}`,
        durationMs: totalMs,
        dbMs,
        status: 304,
        cacheStatus: 'MISS-304',
      });
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: entry.etag,
          'X-Cache': 'MISS-304',
          'Cache-Control': 'private, max-age=4, stale-while-revalidate=8',
          'Server-Timing': buildServerTimingHeader({
            totalMs,
            dbMs,
            cacheStatus: 'MISS-304',
            scope,
          }),
        },
      });
    }
    const payload = filterWorkspaceByScope(entry.data, scope);
    recordDrayageApiMetric({
      tenantId,
      route: '/api/logistics/drayage',
      method: 'GET',
      actionOrScope: `scope:${scope}`,
      durationMs: totalMs,
      dbMs,
      status: 200,
      cacheStatus: 'MISS',
    });
    return NextResponse.json(payload, {
      headers: {
        ETag: entry.etag,
        'X-Cache': 'MISS',
        'X-Drayage-Scope': scope,
        'Cache-Control': 'private, max-age=4, stale-while-revalidate=8',
        'Server-Timing': buildServerTimingHeader({
          totalMs,
          dbMs,
          cacheStatus: 'MISS',
          scope,
        }),
      },
    });
  } catch (error) {
    const totalMs = performance.now() - t0;
    recordDrayageApiMetric({
      tenantId,
      route: '/api/logistics/drayage',
      method: 'GET',
      actionOrScope: `scope:${scope}`,
      durationMs: totalMs,
      status: 500,
      cacheStatus: 'MISS',
      errorMessage: error instanceof Error ? error.message : 'Workspace GET failed',
    });
    console.error('[api/logistics/drayage GET]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load port & container drayage workspace' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const t0 = performance.now();
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId, userId } = authz;

  if (!drayageSchemaEnsured) {
    await ensureDrayageSchema(prisma).catch(() => {});
    drayageSchemaEnsured = true;
  }

  let action = 'unknown_action';
  try {
    // Tenant ownership comes from the session, never the body.
    const body = stripTenantOwnershipFields(await req.json());
    action = String(body.action ?? '');

    const dbStart = performance.now();
    const result = await withTenantRls(prisma, tenantId, async (tx) => {
      let dispatcherActor = typeof body.actor === 'string' ? body.actor.trim() : '';
      if (
        !dispatcherActor ||
        ['Dispatch Console', 'Dispatcher Console', 'Port Operations Desk', 'Super Admin'].includes(
          dispatcherActor,
        )
      ) {
        if (userId) {
          const userRows = await tx
            .$queryRawUnsafe<Array<{ username: string | null; email: string | null }>>(
              `SELECT username, email FROM "User" WHERE id = $1 LIMIT 1`,
              userId,
            )
            .catch(() => []);
          if (userRows[0]?.username) {
            dispatcherActor = String(userRows[0].username).trim();
          } else if (userRows[0]?.email) {
            dispatcherActor = String(userRows[0].email).split('@')[0].trim();
          }
        }
      }
      if (!dispatcherActor) {
        dispatcherActor = 'dispatcher';
      }

      switch (action) {
        case 'create_jobs': {
          const rawContainers: Array<Record<string, unknown>> = Array.isArray(body.containers) ? body.containers : [];
          const hasFallbackWarehouse = Boolean(String(body.warehouseName ?? '').trim());
          const allContainersHaveWarehouse =
            rawContainers.length > 0 &&
            rawContainers.every((c) => Boolean(String(c.warehouseName ?? '').trim()));
          if (!String(body.customerName ?? '').trim() || !String(body.terminalName ?? '').trim() || (!hasFallbackWarehouse && !allContainersHaveWarehouse)) {
            throw new Error('Customer, Port Terminal, and Consignee Destination / Facility are mandatory to create a job.');
          }
          if (rawContainers.length === 0 || rawContainers.some((c: Record<string, unknown>) => !String(c.containerNumber ?? '').trim())) {
            throw new Error('At least one valid Container Number is mandatory to create a job.');
          }
          const parsedRate = Number(body.rateAmountAed);
          const parsedAllow = Number(body.driverAllowanceAed);
          const firstCntWhName = rawContainers[0]?.warehouseName ? String(rawContainers[0].warehouseName).trim() : '';
          const firstCntWhId = rawContainers[0]?.warehouseId ? String(rawContainers[0].warehouseId) : null;
          return createDrayageJobsBatch(tx, {
            tenantId,
            shipmentType: body.shipmentType === 'EXPORT' ? 'EXPORT' : 'IMPORT',
            priority: body.priority || 'STANDARD',
            customerId: body.customerId ?? null,
            customerName: String(body.customerName || 'Enterprise Shipper').trim() || 'Enterprise Shipper',
            warehouseId: body.warehouseId ?? firstCntWhId ?? null,
            warehouseName: String(body.warehouseName || firstCntWhName || 'JAFZA South Bonded Hub').trim() || 'JAFZA South Bonded Hub',
            terminalId: body.terminalId ?? null,
            terminalName: String(body.terminalName || 'Jebel Ali Port - Terminal 1').trim() || 'Jebel Ali Port - Terminal 1',
            rateAmountAed: Number.isFinite(parsedRate) && parsedRate >= 0 ? parsedRate : 1550,
            driverAllowanceAed: Number.isFinite(parsedAllow) && parsedAllow >= 0 ? parsedAllow : 150,
            notes: body.notes ?? null,
            containers: rawContainers as never,
          });
        }

        case 'edit_job':
        case 'update_job': {
          const jobId = String(body.jobId ?? '').trim();
          if (!jobId) {
            throw new Error('jobId is required to edit a job');
          }
          return updateDrayageJobDetails(tx, {
            tenantId,
            jobId,
            containerNumber:
              body.containerNumber !== undefined ? String(body.containerNumber).trim().toUpperCase() : undefined,
            containerSize: body.containerSize !== undefined ? String(body.containerSize).trim() : undefined,
            containerType: body.containerType !== undefined ? String(body.containerType).trim() : undefined,
            sealNumber: body.sealNumber !== undefined ? (body.sealNumber ? String(body.sealNumber).trim() : null) : undefined,
            weightKg:
              body.weightKg !== undefined && Number.isFinite(Number(body.weightKg))
                ? Number(body.weightKg)
                : undefined,
            shipmentType:
              body.shipmentType === 'EXPORT' || body.shipmentType === 'IMPORT'
                ? body.shipmentType
                : undefined,
            priority:
              body.priority && ['STANDARD', 'HIGH', 'URGENT'].includes(String(body.priority).toUpperCase())
                ? (String(body.priority).toUpperCase() as 'STANDARD' | 'HIGH' | 'URGENT')
                : undefined,
            customerId: body.customerId !== undefined ? (body.customerId ? String(body.customerId) : null) : undefined,
            customerName: body.customerName !== undefined ? String(body.customerName).trim() : undefined,
            terminalId: body.terminalId !== undefined ? (body.terminalId ? String(body.terminalId) : null) : undefined,
            terminalName: body.terminalName !== undefined ? String(body.terminalName).trim() : undefined,
            warehouseId: body.warehouseId !== undefined ? (body.warehouseId ? String(body.warehouseId) : null) : undefined,
            warehouseName: body.warehouseName !== undefined ? String(body.warehouseName).trim() : undefined,
            doExpiryDate: body.doExpiryDate !== undefined ? (body.doExpiryDate ? String(body.doExpiryDate) : null) : undefined,
            dischargeDate: body.dischargeDate !== undefined ? (body.dischargeDate ? String(body.dischargeDate) : null) : undefined,
            tokenNumber: body.tokenNumber !== undefined ? (body.tokenNumber ? String(body.tokenNumber).trim() : null) : undefined,
            rateAmountAed:
              body.rateAmountAed !== undefined && Number.isFinite(Number(body.rateAmountAed))
                ? Number(body.rateAmountAed)
                : undefined,
            driverAllowanceAed:
              body.driverAllowanceAed !== undefined && Number.isFinite(Number(body.driverAllowanceAed))
                ? Number(body.driverAllowanceAed)
                : undefined,
            customsInspection:
              body.customsInspection !== undefined ? Boolean(body.customsInspection) : undefined,
            municipalityInspection:
              body.municipalityInspection !== undefined ? Boolean(body.municipalityInspection) : undefined,
            cpipInspection:
              body.cpipInspection !== undefined ? Boolean(body.cpipInspection) : undefined,
            mercInspection:
              body.mercInspection !== undefined ? Boolean(body.mercInspection) : undefined,
            boxcareInspection:
              body.boxcareInspection !== undefined ? Boolean(body.boxcareInspection) : undefined,
            notes: body.notes !== undefined ? (body.notes ? String(body.notes) : null) : undefined,
            actor: dispatcherActor,
          });
        }

        case 'change_return_terminal': {
          const jobId = String(body.jobId ?? '').trim();
          if (!jobId) {
            throw new Error('jobId is required to change the Return Terminal');
          }
          return updateDrayageReturnTerminal(tx, {
            tenantId,
            jobId,
            returnTerminalId: body.returnTerminalId ? String(body.returnTerminalId).trim() : null,
            returnTerminalName: body.returnTerminalName ? String(body.returnTerminalName).trim() : null,
            reason: body.reason ? String(body.reason).trim() : null,
            actor: dispatcherActor,
          });
        }

        case 'assign_job': {
          if (body.returnTerminalId || body.returnTerminalName) {
            await updateDrayageReturnTerminal(tx, {
              tenantId,
              jobId: String(body.jobId),
              returnTerminalId: body.returnTerminalId ? String(body.returnTerminalId).trim() : null,
              returnTerminalName: body.returnTerminalName ? String(body.returnTerminalName).trim() : null,
              reason: body.returnTerminalReason ? String(body.returnTerminalReason).trim() : 'Set during L2 Fleet Assignment',
              actor: dispatcherActor,
            }).catch(() => {});
          }
          return assignDrayageJob(tx, {
            tenantId,
            jobId: String(body.jobId),
            vehicleId: String(body.vehicleId),
            vehiclePlate: String(body.vehiclePlate),
            driverId: String(body.driverId),
            driverName: String(body.driverName),
            trailerId: String(body.trailerId),
            trailerPlate: String(body.trailerPlate),
            tokenNumber: String(body.tokenNumber ?? ''),
            pcsSlotStart: body.pcsSlotStart ? String(body.pcsSlotStart) : null,
            pcsSlotEnd: body.pcsSlotEnd ? String(body.pcsSlotEnd) : null,
            actor: dispatcherActor,
          });
        }

        case 'update_token': {
          const token = String(body.tokenNumber ?? '').trim().toUpperCase();
          if (!token) throw new Error('Token number is required');
          let resolvedSlotStart: string | null = null;
          let resolvedSlotEnd: string | null = null;
          if (body.pcsSlotStart && String(body.pcsSlotStart).trim()) {
            const startDt = new Date(String(body.pcsSlotStart).trim());
            if (!Number.isNaN(startDt.getTime())) {
              resolvedSlotStart = startDt.toISOString();
              const endDt =
                body.pcsSlotEnd && String(body.pcsSlotEnd).trim()
                  ? new Date(String(body.pcsSlotEnd).trim())
                  : new Date(startDt.getTime() + 2 * 60 * 60 * 1000);
              resolvedSlotEnd = !Number.isNaN(endDt.getTime())
                ? endDt.toISOString()
                : new Date(startDt.getTime() + 2 * 60 * 60 * 1000).toISOString();
            }
          }
          await tx.$executeRawUnsafe(
            `UPDATE logistics_drayage_jobs
                SET token_number = $3,
                    pcs_token_number = $3,
                    pcs_slot_start = COALESCE($4::timestamptz, pcs_slot_start),
                    pcs_slot_end = COALESCE($5::timestamptz, pcs_slot_end),
                    pcs_token_status = 'BOOKED',
                    updated_at = NOW()
              WHERE tenant_id = $2
                AND (
                  id = $1
                  OR street_turn_job_id = $1
                  OR bogie_job_id = $1
                  OR id IN (
                    SELECT COALESCE(street_turn_job_id, bogie_job_id)
                      FROM logistics_drayage_jobs
                     WHERE id = $1 AND tenant_id = $2
                  )
                )`,
            String(body.jobId),
            tenantId,
            token,
            resolvedSlotStart,
            resolvedSlotEnd,
          );
          await tx.$executeRawUnsafe(
            `UPDATE logistics_drayage_containers c
                SET pcs_token_number = $3,
                    pcs_slot_start = COALESCE($4::timestamptz, c.pcs_slot_start),
                    pcs_slot_end = COALESCE($5::timestamptz, c.pcs_slot_end),
                    pcs_token_status = 'BOOKED',
                    updated_at = NOW()
               FROM logistics_drayage_jobs j
              WHERE j.id = $1
                AND j.tenant_id = $2
                AND c.tenant_id = $2
                AND (c.id = j.container_id OR UPPER(c.container_number) = UPPER(j.container_number))`,
            String(body.jobId),
            tenantId,
            token,
            resolvedSlotStart,
            resolvedSlotEnd,
          ).catch(() => {});
          return {
            ok: true,
            tokenNumber: token,
            pcsSlotStart: resolvedSlotStart,
            pcsSlotEnd: resolvedSlotEnd,
          };
        }

        case 'get_street_turn_candidates': {
          const candidates = await findStreetTurnCandidates(tx, tenantId);
          return { ok: true, candidates };
        }

        case 'execute_street_turn': {
          const res = await executeStreetTurnTriangulation(tx, {
            tenantId,
            l2JobId: String(body.l2JobId),
            exportJobId: String(body.exportJobId),
            leg3JobId: body.leg3JobId ? String(body.leg3JobId) : undefined,
            holdLeg3: Boolean(body.holdLeg3),
            matchMode: body.matchMode
              ? (String(body.matchMode) as 'INLAND_STREET_TURN' | 'PORT_TERMINAL_RELOAD' | 'DAISY_CHAIN_3LEG')
              : undefined,
            vehicleId: body.vehicleId ? String(body.vehicleId) : undefined,
            vehiclePlate: body.vehiclePlate ? String(body.vehiclePlate) : undefined,
            driverId: body.driverId ? String(body.driverId) : undefined,
            driverName: body.driverName ? String(body.driverName) : undefined,
            trailerId: body.trailerId ? String(body.trailerId) : undefined,
            trailerPlate: body.trailerPlate ? String(body.trailerPlate) : undefined,
            tokenNumber: body.tokenNumber ? String(body.tokenNumber) : undefined,
            pcsSlotStart: body.pcsSlotStart ? String(body.pcsSlotStart) : null,
            pcsSlotEnd: body.pcsSlotEnd ? String(body.pcsSlotEnd) : null,
            actor: dispatcherActor,
          });
          return res;
        }

        case 'hold_for_backhaul': {
          const jobId = String(body.jobId || '');
          if (!jobId) throw new Error('jobId is required');
          const holdReason = String(
            body.reason ||
              '[SMART_BACKHAUL_HOLD] Held for Port Backhaul / Street-Turn (Safe DO window · Avoids empty return leg)',
          );
          await tx.$executeRawUnsafe(
            `UPDATE logistics_drayage_jobs
                SET notes = CASE
                      WHEN POSITION('[SMART_BACKHAUL_HOLD]' IN COALESCE(notes, '')) > 0 THEN notes
                      ELSE COALESCE(notes || ' | ', '') || $3
                    END,
                    updated_at = NOW()
              WHERE id = $1 AND tenant_id = $2`,
            jobId,
            tenantId,
            holdReason,
          );
          return { ok: true, jobId, held: true, reason: holdReason };
        }

        case 'release_backhaul_hold': {
          const jobId = String(body.jobId || '');
          if (!jobId) throw new Error('jobId is required');
          await tx.$executeRawUnsafe(
            `UPDATE logistics_drayage_jobs
                SET notes = REGEXP_REPLACE(COALESCE(notes, ''), '\\s*\\|?\\s*\\[SMART_BACKHAUL_HOLD\\][^|]*', '', 'g'),
                    updated_at = NOW()
              WHERE id = $1 AND tenant_id = $2`,
            jobId,
            tenantId,
          );
          return { ok: true, jobId, held: false };
        }

        case 'get_bogie_candidates': {
          const candidates = await findBogiePairCandidates(tx, tenantId);
          return { ok: true, candidates };
        }

        case 'execute_bogie_dispatch': {
          const res = await executeBogiePairDispatch(tx, {
            tenantId,
            job1Id: String(body.job1Id),
            job2Id: String(body.job2Id),
            vehicleId: String(body.vehicleId),
            vehiclePlate: String(body.vehiclePlate ?? 'DXB-TRACTOR'),
            driverId: String(body.driverId),
            driverName: String(body.driverName ?? 'Assigned Driver'),
            trailerId: String(body.trailerId),
            trailerPlate: String(body.trailerPlate ?? 'DXB-TR-9901'),
            tokenNumber: body.tokenNumber ? String(body.tokenNumber) : undefined,
            pcsSlotStart: body.pcsSlotStart ? String(body.pcsSlotStart) : null,
            pcsSlotEnd: body.pcsSlotEnd ? String(body.pcsSlotEnd) : null,
            actor: dispatcherActor,
          });
          return res;
        }

        case 'create_bogie_trip': {
          const jobIds: string[] = Array.isArray(body.jobIds) ? body.jobIds.map(String) : [];
          if (jobIds.length !== 2) {
            throw new Error('A Bogie trip can only carry exactly two (2) twenty-foot containers on a single prime mover & chassis');
          }
          // Validate that both containers are 20FT
          const containers = (await tx.$queryRawUnsafe(
            `SELECT id, container_size, container_number FROM logistics_drayage_jobs WHERE id = ANY($1::text[]) AND tenant_id = $2`,
            jobIds,
            tenantId,
          )) as Array<{ id: string; container_size: string | null; container_number: string }>;
          const non20 = containers.find((c) => c.container_size && c.container_size.trim().toUpperCase() !== '20FT');
          if (non20) {
            throw new Error(`Container ${non20.container_number} is ${non20.container_size}. A Bogie setup only accommodates two 20FT containers.`);
          }
          const bogieRef = `BOGIE-${Math.floor(1000 + Math.random() * 9000)}`;
          for (const jId of jobIds) {
            await tx.$executeRawUnsafe(
              `UPDATE logistics_drayage_jobs
                  SET notes = COALESCE(notes || ' | ', '') || $3,
                      priority = 'HIGH',
                      updated_at = NOW()
                WHERE id = $1 AND tenant_id = $2`,
              jId,
              tenantId,
              `Paired in 2x20FT Bogie Dispatch (${bogieRef})`,
            );
            if (body.vehicleId && body.driverId && body.trailerId) {
              await assignDrayageJob(tx, {
                tenantId,
                jobId: jId,
                vehicleId: String(body.vehicleId),
                vehiclePlate: String(body.vehiclePlate ?? 'DXB-TRACTOR'),
                driverId: String(body.driverId),
                driverName: String(body.driverName ?? 'Assigned Driver'),
                trailerId: String(body.trailerId),
                trailerPlate: String(body.trailerPlate ?? 'DXB-TR-9901'),
                tokenNumber: String(body.tokenNumber ?? ''),
                actor: dispatcherActor,
              });
            }
          }
          return { ok: true, bogieRef, count: jobIds.length };
        }

        case 'batch_dispatch': {
          const dispatches: Array<{
            type?: 'BOGIE' | 'STREET_TURN' | 'DAISY_CHAIN' | 'PORT_RELOAD' | 'SINGLE';
            jobIds: string[];
            heldLeg3JobId?: string;
            vehicleId: string;
            vehiclePlate: string;
            driverId: string;
            driverName: string;
            trailerId: string;
            trailerPlate: string;
            tokenNumber?: string;
            notes?: string;
          }> = Array.isArray(body.dispatches) ? body.dispatches : [];

          if (dispatches.length === 0) throw new Error('No dispatches provided in batch');

          let assignedCount = 0;
          let heldCount = 0;
          for (const d of dispatches) {
            const jobIds = Array.isArray(d.jobIds) ? d.jobIds.map(String) : [];
            if (jobIds.length === 0) continue;

            const token = String(d.tokenNumber ?? '');

            for (const jId of jobIds) {
              const noteText =
                d.notes ||
                (d.type === 'DAISY_CHAIN'
                  ? `3-Leg Daisy-Chain Triangulation (${token})`
                  : d.type === 'PORT_RELOAD'
                    ? `Port Terminal Reload Dual-Move (${token})`
                    : d.type === 'BOGIE'
                      ? `Dual-20FT Bogie Combo (${token})`
                      : d.type === 'STREET_TURN'
                        ? `Terminal Street Turn Pair (${token})`
                        : undefined);
              if (noteText) {
                await tx.$executeRawUnsafe(
                  `UPDATE logistics_drayage_jobs
                      SET notes = COALESCE(notes || ' | ', '') || $3,
                          priority = CASE WHEN priority = 'URGENT' THEN 'URGENT' ELSE 'HIGH' END,
                          updated_at = NOW()
                    WHERE id = $1 AND tenant_id = $2`,
                  jId,
                  tenantId,
                  noteText,
                );
              }

              await assignDrayageJob(tx, {
                tenantId,
                jobId: jId,
                vehicleId: String(d.vehicleId),
                vehiclePlate: String(d.vehiclePlate ?? 'DXB-TRACTOR'),
                driverId: String(d.driverId),
                driverName: String(d.driverName ?? 'Assigned Driver'),
                trailerId: String(d.trailerId),
                trailerPlate: String(d.trailerPlate ?? 'DXB-TR-9901'),
                tokenNumber: token,
                actor: dispatcherActor,
              });
              assignedCount++;
            }

            if (d.heldLeg3JobId) {
              await tx.$executeRawUnsafe(
                `UPDATE logistics_drayage_jobs
                    SET notes = CASE
                          WHEN POSITION('[SMART_BACKHAUL_HOLD]' IN COALESCE(notes, '')) > 0 THEN notes
                          ELSE COALESCE(notes || ' | ', '') || $3
                        END,
                        updated_at = NOW()
                  WHERE id = $1 AND tenant_id = $2`,
                String(d.heldLeg3JobId),
                tenantId,
                '[SMART_BACKHAUL_HOLD] Held by Auto-Pilot: Safe DO window & no outbound L1 backhaul at destination terminal',
              );
              heldCount++;
            }
          }

          return { ok: true, count: assignedCount, heldCount, batches: dispatches.length };
        }

        case 'update_status': {
          return updateDrayageJobExecutionStatus(tx, {
            tenantId,
            jobId: String(body.jobId),
            status: String(body.status),
            placementLocation: body.placementLocation ?? undefined,
            detachTrailer: body.detachTrailer,
            etcTime: body.etcTime || body.etc || undefined,
            notes: body.notes || undefined,
            actor: dispatcherActor,
          });
        }

        case 'extend_etc': {
          return extendDrayageJobEtcTime(tx, {
            tenantId,
            jobId: String(body.jobId),
            minutesToAdd: Number(body.minutesToAdd ?? 60),
            reason: body.reason ? String(body.reason) : undefined,
            actor: dispatcherActor,
          });
        }

        case 'toggle_auto_l2_mode': {
          return setTenantAutoL2DispatchMode(tx, {
            tenantId,
            enabled: Boolean(body.enabled),
          });
        }

        case 'get_automation_config': {
          const config = await getTenantAutomationConfig(tx, tenantId);
          return { ok: true, automationConfig: config };
        }

        case 'update_automation_config': {
          const res = await saveTenantAutomationConfig(tx, {
            tenantId,
            config: body.config && typeof body.config === 'object' ? body.config : body,
            actor: body.actor ? String(body.actor) : 'Super Admin',
          });
          return res;
        }

        case 'check_etc_timers': {
          return checkAndAutoActivateExpiredEtcJobs(tx, tenantId, {
            thresholdMinutes: body.thresholdMinutes !== undefined ? Number(body.thresholdMinutes) : undefined,
            preAssignTractor: body.preAssignTractor !== undefined ? Boolean(body.preAssignTractor) : true,
          });
        }

        case 'activate_l2': {
          return activateL2EmptyReturnJob(tx, {
            tenantId,
            l1JobId: String(body.l1JobId),
            preAssignTractor: body.preAssignTractor !== undefined ? Boolean(body.preAssignTractor) : undefined,
            triggerSource: body.triggerSource === 'AUTO_T30' ? 'AUTO_T30' : 'MANUAL',
          });
        }

        case 'verify_port_edi': {
          return verifyPortEdiForJob(tx, {
            tenantId,
            jobId: String(body.jobId),
            provider: body.provider === 'AD_PORTS_MAQTA' ? 'AD_PORTS_MAQTA' : 'DUBAI_TRADE_DPWORLD',
          });
        }

        case 'append_itinerary_leg': {
          return appendDrayageItineraryLeg(tx, {
            tenantId,
            jobId: String(body.jobId),
            legType: String(body.legType ?? 'CUSTOMS_INSPECTION'),
            pickupLocation: String(body.pickupLocation ?? 'Jebel Ali Port Gate'),
            dropoffLocation: String(body.dropoffLocation ?? 'JAFZA Customs Inspection Bay'),
            rateAed: Number(body.rateAed ?? 250),
          });
        }

        case 'send_dispatch_message': {
          return sendDispatchChatMessage(tx, {
            tenantId,
            jobId: body.isBroadcast ? 'BROADCAST' : String(body.jobId),
            senderRole: body.senderRole === 'DRIVER' ? 'DRIVER' : 'DISPATCHER',
            senderName: String(body.senderName ?? 'Port Operations Desk'),
            message: String(body.message ?? '').trim(),
            isUrgent: Boolean(body.isUrgent),
            isBroadcast: Boolean(body.isBroadcast),
          });
        }

        case 'acknowledge_alert': {
          return acknowledgeDrayageAlert(tx, {
            tenantId,
            alertKey: String(body.alertKey),
          });
        }

        case 'extend_do': {
          return extendContainerDeliveryOrder(tx, {
            tenantId,
            containerId: String(body.containerId),
            daysToAdd: Number(body.daysToAdd ?? 3),
          });
        }

        case 'create_container': {
          const items = Array.isArray(body.containers) ? body.containers : [body];
          const createdIds: string[] = [];
          for (const item of items) {
            const cntNum = String(item.containerNumber ?? '').trim().toUpperCase();
            if (!cntNum) {
              throw new Error('Container Number is mandatory.');
            }
            const id = `cnt-${crypto.randomUUID().slice(0, 12)}`;
            const doExp = safeIso(item.doExpiryDate, 5 * 86400000);
            const disch = safeIso(item.dischargeDate, 0);
            const weightKg = safeNum(item.weightKg, 22000) > 0 ? safeNum(item.weightKg, 22000) : 22000;
            await tx.$executeRawUnsafe(
              `INSERT INTO logistics_drayage_containers (
                id, tenant_id, container_number, size, container_type, shipment_type, status,
                customer_id, customer_name, terminal_id, terminal_name, warehouse_id, warehouse_name,
                do_expiry_date, discharge_date, seal_number, weight_kg,
                customs_inspection, municipality_inspection, cpip_inspection, merc_inspection, boxcare_inspection
              ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                $14::timestamptz,$15::timestamptz,$16,$17,$18,$19,$20,$21,$22
              )`,
              id,
              tenantId,
              cntNum,
              String(item.size || '40HC').trim() || '40HC',
              String(item.containerType || 'DRY').trim() || 'DRY',
              String(item.shipmentType || 'IMPORT').trim() || 'IMPORT',
              String(item.status || 'AT_PORT_DISCHARGED').trim() || 'AT_PORT_DISCHARGED',
              item.customerId ? String(item.customerId) : null,
              String(item.customerName || 'Al-Futtaim Logistics LLC').trim() || 'Al-Futtaim Logistics LLC',
              item.terminalId ? String(item.terminalId) : null,
              String(item.terminalName || 'Jebel Ali Port - Terminal 1 (DP World)').trim() || 'Jebel Ali Port - Terminal 1 (DP World)',
              item.warehouseId ? String(item.warehouseId) : null,
              String(item.warehouseName || 'JAFZA South Bonded Fulfillment Hub (Gate 5)').trim() || 'JAFZA South Bonded Fulfillment Hub (Gate 5)',
              doExp,
              disch,
              item.sealNumber ? String(item.sealNumber).trim() : null,
              weightKg,
              Boolean(item.customsInspection),
              Boolean(item.municipalityInspection),
              Boolean(item.cpipInspection),
              Boolean(item.mercInspection),
              Boolean(item.boxcareInspection),
            );
            createdIds.push(id);
          }
          return { ok: true, createdCount: createdIds.length, ids: createdIds };
        }

        case 'create_trailer': {
          const plateNum = String(body.plateNumber ?? '').trim().toUpperCase();
          if (!plateNum) {
            throw new Error('Trailer Plate Number is mandatory.');
          }
          const id = `tr-${crypto.randomUUID().slice(0, 10)}`;
          await tx.$executeRawUnsafe(
            `INSERT INTO logistics_drayage_trailers (
              id, tenant_id, plate_number, trailer_type, capacity_tons,
              master_status, operational_status, current_location
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            id,
            tenantId,
            plateNum,
            String(body.trailerType || '40FT_SKELETAL').trim() || '40FT_SKELETAL',
            safeNum(body.capacityTons, 45),
            String(body.masterStatus || 'AVAILABLE').trim() || 'AVAILABLE',
            String(body.operationalStatus || 'EMPTY').trim() || 'EMPTY',
            String(body.currentLocation || 'Jebel Ali Main Yard').trim() || 'Jebel Ali Main Yard',
          );
          return { ok: true, id };
        }

        case 'update_trailer': {
          await tx.$executeRawUnsafe(
            `UPDATE logistics_drayage_trailers
                SET plate_number = $3,
                    trailer_type = $4,
                    capacity_tons = $5,
                    master_status = $6,
                    operational_status = $7,
                    current_location = $8,
                    updated_at = NOW()
              WHERE id = $1 AND tenant_id = $2`,
            String(body.id),
            tenantId,
            String(body.plateNumber ?? '').trim().toUpperCase(),
            String(body.trailerType || '40FT_SKELETAL').trim() || '40FT_SKELETAL',
            safeNum(body.capacityTons, 45),
            String(body.masterStatus || 'AVAILABLE').trim() || 'AVAILABLE',
            String(body.operationalStatus || 'EMPTY').trim() || 'EMPTY',
            String(body.currentLocation || 'Jebel Ali Main Yard').trim() || 'Jebel Ali Main Yard',
          );
          return { ok: true };
        }

        case 'delete_trailer': {
          await tx.$executeRawUnsafe(
            `DELETE FROM logistics_drayage_trailers WHERE id = $1 AND tenant_id = $2`,
            String(body.id),
            tenantId,
          );
          return { ok: true };
        }

        case 'save_geofence': {
          const id = body.id ? String(body.id) : `gf-${crypto.randomUUID().slice(0, 10)}`;
          const gfShape = body.type === 'POLYGON' ? 'POLYGON' : 'CIRCLE';
          const effectiveRadius = gfShape === 'POLYGON' ? 0 : Number(body.radiusMeters ?? 1500);
          const coords = Array.isArray(body.coordinates)
            ? JSON.stringify(body.coordinates)
            : String(body.coordinatesJson ?? '[]');
          await tx.$executeRawUnsafe(
            `INSERT INTO logistics_drayage_geofences (
              id, tenant_id, terminal_id, terminal_name, name, type, center_lat, center_lng, radius_meters, coordinates_json
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            ON CONFLICT (id) DO UPDATE
               SET terminal_id = EXCLUDED.terminal_id,
                   terminal_name = EXCLUDED.terminal_name,
                   name = EXCLUDED.name,
                   type = EXCLUDED.type,
                   center_lat = EXCLUDED.center_lat,
                   center_lng = EXCLUDED.center_lng,
                   radius_meters = EXCLUDED.radius_meters,
                   coordinates_json = EXCLUDED.coordinates_json`,
            id,
            tenantId,
            body.terminalId ? String(body.terminalId) : null,
            String(body.terminalName ?? 'Jebel Ali Port - Terminal 1 (DP World)'),
            String(body.name ?? 'Port Gate Zone'),
            gfShape,
            Number(body.centerLat ?? 25.0112),
            Number(body.centerLng ?? 55.0612),
            effectiveRadius,
            coords,
          );

          // If mapped to a client warehouse destination, synchronize the warehouse geofence parameters
          if (body.terminalId) {
            await tx.$executeRawUnsafe(
              `UPDATE logistics_drayage_warehouses
                  SET geofence_configured = true,
                      geofence_type = $3,
                      geofence_radius_meters = $4,
                      geofence_coordinates_json = $5,
                      lat = $6,
                      lng = $7,
                      updated_at = NOW()
                WHERE (id = $1 OR customer_id = $1) AND tenant_id = $2`,
              String(body.terminalId),
              tenantId,
              gfShape,
              effectiveRadius,
              coords,
              Number(body.centerLat ?? 25.0112),
              Number(body.centerLng ?? 55.0612),
            ).catch(() => {});

            // Also synchronize with port terminal if matching terminal ID
            await tx.$executeRawUnsafe(
              `UPDATE logistics_drayage_terminals
                  SET lat = $3,
                      lng = $4,
                      geofence_radius_meters = $5,
                      updated_at = NOW()
                WHERE id = $1 AND tenant_id = $2`,
              String(body.terminalId),
              tenantId,
              Number(body.centerLat ?? 25.0112),
              Number(body.centerLng ?? 55.0612),
              effectiveRadius,
            ).catch(() => {});
          }

          return { ok: true, id };
        }

        case 'delete_geofence': {
          await tx.$executeRawUnsafe(
            `DELETE FROM logistics_drayage_geofences WHERE id = $1 AND tenant_id = $2`,
            String(body.id),
            tenantId,
          );
          return { ok: true };
        }

        case 'create_terminal':
        case 'save_terminal': {
          const id = body.id ? String(body.id) : `term-${crypto.randomUUID().slice(0, 10)}`;
          const termName = String(body.name ?? '').trim();
          const termCode = String(body.code ?? '').toUpperCase().trim();
          if (!termName || !termCode) {
            throw new Error('Terminal Name and Terminal Code are mandatory.');
          }
          const termPort = String(body.portName || 'Jebel Ali Port').trim() || 'Jebel Ali Port';
          const termEmirate = String(body.emirate || 'Dubai').trim() || 'Dubai';
          const termLat = safeNum(body.lat, 25.0112);
          const termLng = safeNum(body.lng, 55.0612);
          const termGfType = body.geofenceType === 'POLYGON' ? 'POLYGON' : 'CIRCLE';
          const termRadius = termGfType === 'POLYGON' ? 0 : safeNum(body.geofenceRadiusMeters, 1500);
          const hasPolyCoords = Array.isArray(body.geofenceCoordinates) && body.geofenceCoordinates.length >= 3;
          const coordsJson = hasPolyCoords
            ? JSON.stringify(body.geofenceCoordinates)
            : JSON.stringify([{ lat: termLat, lng: termLng }]);

          await tx.$executeRawUnsafe(
            `INSERT INTO logistics_drayage_terminals (
              id, tenant_id, name, code, port_name, emirate, lat, lng,
              geofence_radius_meters, free_days_dry, free_days_reefer, operating_hours, status, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'ACTIVE',NOW())
            ON CONFLICT (id) DO UPDATE
               SET name = EXCLUDED.name,
                   code = EXCLUDED.code,
                   port_name = EXCLUDED.port_name,
                   emirate = EXCLUDED.emirate,
                   lat = EXCLUDED.lat,
                   lng = EXCLUDED.lng,
                   geofence_radius_meters = EXCLUDED.geofence_radius_meters,
                   free_days_dry = EXCLUDED.free_days_dry,
                   free_days_reefer = EXCLUDED.free_days_reefer,
                   operating_hours = EXCLUDED.operating_hours,
                   updated_at = NOW()`,
            id,
            tenantId,
            termName,
            termCode,
            termPort,
            termEmirate,
            termLat,
            termLng,
            termRadius,
            safeNum(body.freeDaysDry, 5),
            safeNum(body.freeDaysReefer, 3),
            String(body.operatingHours || '24/7 Gate Operations').trim() || '24/7 Gate Operations',
          );

          // Automatically upsert an associated perimeter geofence for this port terminal
          const existingGfRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id FROM logistics_drayage_geofences WHERE terminal_id = $1 AND tenant_id = $2 LIMIT 1`,
            id,
            tenantId,
          ).catch(() => []);

          if (existingGfRows.length > 0) {
            if (hasPolyCoords || termGfType === 'CIRCLE') {
              await tx.$executeRawUnsafe(
                `UPDATE logistics_drayage_geofences
                    SET terminal_name = $1,
                        name = $2,
                        type = $3,
                        center_lat = $4,
                        center_lng = $5,
                        radius_meters = $6,
                        coordinates_json = $7
                  WHERE id = $8 AND tenant_id = $9`,
                termName,
                `${termName} Perimeter Geofence`,
                termGfType,
                termLat,
                termLng,
                termRadius,
                coordsJson,
                existingGfRows[0].id,
                tenantId,
              ).catch(() => {});
            } else {
              await tx.$executeRawUnsafe(
                `UPDATE logistics_drayage_geofences
                    SET terminal_name = $1,
                        name = $2,
                        type = $3,
                        center_lat = $4,
                        center_lng = $5,
                        radius_meters = $6
                  WHERE id = $7 AND tenant_id = $8`,
                termName,
                `${termName} Perimeter Geofence`,
                termGfType,
                termLat,
                termLng,
                termRadius,
                existingGfRows[0].id,
                tenantId,
              ).catch(() => {});
            }
          } else {
            const gfId = `gf-${id}`;
            await tx.$executeRawUnsafe(
              `INSERT INTO logistics_drayage_geofences (
                id, tenant_id, terminal_id, terminal_name, name, type, center_lat, center_lng, radius_meters, coordinates_json
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
              ON CONFLICT (id) DO UPDATE
                 SET terminal_name = EXCLUDED.terminal_name,
                     name = EXCLUDED.name,
                     type = EXCLUDED.type,
                     center_lat = EXCLUDED.center_lat,
                     center_lng = EXCLUDED.center_lng,
                     radius_meters = EXCLUDED.radius_meters,
                     coordinates_json = EXCLUDED.coordinates_json`,
              gfId,
              tenantId,
              id,
              termName,
              `${termName} Perimeter Geofence`,
              termGfType,
              termLat,
              termLng,
              termRadius,
              coordsJson,
            ).catch(() => {});
          }

          return { ok: true, id };
        }

        case 'delete_terminal': {
          await tx.$executeRawUnsafe(
            `DELETE FROM logistics_drayage_geofences WHERE terminal_id = $1 AND tenant_id = $2`,
            String(body.id),
            tenantId,
          ).catch(() => {});
          await tx.$executeRawUnsafe(
            `DELETE FROM logistics_drayage_terminals WHERE id = $1 AND tenant_id = $2`,
            String(body.id),
            tenantId,
          );
          return { ok: true };
        }

        case 'create_client':
        case 'save_client': {
          const id = body.id ? String(body.id) : `cli-${crypto.randomUUID().slice(0, 10)}`;
          const name = String(body.name ?? '').trim();
          const code = String(body.code ?? '').trim().toUpperCase();
          if (!name || !code) {
            throw new Error('Client Name and Client Code are mandatory.');
          }
          const contactPerson = body.contactPerson ? String(body.contactPerson).trim() : null;
          const contactNo = body.contactNo ? String(body.contactNo).trim() : null;
          const streetAddress = body.streetAddress ? String(body.streetAddress).trim() : null;
          const city = String(body.city || 'Dubai').trim() || 'Dubai';
          const trn = body.trn ? String(body.trn).trim() : null;
          const tradeLicense = body.tradeLicense ? String(body.tradeLicense).trim() : null;
          const defaultTripAmountAed = safeNum(body.defaultTripAmountAed, 1550);
          const defaultDriverAllowanceAed = safeNum(body.defaultDriverAllowanceAed, 150);
          const notes = body.notes ? String(body.notes).trim() : null;

          await tx.$executeRawUnsafe(
            `INSERT INTO logistics_drayage_clients (
              id, tenant_id, name, code, contact_person, contact_no, street_address, city,
              trn, trade_license, default_trip_amount_aed, default_driver_allowance_aed, notes, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
            ON CONFLICT (id) DO UPDATE
               SET name = EXCLUDED.name,
                   code = EXCLUDED.code,
                   contact_person = EXCLUDED.contact_person,
                   contact_no = EXCLUDED.contact_no,
                   street_address = EXCLUDED.street_address,
                   city = EXCLUDED.city,
                   trn = EXCLUDED.trn,
                   trade_license = EXCLUDED.trade_license,
                   default_trip_amount_aed = EXCLUDED.default_trip_amount_aed,
                   default_driver_allowance_aed = EXCLUDED.default_driver_allowance_aed,
                   notes = EXCLUDED.notes,
                   updated_at = NOW()`,
            id,
            tenantId,
            name,
            code,
            contactPerson,
            contactNo,
            streetAddress,
            city,
            trn,
            tradeLicense,
            defaultTripAmountAed,
            defaultDriverAllowanceAed,
            notes,
          );

          return { ok: true, id };
        }

        case 'delete_client': {
          await tx.$executeRawUnsafe(
            `DELETE FROM logistics_drayage_clients WHERE id = $1 AND tenant_id = $2`,
            String(body.id),
            tenantId,
          );
          return { ok: true };
        }

        case 'create_warehouse':
        case 'save_warehouse': {
          if (!String(body.name ?? '').trim()) {
            throw new Error('Facility / Warehouse Name is mandatory.');
          }
          const id = body.id ? String(body.id) : `wh-${crypto.randomUUID().slice(0, 10)}`;
          const geofenceConfigured = Boolean(body.geofenceConfigured);
          const geofenceType = body.geofenceType === 'POLYGON' ? 'POLYGON' : 'CIRCLE';
          const geofenceRadiusMeters = geofenceType === 'POLYGON' ? safeNum(body.geofenceRadiusMeters, 0) : safeNum(body.geofenceRadiusMeters, 800);
          const geofenceCoords = Array.isArray(body.geofenceCoordinates)
            ? JSON.stringify(body.geofenceCoordinates)
            : String(body.geofenceCoordinatesJson || '[]');
          const tripAmountAed = safeNum(body.tripAmountAed, 1550);
          const driverAllowanceAed = safeNum(body.driverAllowanceAed, 150);

          await tx.$executeRawUnsafe(
            `INSERT INTO logistics_drayage_warehouses (
              id, tenant_id, customer_id, customer_name, name, code, zone, address, lat, lng,
              ramps_count, contact_person, contact_phone, geofence_configured, geofence_type,
              geofence_radius_meters, geofence_coordinates_json, trip_amount_aed, driver_allowance_aed, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW())
            ON CONFLICT (id) DO UPDATE
               SET customer_id = EXCLUDED.customer_id,
                   customer_name = EXCLUDED.customer_name,
                   name = EXCLUDED.name,
                   code = EXCLUDED.code,
                   zone = EXCLUDED.zone,
                   address = EXCLUDED.address,
                   lat = EXCLUDED.lat,
                   lng = EXCLUDED.lng,
                   ramps_count = EXCLUDED.ramps_count,
                   contact_person = EXCLUDED.contact_person,
                   contact_phone = EXCLUDED.contact_phone,
                   geofence_configured = EXCLUDED.geofence_configured,
                   geofence_type = EXCLUDED.geofence_type,
                   geofence_radius_meters = EXCLUDED.geofence_radius_meters,
                   geofence_coordinates_json = EXCLUDED.geofence_coordinates_json,
                   trip_amount_aed = EXCLUDED.trip_amount_aed,
                   driver_allowance_aed = EXCLUDED.driver_allowance_aed,
                   updated_at = NOW()`,
            id,
            tenantId,
            body.customerId ? String(body.customerId) : null,
            String(body.customerName || 'Enterprise Shipper').trim() || 'Enterprise Shipper',
            String(body.name || 'Distribution Hub').trim() || 'Distribution Hub',
            body.code ? String(body.code).trim().toUpperCase() : null,
            String(body.zone || 'JAFZA South').trim() || 'JAFZA South',
            String(body.address || 'Jebel Ali Free Zone, Dubai').trim() || 'Jebel Ali Free Zone, Dubai',
            safeNum(body.lat, 24.9642),
            safeNum(body.lng, 55.0915),
            safeNum(body.rampsCount, 8),
            body.contactPerson ? String(body.contactPerson).trim() : null,
            body.contactPhone ? String(body.contactPhone).trim() : null,
            geofenceConfigured,
            geofenceType,
            geofenceRadiusMeters,
            geofenceCoords,
            tripAmountAed,
            driverAllowanceAed,
          );

          if (geofenceConfigured) {
            const gfId = `gf-wh-${id}`;
            await tx.$executeRawUnsafe(
              `INSERT INTO logistics_drayage_geofences (
                id, tenant_id, terminal_id, terminal_name, name, type, center_lat, center_lng, radius_meters, coordinates_json
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
              ON CONFLICT (id) DO UPDATE
                 SET name = EXCLUDED.name,
                     type = EXCLUDED.type,
                     center_lat = EXCLUDED.center_lat,
                     center_lng = EXCLUDED.center_lng,
                     radius_meters = EXCLUDED.radius_meters,
                     coordinates_json = EXCLUDED.coordinates_json`,
              gfId,
              tenantId,
              null,
              String(body.customerName ?? 'Warehouse'),
              `${String(body.name ?? 'Warehouse')} (Facility Geofence)`,
              geofenceType,
              Number(body.lat ?? 24.9642),
              Number(body.lng ?? 55.0915),
              geofenceRadiusMeters,
              geofenceCoords,
            );
          }

          return { ok: true, id };
        }

        case 'delete_warehouse': {
          await tx.$executeRawUnsafe(
            `DELETE FROM logistics_drayage_warehouses WHERE id = $1 AND tenant_id = $2`,
            String(body.id),
            tenantId,
          );
          await tx.$executeRawUnsafe(
            `DELETE FROM logistics_drayage_geofences WHERE id = $1 AND tenant_id = $2`,
            `gf-wh-${String(body.id)}`,
            tenantId,
          );
          return { ok: true };
        }

        case 'create_mapped_vehicle': {
          const id = crypto.randomUUID();
          const plate = String(body.plateNumber ?? '').trim().toUpperCase();
          if (!plate) {
            throw new Error('Vehicle Plate Number is mandatory.');
          }
          await tx.$executeRawUnsafe(
            `INSERT INTO vehicles (
              id, tenant_id, plate_number, license_plate, registration_no,
              make, model, year, type, status, vehicle_usage, fuel_type, is_active, created_at, updated_at
            ) VALUES ($1,$2,$3,$3,$3,$4,$5,$6,'HEAVY_TRUCK','AVAILABLE','LOGISTICS','DIESEL',true,NOW(),NOW())`,
            id,
            tenantId,
            plate,
            String(body.make ?? 'Mercedes-Benz'),
            String(body.model ?? 'Actros 2645 Tractor Head'),
            Number(body.year ?? 2025),
          );
          return { ok: true, id };
        }

        case 'create_mapped_driver': {
          const id = crypto.randomUUID();
          const firstName = String(body.firstName ?? '').trim();
          if (!firstName || !String(body.phone ?? '').trim() || !String(body.licenseNumber ?? '').trim()) {
            throw new Error('Driver First Name, Phone Number, and License Number are mandatory.');
          }
          const lastName = String(body.lastName ?? '').trim();
          const fullName = `${firstName} ${lastName}`.trim();
          const licExpiry = body.licenseExpiry
            ? new Date(String(body.licenseExpiry)).toISOString()
            : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
          await tx.$executeRawUnsafe(
            `INSERT INTO drivers (
              id, tenant_id, name, first_name, last_name, phone, contact_number,
              license_number, license_expiry, status, assignment_type, created_at, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8::timestamptz,'ACTIVE','LOGISTICS',NOW(),NOW())`,
            id,
            tenantId,
            fullName,
            firstName,
            lastName,
            String(body.phone ?? '+971 50 000 0000'),
            String(body.licenseNumber ?? `UAE-HVY-${Math.floor(10000 + Math.random() * 90000)}`),
            licExpiry,
          );
          return { ok: true, id };
        }

        case 'calculate_payments': {
          return calculateMissingAllowances(tx, tenantId);
        }

        case 'submit_driver_expense_receipt': {
          return submitDriverExpenseReceipt(tx, {
            tenantId,
            jobId: String(body.jobId),
            driverName: body.driverName ? String(body.driverName) : undefined,
            receiptCategory: String(body.receiptCategory || 'PORT_GATE_PASS'),
            receiptLabel: String(body.receiptLabel || 'Port Gate Pass Receipt'),
            amountAed: Number(body.amountAed || 0),
            receiptNumber: body.receiptNumber ? String(body.receiptNumber) : undefined,
            notes: body.notes ? String(body.notes) : undefined,
            receiptPhotoUrl: body.receiptPhotoUrl ? String(body.receiptPhotoUrl) : null,
            voiceNoteDataUrl: body.voiceNoteDataUrl ? String(body.voiceNoteDataUrl) : null,
            voiceNoteDurationSec: body.voiceNoteDurationSec ? Number(body.voiceNoteDurationSec) : 0,
          });
        }

        case 'adjust_allowance': {
          return adjustDriverAllowance(tx, {
            tenantId,
            allowanceId: String(body.allowanceId),
            allowanceAmountAed: Number(body.allowanceAmountAed ?? 150),
            portGateFeeAed: Number(body.portGateFeeAed ?? 35),
            overnightHaltAed: Number(body.overnightHaltAed ?? 0),
            bogieBonusAed: Number(body.bogieBonusAed ?? 0),
            streetTurnBonusAed: Number(body.streetTurnBonusAed ?? 0),
            inspectionBonusAed: Number(body.inspectionBonusAed ?? 0),
            adjustmentNotes: body.adjustmentNotes ? String(body.adjustmentNotes) : null,
            actor: userId ?? 'Finance Settlement Desk',
          });
        }

        case 'settle_allowances': {
          const ids: string[] = Array.isArray(body.allowanceIds)
            ? body.allowanceIds.map(String)
            : body.allowanceId
            ? [String(body.allowanceId)]
            : [];
          return settleDriverAllowancesPayout(tx, {
            tenantId,
            allowanceIds: ids,
            paymentMethod: String(body.paymentMethod ?? 'WPS_PAYROLL'),
            paymentRef: body.paymentRef ? String(body.paymentRef) : undefined,
            notes: body.notes ? String(body.notes) : undefined,
            actor: userId ?? 'Finance Settlement Desk',
          });
        }

        case 'update_allowance_status': {
          const newStatus = ['APPROVED', 'PAID', 'PENDING', 'REJECTED'].includes(String(body.status))
            ? String(body.status)
            : 'APPROVED';
          if (newStatus === 'PAID') {
            return settleDriverAllowancesPayout(tx, {
              tenantId,
              allowanceIds: [String(body.allowanceId)],
              paymentMethod: String(body.paymentMethod ?? 'WPS_PAYROLL'),
              paymentRef: body.paymentRef ? String(body.paymentRef) : undefined,
              notes: body.notes ? String(body.notes) : undefined,
              actor: userId ?? 'Fleet Supervisor',
            });
          }
          await tx.$executeRawUnsafe(
            `UPDATE logistics_drayage_allowances
                SET status = $3,
                    approved_by = $4,
                    approved_at = NOW(),
                    adjustment_notes = CASE WHEN $5::text IS NOT NULL AND $5::text != '' THEN $5::text ELSE adjustment_notes END
              WHERE id = $1 AND tenant_id = $2`,
            String(body.allowanceId),
            tenantId,
            newStatus,
            userId ?? 'Fleet Supervisor',
            body.notes ? String(body.notes) : null,
          );
          return { ok: true, status: newStatus };
        }

        case 'bulk_update_allowances': {
          const ids: string[] = Array.isArray(body.allowanceIds) ? body.allowanceIds.map(String) : [];
          const newStatus = ['APPROVED', 'PAID', 'PENDING', 'REJECTED'].includes(String(body.status))
            ? String(body.status)
            : 'APPROVED';
          if (newStatus === 'PAID') {
            const res = await settleDriverAllowancesPayout(tx, {
              tenantId,
              allowanceIds: ids,
              paymentMethod: String(body.paymentMethod ?? 'WPS_PAYROLL'),
              paymentRef: body.paymentRef ? String(body.paymentRef) : undefined,
              actor: userId ?? 'Fleet Supervisor',
            });
            return { ...res, updatedCount: res.settledCount, status: 'PAID' };
          }
          for (const id of ids) {
            await tx.$executeRawUnsafe(
              `UPDATE logistics_drayage_allowances
                  SET status = $3,
                      approved_by = $4,
                      approved_at = NOW()
                WHERE id = $1 AND tenant_id = $2`,
              id,
              tenantId,
              newStatus,
              userId ?? 'Fleet Supervisor',
            );
          }
          return { ok: true, updatedCount: ids.length, status: newStatus };
        }

        case 'record_log': {
          return recordDrayageStatusLog(tx, {
            tenantId,
            jobId: String(body.jobId),
            jobCode: String(body.jobCode ?? 'DRY-JOB'),
            status: String(body.status ?? 'NOTE'),
            notes: String(body.notes ?? ''),
            actor: String(body.actor ?? 'Dispatch Console'),
          });
        }

        case 'consignee_confirm_empty_ready': {
          return consigneeConfirmEmptyReady(tx, {
            tenantId,
            jobId: String(body.jobId),
            receiverName: String(body.receiverName ?? 'Warehouse Ramp Supervisor'),
            bayNotes: body.bayNotes ? String(body.bayNotes) : undefined,
            photoUrl: body.photoUrl ? String(body.photoUrl) : null,
            operationType: body.operationType === 'STUFFING' ? 'STUFFING' : body.operationType === 'DESTUFFING' ? 'DESTUFFING' : undefined,
            newSealNumber: body.newSealNumber ? String(body.newSealNumber) : null,
            grossWeightKg: body.grossWeightKg != null ? Number(body.grossWeightKg) : null,
          });
        }

        case 'submit_pod_evidence': {
          return submitJobPodEvidence(tx, {
            tenantId,
            jobId: String(body.jobId),
            receiverName: String(body.receiverName ?? 'Warehouse Bay Supervisor'),
            photoUrl: body.photoUrl ? String(body.photoUrl) : null,
            notes: body.notes ? String(body.notes) : undefined,
            actor: body.actor ? String(body.actor) : undefined,
          });
        }

        case 'book_pcs_token': {
          return bookPcsToken(tx, {
            tenantId,
            jobId: body.jobId ? String(body.jobId) : undefined,
            containerId: body.containerId ? String(body.containerId) : undefined,
            terminalName: body.terminalName ? String(body.terminalName) : undefined,
            slotWindowMinutes: body.slotWindowMinutes ? Number(body.slotWindowMinutes) : 120,
            actor: body.actor ? String(body.actor) : undefined,
          });
        }

        case 'clear_port_inspection': {
          return clearPortInspection(tx, {
            tenantId,
            containerId: body.containerId ? String(body.containerId) : undefined,
            jobId: body.jobId ? String(body.jobId) : undefined,
            agency: body.agency,
            newSealNumber: body.newSealNumber ? String(body.newSealNumber) : undefined,
            clearedBy: body.clearedBy ? String(body.clearedBy) : undefined,
            notes: body.notes ? String(body.notes) : undefined,
            actor: body.actor ? String(body.actor) : undefined,
          });
        }

        case 'revalidate_delivery_order': {
          return revalidateDeliveryOrder(tx, {
            tenantId,
            containerId: body.containerId ? String(body.containerId) : undefined,
            jobId: body.jobId ? String(body.jobId) : undefined,
            extendDays: body.extendDays ? Number(body.extendDays) : 5,
            actor: body.actor ? String(body.actor) : undefined,
          });
        }

        case 'rebook_pcs_slot': {
          return rebookPcsTokenForTrafficDelay(tx, {
            tenantId,
            jobId: String(body.jobId),
            reason: body.reason ? String(body.reason) : undefined,
            actor: body.actor ? String(body.actor) : undefined,
          });
        }

        case 'swap_slot_rescue_tractor': {
          return swapTractorForPortSlotRescue(tx, {
            tenantId,
            jobId: String(body.jobId),
            vehicleId: body.vehicleId ? String(body.vehicleId) : undefined,
            actor: body.actor ? String(body.actor) : undefined,
          });
        }

        case 'simulate_slot_traffic_delay': {
          return simulatePortSlotTrafficRisk(tx, {
            tenantId,
            jobId: String(body.jobId),
            actor: body.actor ? String(body.actor) : undefined,
          });
        }

        case 'send_customer_milestone_alert': {
          const targetRole =
            body.targetRole === 'CLIENT' || body.targetRole === 'RAMP'
              ? body.targetRole
              : 'CUSTOMER';
          return dispatchDrayageCustomerMilestoneAlert(tx, {
            tenantId,
            jobId: String(body.jobId),
            milestoneStatus: body.milestoneStatus ? String(body.milestoneStatus) : undefined,
            customWhatsApp: body.customerWhatsApp ? String(body.customerWhatsApp) : undefined,
            customEmail: body.customerEmail ? String(body.customerEmail) : undefined,
            targetRole,
            triggerSource: 'MANUAL_DISPATCH',
          });
        }

        case 'update_customer_alert_preferences': {
          return updateDrayageCustomerAlertPreferences(tx, {
            tenantId,
            jobId: String(body.jobId),
            customerWhatsApp: String(body.customerWhatsApp || '+971 50 482 9104'),
            customerEmail: String(body.customerEmail || 'logistics-ops@shipper.ae'),
            clientWhatsApp: body.clientWhatsApp ? String(body.clientWhatsApp) : undefined,
            clientEmail: body.clientEmail ? String(body.clientEmail) : undefined,
            rampWhatsApp: body.rampWhatsApp ? String(body.rampWhatsApp) : undefined,
            autoAlertsEnabled: Boolean(body.autoAlertsEnabled),
          });
        }

        default:
          throw new Error(`Unsupported drayage action: ${action}`);
      }
    });

    const dbMs = performance.now() - dbStart;
    // Invalidate shared workspace/master cache and push real-time SSE notification
    if (
      action === 'extend_etc_time' ||
      action === 'update_status' ||
      action === 'run_etc_auto_check' ||
      action === 'set_auto_l2_mode' ||
      action === 'save_automation_config'
    ) {
      resetEtcAutoActivationThrottle(tenantId);
    }
    emitDrayageEvent(tenantId, {
      type: 'drayage_mutation',
      action,
      jobId: body.jobId ? String(body.jobId) : null,
      jobCode: body.jobCode ? String(body.jobCode) : null,
      containerNumber: body.containerNumber ? String(body.containerNumber) : null,
      vehicleId: body.vehicleId ? String(body.vehicleId) : null,
    });

    const totalMs = performance.now() - t0;
    recordDrayageApiMetric({
      tenantId,
      route: '/api/logistics/drayage',
      method: 'POST',
      actionOrScope: action || 'mutation',
      durationMs: totalMs,
      dbMs,
      status: 200,
      cacheStatus: 'MUTATION',
    });

    return NextResponse.json(result, {
      headers: {
        'Server-Timing': buildServerTimingHeader({
          totalMs,
          dbMs,
          cacheStatus: 'MUTATION',
          scope: action,
        }),
      },
    });
  } catch (error) {
    const totalMs = performance.now() - t0;
    recordDrayageApiMetric({
      tenantId,
      route: '/api/logistics/drayage',
      method: 'POST',
      actionOrScope: action,
      durationMs: totalMs,
      status: 400,
      cacheStatus: 'MUTATION',
      errorMessage: error instanceof Error ? error.message : 'Operation failed',
    });
    console.error('[api/logistics/drayage POST]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Operation failed' },
      { status: 400 },
    );
  }
}
