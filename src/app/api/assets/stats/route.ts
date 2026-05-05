import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureAssetsSchema } from '@/lib/assets/schema';

type Row = Record<string, unknown>;
const query = <T = Row>(sql: string, ...v: unknown[]) =>
  prisma.$queryRawUnsafe<T[]>(sql, ...v).catch(() => [] as T[]);

function ser(rows: Row[]): Row[] {
  return rows.map(r => {
    const o: Row = {};
    for (const [k, v] of Object.entries(r)) {
      o[k] = v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v;
    }
    return o;
  });
}

export async function GET(req: NextRequest) {
  try {
    await ensureAssetsSchema();
    const sp = req.nextUrl.searchParams;
    const tenantId = sp.get('tenantId') ?? 'default';

    const [
      totalAssetsRes,
      totalValueRes,
      lowStockRes,
      outOfStockRes,
      hvaCountRes,
      hvaInsuranceRes,
      hvaCalibrationRes,
      medicalExpiringRes,
      medicalExpiredRes,
      bleTagsTotalRes,
      bleTagsOfflineRes,
      bleTagsLowBatteryRes,
      gatewaysOnlineRes,
      gatewaysOfflineRes,
      pendingDispatchesRes,
      pendingReturnsRes,
      todayTransactionsRes,
      domainBreakdownRes,
    ] = await Promise.all([
      query<{ count: bigint }>(`SELECT COUNT(*) as count FROM asset_registry WHERE tenant_id = $1 AND is_active = TRUE`, tenantId),
      query<{ total: unknown }>(`SELECT COALESCE(SUM(unit_cost_aed * current_stock), 0) as total FROM asset_registry WHERE tenant_id = $1 AND is_active = TRUE`, tenantId),
      query<{ count: bigint }>(`SELECT COUNT(*) as count FROM asset_registry WHERE tenant_id = $1 AND is_active = TRUE AND status = 'LOW_STOCK'`, tenantId),
      query<{ count: bigint }>(`SELECT COUNT(*) as count FROM asset_registry WHERE tenant_id = $1 AND is_active = TRUE AND status = 'OUT_OF_STOCK'`, tenantId),
      query<{ count: bigint }>(`SELECT COUNT(*) as count FROM hva_assets WHERE tenant_id = $1 AND status != 'CONDEMNED'`, tenantId),
      query<{ count: bigint }>(`SELECT COUNT(*) as count FROM hva_assets WHERE tenant_id = $1 AND insurance_expiry BETWEEN NOW() AND NOW() + INTERVAL '30 days'`, tenantId),
      query<{ count: bigint }>(`SELECT COUNT(*) as count FROM hva_assets WHERE tenant_id = $1 AND calibration_due_date BETWEEN NOW() AND NOW() + INTERVAL '30 days'`, tenantId),
      query<{ count: bigint }>(`SELECT COUNT(*) as count FROM medical_assets WHERE tenant_id = $1 AND expiry_date BETWEEN NOW() AND NOW() + INTERVAL '30 days'`, tenantId),
      query<{ count: bigint }>(`SELECT COUNT(*) as count FROM medical_assets WHERE tenant_id = $1 AND expiry_date < NOW()`, tenantId),
      query<{ count: bigint }>(`SELECT COUNT(*) as count FROM ble_tags WHERE tenant_id = $1`, tenantId),
      query<{ count: bigint }>(`SELECT COUNT(*) as count FROM ble_tags WHERE tenant_id = $1 AND status = 'OFFLINE'`, tenantId),
      query<{ count: bigint }>(`SELECT COUNT(*) as count FROM ble_tags WHERE tenant_id = $1 AND battery_pct < 20`, tenantId),
      query<{ count: bigint }>(`SELECT COUNT(*) as count FROM ble_gateways WHERE tenant_id = $1 AND status = 'ONLINE'`, tenantId),
      query<{ count: bigint }>(`SELECT COUNT(*) as count FROM ble_gateways WHERE tenant_id = $1 AND status = 'OFFLINE'`, tenantId),
      query<{ count: bigint }>(`SELECT COUNT(*) as count FROM field_dispatch WHERE tenant_id = $1 AND status IN ('PENDING','DISPATCHED')`, tenantId),
      query<{ count: bigint }>(`SELECT COUNT(*) as count FROM return_requests WHERE tenant_id = $1 AND status = 'PENDING'`, tenantId),
      query<{ count: bigint }>(`SELECT COUNT(*) as count FROM stock_transactions WHERE tenant_id = $1 AND performed_at >= CURRENT_DATE`, tenantId),
      query<{ domain: string; count: bigint; total_value: unknown }>(`SELECT domain, COUNT(*) as count, COALESCE(SUM(unit_cost_aed * current_stock), 0) as total_value FROM asset_registry WHERE tenant_id = $1 AND is_active = TRUE GROUP BY domain ORDER BY count DESC`, tenantId),
    ]);

    return NextResponse.json({
      totalAssets: Number(totalAssetsRes[0]?.count ?? 0),
      totalValue: Number(totalValueRes[0]?.total ?? 0),
      lowStockCount: Number(lowStockRes[0]?.count ?? 0),
      outOfStockCount: Number(outOfStockRes[0]?.count ?? 0),
      hvaCount: Number(hvaCountRes[0]?.count ?? 0),
      hvaInsuranceExpiring: Number(hvaInsuranceRes[0]?.count ?? 0),
      hvaCalibrationDue: Number(hvaCalibrationRes[0]?.count ?? 0),
      medicalExpiring: Number(medicalExpiringRes[0]?.count ?? 0),
      medicalExpired: Number(medicalExpiredRes[0]?.count ?? 0),
      bleTagsTotal: Number(bleTagsTotalRes[0]?.count ?? 0),
      bleTagsOffline: Number(bleTagsOfflineRes[0]?.count ?? 0),
      bleTagsLowBattery: Number(bleTagsLowBatteryRes[0]?.count ?? 0),
      gatewaysOnline: Number(gatewaysOnlineRes[0]?.count ?? 0),
      gatewaysOffline: Number(gatewaysOfflineRes[0]?.count ?? 0),
      pendingDispatches: Number(pendingDispatchesRes[0]?.count ?? 0),
      pendingReturns: Number(pendingReturnsRes[0]?.count ?? 0),
      todayTransactions: Number(todayTransactionsRes[0]?.count ?? 0),
      domainBreakdown: domainBreakdownRes.map(r => ({
        domain: r.domain,
        count: Number(r.count),
        totalValue: Number(r.total_value ?? 0),
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
