import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { attachTenantToEntity, recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { ensureRentalGovernance } from '@/lib/rental-governance';

export async function GET(req: NextRequest) {
  await ensureRentalGovernance();
  try {
    const ctx = requireOperationalContext(req, 'rac');
    if (ctx instanceof NextResponse) return ctx;
    const scoped = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id::text FROM rental_customers WHERE tenant_id::text = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      ctx.tenantId,
    ).catch(() => []);
    const ids = scoped.map(row => row.id);
    if (!ids.length) return NextResponse.json([]);
    const customers = await prisma.rentalCustomer.findMany({
      where: { id: { in: ids }, deletedAt: null },
    });
    const visible = customers.filter(customer => ids.includes(customer.id));
    visible.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    return NextResponse.json(visible);
  } catch (error) {
    console.error('Error fetching customers:', error);
    return NextResponse.json({ error: 'Failed to fetch customers' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  await ensureRentalGovernance();
  try {
    const ctx = requireOperationalContext(req, 'rac', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const body = await req.json();
    const customer = await prisma.rentalCustomer.create({ data: body });
    await attachTenantToEntity('rental_customers', customer.id, ctx.tenantId);
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'RentalCustomer',
      entityId: customer.id,
      action: 'CREATE',
      after: customer,
      summary: `Created RAC customer ${customer.fullName}.`,
    });
    return NextResponse.json(customer, { status: 201 });
  } catch (error) {
    console.error('Error creating customer:', error);
    return NextResponse.json({ error: 'Failed to create customer' }, { status: 500 });
  }
}
