import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const insurancePolicies = await prisma.insurancePolicy.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(insurancePolicies);
  } catch (error) {
    console.error('Error fetching insurance policies:', error);
    return NextResponse.json({ error: 'Failed to fetch insurance policies' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const insurancePolicy = await prisma.insurancePolicy.create({ data: body });
    return NextResponse.json(insurancePolicy, { status: 201 });
  } catch (error) {
    console.error('Error creating insurance policy:', error);
    return NextResponse.json({ error: 'Failed to create insurance policy' }, { status: 500 });
  }
}
