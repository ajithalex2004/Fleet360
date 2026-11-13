export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { listUnifiedExtensions } from '@/lib/rental/extension-service';
import {
  formatCanonicalFuelDisplay,
  resolveStoredFuelPct,
  resolveStoredOdometerKm,
} from '@/lib/rental/fuel-odometer';
import { withSavepoint } from '@/lib/rental/locks';
import { ALL_RAC_PORTAL_ROLES, requireRacPortalRole } from '../_helpers';

interface AgreementRow {
  id: string;
  agreement_no: string | null;
  booking_id: string;
  customer_id: string;
  vehicle_id: string | null;
  start_date: string | Date;
  end_date: string | Date;
  actual_return_date?: string | Date | null;
  daily_rate: string | number | null;
  total_amount: string | number | null;
  currency: string | null;
  security_deposit: string | number | null;
  deposit_status: string | null;
  status: string | null;
  signed_at: string | Date | null;
  signed_by: string | null;
  authorization_code: string | null;
  credit_card_last4: string | null;
  insurance_plan_code: string | null;
  remarks: string | null;
  mileage_out?: string | number | bigint | null;
  mileage_in?: string | number | bigint | null;
  fuel_out?: string | number | null;
  fuel_in?: string | number | null;
  pickup_odometer?: string | number | bigint | null;
  return_odometer?: string | number | bigint | null;
  pickup_fuel_level?: string | number | null;
  return_fuel_level?: string | number | null;
  created_at: string | Date;
  v_make: string | null;
  v_model: string | null;
  v_plate_number: string | null;
  v_license_plate: string | null;
  v_registration_no: string | null;
  v_category: string | null;
  v_current_mileage?: string | number | bigint | null;
  v_odometer_reading?: string | number | bigint | null;
  rb_ref: string | null;
  rb_pickup_location: string | null;
  rb_dropoff_location: string | null;
  pa_id: string | null;
  pa_auth_code: string | null;
  pa_amount: string | number | null;
  pa_status: string | null;
  pa_card_brand: string | null;
  pa_card_last4: string | null;
}

const BASE_SELECT = `
  ra.id,
  ra.agreement_no,
  ra.booking_id,
  ra.customer_id,
  ra.vehicle_id,
  ra.start_date,
  ra.end_date,
  ra.daily_rate,
  ra.total_amount,
  ra.currency,
  ra.security_deposit,
  ra.deposit_status,
  ra.status,
  ra.signed_at,
  ra.signed_by,
  ra.authorization_code,
  ra.credit_card_last4,
  ra.insurance_plan_code,
  ra.remarks,
  ra.created_at,
  v.make AS v_make,
  v.model AS v_model,
  v.plate_number AS v_plate_number,
  v.license_plate AS v_license_plate,
  v.registration_no AS v_registration_no,
  COALESCE(v.category, v.vehicle_group) AS v_category,
  rb.booking_ref AS rb_ref,
  rb.pickup_location AS rb_pickup_location,
  rb.dropoff_location AS rb_dropoff_location,
  pa.id::text AS pa_id,
  pa.authorization_code AS pa_auth_code,
  pa.amount AS pa_amount,
  pa.status AS pa_status,
  pa.card_brand AS pa_card_brand,
  pa.card_last4 AS pa_card_last4`;

const FROM_AND_WHERE = `
  FROM rental_agreements ra
  LEFT JOIN vehicles v
    ON v.id = ra.vehicle_id AND v.tenant_id::text = ra.tenant_id::text
  LEFT JOIN rental_bookings rb
    ON rb.id = ra.booking_id AND rb.tenant_id::text = ra.tenant_id::text
  LEFT JOIN LATERAL (
    SELECT p.id, p.authorization_code, p.amount, p.status, p.card_brand, p.card_last4
      FROM rac_card_preauths p
     WHERE p.tenant_id = ra.tenant_id::text
       AND p.customer_id = ra.customer_id
       AND (p.agreement_id = ra.id OR p.booking_id = ra.booking_id)
     ORDER BY p.created_at DESC
     LIMIT 1
  ) pa ON TRUE
  WHERE ra.tenant_id::text = $1
    AND ra.customer_id = $2
    AND ra.deleted_at IS NULL
  ORDER BY ra.created_at DESC`;

export async function GET(req: NextRequest) {
  const ctx = await requireRacPortalRole(req, ALL_RAC_PORTAL_ROLES);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const data = await withTenantRls(prisma, ctx.tenantId, async (tx) => {
      const extendedRows = await withSavepoint<AgreementRow[] | null>(
        tx,
        'rac_portal_agr_ext_cols',
        () =>
          tx.$queryRawUnsafe<AgreementRow[]>(
            `SELECT ${BASE_SELECT},
                    ra.actual_return_date,
                    ra.mileage_out,
                    ra.mileage_in,
                    ra.fuel_out,
                    ra.fuel_in,
                    ra.pickup_odometer,
                    ra.return_odometer,
                    ra.pickup_fuel_level,
                    ra.return_fuel_level,
                    v.current_mileage AS v_current_mileage,
                    v.odometer_reading AS v_odometer_reading
             ${FROM_AND_WHERE}`,
            ctx.tenantId,
            ctx.customerId,
          ),
        null,
      );

      const rows =
        extendedRows ??
        (await tx.$queryRawUnsafe<AgreementRow[]>(
          `SELECT ${BASE_SELECT}
           ${FROM_AND_WHERE}`,
          ctx.tenantId,
          ctx.customerId,
        ));

      const extRes = await listUnifiedExtensions(tx, {
        tenantId: ctx.tenantId,
        customerId: ctx.customerId,
        limit: 150,
      });

      const extensionsByAgreement = new Map<string, typeof extRes.data>();
      for (const ext of extRes.data) {
        const list = extensionsByAgreement.get(ext.agreementId) ?? [];
        list.push(ext);
        extensionsByAgreement.set(ext.agreementId, list);
      }

      const agreements = rows.map((r) => {
        const plateNumber =
          r.v_plate_number ?? r.v_license_plate ?? r.v_registration_no ?? 'TBA';
        const agExtensions = extensionsByAgreement.get(r.id) ?? [];

        const pickupFuelPct = resolveStoredFuelPct(r.pickup_fuel_level, r.fuel_out);
        const returnFuelPct = resolveStoredFuelPct(r.return_fuel_level, r.fuel_in);
        const pickupOdometerKm = resolveStoredOdometerKm(r.pickup_odometer, r.mileage_out);
        const returnOdometerKm = resolveStoredOdometerKm(r.return_odometer, r.mileage_in);
        const vehicleOdometerKm = resolveStoredOdometerKm(
          r.v_current_mileage,
          r.v_odometer_reading,
        );
        const distanceDrivenKm =
          pickupOdometerKm != null &&
          returnOdometerKm != null &&
          returnOdometerKm >= pickupOdometerKm
            ? returnOdometerKm - pickupOdometerKm
            : null;

        return {
          id: r.id,
          agreementNo: r.agreement_no ?? `RA-${r.id.slice(0, 8).toUpperCase()}`,
          bookingId: r.booking_id,
          bookingRef: r.rb_ref ?? null,
          vehicleId: r.vehicle_id,
          startDate: new Date(r.start_date).toISOString(),
          endDate: new Date(r.end_date).toISOString(),
          actualReturnDate: r.actual_return_date
            ? new Date(r.actual_return_date).toISOString()
            : null,
          pickupLocation: r.rb_pickup_location ?? null,
          dropoffLocation: r.rb_dropoff_location ?? null,
          dailyRate: Number(r.daily_rate ?? 0),
          totalAmount: Number(r.total_amount ?? 0),
          currency: r.currency ?? 'AED',
          securityDeposit: Number(r.security_deposit ?? 0),
          depositStatus: r.deposit_status ?? (r.pa_status === 'AUTHORIZED' ? 'HELD' : 'PENDING'),
          status: r.status ?? 'ACTIVE',
          signedByCustomer: Boolean(r.signed_at),
          signedAt: r.signed_at ? new Date(r.signed_at).toISOString() : null,
          signedBy: r.signed_by ?? null,
          insurancePlanCode: r.insurance_plan_code ?? null,
          remarks: r.remarks ?? null,
          pickupFuelLevel: pickupFuelPct,
          returnFuelLevel: returnFuelPct,
          fuelOutPct: pickupFuelPct,
          fuelInPct: returnFuelPct,
          fuelOutDisplay: formatCanonicalFuelDisplay(r.fuel_out, {
            pctColumn: r.pickup_fuel_level,
          }),
          fuelInDisplay: formatCanonicalFuelDisplay(r.fuel_in, {
            pctColumn: r.return_fuel_level,
          }),
          pickupOdometer: pickupOdometerKm,
          returnOdometer: returnOdometerKm,
          odometerOutKm: pickupOdometerKm,
          odometerInKm: returnOdometerKm,
          mileageOut: pickupOdometerKm,
          mileageIn: returnOdometerKm,
          distanceDrivenKm,
          createdAt: new Date(r.created_at).toISOString(),
          vehicle: r.vehicle_id
            ? {
                id: r.vehicle_id,
                make: r.v_make ?? 'Fleet',
                model: r.v_model ?? 'Vehicle',
                category: r.v_category ?? 'SEDAN',
                plateNumber,
                currentOdometerKm: vehicleOdometerKm,
              }
            : null,
          preauth: r.pa_id
            ? {
                id: r.pa_id,
                authorizationCode: r.pa_auth_code ?? r.authorization_code,
                amount: Number(r.pa_amount ?? r.security_deposit ?? 0),
                authorizedAmount: Number(r.pa_amount ?? r.security_deposit ?? 0),
                status: r.pa_status ?? 'AUTHORIZED',
                cardBrand: r.pa_card_brand ?? 'CARD',
                cardLast4: r.pa_card_last4 ?? r.credit_card_last4 ?? '0000',
              }
            : r.authorization_code
              ? {
                  id: null,
                  authorizationCode: r.authorization_code,
                  amount: Number(r.security_deposit ?? 0),
                  authorizedAmount: Number(r.security_deposit ?? 0),
                  status: r.deposit_status ?? 'PAID',
                  cardBrand: 'CARD',
                  cardLast4: r.credit_card_last4 ?? '0000',
                }
              : null,
          extensions: agExtensions,
        };
      });

      return {
        agreements,
        extensions: extRes.data,
      };
    });

    return NextResponse.json(data);
  } catch (err) {
    console.error('[rac-portal/agreements] GET failed:', err);
    return NextResponse.json(
      { error: 'Failed to load corporate rental agreements' },
      { status: 500 },
    );
  }
}
