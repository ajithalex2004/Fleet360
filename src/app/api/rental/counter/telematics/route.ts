export const dynamic = 'force-dynamic';

/**
 * GET  /api/rental/counter/telematics — live CAN-bus odometer/fuel/GPS snapshot, cross-border status & immobilizer history
 * POST /api/rental/counter/telematics — `CHECK_GEOFENCE` (`rental:edit:agreements`) & `IMMOBILIZER` (`rental:approve:agreements`)
 *
 * Security & Safety Invariants:
 *   - Every handler calls `requireAuthorizedTenant(req)` and scopes DB reads/writes via `withTenantRls`.
 *   - `IMMOBILIZER` commands are strictly gated by `rental:approve:agreements` (RAC_MANAGER / TENANT_ADMIN;
 *     RAC_OPERATOR is denied 403) and enforce the Mandatory Road-Safety Interlock (`speed === 0 && ignition === OFF`).
 *   - Optional hardware provider webhook dispatch runs strictly OUTSIDE `withTenantRls`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { requireRentalPermission } from '@/lib/rental/rbac';
import { withSavepoint } from '@/lib/rental/locks';
import { isRentalSecurityError } from '@/lib/rental/security-guards';
import { validateOutboundWebhookUrl } from '@/lib/rental-channels';
import {
  UAE_INTERNATIONAL_BORDERS,
  evaluateCrossBorderGeofenceInTx,
  executeSafeImmobilizerCommandInTx,
  readVehicleCanBusSnapshotInTx,
} from '@/lib/rental/telematics-service';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

interface ImmobilizerHistoryRow {
  id: string;
  vehicle_id: string;
  agreement_id: string | null;
  action: string;
  status: string;
  reason: string;
  speed_at_request_kmh: number | string | null;
  ignition_at_request: boolean | null;
  safety_interlock_passed: boolean;
  requested_by: string;
  approved_by: string | null;
  provider_command_ref: string | null;
  executed_at: Date | string | null;
  restored_at: Date | string | null;
  notes: string | null;
  created_at: Date | string;
}

interface PermitSummaryRow {
  permit_no: string;
  destination_country: string;
  border_post: string | null;
  departure_date: Date | string;
  return_date: Date | string;
  status: string;
}

async function loadVehicleTelematicsDetailInTx(
  tx: TxClient,
  tenantId: string,
  vehicleId: string,
  agreementIdHint?: string | null,
) {
  const snapshot = await readVehicleCanBusSnapshotInTx(tx, tenantId, vehicleId);

  const commands = await withSavepoint<ImmobilizerHistoryRow[]>(
    tx,
    'telematics_get_immob_hist',
    () =>
      tx.$queryRawUnsafe<ImmobilizerHistoryRow[]>(
        `SELECT id::text AS id,
                vehicle_id,
                agreement_id,
                action,
                status,
                reason,
                speed_at_request_kmh,
                ignition_at_request,
                safety_interlock_passed,
                requested_by,
                approved_by,
                provider_command_ref,
                executed_at,
                restored_at,
                notes,
                created_at
           FROM rental_immobilizer_commands
          WHERE tenant_id::text = $1
            AND vehicle_id::text = $2
          ORDER BY created_at DESC
          LIMIT 10`,
        tenantId,
        vehicleId,
      ),
    [],
  );

  const activePermits = await withSavepoint<PermitSummaryRow[]>(
    tx,
    'telematics_get_permits',
    () =>
      tx.$queryRawUnsafe<PermitSummaryRow[]>(
        `SELECT permit_no,
                destination_country,
                border_post,
                departure_date,
                return_date,
                status
           FROM rental_cross_border_permits
          WHERE tenant_id::text = $1
            AND vehicle_id::text = $2
            AND status = 'ISSUED'
            AND revoked_at IS NULL
            AND return_date >= NOW()
          ORDER BY departure_date ASC
          LIMIT 5`,
        tenantId,
        vehicleId,
      ),
    [],
  );

  const geofenceStatus =
    snapshot.latitude !== null && snapshot.longitude !== null
      ? await evaluateCrossBorderGeofenceInTx(tx, tenantId, {
          vehicleId,
          agreementId: agreementIdHint ?? null,
          latitude: snapshot.latitude,
          longitude: snapshot.longitude,
          speedKmh: snapshot.speedKmh,
          persistAlert: false,
        })
      : null;

  return {
    snapshot,
    geofenceStatus,
    activePermits: activePermits.map((p) => ({
      permitNo: p.permit_no,
      destinationCountry: p.destination_country,
      borderPost: p.border_post,
      departureDate:
        p.departure_date instanceof Date ? p.departure_date.toISOString() : String(p.departure_date),
      returnDate:
        p.return_date instanceof Date ? p.return_date.toISOString() : String(p.return_date),
      status: p.status,
    })),
    recentImmobilizerCommands: commands.map((c) => ({
      id: c.id,
      vehicleId: c.vehicle_id,
      agreementId: c.agreement_id,
      action: c.action,
      status: c.status,
      reason: c.reason,
      speedAtRequestKmh: Number(c.speed_at_request_kmh ?? 0),
      ignitionAtRequest: Boolean(c.ignition_at_request),
      safetyInterlockPassed: Boolean(c.safety_interlock_passed),
      requestedBy: c.requested_by,
      approvedBy: c.approved_by,
      providerCommandRef: c.provider_command_ref,
      executedAt: c.executed_at
        ? c.executed_at instanceof Date
          ? c.executed_at.toISOString()
          : String(c.executed_at)
        : null,
      restoredAt: c.restored_at
        ? c.restored_at instanceof Date
          ? c.restored_at.toISOString()
          : String(c.restored_at)
        : null,
      notes: c.notes,
      createdAt:
        c.created_at instanceof Date ? c.created_at.toISOString() : String(c.created_at),
    })),
  };
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'view',
    'agreements',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  const vehicleIdParam = req.nextUrl.searchParams.get('vehicleId')?.trim() || null;

  try {
    if (vehicleIdParam) {
      const detail = await withTenantRls(prisma, tenantId, async (tx) => {
        return loadVehicleTelematicsDetailInTx(tx, tenantId, vehicleIdParam);
      });

      return NextResponse.json({
        ok: true,
        tenantId,
        telemetry: detail.snapshot,
        ...detail,
        supportedBorders: UAE_INTERNATIONAL_BORDERS,
      });
    }

    // Fleet-wide active rented vehicles overview (sequential queries on `tx`)
    const fleetData = await withTenantRls(prisma, tenantId, async (tx) => {
      const activeRentals = await withSavepoint<
        Array<{ vehicle_id: string; agreement_id: string | null; agreement_no: string | null }>
      >(
        tx,
        'telematics_active_fleet',
        () =>
          tx.$queryRawUnsafe(
            `SELECT DISTINCT ON (v.id)
                    v.id::text AS vehicle_id,
                    ra.id::text AS agreement_id,
                    ra.agreement_no
               FROM vehicles v
               LEFT JOIN rental_agreements ra
                 ON ra.vehicle_id = v.id
                AND ra.tenant_id::text = $1
                AND ra.deleted_at IS NULL
                AND ra.status = 'ACTIVE'
              WHERE v.tenant_id::text = $1
                AND v.deleted_at IS NULL
                AND (ra.id IS NOT NULL OR UPPER(COALESCE(v.status::text, '')) = 'RENTED')
              ORDER BY v.id, ra.start_date DESC NULLS LAST
              LIMIT 50`,
            tenantId,
          ),
        [],
      );

      const vehicles = [];
      for (const item of activeRentals) {
        const detail = await loadVehicleTelematicsDetailInTx(
          tx,
          tenantId,
          item.vehicle_id,
          item.agreement_id,
        );
        vehicles.push({
          agreementId: item.agreement_id,
          agreementNo: item.agreement_no,
          ...detail,
        });
      }

      const recentCommands = await withSavepoint<ImmobilizerHistoryRow[]>(
        tx,
        'telematics_fleet_immob_recent',
        () =>
          tx.$queryRawUnsafe<ImmobilizerHistoryRow[]>(
            `SELECT id::text AS id,
                    vehicle_id,
                    agreement_id,
                    action,
                    status,
                    reason,
                    speed_at_request_kmh,
                    ignition_at_request,
                    safety_interlock_passed,
                    requested_by,
                    approved_by,
                    provider_command_ref,
                    executed_at,
                    restored_at,
                    notes,
                    created_at
               FROM rental_immobilizer_commands
              WHERE tenant_id = $1
              ORDER BY created_at DESC
              LIMIT 20`,
            tenantId,
          ),
        [],
      );

      return { vehicles, recentCommands };
    });

    return NextResponse.json({
      ok: true,
      tenantId,
      count: fleetData.vehicles.length,
      vehicles: fleetData.vehicles,
      recentImmobilizerCommands: fleetData.recentCommands,
      supportedBorders: UAE_INTERNATIONAL_BORDERS,
    });
  } catch (err: unknown) {
    if (isRentalSecurityError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    captureException(err, { context: 'rental.counter.telematics.GET' });
    return NextResponse.json({ error: 'Failed to load RAC telematics snapshot' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
  }

  const body = stripTenantOwnershipFields(rawBody as Record<string, unknown>);
  const explicitOp = String(body.operation ?? '').trim().toUpperCase();
  const inferredAction = String(body.action ?? '').trim().toUpperCase();
  const operation =
    explicitOp ||
    (inferredAction === 'IMMOBILIZE' || inferredAction === 'RESTORE'
      ? 'IMMOBILIZER'
      : body.latitude !== undefined && body.longitude !== undefined
        ? 'CHECK_GEOFENCE'
        : '');

  try {
    // ── Operation 1: CHECK_GEOFENCE (`rental:edit:agreements`) ─────────────
    if (operation === 'CHECK_GEOFENCE') {
      const denied = await requireRentalPermission(
        req.headers,
        tenantId,
        'edit',
        'agreements',
        req.nextUrl.pathname,
      );
      if (denied) return denied;

      const vehicleId = typeof body.vehicleId === 'string' ? body.vehicleId.trim() : '';
      if (!vehicleId) {
        return NextResponse.json({ error: 'vehicleId is required' }, { status: 400 });
      }
      const latitude = Number(body.latitude);
      const longitude = Number(body.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return NextResponse.json(
          { error: 'Valid numeric latitude and longitude are required' },
          { status: 400 },
        );
      }
      const agreementId =
        typeof body.agreementId === 'string' && body.agreementId.trim()
          ? body.agreementId.trim()
          : null;
      const speedKmh = body.speedKmh != null ? Number(body.speedKmh) : undefined;

      const evaluation = await withTenantRls(prisma, tenantId, async (tx) => {
        return evaluateCrossBorderGeofenceInTx(tx, tenantId, {
          vehicleId,
          agreementId,
          latitude,
          longitude,
          speedKmh,
          persistAlert: true,
        });
      });

      if (evaluation.breachDetected) {
        void logAudit({
          tenantId,
          userId: authz.userId ?? undefined,
          userRole: authz.role ?? undefined,
          entityType: 'RentalCrossBorderGeofence',
          entityId: vehicleId,
          action: 'CREATE',
          details: `${evaluation.severity} border geofence event (${evaluation.zoneStatus}, ${evaluation.detectedCountry} near ${evaluation.nearestBorderPost}) without active NOC permit.`,
        });
      }

      return NextResponse.json({
        ok: true,
        operation: 'CHECK_GEOFENCE',
        evaluation,
      });
    }

    // ── Operation 2: IMMOBILIZER (`rental:approve:agreements` — Managers ONLY) ──
    if (operation === 'IMMOBILIZER') {
      const denied = await requireRentalPermission(
        req.headers,
        tenantId,
        'approve',
        'agreements',
        req.nextUrl.pathname,
      );
      if (denied) return denied;

      const vehicleId = typeof body.vehicleId === 'string' ? body.vehicleId.trim() : '';
      const actionRaw = typeof body.action === 'string' ? body.action.trim().toUpperCase() : '';
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

      if (!vehicleId) {
        return NextResponse.json({ error: 'vehicleId is required' }, { status: 400 });
      }
      if (actionRaw !== 'IMMOBILIZE' && actionRaw !== 'RESTORE') {
        return NextResponse.json(
          { error: 'action must be IMMOBILIZE or RESTORE' },
          { status: 400 },
        );
      }
      if (reason.length < 3) {
        return NextResponse.json(
          { error: 'reason (minimum 3 characters) is required' },
          { status: 400 },
        );
      }

      const agreementId =
        typeof body.agreementId === 'string' && body.agreementId.trim()
          ? body.agreementId.trim()
          : null;
      const notes = typeof body.notes === 'string' ? body.notes.trim() : null;
      const rawOverride =
        body.telemetryOverride && typeof body.telemetryOverride === 'object'
          ? (body.telemetryOverride as Record<string, unknown>)
          : null;

      const requesterId =
        authz.userId ?? req.headers.get('x-user-id') ?? `role:${authz.role ?? 'RAC_MANAGER'}`;

      // Phase 1 (Inside `withTenantRls`): Evaluate road-safety interlock & persist command ledger
      let command = await withTenantRls(prisma, tenantId, async (tx) => {
        return executeSafeImmobilizerCommandInTx(tx, tenantId, {
          vehicleId,
          agreementId,
          action: actionRaw,
          reason,
          requestedBy: requesterId,
          approvedBy: requesterId,
          notes,
          telemetryOverride: rawOverride
            ? {
                speedKmh: rawOverride.speedKmh != null ? Number(rawOverride.speedKmh) : null,
                ignitionOn:
                  typeof rawOverride.ignitionOn === 'boolean' ? rawOverride.ignitionOn : null,
              }
            : null,
        });
      });

      // Phase 2 (Strictly OUTSIDE `withTenantRls`): Optional external telematics gateway dispatch
      const providerApiUrl = process.env.TELEMATICS_IMMOBILIZER_API_URL?.trim();
      if (providerApiUrl) {
        let safeProviderUrl: string | null = null;
        try {
          safeProviderUrl = validateOutboundWebhookUrl(providerApiUrl);
        } catch {
          safeProviderUrl = null;
        }

        if (safeProviderUrl) {
          try {
            const providerRes = await fetch(safeProviderUrl, {
              method: 'POST',
              redirect: 'error',
              signal: AbortSignal.timeout(8_000),
              headers: {
                'Content-Type': 'application/json',
                ...(process.env.TELEMATICS_IMMOBILIZER_API_KEY
                  ? { Authorization: `Bearer ${process.env.TELEMATICS_IMMOBILIZER_API_KEY}` }
                  : {}),
              },
              body: JSON.stringify({
                commandId: command.id,
                tenantId,
                vehicleId,
                action: command.action,
                mode:
                  command.status === 'PENDING_SAFE_STOP'
                    ? 'ARM_ON_SAFE_STOP_ONLY'
                    : command.action,
                safetyInterlockPassed: command.safetyInterlockPassed,
              }),
            });

            if (providerRes.ok) {
              const providerData = (await providerRes.json().catch(() => ({}))) as Record<
                string,
                unknown
              >;
              const providerRef =
                typeof providerData.commandRef === 'string'
                  ? providerData.commandRef
                  : `prov_${command.id.slice(0, 8)}`;

              await withTenantRls(prisma, tenantId, async (tx) => {
                await withSavepoint(
                  tx,
                  'immob_stamp_prov_ref',
                  () =>
                    tx.$executeRawUnsafe(
                      `UPDATE rental_immobilizer_commands
                          SET provider_command_ref = $3,
                              updated_at = NOW()
                        WHERE tenant_id = $1 AND id::text = $2`,
                      tenantId,
                      command.id,
                      providerRef,
                    ),
                  0,
                );
              });

              command = { ...command, providerCommandRef: providerRef };
            }
          } catch (provErr) {
            captureException(provErr, { context: 'rental.telematics.immobilizer.provider' });
          }
        }
      }

      void logAudit({
        tenantId,
        userId: authz.userId ?? undefined,
        userRole: authz.role ?? undefined,
        entityType: 'RentalImmobilizerCommand',
        entityId: command.id,
        entityName: vehicleId,
        action: 'UPDATE',
        details: `Immobilizer ${command.action} on vehicle ${vehicleId}: status=${command.status}, safetyInterlockPassed=${command.safetyInterlockPassed}, speed=${command.speedAtRequestKmh}km/h, reason="${command.reason}".`,
      });

      return NextResponse.json({
        ok: true,
        operation: 'IMMOBILIZER',
        command,
      });
    }

    return NextResponse.json(
      { error: 'Unsupported operation: expected CHECK_GEOFENCE or IMMOBILIZER' },
      { status: 400 },
    );
  } catch (err: unknown) {
    if (isRentalSecurityError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    captureException(err, { context: 'rental.counter.telematics.POST' });
    return NextResponse.json({ error: 'Telematics operation failed' }, { status: 500 });
  }
}
