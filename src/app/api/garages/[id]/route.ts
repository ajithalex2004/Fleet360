import { NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(request: Request, { params }: { params: { id: string } }) {

    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const garage = await tx.garage.findFirst({
                where: { id: params.id, deletedAt: null }
            });
            if (!garage) {
                return NextResponse.json({ error: 'Garage not found' }, { status: 404 });
            }
            return NextResponse.json(JSON.parse(JSON.stringify(garage)));
        } catch (e) {
            console.error('Failed to fetch garage:', e);
            return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
        }
  });
}


export async function PUT(request: Request, { params }: { params: { id: string } }) {

    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const body = await request.json();

            const data: Record<string, unknown> = {};
            if (body.name !== undefined) data.name = body.name;
            if (body.location !== undefined) data.location = body.location;
            if (body.contactPerson !== undefined) data.contactPerson = body.contactPerson;
            if (body.contact_person !== undefined) data.contactPerson = body.contact_person;
            if (body.designation !== undefined) data.designation = body.designation;
            if (body.email !== undefined) data.email = body.email;
            if (body.contactNumber !== undefined) data.contactNumber = body.contactNumber;
            if (body.contact_number !== undefined) data.contactNumber = body.contact_number;
            if (body.specialties !== undefined) data.specialties = body.specialties;
            if (body.isInternal !== undefined) data.isInternal = body.isInternal;
            if (body.is_internal !== undefined) data.isInternal = body.is_internal;

            const updated = await tx.garage.update({
                where: { id: params.id },
                data,
            });

            return NextResponse.json(JSON.parse(JSON.stringify(updated)));
        } catch (e) {
            console.error('Failed to update garage:', e);
            return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
        }
  });
}


export async function PATCH(request: Request, { params }: { params: { id: string } }) {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

    return PUT(request, { params });
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {

    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            await tx.garage.update({
                where: { id: params.id },
                data: { deletedAt: new Date() },
            });
            return NextResponse.json({ success: true });
            } catch (e) {
            console.error('Failed to delete garage:', e);
            return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
        }
  });
}

