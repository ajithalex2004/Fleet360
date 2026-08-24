import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const booking = await tx.booking.findUnique({
          where: { id: params.id },
        });
        if (!booking) {
          return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        return NextResponse.json(booking);
      } catch (e) {
        console.error('Error fetching booking:', e);
        return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
      }
  });
}


export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const booking = await tx.booking.update({
          where: { id: params.id },
          data: body,
        });
        return NextResponse.json(booking);
      } catch (e) {
        console.error('Error updating booking:', e);
        return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
      }
  });
}


/**
 * PATCH /api/bookings/[id]
 * Partial update — used by the Logistics Dispatch Board to assign vehicle/driver
 * and transition status (e.g. CONFIRMED → ACTIVE).
 * Only whitelisted fields are patched to prevent accidental overwrites.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json() as Record<string, unknown>;
  const body = stripTenantOwnershipFields(bodyRaw);

        // Whitelist patchable fields for dispatch actions
        const allowed = ['status', 'vehicleId', 'notes', 'approvedBy', 'approvedAt'];
        const data: Record<string, unknown> = {};
        for (const key of allowed) {
          if (key in body) data[key] = body[key];
        }

        if (!Object.keys(data).length) {
          return NextResponse.json({ error: 'No valid fields to patch.' }, { status: 400 });
        }

        const booking = await tx.booking.update({
          where: { id: params.id },
          data,
        });
        return NextResponse.json(booking);
      } catch (e) {
        console.error('Error patching booking:', e);
        return NextResponse.json({ error: 'Failed to patch' }, { status: 500 });
      }
  });
}


export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        // Hard delete — the Booking model no longer carries `deletedAt` (Layer 2.6
        // schema cleanup removed soft-delete across the platform). If foreign-key
        // references prevent the delete, Prisma will throw and the API returns 500
        // with the FK detail so the caller can clean up child rows first.
        await tx.booking.delete({
          where: { id: params.id },
        });
        return NextResponse.json({ success: true });
        } catch (e) {
        console.error('Error deleting booking:', e);
        return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
      }
  });
}

