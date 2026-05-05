import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type AssetRow = Record<string, unknown>;

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const [asset] = await prisma.$queryRawUnsafe<AssetRow[]>(
    `SELECT a.*,
       json_agg(json_build_object(
         'id', d.id, 'periodYear', d.period_year, 'periodMonth', d.period_month,
         'openingNbv', d.opening_nbv, 'depreciation', d.depreciation,
         'closingNbv', d.closing_nbv, 'isPosted', d.is_posted
       ) ORDER BY d.period_year, d.period_month) FILTER (WHERE d.id IS NOT NULL) as schedule
     FROM finance_fixed_assets a
     LEFT JOIN finance_depreciation_schedule d ON d.asset_id = a.id::text
     WHERE a.id = $1 AND a.deleted_at IS NULL GROUP BY a.id`, params.id
  ).catch(() => [] as AssetRow[]);
  if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(asset);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const allowed = ['asset_name', 'description', 'location', 'notes', 'registration_no', 'vehicle_id', 'coa_account_code'];
  const updates: string[] = [];
  const values: unknown[] = [];
  let pi = 1;
  for (const [key, val] of Object.entries(body)) {
    const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (allowed.includes(col)) { updates.push(`${col} = $${pi++}`); values.push(val); }
  }
  if (!updates.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  values.push(params.id);
  const [row] = await prisma.$queryRawUnsafe<AssetRow[]>(
    `UPDATE finance_fixed_assets SET ${updates.join(', ')}, updated_at=NOW() WHERE id=$${pi} RETURNING *`, ...values
  ).catch(() => [] as AssetRow[]);
  if (!row) return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  return NextResponse.json(row);
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  await prisma.$executeRawUnsafe(`UPDATE finance_fixed_assets SET deleted_at=NOW() WHERE id=$1`, params.id).catch(() => {});
  return NextResponse.json({ ok: true });
}
