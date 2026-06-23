import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { pricingRuleUpdateSet, rowToCamel } from '@/lib/pricing-rule-helpers';
import { recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { ensureRentalGovernance, rentalEntityVisible } from '@/lib/rental-governance';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureRentalGovernance();
  try {
    const ctx = requireOperationalContext(req, 'rac');
    if (ctx instanceof NextResponse) return ctx;

    const visible = await rentalEntityVisible('pricing_rules', params.id, ctx.tenantId, { allowGlobalPricing: true });
    if (!visible) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT *
         FROM pricing_rules
        WHERE id = $1
          AND (tenant_id::text = $2 OR tenant_id IS NULL OR tenant_id::text = 'GLOBAL')
        LIMIT 1`,
      params.id,
      ctx.tenantId,
    );
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(rowToCamel(rows[0]));
  } catch (error) {
    console.error('[rental/rates/:id] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch rule' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureRentalGovernance();
  try {
    const ctx = requireOperationalContext(req, 'rac', { write: true });
    if (ctx instanceof NextResponse) return ctx;

    const visible = await rentalEntityVisible('pricing_rules', params.id, ctx.tenantId);
    if (!visible) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await req.json();
    const now = new Date().toISOString();
    const beforeRows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT *
         FROM pricing_rules
        WHERE id = $1
          AND tenant_id::text = $2
        LIMIT 1`,
      params.id,
      ctx.tenantId,
    );
    const { setClauses, values, nextIdx } = pricingRuleUpdateSet(body, now);
    values.push(params.id, ctx.tenantId);
    await prisma.$executeRawUnsafe(
      `UPDATE pricing_rules
          SET ${setClauses}
        WHERE id = $${nextIdx}
          AND tenant_id::text = $${nextIdx + 1}`,
      ...values,
    );

    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT *
         FROM pricing_rules
        WHERE id = $1
          AND tenant_id::text = $2
        LIMIT 1`,
      params.id,
      ctx.tenantId,
    );
    const updated = rowToCamel(rows[0] ?? { id: params.id });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'PricingRule',
      entityId: params.id,
      action: 'UPDATE',
      before: beforeRows[0] ? rowToCamel(beforeRows[0]) : null,
      after: updated,
      summary: `Updated pricing rule ${params.id}.`,
    });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('[rental/rates/:id] PUT error:', error);
    return NextResponse.json({ error: 'Failed to update rule' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureRentalGovernance();
  try {
    const ctx = requireOperationalContext(req, 'rac', { write: true });
    if (ctx instanceof NextResponse) return ctx;

    const visible = await rentalEntityVisible('pricing_rules', params.id, ctx.tenantId);
    if (!visible) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const beforeRows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT *
         FROM pricing_rules
        WHERE id = $1
          AND tenant_id::text = $2
        LIMIT 1`,
      params.id,
      ctx.tenantId,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM pricing_rules
        WHERE id = $1
          AND tenant_id::text = $2`,
      params.id,
      ctx.tenantId,
    );
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'PricingRule',
      entityId: params.id,
      action: 'DELETE',
      before: beforeRows[0] ? rowToCamel(beforeRows[0]) : null,
      summary: `Deleted pricing rule ${params.id}.`,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[rental/rates/:id] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete rule' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  return PUT(req, { params });
}
