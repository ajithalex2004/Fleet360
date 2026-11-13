export const dynamic = 'force-dynamic';

/**
 * GET & POST /api/rental/counter/return (1 Unified Return & Settlement Desk)
 *
 * GET:
 *   Lists ACTIVE rental agreements enriched with Booking, Customer, Vehicle,
 *   canonical `0..100%` fuel + odometer km, original pick-up `vehicle_inspections`
 *   record, and active `rac_card_preauths` hold.
 *
 * POST (3-Phase Transaction-Safe Settlement):
 *   - Phase 0 (Outside RLS): Validates signature & uploads image to storage
 *   - Phase 1 (`withTenantRls` + `withRentalLock`):
 *       1. Records return inspection (`checkout`) & `damage_claims`
 *       2. Quotes rate, late return, excess KM, and canonical `0..100%` fuel surcharge
 *       3. Closes `rental_agreements` (syncing BOTH `fuel_in`/`return_fuel_level` in `0..100%`
 *          and `mileage_in`/`return_odometer` in km), marks booking `COMPLETED`, and computes
 *          safe post-rental vehicle status (`computeSafePostRentalVehicleStatus`)
 *       4. Builds closing `SENT` invoice excluding `EXTENSION` double-billing, using pre-VAT
 *          charge amounts (no VAT-on-VAT), separating `0%` Out-of-Scope statutory fines from
 *          `5%` admin surcharges & unbilled Salik/Darb tolls, and posts `postRacInvoiceIssuedGl`
 *   - Phase 2 (Outside RLS): Captures or releases external `rac_card_preauths` gateway hold
 *   - Phase 3 (`withTenantRls` + `withInvoicePaymentLock`): Records `RRCPT-XXXXXX` payment +
 *     `postRacInvoicePaymentGl` (or collected-deposit deduction/refund GL), then mirrors to Finance
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { getStorage } from '@/lib/storage';
import { detectFileKind } from '@/lib/storage/file-type';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { mirrorRentalInvoiceToFinance } from '@/lib/finance/module-ledger';
import {
  postRacInvoiceIssuedGl,
  postRacInvoicePaymentGl,
  postRacSecurityDepositRefundGl,
  recordRacSecurityDepositCollected,
} from '@/lib/finance/rac-gl-posting';
import {
  pctToEighths,
  resolveInputFuelPct,
  resolveStoredFuelPct,
  resolveStoredOdometerKm,
} from '@/lib/rental/fuel-odometer';
import { requireRentalPermission } from '@/lib/rental/rbac';
import {
  computeSafePostRentalVehicleStatus,
  nextRentalSerial,
  withInvoicePaymentLock,
  withRentalLock,
  withSavepoint,
} from '@/lib/rental/locks';
import { quoteRentalRateInTx } from '@/lib/rental-rate-engine';
import {
  captureRacCardPreAuth,
  releaseRacCardPreAuth,
  toPublicRacPreAuth,
  type PublicRacCardPreAuth,
} from '@/lib/rac-portal/preauth-store';
import {
  escapeIlikePattern,
  isRentalSecurityError,
  validateSafeDocumentOrSignatureUrl,
} from '@/lib/rental/security-guards';
import {
  dispatchUaeRegulatoryReportOutsideRls,
  queueUaeRegulatoryReportInTx,
  type UaeRegulatoryReportRecord,
} from '@/lib/rental/uae-regulatory-reporting';

export const runtime = 'nodejs';

const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function parseJsonSafe<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

const newDamageMarkerSchema = z
  .object({
    zoneId: z.string().optional(),
    zone: z.string().optional(),
    severity: z.enum(['MINOR', 'MODERATE', 'SEVERE']).default('MINOR'),
    description: z.string().optional(),
    note: z.string().optional(),
    estimatedCost: z.coerce.number().min(0).optional(),
  })
  .passthrough();

const returnBodySchema = z
  .object({
    agreementId: z.string().min(1),
    mileageIn: z.coerce.number().min(0).optional(),
    returnOdometer: z.coerce.number().min(0).optional(),
    fuelIn: z.union([z.coerce.number().min(0).max(100), z.string()]).optional(),
    fuelInPct: z.coerce.number().min(0).max(100).optional(),
    returnFuelLevel: z.coerce.number().min(0).max(100).optional(),
    fuelInEighths: z.coerce.number().min(0).max(8).optional(),
    fuelUnit: z.enum(['PCT', 'EIGHTHS']).optional(),
    returnFuelUnit: z.enum(['PCT', 'EIGHTHS']).optional(),
    checklist: z.record(z.string(), z.boolean()).optional(),
    sixPointClearance: z
      .object({
        brakesOk: z.boolean().optional(),
        tyresOk: z.boolean().optional(),
        lightsOk: z.boolean().optional(),
        fluidsOk: z.boolean().optional(),
        windshieldOk: z.boolean().optional(),
        bodySafetyOk: z.boolean().optional(),
      })
      .optional(),
    checklistItems: z
      .array(
        z
          .object({
            key: z.string().optional(),
            label: z.string().optional(),
            passed: z.boolean().optional(),
            safetyCritical: z.boolean().optional(),
          })
          .passthrough(),
      )
      .optional(),
    conditionGrade: z.enum(['CLEAN', 'MINOR_WEAR', 'DAMAGED']).optional(),
    groundVehicleForMaintenance: z.boolean().optional(),
    newDamageMarkers: z.array(newDamageMarkerSchema).optional().default([]),
    damagePhotos: z.array(z.string()).optional().default([]),
    returnNotes: z.string().optional(),
    signatureDataUrl: z.string().optional(),
    settlementAction: z
      .enum(['NONE', 'CAPTURE_INVOICE', 'RELEASE_DEPOSIT'])
      .optional()
      .default('NONE'),
    refundMethod: z.string().optional(),
  })
  .passthrough();

/* ─── GET: Active agreements ready for counter return ─── */
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
    '*',
    req.nextUrl.pathname,
  );
  if (permErr) return permErr;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const sp = req.nextUrl.searchParams;
      const agreementId = sp.get('agreementId')?.trim() ?? '';
      const search = sp.get('search')?.trim() ?? '';

      const clauses: string[] = ['ra.tenant_id::text = $1', "ra.status = 'ACTIVE'"];
      const params: unknown[] = [tenantId];
      let idx = 2;

      if (agreementId) {
        clauses.push(`ra.id = $${idx++}`);
        params.push(agreementId);
      }
      if (search) {
        const escaped = escapeIlikePattern(search);
        clauses.push(
          `(COALESCE(ra.agreement_no, '') ILIKE $${idx} ESCAPE '\\' OR COALESCE(rb.booking_ref, '') ILIKE $${idx} ESCAPE '\\' OR COALESCE(rc.full_name, '') ILIKE $${idx} ESCAPE '\\' OR COALESCE(rc.company_name, '') ILIKE $${idx} ESCAPE '\\' OR COALESCE(v.plate_number, v.license_plate, v.registration_no, '') ILIKE $${idx} ESCAPE '\\')`,
        );
        params.push(`%${escaped}%`);
        idx++;
      }

      const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT
           ra.id,
           ra.agreement_no,
           ra.booking_id,
           ra.customer_id,
           COALESCE(ra.vehicle_id, rb.vehicle_id) AS vehicle_id,
           ra.start_date,
           ra.end_date,
           ra.daily_rate,
           ra.total_amount,
           ra.currency,
           ra.security_deposit,
           ra.deposit_status,
           ra.mileage_out,
           ra.fuel_out,
           ra.pickup_odometer,
           ra.pickup_fuel_level,
           ra.pickup_location_code,
           ra.dropoff_location_code,
           ra.customer_type,
           ra.is_corporate,
           ra.corporate_account_id,
           ra.channel,
           ra.promo_code,
           ra.insurance_plan_code,
           ra.status,
           rb.booking_ref,
           rb.vehicle_category AS booking_category,
           rb.channel AS booking_channel,
           rb.pickup_date,
           rb.dropoff_date,
           rc.customer_type AS rc_customer_type,
           rc.full_name AS customer_full_name,
           rc.company_name AS customer_company_name,
           rc.phone AS customer_phone,
           rc.email AS customer_email,
           COALESCE(v.plate_number, v.license_plate, v.registration_no) AS plate_number,
           v.make AS vehicle_make,
           v.model AS vehicle_model,
           COALESCE(v.current_mileage, v.odometer_reading, 0) AS vehicle_mileage,
           v.category AS vehicle_category,
           pi.id AS insp_id,
           pi.mileage AS insp_mileage,
           pi.fuel_level AS insp_fuel_level,
           pi.damage_markers AS insp_damage_markers,
           pi.damages AS insp_damages,
           pi.photos AS insp_photos,
           pi.checklist_items AS insp_checklist_items,
           pi.notes AS insp_notes,
           pi.created_at AS insp_created_at,
           pa.id::text AS pa_id,
           pa.amount::text AS pa_amount,
           pa.captured_amount::text AS pa_captured_amount,
           pa.currency AS pa_currency,
           pa.provider AS pa_provider,
           pa.authorization_code AS pa_authorization_code,
           pa.card_brand AS pa_card_brand,
           pa.card_last4 AS pa_card_last4,
           pa.cardholder_name AS pa_cardholder_name,
           pa.status AS pa_status,
           pa.expires_at::text AS pa_expires_at,
           pa.created_at::text AS pa_created_at
         FROM rental_agreements ra
         LEFT JOIN rental_bookings rb ON rb.id = ra.booking_id AND rb.tenant_id::text = ra.tenant_id::text
         LEFT JOIN rental_customers rc ON rc.id = ra.customer_id AND rc.tenant_id::text = ra.tenant_id::text
         LEFT JOIN vehicles v ON v.id = COALESCE(ra.vehicle_id, rb.vehicle_id) AND v.tenant_id::text = ra.tenant_id::text
         LEFT JOIN LATERAL (
           SELECT id, mileage, fuel_level, damages, damage_markers, photos, checklist_items, notes, created_at
             FROM vehicle_inspections
            WHERE ra.booking_id IS NOT NULL
              AND booking_id = ra.booking_id
              AND tenant_id::text = $1
              AND type IN ('checkin', 'PICKUP', 'PRE_RENTAL')
            ORDER BY created_at DESC
            LIMIT 1
         ) pi ON true
         LEFT JOIN LATERAL (
           SELECT id, amount, captured_amount, currency, provider, authorization_code,
                  card_brand, card_last4, cardholder_name, status, expires_at, created_at
             FROM rac_card_preauths
            WHERE (agreement_id = ra.id OR (ra.booking_id IS NOT NULL AND booking_id = ra.booking_id))
              AND tenant_id::text = $1
            ORDER BY CASE WHEN status = 'AUTHORIZED' THEN 0 ELSE 1 END, created_at DESC
            LIMIT 1
         ) pa ON true
         WHERE ${clauses.join(' AND ')}
         ORDER BY ra.end_date ASC
         LIMIT 100`,
        ...params,
      );

      const agreements = rows.map((r) => {
        const pickupFuelLevel =
          resolveStoredFuelPct(r.pickup_fuel_level ?? r.insp_fuel_level, r.fuel_out) ?? 100;
        const pickupOdometer =
          resolveStoredOdometerKm(r.pickup_odometer, r.mileage_out) ??
          resolveStoredOdometerKm(r.insp_mileage, r.vehicle_mileage) ??
          0;

        const parsedMarkers = parseJsonSafe<unknown[]>(
          r.insp_damage_markers ?? r.insp_damages,
          [],
        );
        const parsedPhotos = parseJsonSafe<string[]>(r.insp_photos, []);
        const parsedChecklist = parseJsonSafe<Record<string, boolean> | unknown[]>(
          r.insp_checklist_items,
          {},
        );

        return {
          id: String(r.id),
          agreementNo: (r.agreement_no as string | null) ?? null,
          bookingId: r.booking_id ? String(r.booking_id) : null,
          customerId: String(r.customer_id),
          vehicleId: (r.vehicle_id as string | null) ?? null,
          startDate: r.start_date ? new Date(String(r.start_date)).toISOString() : null,
          endDate: r.end_date ? new Date(String(r.end_date)).toISOString() : null,
          dailyRate: Number(r.daily_rate ?? 0),
          totalAmount: Number(r.total_amount ?? 0),
          currency: String(r.currency ?? 'AED'),
          securityDeposit: Number(r.security_deposit ?? 0),
          depositStatus: String(r.deposit_status ?? 'PENDING'),
          mileageOut: pickupOdometer,
          fuelOut: pickupFuelLevel,
          fuelOutEighths: pctToEighths(pickupFuelLevel),
          pickupOdometer,
          pickupFuelLevel,
          status: String(r.status ?? 'ACTIVE'),
          booking: {
            id: r.booking_id ? String(r.booking_id) : '',
            bookingRef: (r.booking_ref as string | null) ?? 'WALK-IN',
            category:
              (r.booking_category as string | null) ??
              (r.vehicle_category as string | null) ??
              'ECONOMY',
            pickupDate: r.pickup_date
              ? new Date(String(r.pickup_date)).toISOString()
              : r.start_date
                ? new Date(String(r.start_date)).toISOString()
                : null,
            dropoffDate: r.dropoff_date
              ? new Date(String(r.dropoff_date)).toISOString()
              : r.end_date
                ? new Date(String(r.end_date)).toISOString()
                : null,
          },
          customer: {
            id: String(r.customer_id),
            fullName: (r.customer_full_name as string | null) ?? '',
            companyName: (r.customer_company_name as string | null) ?? null,
            phone: (r.customer_phone as string | null) ?? null,
            email: (r.customer_email as string | null) ?? null,
          },
          vehicle: r.vehicle_id
            ? {
                id: String(r.vehicle_id),
                plateNumber: (r.plate_number as string | null) ?? null,
                make: (r.vehicle_make as string | null) ?? null,
                model: (r.vehicle_model as string | null) ?? null,
                currentMileage: Number(r.vehicle_mileage ?? 0),
              }
            : null,
          pickupInspection: r.insp_id
            ? {
                id: String(r.insp_id),
                mileage: Number(r.insp_mileage ?? pickupOdometer),
                fuelLevel: Number(r.insp_fuel_level ?? pickupFuelLevel),
                damageMarkers: parsedMarkers,
                photos: parsedPhotos,
                checklistItems: parsedChecklist,
                notes: (r.insp_notes as string | null) ?? null,
                createdAt: r.insp_created_at
                  ? new Date(String(r.insp_created_at)).toISOString()
                  : null,
              }
            : null,
          preauth: r.pa_id
            ? {
                id: String(r.pa_id),
                amount: Number(r.pa_amount ?? 0),
                capturedAmount: Number(r.pa_captured_amount ?? 0),
                currency: String(r.pa_currency ?? 'AED'),
                provider: String(r.pa_provider ?? 'sandbox'),
                authorizationCode: String(r.pa_authorization_code ?? ''),
                cardBrand: (r.pa_card_brand as string | null) ?? null,
                cardLast4: (r.pa_card_last4 as string | null) ?? null,
                cardholderName: (r.pa_cardholder_name as string | null) ?? null,
                status: String(r.pa_status ?? 'AUTHORIZED'),
                expiresAt: (r.pa_expires_at as string | null) ?? null,
                createdAt: (r.pa_created_at as string | null) ?? null,
              }
            : null,
        };
      });

      let settlementContext: Record<string, unknown> | undefined;
      if (agreementId && agreements[0] && rows[0]) {
        const targetAgr = agreements[0];
        const rawAgr = rows[0];
        const nowDate = new Date();
        const startDate = rawAgr.start_date ? new Date(String(rawAgr.start_date)) : nowDate;
        const scheduledEnd = rawAgr.end_date ? new Date(String(rawAgr.end_date)) : nowDate;
        const quoteEnd = nowDate > scheduledEnd ? nowDate : scheduledEnd;

        const swapRows = await withSavepoint<Array<Record<string, unknown>>>(
          tx,
          'ret_ctx_swaps',
          () =>
            tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
              `SELECT rve.*,
                      COALESCE(fv.plate_number, fv.license_plate, fv.registration_no) AS from_plate,
                      fv.make AS from_make,
                      fv.model AS from_model,
                      COALESCE(tv.plate_number, tv.license_plate, tv.registration_no) AS to_plate,
                      tv.make AS to_make,
                      tv.model AS to_model
                 FROM rental_vehicle_exchanges rve
                 LEFT JOIN vehicles fv ON fv.id = rve.from_vehicle_id AND fv.tenant_id::text = $2
                 LEFT JOIN vehicles tv ON tv.id = rve.to_vehicle_id AND tv.tenant_id::text = $2
                WHERE rve.agreement_id = $1
                  AND rve.tenant_id::text = $2
                ORDER BY COALESCE(rve.exchange_date, rve.created_at) ASC, rve.created_at ASC`,
              targetAgr.id,
              tenantId,
            ),
          [],
        );

        const vehicleExchanges = swapRows.map((ex) => ({
          id: String(ex.id),
          exchangeNo: (ex.exchange_no as string | null) ?? null,
          exchangeDate: ex.exchange_date ? new Date(String(ex.exchange_date)).toISOString() : null,
          reason: (ex.reason as string | null) ?? null,
          fromVehicleId: String(ex.from_vehicle_id),
          fromPlateNumber: (ex.from_plate as string | null) ?? null,
          fromMake: (ex.from_make as string | null) ?? null,
          fromModel: (ex.from_model as string | null) ?? null,
          fromMileageIn: resolveStoredOdometerKm(ex.from_mileage_in, ex.mileage_at_swap) ?? 0,
          fromFuelIn: resolveStoredFuelPct(ex.from_fuel_in, ex.fuel_at_swap) ?? 100,
          toVehicleId: String(ex.to_vehicle_id),
          toPlateNumber: (ex.to_plate as string | null) ?? null,
          toMake: (ex.to_make as string | null) ?? null,
          toModel: (ex.to_model as string | null) ?? null,
          toMileageOut: resolveStoredOdometerKm(ex.to_mileage_out, 0) ?? 0,
          toFuelOut: resolveStoredFuelPct(ex.to_fuel_out, 100) ?? 100,
          rateDifference: Number(ex.rate_difference ?? 0),
        }));

        const segmentVehicleIds = Array.from(
          new Set(
            [
              targetAgr.vehicleId,
              ...vehicleExchanges.flatMap((ex) => [ex.fromVehicleId, ex.toVehicleId]),
            ].filter((v): v is string => Boolean(v)),
          ),
        );

        let fineRows = await withSavepoint<Array<Record<string, unknown>> | null>(
          tx,
          'ret_ctx_fines_v2',
          () =>
            tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
              `SELECT *
                 FROM traffic_fines tf
                WHERE tf.tenant_id::text = $1
                  AND (
                    tf.rental_agreement_id = $2
                    OR (
                      CARDINALITY($3::text[]) > 0
                      AND tf.rental_agreement_id IS NULL
                      AND tf.vehicle_id::text = ANY($3::text[])
                      AND tf.fine_date >= $4::timestamptz
                      AND tf.fine_date <= $5::timestamptz
                      AND COALESCE(tf.assigned_to, '') <> 'DRIVER'
                    )
                  )
                  AND COALESCE(tf.is_billed_to_customer, false) = false
                  AND UPPER(COALESCE(tf.status, 'UNPAID')) <> 'PAID'
                ORDER BY tf.fine_date DESC`,
              tenantId,
              targetAgr.id,
              segmentVehicleIds,
              startDate.toISOString(),
              nowDate.toISOString(),
            ),
          null,
        );
        if (fineRows === null) {
          fineRows = await withSavepoint<Array<Record<string, unknown>>>(
            tx,
            'ret_ctx_fines_legacy',
            () =>
              tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
                `SELECT *
                   FROM traffic_fines tf
                  WHERE tf.tenant_id::text = $1
                    AND (
                      tf.rental_agreement_id = $2
                      OR (
                        CARDINALITY($3::text[]) > 0
                        AND tf.rental_agreement_id IS NULL
                        AND tf.vehicle_id::text = ANY($3::text[])
                        AND tf.fine_date >= $4::timestamptz
                        AND tf.fine_date <= $5::timestamptz
                        AND COALESCE(tf.assigned_to, '') <> 'DRIVER'
                      )
                    )
                    AND UPPER(COALESCE(tf.status, 'UNPAID')) = 'UNPAID'
                  ORDER BY tf.fine_date DESC`,
                tenantId,
                targetAgr.id,
                segmentVehicleIds,
                startDate.toISOString(),
                nowDate.toISOString(),
              ),
            [],
          );
        }

        const unbilledTrafficFines = fineRows.map((tf) => ({
          id: String(tf.id),
          fineRef: (tf.fine_ref as string | null) ?? null,
          offenceType: (tf.offence_type as string | null) ?? 'Traffic fine',
          fineDate: tf.fine_date ? new Date(String(tf.fine_date)).toISOString() : null,
          fineAmount: round2(Number(tf.fine_amount ?? tf.amount ?? 0)),
          knowledgeFee: round2(Number(tf.knowledge_fee ?? 0)),
          adminFee: round2(Number(tf.admin_fee ?? 0)),
          status: String(tf.status ?? 'UNPAID'),
          vehicleId: (tf.vehicle_id as string | null) ?? null,
        }));

        const tollRows = await withSavepoint<Array<Record<string, unknown>>>(
          tx,
          'ret_ctx_tolls',
          () =>
            tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
              `SELECT *
                 FROM toll_transactions tt
                WHERE tt.tenant_id::text = $1
                  AND (
                    tt.rental_agreement_id = $2
                    OR (
                      CARDINALITY($3::text[]) > 0
                      AND tt.rental_agreement_id IS NULL
                      AND tt.vehicle_id::text = ANY($3::text[])
                      AND tt.occurred_at >= $4::timestamptz
                      AND tt.occurred_at <= $5::timestamptz
                    )
                  )
                  AND COALESCE(tt.is_billed_to_customer, false) = false
                ORDER BY tt.occurred_at DESC`,
              tenantId,
              targetAgr.id,
              segmentVehicleIds,
              startDate.toISOString(),
              nowDate.toISOString(),
            ),
          [],
        );

        const unbilledTolls = tollRows.map((toll) => ({
          id: String(toll.id),
          gateName: String(
            toll.gate_name ??
              toll.toll_gate ??
              toll.location ??
              toll.toll_system ??
              'Salik / Darb Toll',
          ),
          occurredAt: toll.occurred_at ? new Date(String(toll.occurred_at)).toISOString() : null,
          amount: round2(Number(toll.amount ?? toll.toll_amount ?? 0)),
          adminFee: round2(Number(toll.admin_fee ?? 0)),
          tollSystem: (toll.toll_system as string | null) ?? null,
          vehicleId: (toll.vehicle_id as string | null) ?? null,
        }));

        const chargeRows = await withSavepoint<Array<Record<string, unknown>>>(
          tx,
          'ret_ctx_charges',
          () =>
            tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
              `SELECT id, charge_type, description, quantity, amount::text AS amount
                 FROM rental_additional_charges
                WHERE agreement_id = $1
                  AND tenant_id::text = $2
                  AND COALESCE(billed_to_customer, true) = true
                  AND UPPER(COALESCE(charge_type, '')) <> 'EXTENSION'
                ORDER BY created_at ASC`,
              targetAgr.id,
              tenantId,
            ),
          [],
        );

        const additionalCharges = chargeRows.map((ch) => {
          const qty = Math.max(1, Number(ch.quantity ?? 1));
          const unitAmount = round2(Number(ch.amount ?? 0));
          return {
            id: String(ch.id),
            chargeType: String(ch.charge_type ?? 'EXTRA').toUpperCase(),
            description: (ch.description as string | null) ?? String(ch.charge_type ?? 'Extra'),
            quantity: qty,
            unitAmount,
            preVatTotal: round2(qty * unitAmount),
          };
        });

        const preauthHoldRows = await withSavepoint<Array<Record<string, unknown>>>(
          tx,
          'ret_ctx_preauths',
          () =>
            tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
              `SELECT id::text AS id, amount::text AS amount, captured_amount::text AS captured_amount,
                      currency, provider, authorization_code, card_brand, card_last4,
                      cardholder_name, status, expires_at::text AS expires_at, created_at::text AS created_at
                 FROM rac_card_preauths
                WHERE (agreement_id = $1 OR ($2::text IS NOT NULL AND booking_id = $2))
                  AND tenant_id::text = $3
                ORDER BY CASE WHEN status = 'AUTHORIZED' THEN 0 ELSE 1 END, created_at DESC`,
              targetAgr.id,
              targetAgr.bookingId,
              tenantId,
            ),
          [],
        );

        const preauthHolds = preauthHoldRows.map((pa) => ({
          id: String(pa.id),
          amount: Number(pa.amount ?? 0),
          capturedAmount: Number(pa.captured_amount ?? 0),
          currency: String(pa.currency ?? 'AED'),
          provider: String(pa.provider ?? 'sandbox'),
          authorizationCode: String(pa.authorization_code ?? ''),
          cardBrand: (pa.card_brand as string | null) ?? null,
          cardLast4: (pa.card_last4 as string | null) ?? null,
          cardholderName: (pa.cardholder_name as string | null) ?? null,
          status: String(pa.status ?? 'AUTHORIZED'),
          expiresAt: (pa.expires_at as string | null) ?? null,
          createdAt: (pa.created_at as string | null) ?? null,
        }));

        const quotePreview = await withSavepoint(
          tx,
          'ret_ctx_quote',
          () =>
            quoteRentalRateInTx(tx, tenantId, {
              vehicleCategory: targetAgr.booking.category,
              pickupDate: startDate,
              dropoffDate: quoteEnd,
              pickupLocationCode: (rawAgr.pickup_location_code as string | null) ?? undefined,
              dropoffLocationCode: (rawAgr.dropoff_location_code as string | null) ?? undefined,
              customerType:
                (rawAgr.customer_type as string | null) ??
                (rawAgr.rc_customer_type as string | null) ??
                (rawAgr.is_corporate ? 'CORPORATE' : 'INDIVIDUAL'),
              corporateAccountId: (rawAgr.corporate_account_id as string | null) ?? undefined,
              channel:
                (rawAgr.channel as string | null) ??
                (rawAgr.booking_channel as string | null) ??
                'DIRECT',
              promoCode: (rawAgr.promo_code as string | null) ?? undefined,
              insurancePlanCode: (rawAgr.insurance_plan_code as string | null) ?? undefined,
              currency: targetAgr.currency,
            }),
          null,
        );

        const pricingRule = quotePreview
          ? {
              dailyRate: quotePreview.dailyRate,
              totalDays: quotePreview.totalDays,
              subtotal: quotePreview.subtotal,
              discountAmount: quotePreview.discountAmount,
              includedKmPerDay: quotePreview.includedKmPerDay ?? 250,
              excessKmRate: quotePreview.excessKmRate ?? 0,
              lateFeePerHour: quotePreview.lateFeePerHour ?? 0,
              lateFeeCap: quotePreview.lateFeeCap ?? 0,
              gracePeriodMin: quotePreview.gracePeriodMin ?? 30,
              breakdown: quotePreview.breakdown,
            }
          : {
              dailyRate: targetAgr.dailyRate,
              totalDays: Math.max(
                1,
                Math.ceil((quoteEnd.getTime() - startDate.getTime()) / 86_400_000),
              ),
              subtotal: targetAgr.totalAmount,
              discountAmount: 0,
              includedKmPerDay: 250,
              excessKmRate: 0,
              lateFeePerHour: 0,
              lateFeeCap: 0,
              gracePeriodMin: 30,
              breakdown: [],
            };

        settlementContext = {
          vehicleExchanges,
          unbilledTrafficFines,
          unbilledTolls,
          additionalCharges,
          preauthHolds,
          pricingRule,
        };

        Object.assign(agreements[0] as Record<string, unknown>, settlementContext);
      }

      return NextResponse.json({
        agreements,
        ...(settlementContext ? { settlementContext } : {}),
      });
    } catch (err) {
      captureException(err, { context: 'rental.counter.return.get' });
      console.error('[counter return GET] error:', err);
      return NextResponse.json({ error: 'Failed to load active agreements' }, { status: 500 });
    }
  });
}

/* ─── POST: Unified Counter Return Check-In & Settlement ─── */
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const counterPermErr = await requireRentalPermission(
    req.headers,
    tenantId,
    'create',
    'counter',
    req.nextUrl.pathname,
  );
  if (counterPermErr) return counterPermErr;

  try {
    const jsonRaw = await req.json().catch(() => null);
    const json = stripTenantOwnershipFields(
      (jsonRaw && typeof jsonRaw === 'object' ? jsonRaw : {}) as Record<string, unknown>,
    ) as Record<string, unknown>;
    const parsed = returnBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
        { status: 400 },
      );
    }
    const data = parsed.data;

    const rawMileageIn = data.mileageIn ?? data.returnOdometer;
    if (rawMileageIn === undefined || rawMileageIn === null || rawMileageIn < 0) {
      return NextResponse.json(
        { error: 'Validation failed: mileageIn (or returnOdometer) is required' },
        { status: 400 },
      );
    }
    const mileageIn = Math.round(rawMileageIn);

    const returnFuelPct = resolveInputFuelPct(json, 'return', 'EIGHTHS');
    if (returnFuelPct === null) {
      return NextResponse.json(
        { error: 'Validation failed: fuelIn (or returnFuelLevel) is required' },
        { status: 400 },
      );
    }

    // Deposit release requires manager/admin permission (`rental:approve:deposits`)
    if (data.settlementAction === 'RELEASE_DEPOSIT') {
      const denied = await requireRentalPermission(
        req.headers,
        tenantId,
        'approve',
        'deposits',
        req.nextUrl.pathname,
      );
      if (denied) return denied;
    } else if (data.settlementAction === 'CAPTURE_INVOICE') {
      const capDenied = await requireRentalPermission(
        req.headers,
        tenantId,
        'create',
        'preauth',
        req.nextUrl.pathname,
      );
      if (capDenied) return capDenied;
    }

    // Validate signature URL and damage photo URLs against XSS / SSRF / SVG injection
    const safeSignatureInput = validateSafeDocumentOrSignatureUrl(data.signatureDataUrl, {
      fieldName: 'signatureDataUrl',
    });
    const safeDamagePhotos: string[] = [];
    for (const rawPhoto of data.damagePhotos ?? []) {
      const validated = validateSafeDocumentOrSignatureUrl(rawPhoto, {
        fieldName: 'damagePhoto',
      });
      if (validated) safeDamagePhotos.push(validated);
    }

    // Phase 0: Optional return signature upload OUTSIDE `withTenantRls`
    let signatureUrl: string | null = null;
    if (safeSignatureInput?.startsWith('data:image/')) {
      try {
        const match = safeSignatureInput.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
        const buffer = match ? Buffer.from(match[2], 'base64') : null;
        const kind =
          buffer && buffer.length <= MAX_SIGNATURE_BYTES ? detectFileKind(buffer) : null;
        if (buffer && (kind === 'png' || kind === 'jpeg')) {
          const stored = await getStorage().upload({
            buffer,
            originalName: `ret-sig-${data.agreementId.slice(0, 8)}.${kind === 'png' ? 'png' : 'jpg'}`,
            mimeType: kind === 'png' ? 'image/png' : 'image/jpeg',
            prefix: `rental/return/${data.agreementId}`,
          });
          signatureUrl = stored.url;
        } else {
          return NextResponse.json(
            { error: 'Invalid return signature image encoding (PNG or JPEG required)' },
            { status: 400 },
          );
        }
      } catch (err) {
        captureException(err, { context: 'rental.counter.return.signature' });
      }
    } else if (safeSignatureInput) {
      signatureUrl = safeSignatureInput;
    }

    const actor = (req.headers.get('x-user-id') ?? '').trim() || 'counter-staff';

    // Phase 1: Close agreement, safely transition vehicle, create invoice & post issue GL inside RLS + lock
    const txOutcome = await withTenantRls(prisma, tenantId, async (tx) => {
      const agrRows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT
           ra.*,
           rb.vehicle_category AS booking_category,
           rb.channel AS booking_channel,
           COALESCE(ra.vehicle_id, rb.vehicle_id) AS resolved_vehicle_id,
           v.category AS vehicle_category,
           COALESCE(v.plate_number, v.license_plate, v.registration_no) AS vehicle_plate,
           v.type AS vehicle_type,
           rc.customer_type AS rc_customer_type,
           rc.full_name AS rc_full_name
         FROM rental_agreements ra
         LEFT JOIN rental_bookings rb ON rb.id = ra.booking_id AND rb.tenant_id::text = ra.tenant_id::text
         LEFT JOIN vehicles v ON v.id = COALESCE(ra.vehicle_id, rb.vehicle_id) AND v.tenant_id::text = ra.tenant_id::text
         LEFT JOIN rental_customers rc ON rc.id = ra.customer_id AND rc.tenant_id::text = ra.tenant_id::text
         WHERE ra.id = $1 AND ra.tenant_id::text = $2
         LIMIT 1`,
        data.agreementId,
        tenantId,
      );

      if (!agrRows.length) {
        return { errorStatus: 404, errorMessage: 'Rental agreement not found' } as const;
      }
      const agr = agrRows[0];
      if (String(agr.status) !== 'ACTIVE') {
        return {
          errorStatus: 409,
          errorMessage: `Agreement is not ACTIVE (current status: ${agr.status})`,
        } as const;
      }

      const vehicleId = (agr.resolved_vehicle_id as string | null) ?? null;
      const bookingIdOrNull = agr.booking_id ? String(agr.booking_id) : null;

      const preLockSwaps = await withSavepoint<Array<Record<string, unknown>>>(
        tx,
        'ret_prelock_swaps',
        () =>
          tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
            `SELECT from_vehicle_id, to_vehicle_id
               FROM rental_vehicle_exchanges
              WHERE agreement_id = $1
                AND tenant_id::text = $2`,
            String(agr.id),
            tenantId,
          ),
        [],
      );
      const lockVehicleIds = Array.from(
        new Set(
          [
            vehicleId,
            ...preLockSwaps.flatMap((s) => [
              (s.from_vehicle_id as string | null) ?? null,
              (s.to_vehicle_id as string | null) ?? null,
            ]),
          ].filter((v): v is string => Boolean(v)),
        ),
      );

      return withRentalLock(
        tx,
        tenantId,
        { entityKey: String(agr.id), vehicleIds: lockVehicleIds },
        async () => {
          const pickupOdometer =
            resolveStoredOdometerKm(agr.pickup_odometer, agr.mileage_out) ?? 0;
          const pickupFuelLevel =
            resolveStoredFuelPct(agr.pickup_fuel_level, agr.fuel_out) ?? 100;

          const swapRows = await withSavepoint<Array<Record<string, unknown>>>(
            tx,
            'ret_locked_swaps',
            () =>
              tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
                `SELECT *
                   FROM rental_vehicle_exchanges
                  WHERE agreement_id = $1
                    AND tenant_id::text = $2
                  ORDER BY COALESCE(exchange_date, created_at) ASC, created_at ASC`,
                String(agr.id),
                tenantId,
              ),
            [],
          );

          const allSegmentVehicleIds = Array.from(
            new Set(
              [
                vehicleId,
                ...swapRows.flatMap((s) => [
                  (s.from_vehicle_id as string | null) ?? null,
                  (s.to_vehicle_id as string | null) ?? null,
                ]),
              ].filter((v): v is string => Boolean(v)),
            ),
          );

          let drivenKm = 0;
          let totalFuelDeficitPct = 0;

          if (swapRows.length > 0) {
            const lastSwap = swapRows[swapRows.length - 1];
            const lastToMileageOut =
              resolveStoredOdometerKm(lastSwap.to_mileage_out, lastSwap.mileage_at_swap) ?? 0;
            if (mileageIn < lastToMileageOut) {
              return {
                errorStatus: 400,
                errorMessage: `Return mileage (${mileageIn} km) cannot be less than replacement vehicle check-out odometer (${lastToMileageOut} km)`,
              } as const;
            }

            // Segment 0: initial check-out -> swap 0 returned car
            const seg0InKm =
              resolveStoredOdometerKm(swapRows[0].from_mileage_in, swapRows[0].mileage_at_swap) ??
              pickupOdometer;
            const seg0InFuel =
              resolveStoredFuelPct(swapRows[0].from_fuel_in, swapRows[0].fuel_at_swap) ??
              pickupFuelLevel;
            drivenKm += Math.max(0, seg0InKm - pickupOdometer);
            totalFuelDeficitPct += Math.max(0, pickupFuelLevel - seg0InFuel);

            // Intermediate segments: swap[i] replacement out -> swap[i+1] returned car
            for (let i = 0; i < swapRows.length - 1; i++) {
              const segOutKm =
                resolveStoredOdometerKm(swapRows[i].to_mileage_out, swapRows[i].mileage_at_swap) ??
                0;
              const segInKm =
                resolveStoredOdometerKm(
                  swapRows[i + 1].from_mileage_in,
                  swapRows[i + 1].mileage_at_swap,
                ) ?? segOutKm;
              const segOutFuel = resolveStoredFuelPct(swapRows[i].to_fuel_out, 100) ?? 100;
              const segInFuel =
                resolveStoredFuelPct(
                  swapRows[i + 1].from_fuel_in,
                  swapRows[i + 1].fuel_at_swap,
                ) ?? segOutFuel;
              drivenKm += Math.max(0, segInKm - segOutKm);
              totalFuelDeficitPct += Math.max(0, segOutFuel - segInFuel);
            }

            // Final segment: last replacement out -> final return in
            const lastOutFuel = resolveStoredFuelPct(lastSwap.to_fuel_out, 100) ?? 100;
            drivenKm += Math.max(0, mileageIn - lastToMileageOut);
            totalFuelDeficitPct += Math.max(0, lastOutFuel - returnFuelPct);
          } else {
            if (mileageIn < pickupOdometer) {
              return {
                errorStatus: 400,
                errorMessage: `Return mileage (${mileageIn} km) cannot be less than pick-up odometer (${pickupOdometer} km)`,
              } as const;
            }
            drivenKm = Math.max(0, mileageIn - pickupOdometer);
            totalFuelDeficitPct = Math.max(0, pickupFuelLevel - returnFuelPct);
          }

          // 1. Insert return vehicle_inspections record (type = 'checkout') & evaluate 6-Point Safety Clearance
          const normalizedMarkers = (data.newDamageMarkers ?? []).map((m) => ({
            zoneId: m.zoneId ?? m.zone ?? 'BODY',
            severity: m.severity,
            description: m.description ?? m.note ?? '',
            estimatedCost: Number(m.estimatedCost ?? 0),
          }));

          const hasSevereDamage = normalizedMarkers.some((d) => d.severity === 'SEVERE');
          const sp6 = data.sixPointClearance;
          const sixPointFailed = Boolean(
            sp6 &&
              (sp6.brakesOk === false ||
                sp6.tyresOk === false ||
                sp6.lightsOk === false ||
                sp6.fluidsOk === false ||
                sp6.windshieldOk === false ||
                sp6.bodySafetyOk === false),
          );
          const checklistItemsFailed = Boolean(
            (data.checklistItems ?? []).some(
              (item) => item.passed === false && item.safetyCritical !== false,
            ),
          );
          const safetyKeys = [
            'brakes',
            'tyres',
            'tires',
            'lights',
            'fluids',
            'windshield',
            'bodySafety',
            'brakesOk',
            'tyresOk',
            'lightsOk',
            'fluidsOk',
            'windshieldOk',
            'bodySafetyOk',
          ];
          const checklistSafetyFailed = Boolean(
            data.checklist && safetyKeys.some((k) => data.checklist?.[k] === false),
          );

          const sixPointClearancePassed =
            !sixPointFailed &&
            !checklistItemsFailed &&
            !checklistSafetyFailed &&
            !hasSevereDamage &&
            data.conditionGrade !== 'DAMAGED' &&
            data.groundVehicleForMaintenance !== true;

          const resolvedConditionGrade =
            data.conditionGrade ??
            (hasSevereDamage || !sixPointClearancePassed
              ? 'DAMAGED'
              : normalizedMarkers.length > 0
                ? 'MINOR_WEAR'
                : 'CLEAN');

          const serializedChecklistPayload =
            data.sixPointClearance || data.checklistItems
              ? {
                  ...(data.checklist ?? {}),
                  ...(data.sixPointClearance ? { sixPointClearance: data.sixPointClearance } : {}),
                  ...(data.checklistItems ? { checklistItems: data.checklistItems } : {}),
                  sixPointClearancePassed,
                  conditionGrade: resolvedConditionGrade,
                }
              : (data.checklist ?? {});

          const returnInspectionId = crypto.randomUUID();
          if (bookingIdOrNull) {
            await tx.$executeRawUnsafe(
              `INSERT INTO vehicle_inspections
                 (id, tenant_id, booking_id, type, mileage, fuel_level, damages, inspector, notes,
                  photos, damage_markers, checklist_items, signature_url, created_at)
               VALUES
                 ($1, $2, $3, 'checkout', $4, $5, $6, $7, $8,
                  $9, $10::jsonb, $11::jsonb, $12, NOW())`,
              returnInspectionId,
              tenantId,
              bookingIdOrNull,
              mileageIn,
              returnFuelPct,
              normalizedMarkers.length > 0 ? JSON.stringify(normalizedMarkers) : null,
              actor,
              data.returnNotes ?? null,
              JSON.stringify(safeDamagePhotos),
              JSON.stringify(normalizedMarkers),
              JSON.stringify(serializedChecklistPayload),
              signatureUrl,
            );
            await withSavepoint(
              tx,
              'ret_insp_cond_grade',
              () =>
                tx.$executeRawUnsafe(
                  `UPDATE vehicle_inspections
                      SET condition_grade = $1
                    WHERE id = $2 AND tenant_id::text = $3`,
                  resolvedConditionGrade,
                  returnInspectionId,
                  tenantId,
                ),
              0,
            );
          } else {
            await withSavepoint(
              tx,
              'ret_walkin_insp',
              () =>
                tx.$executeRawUnsafe(
                  `INSERT INTO vehicle_inspections
                     (id, tenant_id, booking_id, type, mileage, fuel_level, damages, inspector, notes,
                      photos, damage_markers, checklist_items, signature_url, created_at)
                   VALUES
                     ($1, $2, NULL, 'checkout', $3, $4, $5, $6, $7,
                      $8, $9::jsonb, $10::jsonb, $11, NOW())`,
                  returnInspectionId,
                  tenantId,
                  mileageIn,
                  returnFuelPct,
                  normalizedMarkers.length > 0 ? JSON.stringify(normalizedMarkers) : null,
                  actor,
                  data.returnNotes ?? null,
                  JSON.stringify(safeDamagePhotos),
                  JSON.stringify(normalizedMarkers),
                  JSON.stringify(serializedChecklistPayload),
                  signatureUrl,
                ),
              0,
            );
          }

          // 2. Create damage_claims records for each new damage marker
          const damageClaimIds: string[] = [];
          let estimatedDamageTotal = 0;
          for (const m of normalizedMarkers) {
            const est = Number((m.estimatedCost ?? 0).toFixed(2));
            estimatedDamageTotal = Number((estimatedDamageTotal + est).toFixed(2));
            if (bookingIdOrNull) {
              const descParts = [`[${m.severity}] Zone ${m.zoneId}`];
              if (m.description) descParts.push(m.description);
              if (safeDamagePhotos.length > 0) {
                descParts.push(`Photos: ${safeDamagePhotos.join(', ')}`);
              }
              const claim = await tx.damageClaim.create({
                data: {
                  tenantId,
                  bookingId: bookingIdOrNull,
                  description: descParts.join(' — '),
                  estimatedCost: est,
                  status: 'OPEN',
                  billedToCustomer: est > 0,
                },
              });
              damageClaimIds.push(claim.id);
            }
          }

          // 3. Quote excess KM, late return, and fuel surcharge from 1 Master Price List
          const returnDate = new Date();
          const startDate = agr.start_date ? new Date(String(agr.start_date)) : returnDate;
          const scheduledEnd = agr.end_date ? new Date(String(agr.end_date)) : returnDate;
          const quoteEnd = returnDate > scheduledEnd ? returnDate : scheduledEnd;
          const category =
            (agr.vehicle_category as string | null) ??
            (agr.booking_category as string | null) ??
            'ECONOMY';

          const quote = await quoteRentalRateInTx(tx, tenantId, {
            vehicleCategory: category,
            pickupDate: startDate,
            dropoffDate: quoteEnd,
            pickupLocationCode: (agr.pickup_location_code as string | null) ?? undefined,
            dropoffLocationCode: (agr.dropoff_location_code as string | null) ?? undefined,
            customerType:
              (agr.customer_type as string | null) ??
              (agr.rc_customer_type as string | null) ??
              (agr.is_corporate ? 'CORPORATE' : 'INDIVIDUAL'),
            corporateAccountId: (agr.corporate_account_id as string | null) ?? undefined,
            channel:
              (agr.channel as string | null) ??
              (agr.booking_channel as string | null) ??
              'DIRECT',
            promoCode: (agr.promo_code as string | null) ?? undefined,
            insurancePlanCode: (agr.insurance_plan_code as string | null) ?? undefined,
            currency: (agr.currency as string | null) ?? 'AED',
          });

          // Late return fee
          let lateFee = 0;
          const graceMs = (quote.gracePeriodMin ?? 30) * 60_000;
          const lateDiffMs = returnDate.getTime() - scheduledEnd.getTime();
          if (lateDiffMs > graceMs && quote.lateFeePerHour > 0) {
            const lateHours = Math.ceil((lateDiffMs - graceMs) / 3_600_000);
            lateFee = Number((lateHours * quote.lateFeePerHour).toFixed(2));
            if (quote.lateFeeCap > 0) {
              lateFee = Math.min(lateFee, quote.lateFeeCap);
            }
          }

          // Excess KM charge (summed across all rental vehicle segments)
          let excessKmCharge = 0;
          const includedKm = (quote.includedKmPerDay ?? 250) * quote.totalDays;
          const excessKm = Math.max(0, drivenKm - includedKm);
          const kmRate = quote.excessKmRate > 0 ? quote.excessKmRate : 0;
          if (excessKm > 0 && kmRate > 0) {
            excessKmCharge = Number((excessKm * kmRate).toFixed(2));
          }

          // Fuel surcharge (AED 5 per % deficit summed across all rental vehicle segments)
          const fuelSurcharge =
            totalFuelDeficitPct > 0 ? Number((totalFuelDeficitPct * 5).toFixed(2)) : 0;

          // 4. Close rental_agreements (syncing BOTH fuel_in/return_fuel_level in 0..100% and mileage_in/return_odometer in km)
          await tx.$executeRawUnsafe(
            `UPDATE rental_agreements
                SET status = 'CLOSED',
                    actual_return_date = NOW(),
                    mileage_in = $1,
                    return_odometer = $1,
                    fuel_in = $2,
                    return_fuel_level = $2,
                    late_fee = $3,
                    excess_km_fee = $4,
                    fuel_surcharge = $5,
                    closed_by = $6,
                    closing_notes = $7,
                    updated_at = NOW()
              WHERE id = $8 AND tenant_id::text = $9`,
            mileageIn,
            returnFuelPct,
            lateFee,
            excessKmCharge,
            fuelSurcharge,
            actor,
            data.returnNotes ?? null,
            String(agr.id),
            tenantId,
          );

          // 5. Mark booking COMPLETED (when linked) and safely update physical vehicle status + current_mileage + fuel_level
          if (bookingIdOrNull) {
            await tx.$executeRawUnsafe(
              `UPDATE rental_bookings
                  SET status = 'COMPLETED',
                      updated_at = NOW()
                WHERE id = $1 AND tenant_id::text = $2`,
              bookingIdOrNull,
              tenantId,
            );
          }

          let vehicleStatusAfterReturn: string | null = null;
          if (vehicleId) {
            const safeVeh = await computeSafePostRentalVehicleStatus(tx, {
              tenantId,
              vehicleId,
              excludeAgreementId: String(agr.id),
              excludeBookingId: bookingIdOrNull ?? undefined,
              preferredStatus: sixPointClearancePassed ? 'AVAILABLE' : 'MAINTENANCE',
            });
            vehicleStatusAfterReturn = safeVeh.status;
            await tx.$executeRawUnsafe(
              `UPDATE vehicles
                  SET status = $1,
                      current_mileage = GREATEST(COALESCE(current_mileage, 0), $2::bigint),
                      fuel_level = $3,
                      updated_at = NOW()
                WHERE id = $4 AND tenant_id::text = $5`,
              safeVeh.status,
              mileageIn,
              returnFuelPct,
              vehicleId,
              tenantId,
            );
          }

          // 6. Build & insert closing invoice (5% UAE VAT on taxable supplies, 0% Out-of-Scope on statutory fines)
          const existingInvoices = await tx.$queryRawUnsafe<
            Array<{
              id: string;
              invoice_no: string;
              subtotal: string | number;
              tax_amount: string | number;
              total_amount: string | number;
              balance_due: string | number;
            }>
          >(
            `SELECT id, invoice_no, subtotal, tax_amount, total_amount, balance_due
               FROM rental_invoices
              WHERE agreement_id = $1
                AND tenant_id::text = $2
                AND deleted_at IS NULL
                AND status NOT IN ('VOID', 'CANCELLED')
              ORDER BY created_at DESC
              LIMIT 1`,
            String(agr.id),
            tenantId,
          );
          const alreadyInvoiced = existingInvoices.length > 0;

          interface LineItem {
            lineType: string;
            description: string;
            quantity: number;
            unitPrice: number;
            unitLabel: string;
            discountPct: number;
            taxable: boolean;
            amount: number;
          }
          const lineItems: LineItem[] = [];

          if (!alreadyInvoiced) {
            if (quote.dailyRate > 0) {
              for (const bl of quote.breakdown) {
                if (bl.type === 'TAX') continue;
                lineItems.push({
                  lineType: bl.type,
                  description: bl.label,
                  quantity: bl.qty,
                  unitPrice: bl.unitPrice,
                  unitLabel: bl.unitLabel,
                  discountPct: 0,
                  taxable: bl.type !== 'DISCOUNT',
                  amount: bl.amount,
                });
              }
            } else {
              const fallbackDaily = Number(agr.daily_rate ?? 0);
              const contractedDays = Math.max(
                1,
                Math.ceil((scheduledEnd.getTime() - startDate.getTime()) / 86_400_000),
              );
              const baseAmt =
                fallbackDaily > 0
                  ? Number((fallbackDaily * contractedDays).toFixed(2))
                  : Number(agr.total_amount ?? 0);
              lineItems.push({
                lineType: 'RENTAL',
                description: `Vehicle rental — ${category} (${contractedDays} day${contractedDays === 1 ? '' : 's'})`,
                quantity: contractedDays,
                unitPrice: fallbackDaily > 0 ? fallbackDaily : baseAmt,
                unitLabel: 'day',
                discountPct: 0,
                taxable: true,
                amount: baseAmt,
              });
            }

            // Exclude EXTENSION (already covered by quote period) and use pre-VAT amount (NEVER total_amount)
            const extraRows = await withSavepoint<
              Array<{
                charge_type: string;
                description: string | null;
                quantity: number | null;
                amount: string;
              }>
            >(
              tx,
              'ret_add_charges',
              () =>
                tx.$queryRawUnsafe(
                  `SELECT charge_type, description, quantity, amount::text AS amount
                     FROM rental_additional_charges
                    WHERE agreement_id = $1
                      AND tenant_id::text = $2
                      AND COALESCE(billed_to_customer, true) = true
                      AND UPPER(COALESCE(charge_type, '')) <> 'EXTENSION'`,
                  String(agr.id),
                  tenantId,
                ),
              [],
            );
            for (const ch of extraRows) {
              const cType = String(ch.charge_type ?? 'EXTRA').trim().toUpperCase();
              if (cType === 'EXTENSION') continue;
              const qty = Math.max(1, Number(ch.quantity ?? 1));
              const unit = round2(Number(ch.amount ?? 0));
              const lineTotal = round2(qty * unit);
              if (lineTotal > 0) {
                const isFine =
                  cType === 'FINE' || cType === 'TRAFFIC_FINE' || cType === 'STATUTORY_FINE';
                const isKnowledgeFee = cType === 'KNOWLEDGE_FEE' || cType === 'INNOVATION_FEE';
                lineItems.push({
                  lineType: isFine ? 'TRAFFIC_FINE' : isKnowledgeFee ? 'KNOWLEDGE_FEE' : cType,
                  description: ch.description ?? cType,
                  quantity: qty,
                  unitPrice: unit,
                  unitLabel: 'flat',
                  discountPct: 0,
                  taxable: !(isFine || isKnowledgeFee),
                  amount: lineTotal,
                });
              }
            }
          }

          // Unbilled statutory traffic fines (0% Out-of-Scope) + UAE Knowledge Dirham (0% Out-of-Scope) + 5% admin surcharges
          let fineRows = await withSavepoint<Array<Record<string, unknown>> | null>(
            tx,
            'ret_traffic_fines_v2',
            () =>
              tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
                `SELECT *
                   FROM traffic_fines tf
                  WHERE tf.tenant_id::text = $1
                    AND (
                      tf.rental_agreement_id = $2
                      OR (
                        CARDINALITY($3::text[]) > 0
                        AND tf.rental_agreement_id IS NULL
                        AND tf.vehicle_id::text = ANY($3::text[])
                        AND tf.fine_date >= $4::timestamptz
                        AND tf.fine_date <= $5::timestamptz
                        AND COALESCE(tf.assigned_to, '') <> 'DRIVER'
                      )
                    )
                    AND COALESCE(tf.is_billed_to_customer, false) = false
                    AND UPPER(COALESCE(tf.status, 'UNPAID')) <> 'PAID'`,
                tenantId,
                String(agr.id),
                allSegmentVehicleIds,
                startDate.toISOString(),
                returnDate.toISOString(),
              ),
            null,
          );
          if (fineRows === null) {
            fineRows = await withSavepoint<Array<Record<string, unknown>>>(
              tx,
              'ret_traffic_fines',
              () =>
                tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
                  `SELECT *
                     FROM traffic_fines tf
                    WHERE tf.tenant_id::text = $1
                      AND (
                        tf.rental_agreement_id = $2
                        OR (
                          CARDINALITY($3::text[]) > 0
                          AND tf.rental_agreement_id IS NULL
                          AND tf.vehicle_id::text = ANY($3::text[])
                          AND tf.fine_date >= $4::timestamptz
                          AND tf.fine_date <= $5::timestamptz
                          AND COALESCE(tf.assigned_to, '') <> 'DRIVER'
                        )
                      )
                      AND UPPER(COALESCE(tf.status, 'UNPAID')) = 'UNPAID'`,
                  tenantId,
                  String(agr.id),
                  allSegmentVehicleIds,
                  startDate.toISOString(),
                  returnDate.toISOString(),
                ),
              [],
            );
          }

          const billedFineIds: string[] = [];
          for (const tf of fineRows) {
            const fineLabel = String(tf.fine_ref ?? tf.offence_type ?? 'Traffic fine');
            const finePrincipal = round2(Number(tf.fine_amount ?? tf.amount ?? 0));
            const knowledgeFee = round2(Number(tf.knowledge_fee ?? 0));
            const fineAdmin = round2(Number(tf.admin_fee ?? 0));
            let billedThisFine = false;
            if (finePrincipal > 0) {
              lineItems.push({
                lineType: 'TRAFFIC_FINE',
                description: `Traffic Fine (Statutory Out-of-Scope): ${fineLabel}`,
                quantity: 1,
                unitPrice: finePrincipal,
                unitLabel: 'flat',
                discountPct: 0,
                taxable: false,
                amount: finePrincipal,
              });
              billedThisFine = true;
            }
            if (knowledgeFee > 0) {
              lineItems.push({
                lineType: 'KNOWLEDGE_FEE',
                description: `UAE Knowledge & Innovation Dirham (Statutory Out-of-Scope): ${fineLabel}`,
                quantity: 1,
                unitPrice: knowledgeFee,
                unitLabel: 'flat',
                discountPct: 0,
                taxable: false,
                amount: knowledgeFee,
              });
              billedThisFine = true;
            }
            if (fineAdmin > 0) {
              lineItems.push({
                lineType: 'ADMIN_FEE',
                description: `Traffic Fine Admin Surcharge: ${fineLabel}`,
                quantity: 1,
                unitPrice: fineAdmin,
                unitLabel: 'flat',
                discountPct: 0,
                taxable: true,
                amount: fineAdmin,
              });
              billedThisFine = true;
            }
            if (billedThisFine && tf.id) billedFineIds.push(String(tf.id));
          }

          // Unbilled Salik / Darb tolls (5% UAE VAT + 5% admin fee) across all segment vehicles
          const tollRows = await withSavepoint<Array<Record<string, unknown>>>(
            tx,
            'ret_tolls',
            () =>
              tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
                `SELECT *
                   FROM toll_transactions tt
                  WHERE tt.tenant_id::text = $1
                    AND (
                      tt.rental_agreement_id = $2
                      OR (
                        CARDINALITY($3::text[]) > 0
                        AND tt.rental_agreement_id IS NULL
                        AND tt.vehicle_id::text = ANY($3::text[])
                        AND tt.occurred_at >= $4::timestamptz
                        AND tt.occurred_at <= $5::timestamptz
                      )
                    )
                    AND COALESCE(tt.is_billed_to_customer, false) = false`,
                tenantId,
                String(agr.id),
                allSegmentVehicleIds,
                startDate.toISOString(),
                returnDate.toISOString(),
              ),
            [],
          );

          const billedTollIds: string[] = [];
          for (const toll of tollRows) {
            const tollLabel = String(
              toll.gate_name ?? toll.toll_gate ?? toll.location ?? toll.toll_system ?? 'Salik / Darb Toll',
            );
            const tollAmt = round2(Number(toll.amount ?? toll.toll_amount ?? 0));
            const tollAdmin = round2(Number(toll.admin_fee ?? 0));
            if (tollAmt > 0) {
              lineItems.push({
                lineType: 'TOLL',
                description: `Toll Charge: ${tollLabel}`,
                quantity: 1,
                unitPrice: tollAmt,
                unitLabel: 'flat',
                discountPct: 0,
                taxable: true,
                amount: tollAmt,
              });
              if (toll.id) billedTollIds.push(String(toll.id));
            }
            if (tollAdmin > 0) {
              lineItems.push({
                lineType: 'ADMIN_FEE',
                description: `Toll Admin Fee: ${tollLabel}`,
                quantity: 1,
                unitPrice: tollAdmin,
                unitLabel: 'flat',
                discountPct: 0,
                taxable: true,
                amount: tollAdmin,
              });
            }
          }

          if (lateFee > 0) {
            lineItems.push({
              lineType: 'LATE_FEE',
              description: 'Late return fee',
              quantity: 1,
              unitPrice: lateFee,
              unitLabel: 'flat',
              discountPct: 0,
              taxable: true,
              amount: lateFee,
            });
          }
          if (excessKmCharge > 0) {
            lineItems.push({
              lineType: 'EXCESS_KM',
              description: `Excess km charge (${excessKm} km @ AED ${kmRate}/km)`,
              quantity: excessKm,
              unitPrice: kmRate,
              unitLabel: 'km',
              discountPct: 0,
              taxable: true,
              amount: excessKmCharge,
            });
          }
          if (fuelSurcharge > 0) {
            lineItems.push({
              lineType: 'FUEL',
              description:
                swapRows.length > 0
                  ? `Fuel surcharge (${totalFuelDeficitPct}% total deficit across ${swapRows.length + 1} rental segments)`
                  : `Fuel surcharge (${pickupFuelLevel}% → ${returnFuelPct}%)`,
              quantity: 1,
              unitPrice: fuelSurcharge,
              unitLabel: 'flat',
              discountPct: 0,
              taxable: true,
              amount: fuelSurcharge,
            });
          }
          if (estimatedDamageTotal > 0) {
            lineItems.push({
              lineType: 'DAMAGE',
              description: `Return inspection damage (${normalizedMarkers.length} item${normalizedMarkers.length === 1 ? '' : 's'})`,
              quantity: 1,
              unitPrice: estimatedDamageTotal,
              unitLabel: 'flat',
              discountPct: 0,
              taxable: true,
              amount: estimatedDamageTotal,
            });
          }

          let invoiceId: string;
          let invoiceNo: string;
          let subtotal: number;
          let taxAmount: number;
          let totalAmount: number;
          let amountToSettle: number;

          if (alreadyInvoiced && lineItems.length === 0) {
            const prev = existingInvoices[0];
            invoiceId = String(prev.id);
            invoiceNo = String(prev.invoice_no);
            subtotal = round2(Number(prev.subtotal ?? 0));
            taxAmount = round2(Number(prev.tax_amount ?? 0));
            totalAmount = round2(Number(prev.total_amount ?? 0));
            amountToSettle = round2(Math.max(0, Number(prev.balance_due ?? 0)));
          } else {
            const TAX_RATE = 5;
            subtotal = Number(
              lineItems.reduce((sum, li) => sum + li.amount, 0).toFixed(2),
            );
            const discountAmt =
              !alreadyInvoiced && quote.dailyRate > 0 ? quote.discountAmount : 0;
            const taxableLines = lineItems
              .filter((li) => li.taxable)
              .reduce((sum, li) => sum + li.amount, 0);
            const taxableAmount = Number(Math.max(0, taxableLines - discountAmt).toFixed(2));
            taxAmount = Number(((taxableAmount * TAX_RATE) / 100).toFixed(2));
            totalAmount = Number((subtotal + taxAmount).toFixed(2));
            amountToSettle = totalAmount;

            invoiceNo = await nextRentalSerial(tx, {
              tenantId,
              series: 'RINV',
              prefix: 'RINV-',
              table: 'rental_invoices',
              column: 'invoice_no',
            });
            invoiceId = crypto.randomUUID();
            const nowIso = returnDate.toISOString();
            const dueDateIso = new Date(
              returnDate.getTime() + 30 * 24 * 60 * 60 * 1000,
            ).toISOString();

            await tx.$executeRawUnsafe(
              `INSERT INTO rental_invoices
                 (id, tenant_id, created_at, updated_at, invoice_no, agreement_id, customer_id,
                  invoice_type, invoice_date, due_date, period_from, period_to, currency,
                  subtotal, discount_amount, taxable_amount, tax_rate, tax_amount, total_amount,
                  paid_amount, balance_due, status, is_corporate, corporate_account_id,
                  billing_mode, payment_terms_days, notes)
               VALUES
                 ($1, $2, $3::timestamptz, $3::timestamptz, $4, $5, $6,
                  'STANDARD', $3::timestamptz, $7::timestamptz, $8::timestamptz, $3::timestamptz, $9,
                  $10, $11, $12, $13, $14, $15,
                  0, $15, 'SENT', $16, $17,
                  'SEPARATE', 30, $18)`,
              invoiceId,
              tenantId,
              nowIso,
              invoiceNo,
              String(agr.id),
              String(agr.customer_id),
              dueDateIso,
              startDate.toISOString(),
              String(agr.currency ?? 'AED'),
              subtotal,
              discountAmt,
              taxableAmount,
              TAX_RATE,
              taxAmount,
              totalAmount,
              Boolean(agr.is_corporate ?? false),
              (agr.corporate_account_id as string | null) ?? null,
              data.returnNotes ??
                `Closing invoice for agreement ${(agr.agreement_no as string | null) ?? agr.id}`,
            );

            let sortOrder = 0;
            for (const li of lineItems) {
              await tx.$executeRawUnsafe(
                `INSERT INTO rental_invoice_line_items
                   (id, tenant_id, invoice_id, line_type, description, quantity, unit_price,
                    unit_label, discount_pct, taxable, amount, sort_order)
                 VALUES
                   ($1, $2, $3, $4, $5, $6, $7,
                    $8, $9, $10, $11, $12)`,
                crypto.randomUUID(),
                tenantId,
                invoiceId,
                li.lineType,
                li.description,
                li.quantity,
                li.unitPrice,
                li.unitLabel,
                li.discountPct,
                li.taxable,
                li.amount,
                sortOrder++,
              );
            }

            if (billedTollIds.length > 0) {
              await withSavepoint(
                tx,
                'ret_mark_tolls_billed',
                () =>
                  tx.$executeRawUnsafe(
                    `UPDATE toll_transactions
                        SET is_billed_to_customer = true,
                            billed_invoice_id = $1,
                            rental_agreement_id = COALESCE(rental_agreement_id, $2)
                      WHERE tenant_id::text = $3
                        AND id::text = ANY($4::text[])`,
                    invoiceId,
                    String(agr.id),
                    tenantId,
                    billedTollIds,
                  ),
                0,
              );
            }

            if (billedFineIds.length > 0) {
              const markedFinesV2 = await withSavepoint(
                tx,
                'ret_mark_fines_billed_v2',
                async () => {
                  await tx.$executeRawUnsafe(
                    `UPDATE traffic_fines
                        SET is_billed_to_customer = true,
                            billed_invoice_id = $1,
                            rental_agreement_id = COALESCE(rental_agreement_id, $2)
                      WHERE tenant_id::text = $3
                        AND id::text = ANY($4::text[])`,
                    invoiceId,
                    String(agr.id),
                    tenantId,
                    billedFineIds,
                  );
                  return true;
                },
                false,
              );
              if (!markedFinesV2) {
                await withSavepoint(
                  tx,
                  'ret_link_fines_agr',
                  () =>
                    tx.$executeRawUnsafe(
                      `UPDATE traffic_fines
                          SET rental_agreement_id = COALESCE(rental_agreement_id, $1)
                        WHERE tenant_id::text = $2
                          AND id::text = ANY($3::text[])`,
                      String(agr.id),
                      tenantId,
                      billedFineIds,
                    ),
                  0,
                );
              }
            }

            await postRacInvoiceIssuedGl(tx, {
              tenantId,
              invoiceId,
              invoiceNo,
              agreementNo: (agr.agreement_no as string | null) ?? null,
              invoiceDate: nowIso,
              status: 'SENT',
              currency: String(agr.currency ?? 'AED'),
              subtotal,
              discountAmount: discountAmt,
              taxAmount,
              totalAmount,
              lines: lineItems,
              rentalDaysHint: quote.totalDays,
              preparedBy: actor,
            });
          }

          // Check for linked AUTHORIZED card pre-auth hold strictly belonging to the same customer + tenant
          const preauthRows = await tx.$queryRawUnsafe<
            Array<{ id: string; amount: string; customer_id: string }>
          >(
            `SELECT id::text AS id, amount::text AS amount, customer_id::text AS customer_id
               FROM rac_card_preauths
              WHERE (agreement_id = $1 OR ($2::text IS NOT NULL AND booking_id = $2))
                AND tenant_id::text = $3
                AND customer_id::text = $4
                AND status = 'AUTHORIZED'
              ORDER BY created_at DESC
              LIMIT 1`,
            String(agr.id),
            bookingIdOrNull,
            tenantId,
            String(agr.customer_id),
          );

          const collectedDepositAmount =
            !preauthRows[0] &&
            String(agr.deposit_status ?? '').toUpperCase() === 'PAID' &&
            Number(agr.security_deposit ?? 0) > 0
              ? round2(Number(agr.security_deposit))
              : 0;

          const queuedReturnReport = await withSavepoint<UaeRegulatoryReportRecord | null>(
            tx,
            'ret_uae_reg_report',
            () =>
              queueUaeRegulatoryReportInTx(tx, {
                tenantId,
                agreementId: String(agr.id),
                eventType: 'RETURN',
                submittedBy: actor,
              }),
            null,
          );

          return {
            errorStatus: null,
            agreementId: String(agr.id),
            agreementNo: (agr.agreement_no as string | null) ?? null,
            customerId: String(agr.customer_id),
            customerName: (agr.rc_full_name as string | null) ?? 'Rental Customer',
            vehiclePlate: (agr.vehicle_plate as string | null) ?? '—',
            vehicleType: (agr.vehicle_type as string | null) ?? null,
            startDateIso: startDate.toISOString(),
            currency: String(agr.currency ?? 'AED'),
            invoiceId,
            invoiceNumber: invoiceNo,
            subtotal,
            taxAmount,
            totalAmount,
            amountToSettle,
            drivenKm,
            lateFee,
            excessKmCharge,
            fuelSurcharge,
            estimatedDamageTotal,
            damageClaimIds,
            collectedDepositAmount,
            vehicleStatusAfterReturn,
            sixPointClearancePassed,
            queuedReturnReport,
            authorizedPreauth: preauthRows[0]
              ? {
                  id: preauthRows[0].id,
                  amount: Number(preauthRows[0].amount),
                  customerId: preauthRows[0].customer_id,
                }
              : null,
          } as const;
        },
      );
    });

    if (txOutcome.errorStatus) {
      return NextResponse.json(
        { error: txOutcome.errorMessage },
        { status: txOutcome.errorStatus },
      );
    }

    // Phase 2 (Strictly OUTSIDE `withTenantRls`): External payment gateway pre-auth capture / release & UAE Tarrashud dispatch
    let regulatoryReport: UaeRegulatoryReportRecord | null = txOutcome.queuedReturnReport;
    if (txOutcome.queuedReturnReport?.status === 'QUEUED') {
      try {
        regulatoryReport = await dispatchUaeRegulatoryReportOutsideRls(
          txOutcome.queuedReturnReport,
        );
      } catch (regErr) {
        captureException(regErr, { context: 'rental.counter.return.tarrashud' });
      }
    }

    let preauthResult: PublicRacCardPreAuth | null = null;
    let capturedGatewayAmt = 0;
    let capturedAuthCode: string | null = null;

    if (
      txOutcome.authorizedPreauth &&
      txOutcome.authorizedPreauth.customerId === txOutcome.customerId &&
      data.settlementAction === 'CAPTURE_INVOICE'
    ) {
      const captureAmt = Number(
        Math.min(txOutcome.authorizedPreauth.amount, txOutcome.amountToSettle).toFixed(2),
      );
      if (captureAmt > 0) {
        const captured = await captureRacCardPreAuth({
          tenantId,
          preauthId: txOutcome.authorizedPreauth.id,
          captureAmount: captureAmt,
          invoiceId: txOutcome.invoiceId,
          actorId: actor,
        });
        preauthResult = toPublicRacPreAuth(captured);
        capturedGatewayAmt = captureAmt;
        capturedAuthCode = captured.authorizationCode ?? null;
      }
    } else if (
      txOutcome.authorizedPreauth &&
      txOutcome.authorizedPreauth.customerId === txOutcome.customerId &&
      data.settlementAction === 'RELEASE_DEPOSIT'
    ) {
      const released = await releaseRacCardPreAuth({
        tenantId,
        preauthId: txOutcome.authorizedPreauth.id,
        notes: data.returnNotes ?? 'Released at counter return',
      });
      preauthResult = toPublicRacPreAuth(released);
    }

    // Phase 3 (`withTenantRls` + `withInvoicePaymentLock`): Record payment receipt + GL or collected-deposit settlement
    if (capturedGatewayAmt > 0) {
      await withTenantRls(prisma, tenantId, async (tx) => {
        await withInvoicePaymentLock(tx, tenantId, txOutcome.invoiceId, async () => {
          const paymentId = crypto.randomUUID();
          const receiptNo = await nextRentalSerial(tx, {
            tenantId,
            series: 'RRCPT',
            prefix: 'RRCPT-',
            table: 'rental_invoice_payments',
            column: 'receipt_no',
          });
          const paidIso = new Date().toISOString();

          await tx.$executeRawUnsafe(
            `INSERT INTO rental_invoice_payments
               (id, tenant_id, invoice_id, receipt_no, paid_at, payment_date,
                amount, currency, payment_method, reference_no, notes, received_by, created_at)
             VALUES
               ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz,
                $6, $7, 'CARD', $8, $9, $10, $5::timestamptz)`,
            paymentId,
            tenantId,
            txOutcome.invoiceId,
            receiptNo,
            paidIso,
            capturedGatewayAmt,
            txOutcome.currency,
            capturedAuthCode,
            'Captured from card pre-authorization at counter return',
            actor,
          );

          await tx.$executeRawUnsafe(
            `UPDATE rental_invoices
                SET paid_amount = COALESCE(paid_amount, 0) + $1,
                    balance_due = GREATEST(0, total_amount - (COALESCE(paid_amount, 0) + $1)),
                    status = CASE
                      WHEN (total_amount - (COALESCE(paid_amount, 0) + $1)) <= 0.009 THEN 'PAID'
                      ELSE 'PARTIALLY_PAID'
                    END,
                    paid_at = CASE
                      WHEN (total_amount - (COALESCE(paid_amount, 0) + $1)) <= 0.009 THEN $2::timestamptz
                      ELSE paid_at
                    END,
                    updated_at = $2::timestamptz
              WHERE id = $3 AND tenant_id::text = $4`,
            capturedGatewayAmt,
            paidIso,
            txOutcome.invoiceId,
            tenantId,
          );

          await postRacInvoicePaymentGl(tx, {
            tenantId,
            paymentId,
            receiptNo,
            invoiceNo: txOutcome.invoiceNumber,
            amount: capturedGatewayAmt,
            paymentMethod: 'CARD',
            paidAt: paidIso,
            currency: txOutcome.currency,
            preparedBy: actor,
          });
        });
      });
    } else if (
      !txOutcome.authorizedPreauth &&
      txOutcome.collectedDepositAmount > 0 &&
      (data.settlementAction === 'CAPTURE_INVOICE' || data.settlementAction === 'RELEASE_DEPOSIT')
    ) {
      await withTenantRls(prisma, tenantId, async (tx) => {
        await withInvoicePaymentLock(tx, tenantId, txOutcome.invoiceId, async () => {
          // Ensure collected deposit row + opening liability (CR 2150) exist idempotently
          const depSync = await recordRacSecurityDepositCollected(tx, {
            tenantId,
            agreementId: txOutcome.agreementId,
            agreementNo: txOutcome.agreementNo,
            customerName: txOutcome.customerName,
            vehiclePlate: txOutcome.vehiclePlate,
            vehicleType: txOutcome.vehicleType,
            amount: txOutcome.collectedDepositAmount,
            collectionMethod: data.refundMethod ?? 'CARD',
            collectionDate: txOutcome.startDateIso.slice(0, 10),
            currency: txOutcome.currency,
            preparedBy: actor,
          });

          const nowIso = new Date().toISOString();

          if (data.settlementAction === 'CAPTURE_INVOICE') {
            const deductAmt = round2(
              Math.min(txOutcome.collectedDepositAmount, txOutcome.amountToSettle),
            );
            if (deductAmt > 0) {
              const paymentId = crypto.randomUUID();
              const receiptNo = await nextRentalSerial(tx, {
                tenantId,
                series: 'RRCPT',
                prefix: 'RRCPT-',
                table: 'rental_invoice_payments',
                column: 'receipt_no',
              });

              const insertedDeduct = await withSavepoint(
                tx,
                'ret_dep_deduct_pay',
                async () => {
                  await tx.$executeRawUnsafe(
                    `INSERT INTO rental_invoice_payments
                       (id, tenant_id, invoice_id, receipt_no, paid_at, payment_date,
                        amount, currency, payment_method, reference_no, notes, received_by, created_at)
                     VALUES
                       ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz,
                        $6, $7, 'DEPOSIT_DEDUCTION', $8, $9, $10, $5::timestamptz)`,
                    paymentId,
                    tenantId,
                    txOutcome.invoiceId,
                    receiptNo,
                    nowIso,
                    deductAmt,
                    txOutcome.currency,
                    txOutcome.agreementNo ?? txOutcome.agreementId,
                    'Deducted from collected security deposit at counter return',
                    actor,
                  );
                  return true;
                },
                false,
              );

              if (!insertedDeduct) {
                await tx.$executeRawUnsafe(
                  `INSERT INTO rental_invoice_payments
                     (id, tenant_id, invoice_id, receipt_no, paid_at, payment_date,
                      amount, currency, payment_method, reference_no, notes, received_by, created_at)
                   VALUES
                     ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz,
                      $6, $7, 'OTHER', $8, $9, $10, $5::timestamptz)`,
                  paymentId,
                  tenantId,
                  txOutcome.invoiceId,
                  receiptNo,
                  nowIso,
                  deductAmt,
                  txOutcome.currency,
                  txOutcome.agreementNo ?? txOutcome.agreementId,
                  'Deducted from collected security deposit at counter return',
                  actor,
                );
              }

              await tx.$executeRawUnsafe(
                `UPDATE rental_invoices
                    SET paid_amount = COALESCE(paid_amount, 0) + $1,
                        balance_due = GREATEST(0, total_amount - (COALESCE(paid_amount, 0) + $1)),
                        status = CASE
                          WHEN (total_amount - (COALESCE(paid_amount, 0) + $1)) <= 0.009 THEN 'PAID'
                          ELSE 'PARTIALLY_PAID'
                        END,
                        paid_at = CASE
                          WHEN (total_amount - (COALESCE(paid_amount, 0) + $1)) <= 0.009 THEN $2::timestamptz
                          ELSE paid_at
                        END,
                        updated_at = $2::timestamptz
                  WHERE id = $3 AND tenant_id::text = $4`,
                deductAmt,
                nowIso,
                txOutcome.invoiceId,
                tenantId,
              );

              if (depSync.depositId) {
                await withSavepoint(
                  tx,
                  'ret_upd_fsd_deduct',
                  () =>
                    tx.$executeRawUnsafe(
                      `UPDATE finance_security_deposits
                          SET total_deducted = COALESCE(total_deducted, 0) + $1,
                              status = CASE
                                WHEN (collected_amount - COALESCE(refunded_amount, 0) - (COALESCE(total_deducted, 0) + $1)) <= 0.009
                                  THEN 'SETTLED'
                                ELSE status
                              END,
                              updated_at = NOW()
                        WHERE id::text = $2 AND tenant_id = $3`,
                      deductAmt,
                      depSync.depositId,
                      tenantId,
                    ),
                  0,
                );
              }

              // DR 2150 Customer Deposits & Advances / CR 1131 Trade Receivables — RAC
              await postRacInvoicePaymentGl(tx, {
                tenantId,
                paymentId,
                receiptNo,
                invoiceNo: txOutcome.invoiceNumber,
                amount: deductAmt,
                paymentMethod: 'DEPOSIT_DEDUCTION',
                paidAt: nowIso,
                currency: txOutcome.currency,
                preparedBy: actor,
              });

              const remainingDep = round2(txOutcome.collectedDepositAmount - deductAmt);
              await tx.$executeRawUnsafe(
                `UPDATE rental_agreements
                    SET deposit_status = $1,
                        updated_at = NOW()
                  WHERE id = $2 AND tenant_id::text = $3`,
                remainingDep <= 0.009 ? 'DEDUCTED' : 'PARTIALLY_DEDUCTED',
                txOutcome.agreementId,
                tenantId,
              );
            }
          } else if (
            data.settlementAction === 'RELEASE_DEPOSIT' &&
            txOutcome.amountToSettle <= 0.009
          ) {
            // Direct refund of collected deposit when no unpaid invoice balance remains
            if (depSync.depositId) {
              await withSavepoint(
                tx,
                'ret_upd_fsd_refund',
                () =>
                  tx.$executeRawUnsafe(
                    `UPDATE finance_security_deposits
                        SET refunded_amount = collected_amount - COALESCE(total_deducted, 0),
                            status = 'REFUNDED',
                            refund_status = 'PAID',
                            updated_at = NOW()
                      WHERE id::text = $1 AND tenant_id = $2`,
                    depSync.depositId,
                    tenantId,
                  ),
                0,
              );
            }

            await postRacSecurityDepositRefundGl(tx, {
              tenantId,
              agreementId: txOutcome.agreementId,
              agreementNo: txOutcome.agreementNo,
              refundAmount: txOutcome.collectedDepositAmount,
              refundMethod: data.refundMethod ?? 'CARD',
              refundDate: nowIso,
              idempotencySuffix: 'RETURN_RELEASE',
              currency: txOutcome.currency,
              preparedBy: actor,
            });

            await tx.$executeRawUnsafe(
              `UPDATE rental_agreements
                  SET deposit_status = 'REFUNDED',
                      updated_at = NOW()
                WHERE id = $1 AND tenant_id::text = $2`,
              txOutcome.agreementId,
              tenantId,
            );
          }
        });
      });
    }

    // Mirror final invoice state (including any Phase 3 payment/deduction) to Finance
    await mirrorRentalInvoiceToFinance(
      txOutcome.invoiceId,
      tenantId,
      'rental-counter-return',
    ).catch((err) => console.warn('[counter return] finance mirror failed:', err));

    void logAudit({
      tenantId,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      entityType: 'RentalAgreement',
      entityId: txOutcome.agreementId,
      entityName: txOutcome.agreementNo ?? undefined,
      action: 'UPDATE',
      details: `Counter return completed: agreement ${txOutcome.agreementNo ?? txOutcome.agreementId}, mileageIn=${mileageIn}, fuelIn=${returnFuelPct}%, invoice=${txOutcome.invoiceNumber} (total=${txOutcome.totalAmount}), settlement=${data.settlementAction}.`,
    });

    return NextResponse.json({
      ok: true,
      agreementId: txOutcome.agreementId,
      agreementNo: txOutcome.agreementNo,
      invoiceId: txOutcome.invoiceId,
      invoiceNumber: txOutcome.invoiceNumber,
      subtotal: txOutcome.subtotal,
      taxAmount: txOutcome.taxAmount,
      totalAmount: txOutcome.totalAmount,
      drivenKm: txOutcome.drivenKm,
      lateFee: txOutcome.lateFee,
      excessKmCharge: txOutcome.excessKmCharge,
      fuelSurcharge: txOutcome.fuelSurcharge,
      damageCharges: txOutcome.estimatedDamageTotal,
      damageClaimIds: txOutcome.damageClaimIds,
      vehicleStatusAfterReturn: txOutcome.vehicleStatusAfterReturn,
      sixPointClearancePassed: txOutcome.sixPointClearancePassed,
      regulatoryReport,
      preauthResult,
    });
  } catch (err) {
    if (isRentalSecurityError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    captureException(err, { context: 'rental.counter.return.post' });
    console.error('[counter return POST] error:', err);
    return NextResponse.json(
      { error: 'Counter return settlement failed' },
      { status: 500 },
    );
  }
}
