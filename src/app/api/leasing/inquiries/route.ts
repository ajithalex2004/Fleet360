/**
 * /api/leasing/inquiries — list and create LeaseInquiry rows.
 *
 * Tenant scoping: requires x-tenant-id. The list is filtered by tenant; the
 * created row is stamped with the same tenantId; inquiryNumber is generated
 * per tenant.
 */

import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const inquiries = await prisma.leaseInquiry.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(inquiries);
  } catch (error) {
    console.error('Error fetching inquiries:', error);
    return NextResponse.json(
      { error: 'Failed to fetch inquiries' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const tenantId = request.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const body = await request.json();

    // Generate a per-tenant inquiry number so concurrent tenants don't
    // collide on INQ-<last6digits>.
    const count = await prisma.leaseInquiry.count({ where: { tenantId } });
    const inquiryNumber = `INQ-${String(count + 1).padStart(6, '0')}`;

    const inquiry = await prisma.leaseInquiry.create({
      data: {
        ...body,
        inquiryNumber,
        tenantId,
      },
    });

    return NextResponse.json(inquiry, { status: 201 });
  } catch (error) {
    console.error('Error creating inquiry:', error);
    return NextResponse.json(
      { error: 'Failed to create inquiry' },
      { status: 500 }
    );
  }
}
