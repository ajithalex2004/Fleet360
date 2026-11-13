/**
 * UAE Regulatory Renter Reporting Service
 *
 * Implements electronic renter manifest submission & lifecycle tracking for:
 *   - `RTA_TARRASHUD`  — Dubai Roads & Transport Authority (Smart Car Rental / Tarrashud)
 *   - `DUBAI_POLICE`   — Dubai Police Renter Security Registry
 *   - `ABU_DHABI_ITC`  — Abu Dhabi Integrated Transport Centre (ITC / Darb Renter Registry)
 *
 * Architectural Contract:
 *   - `queueUaeRegulatoryReportInTx` executes strictly inside `withTenantRls` wrapped in
 *     `withSavepoint` — ZERO external network I/O occurs inside a database transaction.
 *   - When live government gateway URLs (`RTA_TARRASHUD_API_URL`, `DUBAI_POLICE_TARRASHUD_URL`,
 *     `ABU_DHABI_ITC_API_URL`) are configured, rows are persisted as `QUEUED` and dispatched
 *     post-commit via `dispatchUaeRegulatoryReportOutsideRls`. When unconfigured, rows receive
 *     deterministic `SANDBOX_ACKNOWLEDGED` receipts (`TRD-SBX-...`) for full auditability.
 */

import crypto from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { withSavepoint } from '@/lib/rental/locks';

export type UaeRegulatoryAuthority = 'RTA_TARRASHUD' | 'DUBAI_POLICE' | 'ABU_DHABI_ITC';

export type UaeRegulatoryEventType =
  | 'HANDOVER'
  | 'EXTENSION'
  | 'VEHICLE_SWAP'
  | 'RETURN'
  | 'CANCELLATION';

export type UaeRegulatoryReportStatus =
  | 'QUEUED'
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'SANDBOX_ACKNOWLEDGED'
  | 'FAILED';

export interface UaeRenterManifest {
  schemaVersion: 'UAE-RAC-MANIFEST-2026.1';
  authority: UaeRegulatoryAuthority;
  eventType: UaeRegulatoryEventType;
  generatedAt: string;
  agreement: {
    id: string;
    agreementNo: string;
    startDate: string;
    endDate: string;
    actualReturnDate: string | null;
    pickupLocation: string | null;
    dropoffLocation: string | null;
  };
  renter: {
    customerId: string;
    fullName: string;
    nationality: string | null;
    visaType: string;
    emiratesId: string | null;
    passportNo: string | null;
    drivingLicenseNo: string | null;
    licenseIssuingCountry: string | null;
    licenseExpiry: string | null;
    internationalPermitNo: string | null;
    phone: string | null;
  };
  vehicle: {
    vehicleId: string | null;
    plateNumber: string | null;
    make: string | null;
    model: string | null;
    chassisVin: string | null;
    previousVehicleId?: string | null;
    previousPlateNumber?: string | null;
  };
}

export interface QueueUaeRegulatoryReportInput {
  tenantId: string;
  agreementId: string;
  eventType: UaeRegulatoryEventType;
  authority?: UaeRegulatoryAuthority;
  submittedBy?: string | null;
  previousVehicleId?: string | null;
  previousPlateNumber?: string | null;
}

export interface UaeRegulatoryReportRecord {
  id: string;
  tenantId: string;
  agreementId: string;
  authority: UaeRegulatoryAuthority;
  eventType: UaeRegulatoryEventType;
  status: UaeRegulatoryReportStatus;
  externalRef: string | null;
  manifestPayload: UaeRenterManifest;
  errorMessage: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
}

export function determineUaeRegulatoryAuthority(
  locationHint?: string | null,
  explicitAuthority?: string | null,
): UaeRegulatoryAuthority {
  const exp = String(explicitAuthority ?? '').trim().toUpperCase();
  if (exp === 'RTA_TARRASHUD' || exp === 'DUBAI_POLICE' || exp === 'ABU_DHABI_ITC') {
    return exp;
  }
  const loc = String(locationHint ?? '').trim().toUpperCase();
  if (
    loc.includes('AUH') ||
    loc.includes('ABU DHABI') ||
    loc.includes('ABU_DHABI') ||
    loc.includes('AL AIN') ||
    loc.includes('MUSSAFAH') ||
    loc.includes('YAS')
  ) {
    return 'ABU_DHABI_ITC';
  }
  return 'RTA_TARRASHUD';
}

export function getLiveRegulatoryEndpoint(authority: UaeRegulatoryAuthority): {
  url: string | null;
  apiKey: string | null;
} {
  if (authority === 'ABU_DHABI_ITC') {
    return {
      url: process.env.ABU_DHABI_ITC_API_URL?.trim() || null,
      apiKey: process.env.ABU_DHABI_ITC_API_KEY?.trim() || null,
    };
  }
  if (authority === 'DUBAI_POLICE') {
    return {
      url: process.env.DUBAI_POLICE_TARRASHUD_URL?.trim() || null,
      apiKey: process.env.DUBAI_POLICE_TARRASHUD_KEY?.trim() || null,
    };
  }
  return {
    url: process.env.RTA_TARRASHUD_API_URL?.trim() || null,
    apiKey: process.env.RTA_TARRASHUD_API_KEY?.trim() || null,
  };
}

function buildSandboxAckRef(authority: UaeRegulatoryAuthority, agreementNo: string, eventType: string): string {
  const prefix =
    authority === 'ABU_DHABI_ITC' ? 'ITC' : authority === 'DUBAI_POLICE' ? 'DXBPOL' : 'TRD';
  const digest = crypto
    .createHash('sha256')
    .update(`${authority}:${agreementNo}:${eventType}:${Date.now()}`)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
  return `${prefix}-SBX-${digest}`;
}

/**
 * Builds and persists a UAE regulatory renter manifest inside an active tenant RLS transaction.
 * Safe to call inside handover, activation, extension, swap, and return transactions: wrapped in
 * `withSavepoint` so environments prior to migration replay degrade gracefully without aborting `tx`.
 */
export async function queueUaeRegulatoryReportInTx(
  tx: TxClient,
  input: QueueUaeRegulatoryReportInput,
): Promise<UaeRegulatoryReportRecord | null> {
  if (typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe !== 'function') {
    return null;
  }

  return withSavepoint<UaeRegulatoryReportRecord | null>(
    tx,
    'rac_reg_report_queue',
    async () => {
      const agrRows = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          agreement_no: string | null;
          customer_id: string;
          customer_name: string | null;
          vehicle_id: string | null;
          start_date: Date | string;
          end_date: Date | string;
          actual_return_date: Date | string | null;
          pickup_location_code: string | null;
          dropoff_location_code: string | null;
        }>
      >(
        `SELECT id::text AS id, agreement_no, customer_id, customer_name, vehicle_id,
                start_date, end_date, actual_return_date, pickup_location_code, dropoff_location_code
           FROM rental_agreements
          WHERE id::text = $1 AND tenant_id::text = $2
          LIMIT 1`,
        input.agreementId,
        input.tenantId,
      );
      const agr = agrRows[0];
      if (!agr) return null;

      const custRows = await withSavepoint(
        tx,
        'rac_reg_cust',
        () =>
          tx.$queryRawUnsafe<
            Array<{
              full_name: string | null;
              nationality: string | null;
              visa_type: string | null;
              emirates_id: string | null;
              passport_no: string | null;
              driving_license_no: string | null;
              license_issuing_country: string | null;
              license_expiry: Date | string | null;
              international_permit_no: string | null;
              phone: string | null;
            }>
          >(
            `SELECT full_name, nationality, visa_type, emirates_id, passport_no,
                    driving_license_no, license_issuing_country, license_expiry,
                    international_permit_no, phone
               FROM rental_customers
              WHERE id::text = $1 AND tenant_id::text = $2
              LIMIT 1`,
            agr.customer_id,
            input.tenantId,
          ),
        [],
      );
      const cust = custRows[0];

      let veh: {
        plate_number: string | null;
        make: string | null;
        model: string | null;
        vin: string | null;
      } | null = null;
      if (agr.vehicle_id) {
        const vehRows = await withSavepoint(
          tx,
          'rac_reg_veh',
          () =>
            tx.$queryRawUnsafe<
              Array<{
                plate_number: string | null;
                make: string | null;
                model: string | null;
                vin: string | null;
              }>
            >(
              `SELECT COALESCE(plate_number, license_plate, registration_no) AS plate_number,
                      make,
                      model,
                      COALESCE(vin, chassis_no) AS vin
                 FROM vehicles
                WHERE id::text = $1 AND tenant_id::text = $2
                LIMIT 1`,
              agr.vehicle_id,
              input.tenantId,
            ),
          [],
        );
        veh = vehRows[0] ?? null;
      }

      const authority = determineUaeRegulatoryAuthority(
        agr.pickup_location_code,
        input.authority,
      );
      const nowIso = new Date().toISOString();
      const agreementNo = agr.agreement_no || agr.id.slice(0, 8).toUpperCase();

      const manifest: UaeRenterManifest = {
        schemaVersion: 'UAE-RAC-MANIFEST-2026.1',
        authority,
        eventType: input.eventType,
        generatedAt: nowIso,
        agreement: {
          id: agr.id,
          agreementNo,
          startDate: new Date(agr.start_date).toISOString(),
          endDate: new Date(agr.end_date).toISOString(),
          actualReturnDate: agr.actual_return_date
            ? new Date(agr.actual_return_date).toISOString()
            : null,
          pickupLocation: agr.pickup_location_code ?? null,
          dropoffLocation: agr.dropoff_location_code ?? null,
        },
        renter: {
          customerId: agr.customer_id,
          fullName: cust?.full_name || agr.customer_name || 'Unknown Renter',
          nationality: cust?.nationality ?? null,
          visaType: cust?.visa_type || 'RESIDENT',
          emiratesId: cust?.emirates_id ?? null,
          passportNo: cust?.passport_no ?? null,
          drivingLicenseNo: cust?.driving_license_no ?? null,
          licenseIssuingCountry: cust?.license_issuing_country ?? null,
          licenseExpiry: cust?.license_expiry
            ? new Date(cust.license_expiry).toISOString().slice(0, 10)
            : null,
          internationalPermitNo: cust?.international_permit_no ?? null,
          phone: cust?.phone ?? null,
        },
        vehicle: {
          vehicleId: agr.vehicle_id ?? null,
          plateNumber: veh?.plate_number ?? null,
          make: veh?.make ?? null,
          model: veh?.model ?? null,
          chassisVin: veh?.vin ?? null,
          ...(input.previousVehicleId
            ? {
                previousVehicleId: input.previousVehicleId,
                previousPlateNumber: input.previousPlateNumber ?? null,
              }
            : {}),
        },
      };

      const endpoint = getLiveRegulatoryEndpoint(authority);
      const isLiveConfigured = Boolean(endpoint.url);
      const status: UaeRegulatoryReportStatus = isLiveConfigured
        ? 'QUEUED'
        : 'SANDBOX_ACKNOWLEDGED';
      const externalRef = isLiveConfigured
        ? null
        : buildSandboxAckRef(authority, agreementNo, input.eventType);

      const inserted = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          created_at: Date | string;
          submitted_at: Date | string | null;
          acknowledged_at: Date | string | null;
        }>
      >(
        `INSERT INTO rental_regulatory_reports (
           tenant_id, agreement_id, authority, event_type, status,
           external_ref, manifest_payload, response_payload,
           submitted_by, submitted_at, acknowledged_at
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7::jsonb, $8::jsonb,
           $9, $10::timestamptz, $11::timestamptz
         )
         RETURNING id::text AS id, created_at, submitted_at, acknowledged_at`,
        input.tenantId,
        agr.id,
        authority,
        input.eventType,
        status,
        externalRef,
        JSON.stringify(manifest),
        isLiveConfigured
          ? null
          : JSON.stringify({
              mode: 'sandbox',
              receiptNo: externalRef,
              authority,
              acknowledgedAt: nowIso,
            }),
        input.submittedBy ?? 'system',
        isLiveConfigured ? null : nowIso,
        isLiveConfigured ? null : nowIso,
      );

      const row = inserted[0];
      if (!row) return null;

      return {
        id: row.id,
        tenantId: input.tenantId,
        agreementId: agr.id,
        authority,
        eventType: input.eventType,
        status,
        externalRef,
        manifestPayload: manifest,
        errorMessage: null,
        submittedBy: input.submittedBy ?? 'system',
        submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
        acknowledgedAt: row.acknowledged_at ? new Date(row.acknowledged_at).toISOString() : null,
        createdAt: new Date(row.created_at).toISOString(),
      };
    },
    null,
  );
}

/**
 * Dispatches a queued UAE regulatory report over HTTPS strictly OUTSIDE `withTenantRls`,
 * then updates the report status in a short follow-up RLS transaction.
 */
export async function dispatchUaeRegulatoryReportOutsideRls(
  report: UaeRegulatoryReportRecord,
): Promise<UaeRegulatoryReportRecord> {
  if (report.status !== 'QUEUED') {
    return report;
  }

  const endpoint = getLiveRegulatoryEndpoint(report.authority);
  if (!endpoint.url) {
    return report;
  }

  const nowIso = new Date().toISOString();
  let nextStatus: UaeRegulatoryReportStatus = 'FAILED';
  let externalRef: string | null = null;
  let responsePayload: Record<string, unknown> = {};
  let errorMessage: string | null = null;

  try {
    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}),
        'X-UAE-Authority': report.authority,
        'X-Idempotency-Key': report.id,
      },
      body: JSON.stringify(report.manifestPayload),
      signal: AbortSignal.timeout(10_000),
    });

    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    responsePayload = parsed;

    if (res.ok) {
      nextStatus = 'ACKNOWLEDGED';
      externalRef =
        String(
          parsed.receiptNo ??
            parsed.referenceNumber ??
            parsed.transactionId ??
            `LIVE-${report.id.slice(0, 8).toUpperCase()}`,
        ) || null;
    } else {
      nextStatus = 'FAILED';
      errorMessage = String(parsed.error ?? parsed.message ?? `HTTP ${res.status}`);
    }
  } catch (err) {
    nextStatus = 'FAILED';
    errorMessage = err instanceof Error ? err.message : 'Network dispatch failed';
  }

  await withTenantRls(prisma, report.tenantId, async (tx) => {
    await withSavepoint<number>(
      tx,
      'rac_reg_report_upd',
      () =>
        tx.$executeRawUnsafe(
          `UPDATE rental_regulatory_reports
              SET status = $1,
                  external_ref = COALESCE($2, external_ref),
                  response_payload = $3::jsonb,
                  error_message = $4,
                  submitted_at = $5::timestamptz,
                  acknowledged_at = CASE WHEN $1 = 'ACKNOWLEDGED' THEN $5::timestamptz ELSE acknowledged_at END,
                  updated_at = NOW()
            WHERE id = $6::uuid AND tenant_id::text = $7`,
          nextStatus,
          externalRef,
          JSON.stringify(responsePayload),
          errorMessage,
          nowIso,
          report.id,
          report.tenantId,
        ),
      0,
    );
  });

  return {
    ...report,
    status: nextStatus,
    externalRef,
    errorMessage,
    submittedAt: nowIso,
    acknowledgedAt: nextStatus === 'ACKNOWLEDGED' ? nowIso : null,
  };
}
