import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {

    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const garages = await tx.garage.findMany({
                where: { deletedAt: null },
                orderBy: { name: 'asc' }
            });
            return NextResponse.json(JSON.parse(JSON.stringify(garages)));
        } catch (e) {
            console.error('Failed to fetch garages:', e);
            return NextResponse.json({ error: 'Internal Server Error', details: String(e) }, { status: 500 });
        }
  });
}


export async function POST(request: NextRequest) {

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const body = await request.json();

            const garage = await tx.garage.create({
                data: {
                    // TODO: read tenantId from request headers via getTenantContext()
                    tenantId: '',
                    name: body.name,
                    location: body.location,
                    contactPerson: body.contactPerson || body.contact_person,
                    designation: body.designation,
                    email: body.email,
                    contactNumber: body.contactNumber || body.contact_number,
                    specialties: body.specialties || [],
                    isInternal: body.isInternal ?? body.is_internal ?? false,
                }
            });

            return NextResponse.json(JSON.parse(JSON.stringify(garage)), { status: 201 });
            } catch (e) {
            console.error('Failed to create garage:', e);
            return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
        }
  });
}

