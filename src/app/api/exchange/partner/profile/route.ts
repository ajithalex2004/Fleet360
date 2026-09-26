export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { PartnerService } from '@/lib/exchange/partner-service';

export const runtime = 'nodejs';

/**
 * GET /api/exchange/partner/profile?partnerId=...
 * PUT /api/exchange/partner/profile
 */
// Prisma P2021: "The table ... does not exist in the current database".
// Most Fleet360 Exchange tables (partner capabilities, service areas,
// vehicles, drivers, compliance documents, scorecards, ...) are modeled in
// schema.prisma but were never migrated — see migration
// 20260910000035_add_exchange_partner_settlement_tables. Until they are,
// answer with a clear error instead of an unhandled 500 with an empty body.
function isMissingTable(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2021';
}

export async function GET(req: NextRequest) {
  try {
    return await getProfile(req);
  } catch (err) {
    if (isMissingTable(err)) {
      return NextResponse.json(
        { error: 'The partner exchange is not set up in this environment yet.', code: 'EXCHANGE_NOT_PROVISIONED' },
        { status: 503 },
      );
    }
    console.error('[exchange/partner/profile GET]', err);
    return NextResponse.json({ error: 'Failed to load partner profile' }, { status: 500 });
  }
}

async function getProfile(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const partnerId = searchParams.get('partnerId');

  if (!partnerId) {
    // Fetch first available partner or return placeholder for testing
    const partner = await prisma.transportPartner.findFirst({
      where: { deletedAt: null },
      include: {
        capabilities: true,
        serviceAreas: true,
        vehicles: true,
        drivers: true,
        complianceDocuments: true,
      },
    });
    return NextResponse.json({ partner });
  }

  const partner = await PartnerService.getPartnerProfile(partnerId);
  if (!partner) {
    return NextResponse.json({ error: 'Partner not found' }, { status: 404 });
  }

  return NextResponse.json({ partner });
}

export async function PUT(req: NextRequest) {
  try {
    const rawBody = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(rawBody);
    const { partnerId, legalName, tradeName, address, city, primaryContactName, primaryContactEmail, primaryContactPhone } = body;

    if (!partnerId) {
      return NextResponse.json({ error: 'partnerId is required' }, { status: 400 });
    }

    const updated = await prisma.transportPartner.update({
      where: { id: partnerId },
      data: {
        legalName,
        tradeName,
        address,
        city,
        primaryContactName,
        primaryContactEmail,
        primaryContactPhone,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true, partner: updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update partner' }, { status: 500 });
  }
}
