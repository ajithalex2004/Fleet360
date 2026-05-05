import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const modules = await prisma.tenantModule.findMany({ where: { tenantId: params.id } });
  return NextResponse.json(modules);
}

// PUT: replace all module assignments
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { enabledModules }: { enabledModules: string[] } = await req.json();
    await prisma.$transaction([
      prisma.tenantModule.deleteMany({ where: { tenantId: params.id } }),
      prisma.tenantModule.createMany({
        data: enabledModules.map(m => ({ tenantId: params.id, module: m, isEnabled: true })),
      }),
    ]);
    const modules = await prisma.tenantModule.findMany({ where: { tenantId: params.id } });
    return NextResponse.json(modules);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
