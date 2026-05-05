import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const customer = await prisma.rentalCustomer.findUnique({
      where: { id: params.id },
      include: {
        bookings: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
    if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(customer);
  } catch (error) {
    console.error('Error fetching customer:', error);
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { bookings, ...data } = body;
    const customer = await prisma.rentalCustomer.update({
      where: { id: params.id },
      data: { ...data, updatedAt: new Date() },
    });
    return NextResponse.json(customer);
  } catch (error) {
    console.error('Error updating customer:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await prisma.rentalCustomer.update({
      where: { id: params.id },
      data: { deletedAt: new Date() },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting customer:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
