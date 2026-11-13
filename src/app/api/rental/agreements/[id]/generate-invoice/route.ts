export const dynamic = 'force-dynamic';

/**
 * POST /api/rental/agreements/:id/generate-invoice
 *
 * Builds a full RentalInvoice from an active/completed/closed agreement, pulling:
 *  - Base rental charge & insurance (from rate engine)
 *  - Additional / optional charges (excluding EXTENSION to avoid double-billing, pre-VAT amounts only)
 *  - Outstanding damage-claim charges (`damage_claims`)
 *  - Unpaid statutory traffic fines (`0%` Out-of-Scope VAT per FTA VATP006/VATP040) + `5%` admin/knowledge fees
 *  - Unbilled Salik / Darb toll transactions (`5%` UAE VAT + `5%` admin fee)
 *  - Posts balanced double-entry GL (`postRacInvoiceIssuedGl` / `postRacCreditNoteOrVoidGl`) when issued
 *  - Mirrors synchronously post-commit to `finance_invoices` (single mirror, no duplicate event race)
 *
 * Preserves exact positional SQL parameter slices asserted by
 * `tests/unit/rental-agreement-close-invoice.test.ts` (`invoiceArgs().slice(13, 19)`).
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { calculateRate, type RateRequest, type PricingRuleRow } from '@/lib/rental-rate-engine';
import { mirrorRentalInvoiceToFinance } from '@/lib/finance/module-ledger';
import {
  postRacCreditNoteOrVoidGl,
  postRacInvoiceIssuedGl,
} from '@/lib/finance/rac-gl-posting';
import {
  resolveStoredFuelPct,
  resolveStoredOdometerKm,
} from '@/lib/rental/fuel-odometer';
import { nextRentalSerial, withSavepoint } from '@/lib/rental/locks';
import { requireRentalPermission } from '@/lib/rental/rbac';
import { isRentalSecurityError } from '@/lib/rental/security-guards';

interface AgreementRow {
  id: string;
  status: string;
  booking_id?: string | null;
  vehicle_id?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  agreement_no?: string | null;
  vehicle_category?: string | null;
  registration_no?: string | null;
  start_date?: string | null;
  actual_return_date?: string | null;
  end_date?: string | null;
  pickup_location_code?: string | null;
  dropoff_location_code?: string | null;
  customer_type?: string | null;
  corporate_account_id?: string | null;
  channel?: string | null;
  promo_code?: string | null;
  insurance_plan_code?: string | null;
  currency?: string | null;
  additional_charges?: string | null;
  is_corporate?: boolean | null;
  billing_mode?: string | null;
  [key: string]: unknown;
}

interface InvoiceLineItemInput {
  lineType: string;
  description: string;
  quantity: number;
  unitPrice: number;
  unitLabel: string;
  discountPct: number;
  taxable: boolean;
  amount: number;
}

const ALLOWED_INVOICE_TYPES = new Set([
  'RENTAL',
  'FINAL',
  'EXTENSION',
  'CREDIT_NOTE',
  'STANDARD',
  'PRE_BILLING',
  'MONTHLY',
  'COMBINATION',
]);

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const createPermErr = await requireRentalPermission(
    req.headers,
    tenantId,
    'create',
    'invoices',
    req.nextUrl.pathname,
  );
  if (createPermErr) return createPermErr;

  try {
    const bodyRaw = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(
      (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
    ) as Record<string, unknown>;

    const rawInvoiceType =
      body.invoiceType === undefined || body.invoiceType === null || String(body.invoiceType).trim() === ''
        ? 'RENTAL'
        : String(body.invoiceType).trim().toUpperCase();

    if (!ALLOWED_INVOICE_TYPES.has(rawInvoiceType)) {
      return NextResponse.json(
        { error: `Invalid invoiceType: must be one of RENTAL, FINAL, EXTENSION, CREDIT_NOTE` },
        { status: 400 },
      );
    }

    if (rawInvoiceType === 'CREDIT_NOTE') {
      const creditPermErr = await requireRentalPermission(
        req.headers,
        tenantId,
        'approve',
        'invoices',
        req.nextUrl.pathname,
      );
      if (creditPermErr) return creditPermErr;
    }

    const autoSend = Boolean(body.autoSend);
    const requestedStatusRaw =
      typeof body.status === 'string' ? body.status.trim().toUpperCase() : '';
    const status =
      requestedStatusRaw && ['DRAFT', 'SENT', 'ISSUED', 'UNPAID'].includes(requestedStatusRaw)
        ? requestedStatusRaw
        : autoSend
          ? 'SENT'
          : 'DRAFT';
    const notes = typeof body.notes === 'string' ? body.notes : null;
    const actor = (req.headers.get('x-user-id') ?? '').trim() || 'system';

    const txOutcome = await withTenantRls(prisma, tenantId, async (tx) => {
      // ── 1. Load agreement strictly scoped to tenant_id ────────────────────
      // Invariant: preserve exact substring 'FROM rental_agreements ra'
      const agreements = await tx.$queryRawUnsafe<AgreementRow[]>(
        'SELECT ra.*, v.category AS vehicle_category, v.registration_no ' +
          'FROM rental_agreements ra ' +
          'LEFT JOIN vehicles v ON v.id = ra.vehicle_id AND v.tenant_id::text = ra.tenant_id::text ' +
          'WHERE ra.id = $1 AND ra.tenant_id::text = $2',
        params.id,
        tenantId,
      );
      if (!agreements.length) {
        return { error: 'Agreement not found', status: 404 as const };
      }
      const agr = agreements[0];

      if (!['ACTIVE', 'COMPLETED', 'CLOSED'].includes(agr.status)) {
        return {
          error: 'Invoice can only be generated for ACTIVE, COMPLETED or CLOSED agreements',
          status: 422 as const,
        };
      }

      // ── 2. Fetch tenant-scoped pricing rules and calculate base rental ────
      const pricingRules = await withSavepoint<PricingRuleRow[]>(
        tx,
        'gen_inv_pricing_rules',
        () =>
          tx.$queryRawUnsafe<PricingRuleRow[]>(
            'SELECT * FROM pricing_rules WHERE tenant_id::text = $1 AND is_active = true ORDER BY priority DESC',
            tenantId,
          ),
        [],
      );

      const pickupDate = agr.start_date ? new Date(agr.start_date) : new Date();
      const dropoffDate = agr.actual_return_date
        ? new Date(agr.actual_return_date)
        : agr.end_date
          ? new Date(agr.end_date)
          : new Date();

      const rateReq: RateRequest = {
        vehicleCategory: agr.vehicle_category ?? 'ECONOMY',
        pickupDate,
        dropoffDate,
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

      // ── 3. Load additional charges (excluding EXTENSION & using pre-VAT amounts) ──
      let additionalCharges: Array<{
        description: string;
        amount: number;
        lineType?: string;
        charge_type?: string;
        taxable?: boolean;
      }> = [];
      try {
        if (agr.additional_charges) {
          const parsed = JSON.parse(agr.additional_charges);
          additionalCharges = Array.isArray(parsed) ? parsed : [];
        }
      } catch {
        /* ignore */
      }

      const tableCharges = await withSavepoint<Array<Record<string, unknown>>>(
        tx,
        'gen_inv_table_charges',
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

      // ── 4. Load open/approved/charged damage-claim charges (`damage_claims`) ──
      const damageClaims = agr.booking_id
        ? await withSavepoint<{ description: string; amount: number }[]>(
            tx,
            'gen_inv_damage_claims',
            () =>
              tx.$queryRawUnsafe<{ description: string; amount: number }[]>(
                "SELECT COALESCE(description, 'Vehicle damage') AS description, " +
                  'COALESCE(actual_cost, estimated_cost, 0) AS amount ' +
                  'FROM damage_claims ' +
                  "WHERE booking_id = $1 AND tenant_id::text = $2 AND status IN ('OPEN', 'ASSESSED', 'APPROVED', 'CHARGED')",
                agr.booking_id,
                tenantId,
              ),
            [],
          )
        : [];

      // ── 4b. Load mid-rental vehicle swaps (for multi-segment KM/fuel & fine/toll windows) ──
      const exchangeRows = await withSavepoint<Array<Record<string, unknown>>>(
        tx,
        'gen_inv_exchanges',
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

      const currentVehSegmentStart =
        exchangeRows.length > 0 && exchangeRows[exchangeRows.length - 1].exchange_date
          ? new Date(String(exchangeRows[exchangeRows.length - 1].exchange_date)).toISOString()
          : pickupDate.toISOString();

      // ── 5. Load unbilled traffic fines (`0%` Out-of-Scope principal + `0%` Knowledge Dirham + `5%` admin) ──
      let trafficFines = await withSavepoint<Array<Record<string, unknown>> | null>(
        tx,
        'gen_inv_traffic_fines_v2',
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
            dropoffDate.toISOString(),
            pickupDate.toISOString(),
          ),
        null,
      );

      if (trafficFines === null) {
        trafficFines = await withSavepoint<Array<Record<string, unknown>>>(
          tx,
          'gen_inv_traffic_fines',
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
              dropoffDate.toISOString(),
            ),
          [],
        );
      }

      // ── 6. Load unbilled Salik / Darb toll transactions (`5%` VAT + `5%` admin fee) ──
      const tollRows = await withSavepoint<Array<Record<string, unknown>>>(
        tx,
        'gen_inv_tolls',
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
            dropoffDate.toISOString(),
            pickupDate.toISOString(),
          ),
        [],
      );

      // ── 7. Build line items ───────────────────────────────────────────────
      const TAX_RATE = 5; // UAE VAT
      const lineItems: InvoiceLineItemInput[] = [];

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

      for (const ac of additionalCharges) {
        const cType = String(ac.lineType ?? ac.charge_type ?? 'EXTRA').trim().toUpperCase();
        if (cType === 'EXTENSION') continue;
        const amt = round2(Number(ac.amount ?? 0));
        if (amt <= 0) continue;
        const isFine =
          cType === 'FINE' ||
          cType === 'TRAFFIC_FINE' ||
          cType === 'STATUTORY_FINE' ||
          cType === 'KNOWLEDGE_FEE';
        lineItems.push({
          lineType: cType === 'KNOWLEDGE_FEE' ? 'KNOWLEDGE_FEE' : isFine ? 'FINE' : cType || 'EXTRA',
          description: String(ac.description ?? cType),
          quantity: 1,
          unitPrice: amt,
          unitLabel: 'flat',
          discountPct: 0,
          taxable: ac.taxable !== undefined ? Boolean(ac.taxable) : !isFine,
          amount: amt,
        });
      }

      for (const ch of tableCharges) {
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

      for (const dc of damageClaims) {
        if (Number(dc.amount) <= 0) continue;
        const dmgAmt = round2(Number(dc.amount));
        lineItems.push({
          lineType: 'DAMAGE',
          description: 'Damage: ' + dc.description,
          quantity: 1,
          unitPrice: dmgAmt,
          unitLabel: 'flat',
          discountPct: 0,
          taxable: true,
          amount: dmgAmt,
        });
      }

      // Multi-segment swap driven KM & fuel deficit when mid-rental swaps exist
      if (exchangeRows.length > 0) {
        const pickupOdo = resolveStoredOdometerKm(agr.pickup_odometer, agr.mileage_out);
        const returnOdo = resolveStoredOdometerKm(agr.return_odometer, agr.mileage_in);
        const pickupFuel = resolveStoredFuelPct(agr.pickup_fuel_level, agr.fuel_out);
        const returnFuel = resolveStoredFuelPct(agr.return_fuel_level, agr.fuel_in);

        if (!lineItems.some((l) => l.lineType === 'EXCESS_KM') && rate.includedKmPerDay > 0) {
          let drivenSum = 0;
          let hasSegmentKm = false;

          const ex0InOdo = resolveStoredOdometerKm(
            exchangeRows[0].from_mileage_in,
            exchangeRows[0].mileage_at_exchange,
          );
          if (pickupOdo != null && ex0InOdo != null && ex0InOdo >= pickupOdo) {
            drivenSum += ex0InOdo - pickupOdo;
            hasSegmentKm = true;
          }

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

          const lastEx = exchangeRows[exchangeRows.length - 1];
          const lastOut = resolveStoredOdometerKm(
            lastEx.to_mileage_out,
            lastEx.mileage_at_exchange,
          );
          if (lastOut != null && returnOdo != null && returnOdo >= lastOut) {
            drivenSum += returnOdo - lastOut;
            hasSegmentKm = true;
          }

          if (hasSegmentKm) {
            const includedKm = rate.includedKmPerDay * rate.totalDays;
            const excessKm = Math.max(0, drivenSum - includedKm);
            if (excessKm > 0 && rate.excessKmRate > 0) {
              const excessKmFee = round2(excessKm * rate.excessKmRate);
              if (excessKmFee > 0) {
                lineItems.push({
                  lineType: 'EXCESS_KM',
                  description: 'Excess km charge (multi-vehicle segments)',
                  quantity: 1,
                  unitPrice: excessKmFee,
                  unitLabel: 'flat',
                  discountPct: 0,
                  taxable: true,
                  amount: excessKmFee,
                });
              }
            }
          }
        }

        if (!lineItems.some((l) => l.lineType === 'FUEL')) {
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
          if (returnFuel != null && lastOutFuel != null && returnFuel < lastOutFuel) {
            totalFuelDeficit += lastOutFuel - returnFuel;
          }
          const fuelSurcharge = round2(totalFuelDeficit * 5);
          if (fuelSurcharge > 0) {
            lineItems.push({
              lineType: 'FUEL',
              description: 'Fuel surcharge (multi-vehicle segments)',
              quantity: 1,
              unitPrice: fuelSurcharge,
              unitLabel: 'flat',
              discountPct: 0,
              taxable: true,
              amount: fuelSurcharge,
            });
          }
        }
      }

      const billedFineIds: string[] = [];
      const fineLabels: string[] = [];
      let finePrincipalTotal = 0;
      let knowledgeFeeTotal = 0;
      let fineAdminTotal = 0;

      for (const tf of trafficFines) {
        const fineLabel = String(tf.fine_ref ?? tf.offence_type ?? tf.description ?? 'Traffic fine');
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
          description: 'Traffic Fine (Statutory Out-of-Scope): ' + fineLabels.join(', '),
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
            description: 'Toll Charge: ' + tollLabel,
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

      // ── 8. Compute totals ─────────────────────────────────────────────────
      const taxableSubtotal = lineItems
        .filter((l) => l.taxable)
        .reduce((s, l) => s + l.amount, 0);
      const nonTaxableSubtotal = lineItems
        .filter((l) => !l.taxable)
        .reduce((s, l) => s + l.amount, 0);
      const subtotal = parseFloat((taxableSubtotal + nonTaxableSubtotal).toFixed(2));
      const discountAmount = rate.discountAmount;
      const taxableAmount = parseFloat(Math.max(0, taxableSubtotal - discountAmount).toFixed(2));
      const taxAmount = parseFloat(((taxableAmount * TAX_RATE) / 100).toFixed(2));
      const totalAmount = parseFloat((subtotal + taxAmount).toFixed(2));

      // ── 9. Serialize & generate collision-free tenant-scoped invoice number ──
      const isCreditNote = rawInvoiceType === 'CREDIT_NOTE';
      const invoiceNo = await nextRentalSerial(tx, {
        tenantId,
        series: isCreditNote ? 'RCN' : 'RINV',
        prefix: isCreditNote ? 'RCN-' : 'RINV-',
        table: 'rental_invoices',
        column: 'invoice_no',
      });

      const invoiceId = crypto.randomUUID();
      const now = new Date().toISOString();
      const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      // ── 10. Insert invoice (preserves args.slice(13, 19) invariant) ────────
      await tx.$executeRawUnsafe(
        'INSERT INTO rental_invoices ' +
          '(id,tenant_id,created_at,updated_at,invoice_no,agreement_id,customer_id,invoice_type,invoice_date,' +
          'due_date,period_from,period_to,currency,subtotal,discount_amount,taxable_amount,tax_rate,' +
          'tax_amount,total_amount,paid_amount,balance_due,status,is_corporate,corporate_account_id,' +
          'billing_mode,payment_terms_days,notes) ' +
          'VALUES ($1,$2,$3::timestamptz,$4::timestamptz,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz,$11::timestamptz,$12::timestamptz,$13,$14,$15,$16,$17,$18,$19,0,$19,$20,$21,$22,$23,30,$24)',
        invoiceId,
        tenantId,
        now,
        now,
        invoiceNo,
        params.id,
        agr.customer_id,
        rawInvoiceType,
        now,
        dueDate,
        pickupDate.toISOString(),
        dropoffDate.toISOString(),
        agr.currency ?? 'AED',
        subtotal,
        discountAmount,
        taxableAmount,
        TAX_RATE,
        taxAmount,
        totalAmount,
        status,
        agr.is_corporate ?? false,
        agr.corporate_account_id ?? null,
        agr.billing_mode ?? 'SEPARATE',
        notes,
      );

      // ── 11. Insert line items ─────────────────────────────────────────────
      let sortOrder = 0;
      for (const li of lineItems) {
        const liId = crypto.randomUUID();
        await tx.$executeRawUnsafe(
          'INSERT INTO rental_invoice_line_items ' +
            '(id,tenant_id,invoice_id,line_type,description,quantity,unit_price,unit_label,discount_pct,taxable,amount,sort_order) ' +
            'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
          liId,
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
          'gen_inv_mark_tolls_billed',
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
          'gen_inv_mark_fines_billed_v2',
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
            'gen_inv_link_fines_agr',
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

      // ── 12. Post double-entry General Ledger when non-DRAFT ───────────────
      if (status !== 'DRAFT') {
        if (isCreditNote) {
          await postRacCreditNoteOrVoidGl(tx, {
            tenantId,
            creditNoteOrInvoiceId: invoiceId,
            documentNo: invoiceNo,
            entryDate: now,
            currency: agr.currency ?? 'AED',
            subtotalMagnitude: subtotal,
            taxMagnitude: taxAmount,
            totalMagnitude: totalAmount,
            lines: lineItems,
            rentalDaysHint: rate.totalDays,
            preparedBy: actor,
          });
        } else {
          await postRacInvoiceIssuedGl(tx, {
            tenantId,
            invoiceId,
            invoiceNo,
            agreementNo: agr.agreement_no ?? null,
            invoiceDate: now,
            status,
            currency: agr.currency ?? 'AED',
            subtotal,
            discountAmount,
            taxAmount,
            totalAmount,
            lines: lineItems,
            rentalDaysHint: rate.totalDays,
            preparedBy: actor,
          });
        }
      }

      const invoiceRows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        'SELECT * FROM rental_invoices WHERE id = $1 AND tenant_id::text = $2',
        invoiceId,
        tenantId,
      );

      return {
        invoice: invoiceRows[0],
        lineItems,
        invoiceId,
        invoiceNo,
        customerId: agr.customer_id ?? null,
        totalAmount,
        currency: agr.currency ?? 'AED',
        status,
        generatedAt: now,
      };
    });

    if ('error' in txOutcome && txOutcome.error !== undefined) {
      return NextResponse.json({ error: txOutcome.error }, { status: txOutcome.status });
    }

    // Single synchronous post-commit mirror to Finance (no duplicate event-bus race)
    await mirrorRentalInvoiceToFinance(txOutcome.invoiceId, tenantId, actor).catch((err) =>
      console.warn('[rental/generate-invoice] mirror failed:', err),
    );

    return NextResponse.json(
      { invoice: txOutcome.invoice, lineItems: txOutcome.lineItems },
      { status: 201 },
    );
  } catch (e) {
    if (isRentalSecurityError(e)) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    console.error('Generate invoice error:', e);
    return NextResponse.json({ error: 'Failed to generate invoice' }, { status: 500 });
  }
}
