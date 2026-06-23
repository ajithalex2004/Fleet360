import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminPermission } from '@/lib/admin-policy';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdminPermission(req, 'view', 'roles');
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(req.url);
    const module = searchParams.get('module');
    const perms = await prisma.permission.findMany({
      where: module ? { module } : {},
      orderBy: [{ module: 'asc' }, { action: 'asc' }],
    });
    return NextResponse.json(perms);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
