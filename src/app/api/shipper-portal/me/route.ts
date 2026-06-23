/**
 * GET /api/shipper-portal/me
 *
 * Returns the logged-in portal user + their customer record. Used by the
 * portal layout to hydrate the header chrome and decide whether to redirect
 * to /shipper-portal/login.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireShipperPortal } from '@/lib/shipper-portal/auth';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = await requireShipperPortal(req);
  if (auth instanceof NextResponse) return auth;

  // Hydrate the customer record so the portal header can show the shipper's
  // company name without an extra fetch. Soft-fail on customer not found
  // (operator deleted it) — we still return the user so the UI can show a
  // "your organisation is no longer registered" message.
  const customerRows = await prisma.$queryRawUnsafe<Array<{
    id: string; name_en: string | null; name_ar: string | null;
    email: string | null; mobile_number: string | null;
    portal_tracking_level: string | null;
  }>>(
    `SELECT id, name_en, name_ar, email, mobile_number, portal_tracking_level
       FROM customers
      WHERE id = $1 AND tenant_id = $2
      LIMIT 1`,
    auth.customerId, auth.tenantId,
  ).catch(() => []);
  const customer = customerRows[0] ?? null;

  return NextResponse.json({
    user: auth.user,
    customer: customer ? {
      id: customer.id,
      nameEn: customer.name_en,
      nameAr: customer.name_ar,
      email: customer.email,
      phone: customer.mobile_number,
      portalTrackingLevel: customer.portal_tracking_level ?? 'STATUS_ONLY',
    } : null,
  }, {
    headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=120' },
  });
}
