import { createElement } from 'react';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { renderPdf } from '@/lib/pdf/render';
import { RentalAgreementPdf, type RentalAgreementPdfData } from '@/lib/pdf/templates/rental-agreement';
import type { Lang } from '@/lib/pdf/theme';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const VENDOR = {
  name: 'Fleet360 — Rent-A-Car',
  tagline: 'UAE Smart Transport Management',
  address: 'Dubai, United Arab Emirates',
  email: 'rental@fleet360.app',
  trn: '',
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lang: Lang = req.nextUrl.searchParams.get('lang') === 'ar' ? 'ar' : 'en';
  const download = req.nextUrl.searchParams.get('download') === '1';

  try {
    const a = await prisma.rentalAgreement.findUnique({
      where: { id },
      include: {
        booking: { include: { customer: true } },
        charges: true,
      },
    });
    if (!a) return jsonErr('Rental agreement not found', 404);

    // Vehicle info: pull from RentalBooking + Vehicle if available.
    const vehicle = a.vehicleId
      ? await prisma.vehicle.findUnique({ where: { id: a.vehicleId } })
      : null;

    const customer = a.booking?.customer;
    const dailyRate = Number(a.dailyRate ?? 0);
    const days = Math.max(1, Math.ceil((a.endDate.getTime() - a.startDate.getTime()) / 86400000));
    const baseRentalCharge = dailyRate * days;

    const charges = (a.charges ?? []).map(c => ({
      description: c.description ?? c.chargeType,
      quantity: c.quantity ?? 1,
      unitPrice: Number(c.amount ?? 0),
      totalAmount: Number(c.totalAmount ?? c.amount ?? 0),
      lineType: c.chargeType,
    }));
    const ancillariesTotal = charges.reduce((sum, c) => sum + c.totalAmount, 0);
    const total = Number(a.totalAmount ?? 0);
    const vatPct = 5;
    // If totalAmount already includes VAT, derive subtotal; otherwise compute from base+charges.
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
      vendor: VENDOR,
      customer: {
        name: customer?.fullName ?? customer?.companyName ?? '—',
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
        : { make: a.booking?.vehicleCategory ?? null, model: null, year: null, licensePlate: null, vin: null, color: null, category: a.booking?.vehicleCategory ?? null },
      dailyRate,
      baseRentalCharge,
      insuranceTier: null, // wired in v1.1 from agreement.terms or new column
      insuranceCharge: 0,
      charges,
      ancillariesTotal,
      subTotal,
      vatPct,
      vatAmount,
      totalAmount: total > 0 ? total : subTotal + vatAmount,
      securityDeposit: a.securityDeposit ? Number(a.securityDeposit) : null,
      currency: a.currency ?? 'AED',
      mileageIn: a.mileageIn,
      mileageOut: a.mileageOut,
      fuelIn: a.fuelIn,
      fuelOut: a.fuelOut,
      notes: a.terms,
    };

    const buffer = await renderPdf(createElement(RentalAgreementPdf, { data, lang }));
    return pdfResponse(buffer, `${data.agreementNo}_${lang}.pdf`, download);
  } catch (err) {
    captureException(err, { context: 'rental.agreement.pdf', tags: { agreementId: id, lang } });
    console.error('[rental agreement pdf] error:', err);
    return jsonErr('Failed to generate agreement PDF', 500);
  }
}

function jsonErr(error: string, status: number) {
  return new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } });
}
function pdfResponse(buffer: Buffer, filename: string, download: boolean) {
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(buffer.length),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
      'Cache-Control': 'private, no-cache',
    },
  });
}
