export const dynamic = 'force-dynamic';

/**
 * POST /api/rental/agreements/:id/close
 *
 * Closes a rental agreement:
 *  1. Validates agreement is ACTIVE or COMPLETED (scoped strictly to tenant_id)
 *  2. Records actual return date, canonical fuel level (0..100%), and odometer across dual columns
 *  3. Computes excess KM / late fees / fuel surcharge if applicable
 *  4. Bills unbilled additional charges (excluding EXTENSION), statutory traffic fines (0% Out-of-Scope VAT)
 *     + 5% admin/knowledge surcharges, and unbilled Salik/Darb tolls (5% VAT)
 *  5. Generates a final closing invoice (STANDARD, SENT) with balanced double-entry GL posting
 *  6. Sets booking COMPLETED and computes safe post-rental vehicle status (respecting grounding/work orders)
 *  7. Sets agreement status to CLOSED and mirrors invoice to Finance post-commit
 *
 * NOTE: Preserves exact positional SQL parameter slices asserted by
 * `tests/unit/rental-agreement-close-invoice.test.ts` (`tenant_id` is appended
 * as `$19` and status as `$20` on `rental_invoices`, and `tenant_id` as `$12` on
 * `rental_invoice_line_items`).
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { calculateRate, type PricingRuleRow, type RateRequest } from '@/lib/rental-rate-engine';
import { mirrorRentalInvoiceToFinance } from '@/lib/finance/module-ledger';
import { postRacInvoiceIssuedGl } from '@/lib/finance/rac-gl-posting';
import {
  resolveInputFuelPct,
  resolveStoredFuelPct,
  resolveStoredOdometerKm,
} from '@/lib/rental/fuel-odometer';
import {
  computeSafePostRentalVehicleStatus,
  nextRentalSerial,
  withSavepoint,
} from '@/lib/rental/locks';
import { requireRentalPermission } from '@/lib/rental/rbac';
import { isRentalSecurityError } from '@/lib/rental/security-guards';
import {
  dispatchUaeRegulatoryReportOutsideRls,
  queueUaeRegulatoryReportInTx,
  type UaeRegulatoryReportRecord,
} from '@/lib/rental/uae-regulatory-reporting';
import type { TxClient } from '@/lib/rls';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function isInspectionDamagedOrUnsafe(insp: Record<string, unknown>): boolean {
  const grade = String(insp.condition_grade ?? insp.overall_condition ?? '')
    .trim()
    .toUpperCase();
  if (grade === 'DAMAGED' || grade === 'UNSAFE' || grade === 'FAIL' || grade === 'FAILED') {
    return true;
  }
  if (
    insp.safety_clearance === false ||
    insp.passed === false ||
    insp.requires_maintenance === true
  ) {
    return true;
  }

  let rawChecklist: unknown = insp.checklist_items;
  if (typeof rawChecklist === 'string') {
    try {
      rawChecklist = JSON.parse(rawChecklist);
    } catch {
      rawChecklist = null;
    }
  }
  if (Array.isArray(rawChecklist)) {
    for (const item of rawChecklist) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const status = String(rec.status ?? rec.condition ?? '').trim().toUpperCase();
      const isSafetyKey =
        Boolean(rec.safetyCritical) ||
        Boolean(rec.safety_critical) ||
        /brake|tyre|tire|light|steer|airbag|windshield|safety/i.test(
          String(rec.key ?? rec.label ?? rec.name ?? ''),
        );
      if (rec.passed === false && isSafetyKey) return true;
      if (status === 'UNSAFE' || status === 'CRITICAL' || (status === 'FAIL' && isSafetyKey)) {
        return true;
      }
      if (status === 'DAMAGED') return true;
    }
  } else if (rawChecklist && typeof rawChecklist === 'object') {
    const obj = rawChecklist as Record<string, unknown>;
    if (obj.safetyClearance === false || obj.safety_clearance === false) {
      return true;
    }
  }
  return false;
}

async function resolvePreferredPostReturnStatus(
  tx: TxClient,
  args: {
    tenantId: string;
    vehicleId: string;
    agreementId: string;
    bookingId?: string | null;
  },
): Promise<'AVAILABLE' | 'MAINTENANCE'> {
  const inspections = await withSavepoint<Array<Record<string, unknown>>>(
    tx,
    'close_agr_inspections',
    () =>
      tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT *
           FROM vehicle_inspections
          WHERE tenant_id::text = $1
            AND vehicle_id = $2
          ORDER BY created_at DESC
          LIMIT 10`,
        args.tenantId,
        args.vehicleId,
      ),
    [],
  );
  if (!inspections.length) return 'AVAILABLE';

  const checkinRow =
    inspections.find((row) => {
      const iType = String(row.inspection_type ?? row.type ?? '').trim().toUpperCase();
      const matchesContext =
        (row.agreement_id && String(row.agreement_id) === args.agreementId) ||
        (args.bookingId && row.booking_id && String(row.booking_id) === String(args.bookingId));
      const isCheckinType =
        iType === 'CHECKIN' ||
        iType === 'CHECK_IN' ||
        iType === 'RETURN' ||
        iType === 'POST_RENTAL' ||
        iType === 'IN';
      return matchesContext && (isCheckinType || !iType);
    }) ??
    inspections.find((row) => {
      const iType = String(row.inspection_type ?? row.type ?? '').trim().toUpperCase();
      return (
        iType === 'CHECKIN' ||
        iType === 'CHECK_IN' ||
        iType === 'RETURN' ||
        iType === 'POST_RENTAL' ||
        iType === 'IN'
      );
    });

  if (checkinRow && isInspectionDamagedOrUnsafe(checkinRow)) {
    return 'MAINTENANCE';
  }
  return 'AVAILABLE';
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

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

  const actorId = (req.headers.get('x-user-id') ?? '').trim() || 'system';

  try {
    const bodyRaw = await req.json();
    const body = stripTenantOwnershipFields(
      (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
    ) as Record<string, unknown>;
    const {
      actualReturnDate,
      returnOdometer,
      notes,
      generateInvoice = true,
    } = body;

    if (!actualReturnDate) {
      return NextResponse.json({ error: 'actualReturnDate is required' }, { status: 400 });
    }

    const returnDate = new Date(String(actualReturnDate));
    if (Number.isNaN(returnDate.getTime())) {
      return NextResponse.json({ error: 'Invalid actualReturnDate' }, { status: 400 });
    }

    const rawReturnOdo = returnOdometer ?? body.mileageIn ?? body.return_odometer ?? body.mileage_in;
    if (
      rawReturnOdo != null &&
      rawReturnOdo !== '' &&
      (!Number.isFinite(Number(rawReturnOdo)) || Number(rawReturnOdo) < 0)
    ) {
      return NextResponse.json({ error: 'Invalid returnOdometer' }, { status: 400 });
    }
    const resolvedReturnOdometer =
      rawReturnOdo != null && rawReturnOdo !== '' ? Math.round(Number(rawReturnOdo)) : null;

    const resolvedReturnFuelPct = resolveInputFuelPct(body, 'return', 'PCT');

    let createdInvoiceIdForMirror = null as string | null;
    let queuedReturnReport = null as UaeRegulatoryReportRecord | null;

    const response = await withTenantRls(prisma, tenantId, async (tx) => {
      // ── 1. Load agreement strictly scoped to tenant_id ──
      // Invariant: preserve exact substring 'FROM rental_agreements ra'
      const agreements = await tx.$queryRawUnsafe<any[]>(
        'SELECT ra.*, v.category AS vehicle_category, v.registration_no ' +
          'FROM rental_agreements ra ' +
          'LEFT JOIN vehicles v ON v.id = ra.vehicle_id AND v.tenant_id::text = ra.tenant_id::text ' +
          'WHERE ra.id = $1 AND ra.tenant_id::text = $2',
        params.id,
        tenantId,
      );
      if (!agreements.length) {
        return NextResponse.json({ error: 'Agreement not found' }, { status: 404 });
      }
      const agr = agreements[0];

      if (agr.status !== 'ACTIVE' && agr.status !== 'COMPLETED') {
        return NextResponse.json(
          { error: 'Only ACTIVE or COMPLETED agreements can be closed. Current status: ' + agr.status },
          { status: 422 },
        );
      }

      const pickupOdometer = resolveStoredOdometerKm(agr.pickup_odometer, agr.mileage_out);

      // Load mid-rental vehicle swaps (multi-segment odometer & fuel calculation)
      const exchangeRows = await withSavepoint<Array<Record<string, unknown>>>(
        tx,
        'close_agr_exchanges',
        () =>
          tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
            `SELECT *
               FROM rental_vehicle_exchanges
              WHERE tenant_id::text = $1
                AND agreement_id = $2
              ORDER BY exchange_date ASC, created_at ASC`,
            tenantId,
            params.id,
          ),
        [],
      );

      if (exchangeRows.length > 0) {
        const lastEx = exchangeRows[exchangeRows.length - 1];
        const lastOutOdo = resolveStoredOdometerKm(
          lastEx.to_mileage_out,
          lastEx.mileage_at_exchange,
        );
        if (
          resolvedReturnOdometer != null &&
          lastOutOdo != null &&
          resolvedReturnOdometer < lastOutOdo
        ) {
          return NextResponse.json(
            {
              error:
                'returnOdometer cannot be lower than replacement vehicle outgoing odometer',
            },
            { status: 422 },
          );
        }
      } else if (
        resolvedReturnOdometer != null &&
        pickupOdometer != null &&
        resolvedReturnOdometer < pickupOdometer
      ) {
        return NextResponse.json(
          { error: 'returnOdometer cannot be lower than pickup odometer' },
          { status: 422 },
        );
      }

      const now = new Date().toISOString();
      const pickupDate = agr.start_date ? new Date(agr.start_date) : new Date();
      const dropoff = agr.end_date ? new Date(agr.end_date) : returnDate;

      // ── 2. Load tenant-scoped rate rules strictly inside RLS tx ──
      const pricingRules = await withSavepoint<PricingRuleRow[]>(
        tx,
        'close_agr_pricing_rules',
        () =>
          tx.$queryRawUnsafe<PricingRuleRow[]>(
            'SELECT * FROM pricing_rules WHERE tenant_id::text = $1 AND is_active = true ORDER BY priority DESC',
            tenantId,
          ),
        [],
      );

      const rateReq: RateRequest = {
        vehicleCategory: agr.vehicle_category ?? 'ECONOMY',
        pickupDate,
        dropoffDate: returnDate,
        pickupLocationCode: agr.pickup_location_code ?? undefined,
        dropoffLocationCode: agr.dropoff_location_code ?? undefined,
        customerType: agr.customer_type ?? 'INDIVIDUAL',
        corporateAccountId: agr.corporate_account_id ?? undefined,
        channel: agr.channel ?? 'DIRECT',
        promoCode: agr.promo_code ?? undefined,
        insurancePlanCode: agr.insurance_plan_code ?? undefined,
        currency: agr.currency ?? 'AED',
      };

      const rate = calculateRate(pricingRules, rateReq);

      // ── 3. Compute late-return fee ────────────────────────────────────────
      let lateFee = 0;
      const graceMs = (rate.gracePeriodMin ?? 30) * 60 * 1000;
      const lateDiff = returnDate.getTime() - dropoff.getTime();
      if (lateDiff > graceMs && rate.lateFeePerHour > 0) {
        const lateHours = Math.ceil((lateDiff - graceMs) / (60 * 60 * 1000));
        lateFee = Math.min(lateHours * rate.lateFeePerHour, rate.lateFeeCap || Infinity);
      }

      // ── 4. Compute excess KM fee (multi-segment swap aware) ───────────────
      let excessKmFee = 0;
      let totalDrivenKm: number | null = null;
      if (exchangeRows.length > 0) {
        let drivenSum = 0;
        let hasSegmentKm = false;

        // Initial vehicle segment: pickup -> exchangeRows[0]
        const ex0InOdo = resolveStoredOdometerKm(
          exchangeRows[0].from_mileage_in,
          exchangeRows[0].mileage_at_exchange,
        );
        if (pickupOdometer != null && ex0InOdo != null && ex0InOdo >= pickupOdometer) {
          drivenSum += ex0InOdo - pickupOdometer;
          hasSegmentKm = true;
        }

        // Intermediate swap segments: exchangeRows[i-1] -> exchangeRows[i]
        for (let i = 1; i < exchangeRows.length; i++) {
          const segOut = resolveStoredOdometerKm(
            exchangeRows[i - 1].to_mileage_out,
            exchangeRows[i - 1].mileage_at_exchange,
          );
          const segIn = resolveStoredOdometerKm(
            exchangeRows[i].from_mileage_in,
            exchangeRows[i].mileage_at_exchange,
          );
          if (segOut != null && segIn != null && segIn >= segOut) {
            drivenSum += segIn - segOut;
            hasSegmentKm = true;
          }
        }

        // Final vehicle segment: lastExchange -> return
        const lastEx = exchangeRows[exchangeRows.length - 1];
        const lastOut = resolveStoredOdometerKm(
          lastEx.to_mileage_out,
          lastEx.mileage_at_exchange,
        );
        if (lastOut != null && resolvedReturnOdometer != null && resolvedReturnOdometer >= lastOut) {
          drivenSum += resolvedReturnOdometer - lastOut;
          hasSegmentKm = true;
        }

        if (hasSegmentKm) {
          totalDrivenKm = drivenSum;
        }
      } else if (resolvedReturnOdometer != null && pickupOdometer != null) {
        totalDrivenKm = resolvedReturnOdometer - pickupOdometer;
      }

      if (totalDrivenKm != null && rate.includedKmPerDay > 0) {
        const includedKm = rate.includedKmPerDay * rate.totalDays;
        const excessKm = Math.max(0, totalDrivenKm - includedKm);
        if (excessKm > 0 && rate.excessKmRate > 0) {
          excessKmFee = parseFloat((excessKm * rate.excessKmRate).toFixed(2));
        }
      }

      // ── 5. Compute fuel surcharge (canonical 0..100%, multi-segment swap aware) ──
      const pickupFuel = resolveStoredFuelPct(agr.pickup_fuel_level, agr.fuel_out);

      let fuelSurcharge = 0;
      if (exchangeRows.length > 0) {
        let totalFuelDeficit = 0;

        const ex0InFuel = resolveStoredFuelPct(
          exchangeRows[0].from_fuel_in,
          exchangeRows[0].fuel_level_at_exchange,
        );
        if (pickupFuel != null && ex0InFuel != null && ex0InFuel < pickupFuel) {
          totalFuelDeficit += pickupFuel - ex0InFuel;
        }

        for (let i = 1; i < exchangeRows.length; i++) {
          const segOutFuel = resolveStoredFuelPct(
            exchangeRows[i - 1].to_fuel_out,
            exchangeRows[i - 1].fuel_level_at_exchange,
          );
          const segInFuel = resolveStoredFuelPct(
            exchangeRows[i].from_fuel_in,
            exchangeRows[i].fuel_level_at_exchange,
          );
          if (segOutFuel != null && segInFuel != null && segInFuel < segOutFuel) {
            totalFuelDeficit += segOutFuel - segInFuel;
          }
        }

        const lastEx = exchangeRows[exchangeRows.length - 1];
        const lastOutFuel =
          resolveStoredFuelPct(lastEx.to_fuel_out, lastEx.fuel_level_at_exchange) ?? pickupFuel;
        if (
          resolvedReturnFuelPct != null &&
          lastOutFuel != null &&
          resolvedReturnFuelPct < lastOutFuel
        ) {
          totalFuelDeficit += lastOutFuel - resolvedReturnFuelPct;
        }

        if (totalFuelDeficit > 0) {
          fuelSurcharge = parseFloat((totalFuelDeficit * 5).toFixed(2));
        }
      } else if (
        resolvedReturnFuelPct != null &&
        pickupFuel != null &&
        resolvedReturnFuelPct < pickupFuel
      ) {
        const fuelDiff = pickupFuel - resolvedReturnFuelPct;
        if (fuelDiff > 0) {
          fuelSurcharge = parseFloat((fuelDiff * 5).toFixed(2));
        }
      }

      // ── 6. Update agreement to CLOSED (sync dual fuel & odometer columns in 0..100% & km) ──
      await tx.$executeRawUnsafe(
        'UPDATE rental_agreements SET ' +
          "status='CLOSED', actual_return_date=$1::timestamptz, " +
          'return_fuel_level=$2, fuel_in=$2, return_odometer=$3, mileage_in=$3, ' +
          'late_fee=$4, excess_km_fee=$5, fuel_surcharge=$6, closed_by=$7, ' +
          'closing_notes=$8, updated_at=$9::timestamptz ' +
          'WHERE id=$10 AND tenant_id::text=$11',
        returnDate.toISOString(),
        resolvedReturnFuelPct,
        resolvedReturnOdometer,
        lateFee,
        excessKmFee,
        fuelSurcharge,
        actorId,
        typeof notes === 'string' ? notes : null,
        now,
        params.id,
        tenantId,
      );

      // ── 7. Mark booking COMPLETED & safely transition vehicle status (with 6-point inspection sync) ──
      if (agr.booking_id) {
        await tx.$executeRawUnsafe(
          "UPDATE rental_bookings SET status='COMPLETED', updated_at=$1::timestamptz WHERE id=$2 AND tenant_id::text=$3",
          now,
          agr.booking_id,
          tenantId,
        );
      }
      if (agr.vehicle_id) {
        const preferredStatus = await resolvePreferredPostReturnStatus(tx, {
          tenantId,
          vehicleId: String(agr.vehicle_id),
          agreementId: params.id,
          bookingId: agr.booking_id ?? null,
        });
        const safeVeh = await computeSafePostRentalVehicleStatus(tx, {
          tenantId,
          vehicleId: String(agr.vehicle_id),
          excludeAgreementId: params.id,
          excludeBookingId: agr.booking_id ?? null,
          preferredStatus,
        });
        await tx.$executeRawUnsafe(
          'UPDATE vehicles SET status=$1, ' +
            'current_mileage = CASE WHEN $4::bigint IS NOT NULL THEN GREATEST(COALESCE(current_mileage, 0), $4::bigint) ELSE current_mileage END, ' +
            'fuel_level = COALESCE($5, fuel_level), ' +
            'updated_at=$2::timestamptz WHERE id=$3 AND tenant_id::text=$6',
          safeVeh.status,
          now,
          agr.vehicle_id,
          resolvedReturnOdometer,
          resolvedReturnFuelPct,
          tenantId,
        );
      }

      // Queue UAE RTA Tarrashud / Dubai Police / Abu Dhabi ITC RETURN manifest
      queuedReturnReport = await queueUaeRegulatoryReportInTx(tx, {
        tenantId,
        agreementId: params.id,
        eventType: 'RETURN',
        submittedBy: actorId,
      });

      // ── 8. Generate closing invoice if requested ──────────────────────────
      let invoice = null;
      if (generateInvoice) {
        const TAX_RATE = 5;
        const lineItems: Array<{
          lineType: string;
          description: string;
          quantity: number;
          unitPrice: number;
          unitLabel: string;
          discountPct: number;
          taxable: boolean;
          amount: number;
        }> = [];

        // Invariant: preserve exact substring 'FROM rental_invoices WHERE agreement_id'
        const existing = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          'SELECT id FROM rental_invoices WHERE agreement_id = $1 AND tenant_id::text = $2 AND deleted_at IS NULL ' +
            "AND status NOT IN ('VOID','CANCELLED') LIMIT 1",
          params.id,
          tenantId,
        );
        const alreadyInvoiced = existing.length > 0;

        if (!alreadyInvoiced) {
          for (const bl of rate.breakdown) {
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

          // JSON additional_charges on agreement: exclude EXTENSION (already covered by rate engine period)
          try {
            if (agr.additional_charges) {
              const ac = JSON.parse(agr.additional_charges);
              for (const c of Array.isArray(ac) ? ac : []) {
                const cType = String(c.lineType ?? c.charge_type ?? 'EXTRA').trim().toUpperCase();
                if (cType === 'EXTENSION') continue;
                const amt = round2(Number(c.amount ?? 0));
                if (amt <= 0) continue;
                const isFine =
                  cType === 'FINE' ||
                  cType === 'TRAFFIC_FINE' ||
                  cType === 'STATUTORY_FINE' ||
                  cType === 'KNOWLEDGE_FEE';
                lineItems.push({
                  lineType: cType === 'KNOWLEDGE_FEE' ? 'KNOWLEDGE_FEE' : isFine ? 'FINE' : cType || 'EXTRA',
                  description: String(c.description ?? cType),
                  quantity: 1,
                  unitPrice: amt,
                  unitLabel: 'flat',
                  discountPct: 0,
                  taxable: c.taxable !== undefined ? Boolean(c.taxable) : !isFine,
                  amount: amt,
                });
              }
            }
          } catch {
            /* ignore malformed JSON */
          }

          // Table rental_additional_charges: exclude EXTENSION and sum pre-VAT amount (NEVER total_amount)
          const extraRows = await withSavepoint<Array<Record<string, unknown>>>(
            tx,
            'close_agr_add_charges',
            () =>
              tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
                `SELECT charge_type, description, quantity, amount::text AS amount
                   FROM rental_additional_charges
                  WHERE agreement_id = $1
                    AND tenant_id::text = $2
                    AND COALESCE(billed_to_customer, true) = true
                    AND UPPER(COALESCE(charge_type, '')) <> 'EXTENSION'`,
                params.id,
                tenantId,
              ),
            [],
          );
          for (const ch of extraRows) {
            const cType = String(ch.charge_type ?? 'EXTRA').trim().toUpperCase();
            if (cType === 'EXTENSION') continue;
            const qty = Math.max(1, Number(ch.quantity ?? 1));
            const unit = round2(Number(ch.amount ?? 0));
            const lineAmt = round2(qty * unit);
            if (lineAmt <= 0) continue;
            const isFine =
              cType === 'FINE' ||
              cType === 'TRAFFIC_FINE' ||
              cType === 'STATUTORY_FINE' ||
              cType === 'KNOWLEDGE_FEE';
            lineItems.push({
              lineType: cType === 'KNOWLEDGE_FEE' ? 'KNOWLEDGE_FEE' : isFine ? 'FINE' : cType,
              description: String(ch.description ?? cType),
              quantity: qty,
              unitPrice: unit,
              unitLabel: 'flat',
              discountPct: 0,
              taxable: !isFine,
              amount: lineAmt,
            });
          }
        }

        const currentVehSegmentStart =
          exchangeRows.length > 0 && exchangeRows[exchangeRows.length - 1].exchange_date
            ? new Date(String(exchangeRows[exchangeRows.length - 1].exchange_date)).toISOString()
            : pickupDate.toISOString();

        // Unbilled statutory traffic fines (0% Out-of-Scope VAT per FTA VATP006/VATP040)
        // + 0% Knowledge & Innovation Dirham + 5% RAC admin handling surcharge
        let fineRows = await withSavepoint<Array<Record<string, unknown>> | null>(
          tx,
          'close_agr_traffic_fines_v2',
          () =>
            tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
              `SELECT *
                 FROM traffic_fines tf
                WHERE tf.tenant_id::text = $1
                  AND (
                    tf.rental_agreement_id = $2
                    OR (
                      $3::text IS NOT NULL
                      AND tf.rental_agreement_id IS NULL
                      AND tf.vehicle_id = $3
                      AND tf.fine_date >= $4::timestamptz
                      AND tf.fine_date <= $5::timestamptz
                      AND COALESCE(tf.assigned_to, '') <> 'DRIVER'
                    )
                    OR (
                      tf.rental_agreement_id IS NULL
                      AND COALESCE(tf.assigned_to, '') <> 'DRIVER'
                      AND EXISTS (
                        SELECT 1
                          FROM (
                            SELECT rve.from_vehicle_id AS seg_veh_id,
                                   COALESCE(
                                     LAG(rve.exchange_date) OVER (ORDER BY rve.exchange_date ASC, rve.created_at ASC),
                                     $6::timestamptz
                                   ) AS seg_start,
                                   rve.exchange_date AS seg_end
                              FROM rental_vehicle_exchanges rve
                             WHERE rve.tenant_id::text = $1
                               AND rve.agreement_id = $2
                          ) seg
                         WHERE seg.seg_veh_id = tf.vehicle_id
                           AND tf.fine_date >= seg.seg_start
                           AND tf.fine_date <= seg.seg_end
                      )
                    )
                  )
                  AND COALESCE(tf.is_billed_to_customer, FALSE) = FALSE
                  AND UPPER(COALESCE(tf.status, 'UNPAID')) NOT IN ('PAID', 'WAIVED', 'CANCELLED')`,
              tenantId,
              params.id,
              agr.vehicle_id ?? null,
              currentVehSegmentStart,
              returnDate.toISOString(),
              pickupDate.toISOString(),
            ),
          null,
        );

        if (fineRows === null) {
          fineRows = await withSavepoint<Array<Record<string, unknown>>>(
            tx,
            'close_agr_traffic_fines_legacy',
            () =>
              tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
                `SELECT *
                   FROM traffic_fines tf
                  WHERE tf.tenant_id::text = $1
                    AND (
                      tf.rental_agreement_id = $2
                      OR (
                        $3::text IS NOT NULL
                        AND tf.rental_agreement_id IS NULL
                        AND tf.vehicle_id = $3
                        AND tf.fine_date >= $4::timestamptz
                        AND tf.fine_date <= $5::timestamptz
                        AND COALESCE(tf.assigned_to, '') <> 'DRIVER'
                      )
                    )
                    AND UPPER(COALESCE(tf.status, 'UNPAID')) = 'UNPAID'`,
                tenantId,
                params.id,
                agr.vehicle_id ?? null,
                pickupDate.toISOString(),
                returnDate.toISOString(),
              ),
            [],
          );
        }

        const billedFineIds: string[] = [];
        const fineLabels: string[] = [];
        let finePrincipalTotal = 0;
        let knowledgeFeeTotal = 0;
        let fineAdminTotal = 0;

        for (const tf of fineRows) {
          const fineLabel = String(tf.fine_ref ?? tf.offence_type ?? 'Traffic fine');
          const finePrincipal = round2(Number(tf.fine_amount ?? tf.amount ?? 0));
          const knowledgeFee = round2(Number(tf.knowledge_fee ?? 0));
          const fineAdmin = round2(Number(tf.admin_fee ?? 0));

          if (finePrincipal > 0 || knowledgeFee > 0 || fineAdmin > 0) {
            if (tf.id) billedFineIds.push(String(tf.id));
            fineLabels.push(fineLabel);
          }
          finePrincipalTotal = round2(finePrincipalTotal + finePrincipal);
          knowledgeFeeTotal = round2(knowledgeFeeTotal + knowledgeFee);
          fineAdminTotal = round2(fineAdminTotal + fineAdmin);
        }

        if (finePrincipalTotal > 0) {
          lineItems.push({
            lineType: 'FINE',
            description: `Traffic Fine (Statutory Out-of-Scope): ${fineLabels.join(', ')}`,
            quantity: 1,
            unitPrice: finePrincipalTotal,
            unitLabel: 'flat',
            discountPct: 0,
            taxable: false,
            amount: finePrincipalTotal,
          });
        }

        if (knowledgeFeeTotal > 0) {
          lineItems.push({
            lineType: 'KNOWLEDGE_FEE',
            description:
              'UAE Knowledge & Innovation Dirham (Statutory Out-of-Scope, FTA VATP006/VATP040)',
            quantity: 1,
            unitPrice: knowledgeFeeTotal,
            unitLabel: 'flat',
            discountPct: 0,
            taxable: false,
            amount: knowledgeFeeTotal,
          });
        }

        // Unbilled Salik / Darb toll transactions (5% UAE VAT taxable supply + 5% admin fee)
        const tollRows = await withSavepoint<Array<Record<string, unknown>>>(
          tx,
          'close_agr_tolls',
          () =>
            tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
              `SELECT *
                 FROM toll_transactions tt
                WHERE tt.tenant_id::text = $1
                  AND (
                    tt.rental_agreement_id = $2
                    OR (
                      $3::text IS NOT NULL
                      AND tt.rental_agreement_id IS NULL
                      AND tt.vehicle_id = $3
                      AND tt.occurred_at >= $4::timestamptz
                      AND tt.occurred_at <= $5::timestamptz
                    )
                    OR (
                      tt.rental_agreement_id IS NULL
                      AND EXISTS (
                        SELECT 1
                          FROM (
                            SELECT rve.from_vehicle_id AS seg_veh_id,
                                   COALESCE(
                                     LAG(rve.exchange_date) OVER (ORDER BY rve.exchange_date ASC, rve.created_at ASC),
                                     $6::timestamptz
                                   ) AS seg_start,
                                   rve.exchange_date AS seg_end
                              FROM rental_vehicle_exchanges rve
                             WHERE rve.tenant_id::text = $1
                               AND rve.agreement_id = $2
                          ) seg
                         WHERE seg.seg_veh_id = tt.vehicle_id
                           AND tt.occurred_at >= seg.seg_start
                           AND tt.occurred_at <= seg.seg_end
                      )
                    )
                  )
                  AND COALESCE(tt.is_billed_to_customer, false) = false`,
              tenantId,
              params.id,
              agr.vehicle_id ?? null,
              currentVehSegmentStart,
              returnDate.toISOString(),
              pickupDate.toISOString(),
            ),
          [],
        );

        const billedTollIds: string[] = [];
        let tollAdminTotal = 0;
        for (const toll of tollRows) {
          const tollLabel = String(
            toll.gate_name ?? toll.toll_gate ?? toll.location ?? toll.toll_system ?? 'Salik / Darb Toll',
          );
          const tollAmt = round2(Number(toll.amount ?? toll.toll_amount ?? 0));
          const tollAdmin = round2(Number(toll.admin_fee ?? 0));
          if (tollAmt > 0 || tollAdmin > 0) {
            if (toll.id) billedTollIds.push(String(toll.id));
          }
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
          }
          tollAdminTotal = round2(tollAdminTotal + tollAdmin);
        }

        const totalAdminSurcharge = round2(fineAdminTotal + tollAdminTotal);
        if (totalAdminSurcharge > 0) {
          lineItems.push({
            lineType: 'ADMIN_FEE',
            description:
              fineAdminTotal > 0 && tollAdminTotal > 0
                ? 'Traffic Fine & Toll Administrative Handling Surcharge (5% UAE VAT)'
                : fineAdminTotal > 0
                  ? 'Traffic Fine Administrative Handling Surcharge (5% UAE VAT)'
                  : 'Toll Administrative Handling Surcharge (5% UAE VAT)',
            quantity: 1,
            unitPrice: totalAdminSurcharge,
            unitLabel: 'flat',
            discountPct: 0,
            taxable: true,
            amount: totalAdminSurcharge,
          });
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
        if (excessKmFee > 0) {
          lineItems.push({
            lineType: 'EXCESS_KM',
            description: 'Excess km charge',
            quantity: 1,
            unitPrice: excessKmFee,
            unitLabel: 'flat',
            discountPct: 0,
            taxable: true,
            amount: excessKmFee,
          });
        }
        if (fuelSurcharge > 0) {
          lineItems.push({
            lineType: 'FUEL',
            description: 'Fuel surcharge',
            quantity: 1,
            unitPrice: fuelSurcharge,
            unitLabel: 'flat',
            discountPct: 0,
            taxable: true,
            amount: fuelSurcharge,
          });
        }

        if (lineItems.length > 0) {
          const subtotal = parseFloat(lineItems.reduce((s, l) => s + l.amount, 0).toFixed(2));
          const discAmt = alreadyInvoiced ? 0 : rate.discountAmount;
          const taxableLines = lineItems
            .filter((l) => l.taxable)
            .reduce((s, l) => s + l.amount, 0);
          const taxableAmt = parseFloat(Math.max(0, taxableLines - discAmt).toFixed(2));
          const taxAmt = parseFloat(((taxableAmt * TAX_RATE) / 100).toFixed(2));
          const totalAmt = parseFloat((subtotal + taxAmt).toFixed(2));

          const invoiceNo = await nextRentalSerial(tx, {
            tenantId,
            series: 'RINV',
            prefix: 'RINV-',
            table: 'rental_invoices',
            column: 'invoice_no',
          });
          const invoiceId = crypto.randomUUID();
          const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          const invoiceStatus =
            typeof body.status === 'string' && body.status.trim().toUpperCase() === 'DRAFT'
              ? 'DRAFT'
              : 'SENT';

          // Invariant: args[0..18] preserved identically; status appended as $20!
          await tx.$executeRawUnsafe(
            'INSERT INTO rental_invoices ' +
              '(id,created_at,updated_at,invoice_no,agreement_id,customer_id,invoice_type,invoice_date,' +
              'due_date,period_from,period_to,currency,subtotal,discount_amount,taxable_amount,tax_rate,' +
              'tax_amount,total_amount,paid_amount,balance_due,status,billing_mode,payment_terms_days,notes,tenant_id) ' +
              "VALUES ($1,$2::timestamptz,$3::timestamptz,$4,$5,$6,'STANDARD',$7::timestamptz,$8::timestamptz,$9::timestamptz,$10::timestamptz,$11,$12,$13,$14,$15,$16,$17,0,$17,$20,'SEPARATE',30,$18,$19)",
            invoiceId,
            now,
            now,
            invoiceNo,
            params.id,
            agr.customer_id,
            now,
            dueDate,
            agr.start_date,
            returnDate.toISOString(),
            agr.currency ?? 'AED',
            subtotal,
            discAmt,
            taxableAmt,
            TAX_RATE,
            taxAmt,
            totalAmt,
            typeof notes === 'string' ? notes : 'Closing invoice for agreement ' + agr.agreement_no,
            tenantId,
            invoiceStatus,
          );

          let sortOrder = 0;
          for (const li of lineItems) {
            // Invariant: args[0..10] preserved identically; tenant_id appended as $12!
            await tx.$executeRawUnsafe(
              'INSERT INTO rental_invoice_line_items ' +
                '(id,invoice_id,line_type,description,quantity,unit_price,unit_label,discount_pct,taxable,amount,sort_order,tenant_id) ' +
                'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
              crypto.randomUUID(),
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
              tenantId,
            );
          }

          if (billedTollIds.length > 0) {
            await withSavepoint(
              tx,
              'close_mark_tolls_billed',
              () =>
                tx.$executeRawUnsafe(
                  `UPDATE toll_transactions
                      SET is_billed_to_customer = true,
                          billed_invoice_id = $1,
                          rental_agreement_id = COALESCE(rental_agreement_id, $2)
                    WHERE tenant_id::text = $3
                      AND id::text = ANY($4::text[])`,
                  invoiceId,
                  params.id,
                  tenantId,
                  billedTollIds,
                ),
              0,
            );
          }

          if (billedFineIds.length > 0) {
            const markedV2 = await withSavepoint<number | null>(
              tx,
              'close_mark_fines_billed_v2',
              () =>
                tx.$executeRawUnsafe(
                  `UPDATE traffic_fines
                      SET is_billed_to_customer = TRUE,
                          billed_invoice_id = $1,
                          rental_agreement_id = COALESCE(rental_agreement_id, $2)
                    WHERE tenant_id::text = $3
                      AND id::text = ANY($4::text[])`,
                  invoiceId,
                  params.id,
                  tenantId,
                  billedFineIds,
                ),
              null,
            );
            if (markedV2 === null) {
              await withSavepoint(
                tx,
                'close_link_fines_agr',
                () =>
                  tx.$executeRawUnsafe(
                    `UPDATE traffic_fines
                        SET rental_agreement_id = COALESCE(rental_agreement_id, $1)
                      WHERE tenant_id::text = $2
                        AND id::text = ANY($3::text[])`,
                    params.id,
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
            agreementNo: agr.agreement_no ?? null,
            invoiceDate: now,
            status: invoiceStatus,
            currency: agr.currency ?? 'AED',
            subtotal,
            discountAmount: discAmt,
            taxAmount: taxAmt,
            totalAmount: totalAmt,
            lines: lineItems,
            rentalDaysHint: rate.totalDays,
            preparedBy: actorId,
          });

          createdInvoiceIdForMirror = invoiceId;

          const invRows = await tx.$queryRawUnsafe<any[]>(
            'SELECT * FROM rental_invoices WHERE id = $1 AND tenant_id::text = $2',
            invoiceId,
            tenantId,
          );
          invoice = invRows[0];
        }
      }

      const updatedAgr = await tx.$queryRawUnsafe<any[]>(
        'SELECT * FROM rental_agreements WHERE id = $1 AND tenant_id::text = $2',
        params.id,
        tenantId,
      );

      return NextResponse.json({
        agreement: updatedAgr[0],
        closingSummary: { lateFee, excessKmFee, fuelSurcharge },
        invoice,
        regulatoryReport: queuedReturnReport,
      });
    });

    if (createdInvoiceIdForMirror) {
      await mirrorRentalInvoiceToFinance(createdInvoiceIdForMirror, tenantId, actorId).catch(
        (err) => console.warn('[rental/close] mirror failed:', err),
      );
    }

    if (queuedReturnReport && queuedReturnReport.status === 'QUEUED') {
      await dispatchUaeRegulatoryReportOutsideRls(queuedReturnReport).catch((err) =>
        console.warn('[rental/close] regulatory report dispatch failed:', err),
      );
    }

    return response;
  } catch (e) {
    if (isRentalSecurityError(e)) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    console.error('Agreement close error:', e);
    return NextResponse.json(
      { error: 'Failed to close rental agreement' },
      { status: 500 },
    );
  }
}
