import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { MODULES } from '@/lib/permissions';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search')?.trim() ?? '';
    const limit  = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200);

    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { code: { contains: search, mode: 'insensitive' as const } },
            { id:   { contains: search, mode: 'insensitive' as const } },
            { contactEmail: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const tenants = await prisma.tenant.findMany({
      where,
      include: {
        modules: true,
        _count: { select: { userTenants: true, roles: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return NextResponse.json(tenants);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      enabledModules = MODULES,
      // pull out fields that need special handling
      localizedName, localizedDesc, bookingTypes,
      supportedLanguages, defaultLanguage,
      domain, address, contactName, contactEmail, contactPhone,
      plan, industry, code, name,
    } = body;

    const tenant = await prisma.tenant.create({
      data: {
        name:              name,
        code:              code   || undefined,
        plan:              plan   || 'STANDARD',
        industry:          industry || undefined,
        domain:            domain   || undefined,
        address:           address  || undefined,
        contactName:       contactName  || undefined,
        contactEmail:      contactEmail || undefined,
        contactPhone:      contactPhone || undefined,
        defaultLanguage:   defaultLanguage  || 'en',
        supportedLanguages: supportedLanguages || 'en',
        localizedName:     localizedName  || undefined,
        localizedDesc:     localizedDesc  || undefined,
        bookingTypes:      bookingTypes   || undefined,
        modules: {
          create: (enabledModules as string[]).map((m: string) => ({ module: m, isEnabled: true })),
        },
      },
      include: { modules: true },
    });
    return NextResponse.json(tenant, { status: 201 });
  } catch (e) {
    console.error('[CREATE TENANT]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
