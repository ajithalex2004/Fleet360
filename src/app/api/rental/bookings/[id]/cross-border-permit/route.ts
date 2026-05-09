/**
 * GET /api/rental/bookings/[id]/cross-border-permit
 *
 * Generates a bilingual cross-border travel permit PDF for a rental booking.
 * Required when the customer drives a UAE-rented vehicle into Oman, KSA,
 * Bahrain, Qatar, or Kuwait. Customer presents the printed permit at the
 * border together with the rental agreement, mulkiya, and driving licence.
 *
 * Query:
 *   ?lang=en|ar               (default en)
 *   ?destination=Oman|KSA|... (required)
 *   ?validFrom=ISO            (default = booking pickup date)
 *   ?validUntil=ISO           (default = booking dropoff date)
 *   ?border=...               (optional border crossing — e.g. "Hatta / Wajaja")
 *   ?route=...                (optional route description)
 *   ?purpose=...              (optional purpose — Tourism / Business / etc.)
 *   ?download=1               (force attachment instead of inline)
 */

import { createElement } from 'react';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { renderPdf } from '@/lib/pdf/render';
import { CrossBorderPermitPdf, type CrossBorderPermitPdfData } from '@/lib/pdf/templates/cross-border-permit';
import type { Lang } from '@/lib/pdf/theme';
import { captureException } from '@/lib/sentry';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

const VENDOR = {
  name: 'Fleet360 — Rent-A-Car',
  tagline: 'UAE Smart Transport Management',
  address: 'Dubai, United Arab Emirates',
  phone: '+971 4 000 0000',
  email: 'rental@fleet360.app',
  trn: '',
};

const DESTINATION_LABELS: Record<string, { en: string; ar: string }> = {
  OMAN:    { en: 'Sultanate of Oman',                 ar: 'سلطنة عُمان' },
  KSA:     { en: 'Kingdom of Saudi Arabia',           ar: 'المملكة العربية السعودية' },
  BAHRAIN: { en: 'Kingdom of Bahrain',                ar: 'مملكة البحرين' },
  QATAR:   { en: 'State of Qatar',                    ar: 'دولة قطر' },
  KUWAIT:  { en: 'State of Kuwait',                   ar: 'دولة الكويت' },
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sp = req.nextUrl.searchParams;
  const lang: Lang = sp.get('lang') === 'ar' ? 'ar' : 'en';
  const download = sp.get('download') === '1';

  const destinationKey = (sp.get('destination') ?? '').toUpperCase();
  if (!destinationKey) {
    return jsonErr('Missing required query param: destination (OMAN|KSA|BAHRAIN|QATAR|KUWAIT)', 400);
  }

  try {
    const booking = await prisma.rentalBooking.findUnique({
      where: { id },
      include: { customer: true, agreement: true },
    });
    if (!booking) return jsonErr('Booking not found', 404);
    if (booking.deletedAt) return jsonErr('Booking has been deleted', 404);

    const vehicle = booking.vehicleId
      ? await prisma.vehicle.findUnique({ where: { id: booking.vehicleId } })
      : null;

    const validFrom = sp.get('validFrom') ? new Date(sp.get('validFrom')!) : booking.pickupDate;
    const validUntil = sp.get('validUntil') ? new Date(sp.get('validUntil')!) : booking.dropoffDate;
    if (validUntil <= validFrom) {
      return jsonErr('validUntil must be after validFrom', 400);
    }

    const destLabel = DESTINATION_LABELS[destinationKey]
      ? DESTINATION_LABELS[destinationKey][lang]
      : sp.get('destination')!;

    const permitNo = `XBP-${booking.bookingRef ?? id.slice(0, 8)}-${destinationKey.slice(0, 3)}`;

    const data: CrossBorderPermitPdfData = {
      permitNo,
      issueDate: new Date(),
      validFrom,
      validUntil,
      destinationCountry: destLabel,
      borderCrossing: sp.get('border'),
      routeOfTravel: sp.get('route'),
      purposeOfTravel: sp.get('purpose'),
      rentalAgreementRef: booking.agreement?.agreementNo ?? null,
      bookingRef: booking.bookingRef,
      vendor: VENDOR,
      renter: {
        name: booking.customer.fullName ?? booking.customer.companyName ?? '—',
        nationality: booking.customer.nationality,
        drivingLicenseNo: booking.customer.drivingLicenseNo,
        passportNo: booking.customer.passportNo,
        emiratesId: null,
        phone: booking.customer.phone,
      },
      vehicle: {
        make: vehicle?.make ?? null,
        model: vehicle?.model ?? null,
        year: vehicle?.year != null ? Number(vehicle.year) : null,
        licensePlate: vehicle?.licensePlate ?? null,
        vin: vehicle?.vin ?? null,
        color: vehicle?.color ?? null,
      },
    };

    const buffer = await renderPdf(createElement(CrossBorderPermitPdf, { data, lang }));

    void logAudit({
      tenantId: req.headers.get('x-tenant-id') ?? undefined,
      userId: req.headers.get('x-user-id') ?? 'system',
      userRole: req.headers.get('x-user-role') ?? 'STAFF',
      entityType: 'RentalBooking',
      entityId: id,
      action: 'EXPORT',
      details: `Cross-border permit issued: ${permitNo} → ${destLabel}, valid ${validFrom.toISOString().slice(0,10)} to ${validUntil.toISOString().slice(0,10)}.`,
    });

    const filename = `cross-border-permit-${permitNo}.pdf`;
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    captureException(err, { context: 'rental.bookings.cross-border-permit', tags: { bookingId: id } });
    console.error('[cross-border-permit] error:', err);
    return jsonErr('Failed to generate cross-border permit', 500);
  }
}

function jsonErr(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
