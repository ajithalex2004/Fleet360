import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const module = searchParams.get('module');
    const perms = await prisma.permission.findMany({
      where: module ? { module } : {},
      orderBy: [{ module: 'asc' }, { action: 'asc' }],
    });
    return NextResponse.json(perms);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
