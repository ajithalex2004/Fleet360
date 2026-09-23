export const dynamic = 'force-dynamic';

/**
 * /api/leasing/renewals — list + create LeaseRenewal rows.
 *
 * Tenant scoping: requires x-tenant-id. Reads filter by tenant; creates
 * verify the source contract belongs to the caller's tenant and stamp the
 * new renewal with the same tenantId. renewalNo is scoped per tenant.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { lockSerialSeries } from '@/lib/leasing/serial-lock';

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const { searchParams } = new URL(req.url);
        const status = searchParams.get('status');
        const renewals = await tx.leaseRenewal.findMany({
          where: {
            tenantId,
            ...(status ? { status } : {}),
          },
          include: { originalContract: { select: { contractNumber: true, endDate: true, monthlyRate: true } } },
          orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json(renewals);
      } catch (e) {
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const bodyRaw = await req.json();
  const body = stripTenantOwnershipFields(bodyRaw);
    const contract = await prisma.leaseContract2.findFirst({
      where: { id: body.originalContractId, tenantId },
      select: { id: true },
    });
    if (!contract) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    }
    // <input type="date"> sends a bare "YYYY-MM-DD" string, which Prisma's
    // strict DateTime parser rejects ("premature end of input") — every
    // renewal proposal 500'd on submission because of this (same bug class
    // as the invoices route).
    if (!body.proposedStartDate || !body.proposedEndDate) {
      return NextResponse.json(
        { error: 'proposedStartDate and proposedEndDate are required' },
        { status: 400 },
      );
    }
    // LeaseRenewal.proposedStartDate/proposedEndDate are required columns —
    // passing `undefined` through to tx.leaseRenewal.create() below would
    // hit the DB's NOT NULL constraint at runtime, so both are validated
    // above rather than silently defaulting to undefined.
    const proposedStartDate = new Date(body.proposedStartDate);
    const proposedEndDate = new Date(body.proposedEndDate);
    const renewal = await withTenantRls(prisma, tenantId, async (tx) => {
      await lockSerialSeries(tx, tenantId, 'renewal');
      const count = await tx.leaseRenewal.count({ where: { tenantId } });
      const renewalNo = `RNW-${String(count + 1).padStart(5, '0')}`;
      return tx.leaseRenewal.create({
        // body is untyped JSON; spreading it alongside explicit typed
        // fields (proposedStartDate/proposedEndDate as Date, tenantId as
        // string) sharpens the inferred shape enough that it stops
        // matching Prisma's Checked/Unchecked create-input union.
        // originalContractId comes through as a plain FK string from
        // body, so Unchecked is the correct variant.
        data: { ...body, proposedStartDate, proposedEndDate, renewalNo, tenantId } as Prisma.LeaseRenewalUncheckedCreateInput,
      });
    });
    return NextResponse.json(renewal, { status: 201 });
    } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
