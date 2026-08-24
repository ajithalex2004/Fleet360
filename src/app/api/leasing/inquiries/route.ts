/**
 * /api/leasing/inquiries — list and create LeaseInquiry rows.
 *
 * Tenant scoping: requires x-tenant-id. The list is filtered by tenant; the
 * created row is stamped with the same tenantId; inquiryNumber is generated
 * per tenant.
 */

import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const inquiries = await tx.leaseInquiry.findMany({
          where: { tenantId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json(inquiries);
      } catch (e) {
        console.error('Error fetching inquiries:', e);
        return NextResponse.json(
          { error: 'Failed to fetch inquiries' },
          { status: 500 }
        );
      }
  });
}


export async function POST(request: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const body = await request.json();

    // Generate a per-tenant inquiry number so concurrent tenants don't
    // collide on INQ-<last6digits>.
    const count = await prisma.leaseInquiry.count({ where: { tenantId } });
    const inquiryNumber = `INQ-${String(count + 1).padStart(6, '0')}`;

    const inquiry = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseInquiry.create({
      data: {
        ...body,
        inquiryNumber,
        tenantId,
      },
    }),
    );

    return NextResponse.json(inquiry, { status: 201 });
    } catch (e) {
    console.error('Error creating inquiry:', e);
    return NextResponse.json(
      { error: 'Failed to create inquiry' },
      { status: 500 }
    );
  }
}
