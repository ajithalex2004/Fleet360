export const dynamic = 'force-dynamic';

/**
 * GET / POST /api/rental/counter/tolls-fines
 *
 * RAC Counter Salik/Darb Tolls & RTA/Police Traffic Fines Reconciliation API:
 *   - `GET`: Lists matched Salik/Darb toll crossings and RTA/Police traffic fines
 *     for `agreementId` or `vehicleId` (including historical swap segments in
 *     `rental_vehicle_exchanges`), with UAE FTA VATP006/VATP040 billed vs unbilled
 *     breakdown (`0%` Out-of-Scope Fine Principal & Knowledge Dirham vs `5%` Tolls
 *     & Admin Handling Surcharges).
 *   - `POST`: Batch ingests Dubai Salik (2025/2026 dynamic Peak AED 6 / Off-Peak AED 4 /
 *     Night Free AED 0) and Abu Dhabi Darb (AED 4 Peak) crossings + configurable RAC
 *     `adminFee` (default AED 1), auto-matching against active & swapped RAC agreements.
 */

import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { requireRentalPermission } from '@/lib/rental/rbac';
import { withSavepoint } from '@/lib/rental/locks';
import { isRentalSecurityError } from '@/lib/rental/security-guards';
import { matchFineOrToll } from '@/lib/fleet/fine-toll-matcher';
import { calculateUaeTollTariff, type TollSystem } from '@/lib/fines/toll-reconciliation';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const permErr = await requireRentalPermission(
    req.headers,
    tenantId,
    'view',
    'agreements',
    req.nextUrl.pathname,
  );
  if (permErr) return permErr;

  const sp = req.nextUrl.searchParams;
  const agreementId = sp.get('agreementId')?.trim() || null;
  const vehicleId = sp.get('vehicleId')?.trim() || null;
  const billingStatus = (sp.get('billingStatus') ?? 'ALL').trim().toUpperCase(); // ALL | UNBILLED | BILLED

  try {
    const payload = await withTenantRls(prisma, tenantId, async (tx) => {
      let agrWindow: {
        id: string;
        vehicle_id: string | null;
        start_date: string;
        end_date: string;
      } | null = null;

      if (agreementId) {
        const agrRows = await withSavepoint<
          Array<{
            id: string;
            vehicle_id: string | null;
            start_date: Date | string;
            end_date: Date | string;
            actual_return_date: Date | string | null;
          }>
        >(
          tx,
          'counter_tf_agr',
          () =>
            tx.$queryRawUnsafe(
              `SELECT id::text AS id, vehicle_id, start_date, end_date, actual_return_date
                 FROM rental_agreements
                WHERE id::text = $1
                  AND tenant_id = $2
                LIMIT 1`,
              agreementId,
              tenantId,
            ),
          [],
        );
        const agr = agrRows[0];
        if (agr) {
          agrWindow = {
            id: agr.id,
            vehicle_id: agr.vehicle_id,
            start_date: new Date(agr.start_date).toISOString(),
            end_date: new Date(agr.actual_return_date ?? agr.end_date).toISOString(),
          };
        }
      }

      // 1. Load matched toll_transactions
      const tolls = await withSavepoint<Array<Record<string, unknown>>>(
        tx,
        'counter_tf_tolls',
        () =>
          tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
            `SELECT tt.*
               FROM toll_transactions tt
              WHERE tt.tenant_id = $1
                AND ($2::text IS NULL OR tt.vehicle_id = $2)
                AND (
                  $3::text IS NULL
                  OR tt.rental_agreement_id = $3
                  OR (
                    $4::text IS NOT NULL
                    AND tt.rental_agreement_id IS NULL
                    AND tt.vehicle_id = $4
                    AND tt.occurred_at >= $5::timestamptz
                    AND tt.occurred_at <= $6::timestamptz
                  )
                  OR (
                    tt.rental_agreement_id IS NULL
                    AND $5::timestamptz IS NOT NULL
                    AND EXISTS (
                      SELECT 1
                        FROM (
                          SELECT rve.from_vehicle_id AS seg_veh_id,
                                 COALESCE(
                                   LAG(rve.exchange_date) OVER (ORDER BY rve.exchange_date ASC, rve.created_at ASC),
                                   $5::timestamptz
                                 ) AS seg_start,
                                 rve.exchange_date AS seg_end
                            FROM rental_vehicle_exchanges rve
                           WHERE rve.tenant_id = $1
                             AND rve.agreement_id = $3
                        ) seg
                       WHERE seg.seg_veh_id = tt.vehicle_id
                         AND tt.occurred_at >= seg.seg_start
                         AND tt.occurred_at <= seg.seg_end
                    )
                  )
                )
              ORDER BY tt.occurred_at DESC
              LIMIT 250`,
            tenantId,
            vehicleId,
            agreementId,
            agrWindow?.vehicle_id ?? null,
            agrWindow?.start_date ?? null,
            agrWindow?.end_date ?? null,
          ),
        [],
      );

      // 2. Load matched traffic_fines (with fallback if `is_billed_to_customer` absent in legacy DB)
      let fines = await withSavepoint<Array<Record<string, unknown>> | null>(
        tx,
        'counter_tf_fines_v2',
        () =>
          tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
            `SELECT tf.*
               FROM traffic_fines tf
              WHERE tf.tenant_id = $1
                AND ($2::text IS NULL OR tf.vehicle_id = $2)
                AND (
                  $3::text IS NULL
                  OR tf.rental_agreement_id = $3
                  OR (
                    $4::text IS NOT NULL
                    AND tf.rental_agreement_id IS NULL
                    AND tf.vehicle_id = $4
                    AND tf.fine_date >= $5::timestamptz
                    AND tf.fine_date <= $6::timestamptz
                    AND COALESCE(tf.assigned_to, '') <> 'DRIVER'
                  )
                  OR (
                    tf.rental_agreement_id IS NULL
                    AND COALESCE(tf.assigned_to, '') <> 'DRIVER'
                    AND $5::timestamptz IS NOT NULL
                    AND EXISTS (
                      SELECT 1
                        FROM (
                          SELECT rve.from_vehicle_id AS seg_veh_id,
                                 COALESCE(
                                   LAG(rve.exchange_date) OVER (ORDER BY rve.exchange_date ASC, rve.created_at ASC),
                                   $5::timestamptz
                                 ) AS seg_start,
                                 rve.exchange_date AS seg_end
                            FROM rental_vehicle_exchanges rve
                           WHERE rve.tenant_id = $1
                             AND rve.agreement_id = $3
                        ) seg
                       WHERE seg.seg_veh_id = tf.vehicle_id
                         AND tf.fine_date >= seg.seg_start
                         AND tf.fine_date <= seg.seg_end
                    )
                  )
                )
              ORDER BY tf.fine_date DESC
              LIMIT 250`,
            tenantId,
            vehicleId,
            agreementId,
            agrWindow?.vehicle_id ?? null,
            agrWindow?.start_date ?? null,
            agrWindow?.end_date ?? null,
          ),
        null,
      );

      if (fines === null) {
        fines = await withSavepoint<Array<Record<string, unknown>>>(
          tx,
          'counter_tf_fines_legacy',
          () =>
            tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
              `SELECT tf.*
                 FROM traffic_fines tf
                WHERE tf.tenant_id = $1
                  AND ($2::text IS NULL OR tf.vehicle_id = $2)
                  AND ($3::text IS NULL OR tf.rental_agreement_id = $3)
                ORDER BY tf.fine_date DESC
                LIMIT 250`,
              tenantId,
              vehicleId,
              agreementId,
            ),
          [],
        );
      }

      const filteredTolls = tolls.filter((t) => {
        const billed = Boolean(t.is_billed_to_customer);
        if (billingStatus === 'UNBILLED') return !billed;
        if (billingStatus === 'BILLED') return billed;
        return true;
      });

      const filteredFines = fines.filter((f) => {
        const st = String(f.status ?? 'UNPAID').trim().toUpperCase();
        const billed = Boolean(f.is_billed_to_customer) || st === 'PAID' || st === 'WAIVED';
        if (billingStatus === 'UNBILLED') return !billed;
        if (billingStatus === 'BILLED') return billed;
        return true;
      });

      let unbilledFinePrincipalAed = 0;
      let unbilledKnowledgeFeeAed = 0;
      let unbilledFineAdminAed = 0;
      let billedFinePrincipalAed = 0;
      let billedKnowledgeFeeAed = 0;
      let billedFineAdminAed = 0;

      for (const f of fines) {
        const st = String(f.status ?? 'UNPAID').trim().toUpperCase();
        if (st === 'WAIVED' || st === 'CANCELLED') continue;
        const billed = Boolean(f.is_billed_to_customer) || st === 'PAID';
        const principal = round2(Number(f.fine_amount ?? f.amount ?? 0));
        const knowledge = round2(Number(f.knowledge_fee ?? 0));
        const admin = round2(Number(f.admin_fee ?? 0));
        if (billed) {
          billedFinePrincipalAed = round2(billedFinePrincipalAed + principal);
          billedKnowledgeFeeAed = round2(billedKnowledgeFeeAed + knowledge);
          billedFineAdminAed = round2(billedFineAdminAed + admin);
        } else {
          unbilledFinePrincipalAed = round2(unbilledFinePrincipalAed + principal);
          unbilledKnowledgeFeeAed = round2(unbilledKnowledgeFeeAed + knowledge);
          unbilledFineAdminAed = round2(unbilledFineAdminAed + admin);
        }
      }

      let unbilledTollPrincipalAed = 0;
      let unbilledTollAdminAed = 0;
      let billedTollPrincipalAed = 0;
      let billedTollAdminAed = 0;

      for (const t of tolls) {
        const billed = Boolean(t.is_billed_to_customer);
        const principal = round2(Number(t.amount ?? t.toll_amount ?? 0));
        const admin = round2(Number(t.admin_fee ?? 0));
        if (billed) {
          billedTollPrincipalAed = round2(billedTollPrincipalAed + principal);
          billedTollAdminAed = round2(billedTollAdminAed + admin);
        } else {
          unbilledTollPrincipalAed = round2(unbilledTollPrincipalAed + principal);
          unbilledTollAdminAed = round2(unbilledTollAdminAed + admin);
        }
      }

      const unbilledAdminSurchargeAed = round2(unbilledFineAdminAed + unbilledTollAdminAed);
      const billedAdminSurchargeAed = round2(billedFineAdminAed + billedTollAdminAed);
      const unbilledTaxableSubtotalAed = round2(
        unbilledTollPrincipalAed + unbilledAdminSurchargeAed,
      );
      const unbilledOutOfScopeSubtotalAed = round2(
        unbilledFinePrincipalAed + unbilledKnowledgeFeeAed,
      );
      const unbilledVatAed = round2((unbilledTaxableSubtotalAed * 5) / 100);
      const unbilledNetTotalAed = round2(
        unbilledOutOfScopeSubtotalAed + unbilledTaxableSubtotalAed,
      );
      const unbilledGrossTotalAed = round2(unbilledNetTotalAed + unbilledVatAed);

      return {
        tolls: filteredTolls,
        fines: filteredFines,
        breakdown: {
          unbilled: {
            outOfScopeZeroVat: {
              finePrincipalAed: unbilledFinePrincipalAed,
              knowledgeDirhamAed: unbilledKnowledgeFeeAed,
              subtotalAed: unbilledOutOfScopeSubtotalAed,
            },
            standardRatedFivePctVat: {
              tollPrincipalAed: unbilledTollPrincipalAed,
              adminSurchargeAed: unbilledAdminSurchargeAed,
              subtotalAed: unbilledTaxableSubtotalAed,
              vatAmountAed: unbilledVatAed,
            },
            netTotalAed: unbilledNetTotalAed,
            grossTotalAed: unbilledGrossTotalAed,
          },
          billed: {
            finePrincipalAed: billedFinePrincipalAed,
            knowledgeDirhamAed: billedKnowledgeFeeAed,
            tollPrincipalAed: billedTollPrincipalAed,
            adminSurchargeAed: billedAdminSurchargeAed,
          },
        },
      };
    });

    return NextResponse.json(payload);
  } catch (err) {
    if (isRentalSecurityError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[rental/counter/tolls-fines GET] error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch RAC tolls and traffic fines' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const permErr = await requireRentalPermission(
    req.headers,
    tenantId,
    'edit',
    'agreements',
    req.nextUrl.pathname,
  );
  if (permErr) return permErr;

  try {
    const rawBody = await req.json();
    const body = stripTenantOwnershipFields(
      (rawBody && typeof rawBody === 'object' ? rawBody : {}) as Record<string, unknown>,
    ) as Record<string, unknown>;

    const defaultAdminFeeAed =
      body.defaultAdminFee !== undefined && body.defaultAdminFee !== null
        ? Math.max(0, round2(Number(body.defaultAdminFee)))
        : body.adminFee !== undefined && body.adminFee !== null && Array.isArray(body.crossings)
          ? Math.max(0, round2(Number(body.adminFee)))
          : 1;

    const rawCrossings: Array<Record<string, unknown>> = Array.isArray(body.crossings)
      ? (body.crossings as Array<Record<string, unknown>>)
      : Array.isArray(body.items)
        ? (body.items as Array<Record<string, unknown>>)
        : [body];

    if (rawCrossings.length === 0) {
      return NextResponse.json({ error: 'At least one toll crossing is required' }, { status: 400 });
    }
    if (rawCrossings.length > 200) {
      return NextResponse.json(
        { error: 'Batch ingestion is capped at 200 crossings per request' },
        { status: 400 },
      );
    }

    const result = await withTenantRls(prisma, tenantId, async (tx) => {
      const createdTolls: Array<Record<string, unknown>> = [];
      const skipped: Array<{ index: number; reason: string }> = [];
      let matchedToRentalCount = 0;
      let matchedToDriverCount = 0;
      let unmatchedCount = 0;
      let totalTollPrincipalAed = 0;
      let totalAdminFeeAed = 0;

      // Process sequentially on `tx` (never Promise.all on RLS transaction connection)
      for (let idx = 0; idx < rawCrossings.length; idx++) {
        const rawItem = stripTenantOwnershipFields(
          (rawCrossings[idx] && typeof rawCrossings[idx] === 'object'
            ? rawCrossings[idx]
            : {}) as Record<string, unknown>,
        ) as Record<string, unknown>;

        const rawSys = String(rawItem.tollSystem ?? rawItem.system ?? body.tollSystem ?? 'SALIK')
          .trim()
          .toUpperCase();
        const tollSystem: TollSystem = rawSys === 'DARB' ? 'DARB' : 'SALIK';

        const gateName =
          String(
            rawItem.gateName ??
              rawItem.tollGate ??
              rawItem.location ??
              (tollSystem === 'DARB' ? 'Abu Dhabi Darb Gate' : 'Dubai Salik Gate'),
          ).trim() || 'Salik Gate';

        const occurredRaw =
          rawItem.occurredAt ?? rawItem.crossingTimestamp ?? rawItem.timestamp ?? new Date().toISOString();
        const occurredAt = new Date(String(occurredRaw));
        if (Number.isNaN(occurredAt.getTime())) {
          skipped.push({ index: idx, reason: 'Invalid occurredAt timestamp' });
          continue;
        }

        // Resolve vehicleId in tenant (by explicit vehicleId or normalized license plate)
        let resolvedVehicleId =
          typeof rawItem.vehicleId === 'string' && rawItem.vehicleId.trim()
            ? rawItem.vehicleId.trim()
            : null;
        const plateHint = String(
          rawItem.plateNumber ?? rawItem.vehiclePlate ?? rawItem.licensePlate ?? '',
        ).trim();

        if (resolvedVehicleId) {
          const vCheck = await tx.vehicle.findFirst({
            where: { id: resolvedVehicleId, tenantId, deletedAt: null },
            select: { id: true },
          });
          if (!vCheck) {
            skipped.push({ index: idx, reason: `Vehicle ${resolvedVehicleId} not found in tenant` });
            continue;
          }
        } else if (plateHint) {
          const cleanPlate = plateHint.replace(/[\s-]/g, '').toUpperCase();
          const plateRows = await withSavepoint<Array<{ id: string }>>(
            tx,
            'toll_resolve_plate',
            () =>
              tx.$queryRawUnsafe<Array<{ id: string }>>(
                `SELECT id::text AS id
                   FROM vehicles
                  WHERE tenant_id = $1
                    AND deleted_at IS NULL
                    AND UPPER(REGEXP_REPLACE(COALESCE("plateNumber", ''), '[\\s-]+', '', 'g')) = $2
                  LIMIT 1`,
                tenantId,
                cleanPlate,
              ),
            [],
          );
          resolvedVehicleId = plateRows[0]?.id ?? null;
          if (!resolvedVehicleId) {
            skipped.push({ index: idx, reason: `No vehicle matched plate ${plateHint}` });
            continue;
          }
        } else {
          skipped.push({ index: idx, reason: 'vehicleId or plateNumber is required' });
          continue;
        }

        const explicitAmount =
          rawItem.amount !== undefined && rawItem.amount !== null && rawItem.amount !== ''
            ? Number(rawItem.amount)
            : rawItem.tollAmountAed !== undefined &&
                rawItem.tollAmountAed !== null &&
                rawItem.tollAmountAed !== ''
              ? Number(rawItem.tollAmountAed)
              : null;

        const itemAdminOverride =
          rawItem.adminFee !== undefined && rawItem.adminFee !== null && rawItem.adminFee !== ''
            ? Math.max(0, round2(Number(rawItem.adminFee)))
            : defaultAdminFeeAed;

        const quote = calculateUaeTollTariff({
          tollSystem,
          occurredAt,
          explicitTollAmountAed: explicitAmount,
          defaultAdminFeeAed: itemAdminOverride,
          strictDarbWindow: Boolean(rawItem.strictDarbWindow),
        });

        const explicitAgreementId =
          typeof rawItem.rentalAgreementId === 'string' && rawItem.rentalAgreementId.trim()
            ? rawItem.rentalAgreementId.trim()
            : typeof body.agreementId === 'string' && body.agreementId.trim()
              ? body.agreementId.trim()
              : null;

        const match = await matchFineOrToll(tx, {
          tenantId,
          vehicleId: resolvedVehicleId,
          occurredAt,
          amount: quote.tollAmountAed,
          authority: tollSystem,
        });

        const matchedAgreementId =
          explicitAgreementId ??
          (match.assignedTo === 'RENTAL_CUSTOMER' ? (match.rentalAgreementId ?? null) : null);
        const matchedDriverId =
          !matchedAgreementId && match.assignedTo === 'DRIVER' ? (match.driverId ?? null) : null;

        if (matchedAgreementId) {
          matchedToRentalCount++;
        } else if (matchedDriverId) {
          matchedToDriverCount++;
        } else {
          unmatchedCount++;
        }

        const tollId = crypto.randomUUID();
        const nowIso = new Date().toISOString();
        const tagNumber =
          typeof rawItem.tagNumber === 'string' && rawItem.tagNumber.trim()
            ? rawItem.tagNumber.trim()
            : null;

        // Persist crossing in `toll_transactions` (with savepoint fallbacks for schema compatibility)
        let persisted = await withSavepoint<boolean>(
          tx,
          'toll_insert_full',
          async () => {
            await tx.$executeRawUnsafe(
              `INSERT INTO toll_transactions (
                 id, tenant_id, vehicle_id, driver_id, rental_agreement_id,
                 toll_system, gate_name, occurred_at, amount, admin_fee,
                 tag_number, is_billed_to_customer, created_at, updated_at
               ) VALUES (
                 $1, $2, $3, $4, $5,
                 $6, $7, $8::timestamptz, $9, $10,
                 $11, FALSE, $12::timestamptz, $12::timestamptz
               )`,
              tollId,
              tenantId,
              resolvedVehicleId,
              matchedDriverId,
              matchedAgreementId,
              tollSystem,
              gateName,
              occurredAt.toISOString(),
              quote.tollAmountAed,
              quote.adminFeeAed,
              tagNumber,
              nowIso,
            );
            return true;
          },
          false,
        );

        if (!persisted) {
          persisted = await withSavepoint<boolean>(
            tx,
            'toll_insert_core',
            async () => {
              await tx.$executeRawUnsafe(
                `INSERT INTO toll_transactions (
                   id, tenant_id, vehicle_id, rental_agreement_id,
                   gate_name, occurred_at, amount, admin_fee, is_billed_to_customer
                 ) VALUES (
                   $1, $2, $3, $4,
                   $5, $6::timestamptz, $7, $8, FALSE
                 )`,
                tollId,
                tenantId,
                resolvedVehicleId,
                matchedAgreementId,
                gateName,
                occurredAt.toISOString(),
                quote.tollAmountAed,
                quote.adminFeeAed,
              );
              return true;
            },
            false,
          );
        }

        totalTollPrincipalAed = round2(totalTollPrincipalAed + quote.tollAmountAed);
        totalAdminFeeAed = round2(totalAdminFeeAed + quote.adminFeeAed);

        createdTolls.push({
          id: tollId,
          persisted,
          vehicleId: resolvedVehicleId,
          tollSystem,
          gateName,
          occurredAt: occurredAt.toISOString(),
          tariffBand: quote.tariffBand,
          amount: quote.tollAmountAed,
          adminFee: quote.adminFeeAed,
          vatRatePct: quote.vatRatePct,
          rentalAgreementId: matchedAgreementId,
          agreementNo: match.agreementNo ?? null,
          driverId: matchedDriverId,
          assignedTo: matchedAgreementId
            ? 'RENTAL_CUSTOMER'
            : matchedDriverId
              ? 'DRIVER'
              : 'COMPANY',
          isBilledToCustomer: false,
        });
      }

      return {
        ingestedCount: createdTolls.length,
        skippedCount: skipped.length,
        matchedToRentalCount,
        matchedToDriverCount,
        unmatchedCount,
        totalTollPrincipalAed,
        totalAdminFeeAed,
        crossings: createdTolls,
        skipped,
      };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (isRentalSecurityError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[rental/counter/tolls-fines POST] error:', err);
    return NextResponse.json(
      { error: 'Failed to ingest toll crossings' },
      { status: 500 },
    );
  }
}
