import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cacheRead, privateCacheControl, revalidateCache } from '@/lib/server-cache';

const CACHE_TAG = 'rental:customers';

const getCustomers = cacheRead(
  async (tenantId: string) => {
    return prisma.rentalCustomer.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  },
  [CACHE_TAG],
  30,
);

export async function GET(req: NextRequest) {
  try {
    const tenantId = req.headers.get('x-tenant-id') ?? 'unknown';
    const customers = await getCustomers(tenantId);
    return NextResponse.json(customers, {
      headers: { 'Cache-Control': privateCacheControl(30, 120) },
    });
  } catch (error) {
    console.error('Error fetching customers:', error);
    return NextResponse.json({ error: 'Failed to fetch customers' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const customer = await prisma.rentalCustomer.create({ data: body });
    revalidateCache([CACHE_TAG]);
    return NextResponse.json(customer, { status: 201 });
  } catch (error) {
    console.error('Error creating customer:', error);
    return NextResponse.json({ error: 'Failed to create customer' }, { status: 500 });
  }
}
