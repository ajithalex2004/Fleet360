export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/rac-portal/agreements/[id]/pdf?lang=en|ar&download=1
 *
 * Corporate B2B Portal Rental Agreement PDF endpoint.
 * Authenticates via `requireRacPortal` (`requireRacPortalRole`), loads agreement data
 * strictly inside `withTenantRls(prisma, ctx.tenantId, ...)` scoped to `customer_id = ctx.customerId`,
 * closes the DB transaction, and renders `RentalAgreementPdf` outside `withTenantRls`.
 */

import { createElement } from 'react';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { renderPdf } from '@/lib/pdf/render';
import {
  RentalAgreementPdf,
  type RentalAgreementPdfData,
} from '@/lib/pdf/templates/rental-agreement';
import type { Lang } from '@/lib/pdf/theme';
import { captureException } from '@/lib/sentry';
import {
  formatCanonicalFuelDisplay,
  resolveStoredFuelPct,
  resolveStoredOdometerKm,
} from '@/lib/rental/fuel-odometer';
import { withSavepoint } from '@/lib/rental/locks';
import { sanitizeDownloadFilename } from '@/lib/rental/security-guards';
import { ALL_RAC_PORTAL_ROLES, requireRacPortalRole } from '../../../_helpers';

const VENDOR = {
  name: 'Fleet360 — Rent-A-Car',
  tagline: 'UAE Smart Transport Management',
  address: 'Dubai, United Arab Emirates',
  email: 'rental@fleet360.app',
  trn: '',
};

function pickStr(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function parseSettingsJson(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function resolveTenantVendor(tx: TxClient, tenantId: string) {
  const tenantRecord =
    typeof tx.tenant?.findUnique === 'function'
      ? await withSavepoint(
          tx,
          'rac_portal_agr_pdf_tenant_prisma',
          () =>
            tx.tenant.findUnique({
              where: { id: tenantId },
              select: {
                name: true,
                address: true,
                contactEmail: true,
                contactPhone: true,
                trn: true,
              },
            }),
          null,
        )
      : null;

  const rawRows = await withSavepoint<Array<Record<string, unknown>>>(
    tx,
    'rac_portal_agr_pdf_tenant_raw',
    () =>
      tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        'SELECT * FROM tenants WHERE id = $1 LIMIT 1',
        tenantId,
      ),
    [],
  );
  const rawTenant = rawRows[0] ?? null;
  const settings = parseSettingsJson(rawTenant?.settings);

  const phone = pickStr(
    tenantRecord?.contactPhone,
    rawTenant?.contact_phone,
    rawTenant?.phone,
    settings?.phone,
  );

  return {
    name: pickStr(tenantRecord?.name, rawTenant?.name, VENDOR.name),
    tagline: VENDOR.tagline,
    address: pickStr(tenantRecord?.address, rawTenant?.address, settings?.address, VENDOR.address),
    email: pickStr(
      tenantRecord?.contactEmail,
      rawTenant?.contact_email,
      rawTenant?.email,
      settings?.email,
      VENDOR.email,
    ),
    ...(phone ? { phone } : {}),
    trn: pickStr(
      tenantRecord?.trn,
      rawTenant?.trn,
      rawTenant?.tax_registration_number,
      rawTenant?.vat_number,
      settings?.trn,
      settings?.taxRegistrationNumber,
      settings?.vatNumber,
      process.env.DEFAULT_SUPPLIER_TRN ?? '',
    ),
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireRacPortalRole(req, ALL_RAC_PORTAL_ROLES);
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  const lang: Lang = req.nextUrl.searchParams.get('lang') === 'ar' ? 'ar' : 'en';
  const download = req.nextUrl.searchParams.get('download') === '1';

  try {
    const txResult = await withTenantRls(prisma, ctx.tenantId, async (tx) => {
      const a = await tx.rentalAgreement.findFirst({
        where: {
          id,
          tenantId: ctx.tenantId,
          customerId: ctx.customerId,
        },
        include: {
          booking: { include: { customer: true } },
          charges: true,
        },
      });
      if (!a || a.customerId !== ctx.customerId) {
        return { kind: 'not_found' as const };
      }

      const softDeleteRows = await withSavepoint<Array<{ deleted_at: unknown }> | null>(
        tx,
        'rac_portal_agr_pdf_soft_del',
        () =>
          tx.$queryRawUnsafe<Array<{ deleted_at: unknown }>>(
            `SELECT deleted_at
               FROM rental_agreements
              WHERE id::text = $1
                AND tenant_id::text = $2
              LIMIT 1`,
            id,
            ctx.tenantId,
          ),
        null,
      );
      if (softDeleteRows && (!softDeleteRows[0] || softDeleteRows[0].deleted_at != null)) {
        return { kind: 'not_found' as const };
      }

      const vendor = await resolveTenantVendor(tx, ctx.tenantId);

      const vehicle = a.vehicleId
        ? await tx.vehicle.findFirst({ where: { id: a.vehicleId, tenantId: ctx.tenantId } })
        : null;

      const rawAgrRows = await withSavepoint<Array<Record<string, unknown>>>(
        tx,
        'rac_portal_agr_pdf_raw_readings',
        () =>
          tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
            `SELECT *
               FROM rental_agreements
              WHERE id::text = $1
                AND tenant_id::text = $2
                AND customer_id = $3
                AND deleted_at IS NULL
              LIMIT 1`,
            id,
            ctx.tenantId,
            ctx.customerId,
          ),
        [],
      );
      const rawAgr = rawAgrRows[0] ?? null;

      const resolvedMileageOut = resolveStoredOdometerKm(
        rawAgr?.pickup_odometer,
        rawAgr?.mileage_out ?? a.mileageOut,
      );
      const resolvedMileageIn = resolveStoredOdometerKm(
        rawAgr?.return_odometer,
        rawAgr?.mileage_in ?? a.mileageIn,
      );
      const fuelOutPct = resolveStoredFuelPct(
        rawAgr?.pickup_fuel_level,
        rawAgr?.fuel_out ?? a.fuelOut,
      );
      const fuelInPct = resolveStoredFuelPct(
        rawAgr?.return_fuel_level,
        rawAgr?.fuel_in ?? a.fuelIn,
      );
      const resolvedFuelOut = fuelOutPct != null ? formatCanonicalFuelDisplay(fuelOutPct) : null;
      const resolvedFuelIn = fuelInPct != null ? formatCanonicalFuelDisplay(fuelInPct) : null;

      const customer =
        a.booking?.customer ??
        (await tx.rentalCustomer.findFirst({
          where: { id: ctx.customerId, tenantId: ctx.tenantId },
        }));

      const dailyRate = Number(a.dailyRate ?? 0);
      const days = Math.max(
        1,
        Math.ceil((a.endDate.getTime() - a.startDate.getTime()) / 86_400_000),
      );
      const baseRentalCharge = dailyRate * days;

      const billableChargeRows = (a.charges ?? []).filter(
        (c: { billedToCustomer?: boolean | null; chargeType?: string | null }) =>
          c.billedToCustomer !== false &&
          String(c.chargeType ?? '').toUpperCase() !== 'EXTENSION',
      );
      const charges = billableChargeRows.map(
        (c: {
          description?: string | null;
          chargeType: string;
          quantity?: number | null;
          amount?: unknown;
          totalAmount?: unknown;
        }) => ({
          description: c.description ?? c.chargeType,
          quantity: c.quantity ?? 1,
          unitPrice: Number(c.amount ?? 0),
          totalAmount: Number(c.totalAmount ?? c.amount ?? 0),
          lineType: c.chargeType,
        }),
      );
      const ancillariesTotal = charges.reduce((sum, c) => sum + c.totalAmount, 0);
      const total = Number(a.totalAmount ?? 0);
      const vatPct = 5;
      let subTotal: number;
      let vatAmount: number;
      if (total > 0) {
        subTotal = total / 1.05;
        vatAmount = total - subTotal;
      } else {
        subTotal = baseRentalCharge + ancillariesTotal;
        vatAmount = subTotal * 0.05;
      }

      const data: RentalAgreementPdfData = {
        agreementNo: a.agreementNo ?? `RA-${id.slice(0, 8)}`,
        bookingRef: a.booking?.bookingRef ?? null,
        startDate: a.startDate,
        endDate: a.endDate,
        totalDays: days,
        pickupBranch: a.openBranchId,
        dropoffBranch: a.closeBranchId,
        vendor,
        customer: {
          name: pickStr(customer?.companyName, customer?.fullName, rawAgr?.customer_name) || '—',
          customerType: customer?.customerType,
          address: customer?.address,
          email: customer?.email,
          phone: customer?.phone,
          nationality: customer?.nationality,
          drivingLicenseNo: customer?.drivingLicenseNo,
          passportNo: customer?.passportNo,
          tradeLicense: customer?.tradeLicense,
          vatNumber: customer?.vatNumber,
        },
        vehicle: vehicle
          ? {
              make: vehicle.make,
              model: vehicle.model,
              year: vehicle.year ? Number(vehicle.year) : null,
              licensePlate: vehicle.licensePlate,
              vin: vehicle.vin,
              color: vehicle.color,
              category: vehicle.type,
            }
          : {
              make: a.booking?.vehicleCategory ?? null,
              model: null,
              year: null,
              licensePlate: null,
              vin: null,
              color: null,
              category: a.booking?.vehicleCategory ?? null,
            },
        dailyRate,
        baseRentalCharge,
        insuranceTier: a.insurancePlanCode ?? null,
        insuranceCharge: 0,
        charges,
        ancillariesTotal,
        subTotal,
        vatPct,
        vatAmount,
        totalAmount: total > 0 ? total : subTotal + vatAmount,
        securityDeposit: a.securityDeposit ? Number(a.securityDeposit) : null,
        currency: a.currency ?? 'AED',
        mileageOut: resolvedMileageOut,
        mileageIn: resolvedMileageIn,
        fuelOut: resolvedFuelOut,
        fuelIn: resolvedFuelIn,
        notes: a.notes ?? a.terms,
      };

      return { kind: 'ok' as const, data };
    });

    if (txResult.kind === 'not_found') {
      return jsonErr('Rental agreement not found', 404);
    }

    // Render PDF strictly outside the RLS DB transaction
    const buffer = await renderPdf(
      createElement(RentalAgreementPdf, { data: txResult.data, lang }),
    );
    const safeStem = sanitizeDownloadFilename(txResult.data.agreementNo, 'rental_agreement');
    return pdfResponse(buffer, `${safeStem}_${lang}.pdf`, download);
  } catch (err) {
    captureException(err, {
      context: 'rac-portal.agreement.pdf',
      tags: { agreementId: id, lang },
    });
    console.error('[rac-portal/agreements/[id]/pdf] error:', err);
    return jsonErr('Failed to generate agreement PDF', 500);
  }
}

function jsonErr(error: string, status: number) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function pdfResponse(buffer: Buffer, filename: string, download: boolean) {
  const safeFilename = sanitizeDownloadFilename(filename, 'rental_agreement.pdf');
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(buffer.length),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${safeFilename}"`,
      'Cache-Control': 'private, no-cache',
    },
  });
}
