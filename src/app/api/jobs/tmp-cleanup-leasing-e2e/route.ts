export const dynamic = 'force-dynamic';

/**
 * TEMPORARY — one-shot cleanup of the disposable test data created while
 * E2E-testing the Leasing module through the real UI (see the session's
 * final report). Local dev can't reach the Neon DB directly right now,
 * so this runs the cleanup through the deployed app instead, the same
 * pattern used for the earlier G13/G14 migration work.
 *
 * DELETE THIS FILE once the cleanup has run successfully.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const LESSEE_ID = 'fd30aafe-da42-47d4-a12e-8c886a92f638';
const CONTRACT_IDS = ['9239b72e-b8b1-4fd8-8aac-afbf006774fb', 'a71d05c6-bd68-4e66-b386-73386c328efd'];
const QUOTATION_ID = '3221803d-f4d2-488c-81ae-2d84a85de0b2';
const PORTAL_USER_ID = 'dc51428f-aec7-4822-a2fd-0d961efad71e';

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const results: Record<string, unknown> = {};
  try {
    results.damageReports = await prisma.$executeRawUnsafe(
      `DELETE FROM lease_damage_reports WHERE lessee_id = $1`, LESSEE_ID,
    );
    results.esignatures = await prisma.$executeRawUnsafe(
      `DELETE FROM lease_esignatures WHERE lessee_id = $1`, LESSEE_ID,
    );
    results.paymentIntents = await prisma.$executeRawUnsafe(
      `DELETE FROM lease_payment_intents WHERE lessee_id = $1`, LESSEE_ID,
    );
    results.portalInvitations = await prisma.$executeRawUnsafe(
      `DELETE FROM lessee_portal_invitations WHERE portal_user_id = $1::uuid`, PORTAL_USER_ID,
    );
    results.portalUsers = await prisma.$executeRawUnsafe(
      `DELETE FROM lessee_portal_users WHERE id = $1::uuid`, PORTAL_USER_ID,
    );

    results.alerts = await prisma.leaseAlert.deleteMany({ where: { contractId: { in: CONTRACT_IDS } } });
    results.invoiceLines = await prisma.leaseInvoiceLine.deleteMany({ where: { invoice: { lesseeId: LESSEE_ID } } });
    results.invoices = await prisma.leaseInvoice.deleteMany({ where: { lesseeId: LESSEE_ID } });
    results.payments = await prisma.leasePayment2.deleteMany({ where: { contractId: { in: CONTRACT_IDS } } });
    results.contractVehicles = await prisma.leaseContractVehicle.deleteMany({ where: { contractId: { in: CONTRACT_IDS } } });
    results.renewals = await prisma.leaseRenewal.deleteMany({ where: { originalContractId: { in: CONTRACT_IDS } } });
    results.contracts = await prisma.leaseContract2.deleteMany({ where: { id: { in: CONTRACT_IDS } } });
    results.quotationVehicles = await prisma.leaseQuotationVehicle.deleteMany({ where: { quotationId: QUOTATION_ID } });
    results.quotationItems = await prisma.leaseQuotationItem.deleteMany({ where: { quotationId: QUOTATION_ID } });
    results.quotations = await prisma.leaseQuotation.deleteMany({ where: { id: QUOTATION_ID } });
    results.inquiries = await prisma.leaseInquiry.deleteMany({ where: { customerEmail: 'e2e-inquiry@fleet360.invalid' } });
    results.lessee = await prisma.lessee.deleteMany({ where: { id: LESSEE_ID } });

    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e), results }, { status: 500 });
  }
}
