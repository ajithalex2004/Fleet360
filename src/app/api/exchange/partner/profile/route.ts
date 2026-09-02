export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { PartnerService } from '@/lib/exchange/partner-service';

export const runtime = 'nodejs';

/**
 * GET /api/exchange/partner/profile?partnerId=...
 * PUT /api/exchange/partner/profile
 */
export async function GET(req: NextRequest) {
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
