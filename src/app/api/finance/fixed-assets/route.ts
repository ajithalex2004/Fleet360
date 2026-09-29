export const dynamic = 'force-dynamic';

/**
 * Fixed Assets API — /api/finance/fixed-assets
 * Fleet Register with straight-line and reducing-balance depreciation
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
// Tables come from migrations (the last: 20261005090000_finance_tenant_tables).
// A request runs no DDL: the runtime role may not create tables, and the
// failed statement aborted the request's transaction, so every query after
// it failed too.

type AssetRow = Record<string, unknown>;

// Asset numbers are unique per tenant: count the tenant's own assets.
async function nextAssetNo(tx: TxClient, tenantId: string, category: string): Promise<string> {
  const prefix: Record<string, string> = {
    PASSENGER_VEHICLE: 'PV', LCV: 'LCV', HEAVY_VEHICLE: 'HV',
    BUS: 'BUS', AMBULANCE: 'AMB', EQUIPMENT: 'EQP', OFFICE: 'OFC',
  };
  const [{ count }] = await tx.$queryRawUnsafe<{count: string}[]>(
    `SELECT COUNT(*)::text as count FROM finance_fixed_assets WHERE tenant_id=$1 AND asset_category=$2`, tenantId, category
  ).catch(() => [{ count: '0' }]);
  const pfx = prefix[category] ?? 'AST';
  const seq = (parseInt(count) + 1).toString().padStart(4, '0');
  return `${pfx}-${seq}`;
}

function calculateMonthlyDepreciation(
  cost: number, residual: number, usefulLifeMonths: number,
  method: string, depRate: number, currentNBV: number
): number {
  if (method === 'REDUCING_BALANCE') {
    return Math.round((currentNBV * (depRate / 12)) * 100) / 100;
  }
  // Straight-line
  return Math.round(((cost - residual) / usefulLifeMonths) * 100) / 100;
}

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const sp       = req.nextUrl.searchParams;
      const status   = sp.get('status');
      const category = sp.get('category');
      const type     = sp.get('type');

      if (type === 'schedule') {
        const assetId = sp.get('assetId');
        if (!assetId) return NextResponse.json({ error: 'assetId required' }, { status: 400 });
        const schedule = await tx.$queryRawUnsafe<AssetRow[]>(
          `SELECT * FROM finance_depreciation_schedule WHERE tenant_id=$1 AND asset_id=$2 ORDER BY period_year, period_month`, tenantId, assetId
        ).catch(() => []);
        return NextResponse.json({ data: schedule });
      }

      if (type === 'summary') {
        const [totals] = await tx.$queryRawUnsafe<{total_cost: string; total_acc_dep: string; total_nbv: string; count: string; active_count: string}[]>(
          `SELECT
             COALESCE(SUM(acquisition_cost),0)::text as total_cost,
             COALESCE(SUM(accumulated_depreciation),0)::text as total_acc_dep,
             COALESCE(SUM(net_book_value),0)::text as total_nbv,
             COUNT(*)::text as count,
             SUM(CASE WHEN status='ACTIVE' THEN 1 ELSE 0 END)::text as active_count
           FROM finance_fixed_assets WHERE tenant_id = $1 AND deleted_at IS NULL`,
          tenantId,
        ).catch(() => []);
        return NextResponse.json(totals ?? {});
      }

      let where = `WHERE tenant_id = $1 AND deleted_at IS NULL`;
      const params: unknown[] = [tenantId];
      let pi = 2;
      if (status)   { where += ` AND status = $${pi++}`;          params.push(status); }
      if (category) { where += ` AND asset_category = $${pi++}`;  params.push(category); }

      const assets = await tx.$queryRawUnsafe<AssetRow[]>(
        `SELECT * FROM finance_fixed_assets ${where} ORDER BY asset_no ASC`, ...params
      ).catch(() => []);

      return NextResponse.json({ data: assets, count: assets.length });
  });
}

export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);

      if (body.action === 'run_depreciation') {
        // Run depreciation for a period
        const period = body.period ?? new Date().toISOString().slice(0, 7); // YYYY-MM
        const [yr, mo] = period.split('-').map(Number);

        const assets = await tx.$queryRawUnsafe<{
          id: string; acquisition_cost: string; residual_value: string;
          useful_life_months: number; depreciation_method: string; depreciation_rate: string;
          accumulated_depreciation: string; net_book_value: string; acquisition_date: string;
          status: string;
        }[]>(
          `SELECT * FROM finance_fixed_assets WHERE tenant_id = $1 AND deleted_at IS NULL AND status = 'ACTIVE'`,
          tenantId,
        ).catch(() => []);

        let processed = 0;
        for (const asset of assets) {
          // Skip if already run for this period
          const [existing] = await tx.$queryRawUnsafe<{id: string}[]>(
            `SELECT id FROM finance_depreciation_schedule WHERE tenant_id=$4 AND asset_id=$1 AND period_year=$2 AND period_month=$3`,
            asset.id, yr, mo, tenantId
          ).catch(() => [] as {id: string}[]);
          if (existing) continue;

          const cost       = parseFloat(asset.acquisition_cost);
          const residual   = parseFloat(asset.residual_value ?? '0');
          const accDep     = parseFloat(asset.accumulated_depreciation ?? '0');
          const nbv        = parseFloat(asset.net_book_value ?? String(cost));
          const depMethod  = asset.depreciation_method ?? 'STRAIGHT_LINE';
          const depRate    = parseFloat(asset.depreciation_rate ?? '0.20');

          const monthlyDep = calculateMonthlyDepreciation(cost, residual, asset.useful_life_months, depMethod, depRate, nbv);
          const actualDep  = Math.min(monthlyDep, Math.max(0, nbv - residual));

          const closingNBV = nbv - actualDep;
          const newAccDep  = accDep + actualDep;

          await tx.$executeRawUnsafe(
            `INSERT INTO finance_depreciation_schedule
               (asset_id, period_year, period_month, opening_nbv, depreciation, closing_nbv, tenant_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            asset.id, yr, mo, nbv, actualDep, closingNBV, tenantId
          ).catch(() => {});

          await tx.$executeRawUnsafe(
            `UPDATE finance_fixed_assets SET
               accumulated_depreciation=$2, net_book_value=$3, last_depreciation_date=$4::date, updated_at=NOW()
             WHERE id::text=$1 AND tenant_id=$5`,
            asset.id, newAccDep, closingNBV,
            `${yr}-${String(mo).padStart(2,'0')}-${new Date(yr, mo, 0).getDate()}`, tenantId
          ).catch(() => {});

          // Auto-set FULLY_DEPRECIATED if NBV <= residual
          if (closingNBV <= residual) {
            await tx.$executeRawUnsafe(
              `UPDATE finance_fixed_assets SET status='FULLY_DEPRECIATED', updated_at=NOW() WHERE id::text=$1 AND tenant_id=$2`, asset.id, tenantId
            ).catch(() => {});
          }

          processed++;
        }

        return NextResponse.json({ processed, period });
      }

      if (body.action === 'dispose') {
        const { assetId, disposalDate, disposalProceeds, disposalMethod, notes } = body;
        const [asset] = await tx.$queryRawUnsafe<{net_book_value: string}[]>(
          `SELECT net_book_value FROM finance_fixed_assets WHERE id::text=$1 AND tenant_id=$2`, assetId, tenantId
        ).catch(() => [] as {net_book_value: string}[]);

        await tx.$executeRawUnsafe(
          `UPDATE finance_fixed_assets SET
             status='DISPOSED', disposal_date=$2::date, disposal_proceeds=$3::numeric,
             disposal_method=$4, notes=COALESCE($5,notes), updated_at=NOW()
           WHERE id::text=$1 AND tenant_id=$6`,
          assetId, disposalDate, disposalProceeds ?? 0, disposalMethod ?? 'SOLD', notes ?? null, tenantId
        ).catch(() => {});

        const nbv      = parseFloat(asset?.net_book_value ?? '0');
        const proceeds = parseFloat(disposalProceeds ?? '0');
        const gainLoss = proceeds - nbv;

        return NextResponse.json({ disposed: assetId, gainLoss: Math.round(gainLoss * 100) / 100 });
      }

      // Create new fixed asset
      const assetNo  = await nextAssetNo(tx, tenantId, body.assetCategory);
      const cost     = parseFloat(body.acquisitionCost);
      const residual = parseFloat(body.residualValue ?? '0');
      const nbv      = cost;

      const [row] = await tx.$queryRawUnsafe<AssetRow[]>(
        `INSERT INTO finance_fixed_assets
           (asset_no, asset_name, asset_category, coa_account_code, description,
            vehicle_id, registration_no, acquisition_date, acquisition_cost, residual_value,
            useful_life_months, depreciation_method, depreciation_rate,
            net_book_value, supplier, purchase_invoice_no, location, notes, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         RETURNING *`,
        assetNo, body.assetName, body.assetCategory,
        body.coaAccountCode ?? null, body.description ?? null,
        body.vehicleId ?? null, body.registrationNo ?? null,
        body.acquisitionDate, cost, residual,
        body.usefulLifeMonths ?? 60,
        body.depreciationMethod ?? 'STRAIGHT_LINE',
        body.depreciationRate ?? null,
        nbv, body.supplier ?? null, body.purchaseInvoiceNo ?? null,
        body.location ?? null, body.notes ?? null, tenantId,
      ).catch(() => []);

      if (!row) return NextResponse.json({ error: 'Failed to create asset' }, { status: 500 });
      return NextResponse.json(row, { status: 201 });
  });
}

