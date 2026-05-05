import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureAssetsSchema } from '@/lib/assets/schema';
import { ensureBleHwSchema } from '@/lib/assets/ble-hw-schema';

type Row = Record<string, unknown>;
const query = <T = Row>(sql: string, ...v: unknown[]) =>
  prisma.$queryRawUnsafe<T[]>(sql, ...v).catch(() => [] as T[]);

export async function GET(req: NextRequest) {
  try {
    await ensureAssetsSchema();
    await ensureBleHwSchema();

    const tenantId = req.nextUrl.searchParams.get('tenantId') ?? 'default';

    const [
      gatewayStats,
      tagStats,
      detectionTodayRes,
      detectionHourRes,
      alertStats,
      lastDetectionRes,
    ] = await Promise.all([
      query<{ total: bigint; online: bigint; offline: bigint }>(
        `SELECT
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE status = 'ONLINE') as online,
           COUNT(*) FILTER (WHERE status = 'OFFLINE') as offline
         FROM ble_gateways WHERE tenant_id = $1`,
        tenantId,
      ),
      query<{ active_tags: bigint }>(
        `SELECT COUNT(*) as active_tags
         FROM ble_tags
         WHERE tenant_id = $1 AND status = 'ACTIVE'`,
        tenantId,
      ),
      query<{ count: bigint }>(
        `SELECT COUNT(*) as count
         FROM ble_detections
         WHERE tenant_id = $1 AND detected_at >= NOW() - INTERVAL '1 day'`,
        tenantId,
      ),
      query<{ count: bigint }>(
        `SELECT COUNT(*) as count
         FROM ble_detections
         WHERE tenant_id = $1 AND detected_at >= NOW() - INTERVAL '1 hour'`,
        tenantId,
      ),
      query<{ open_alerts: bigint; critical_alerts: bigint }>(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'OPEN') as open_alerts,
           COUNT(*) FILTER (WHERE status = 'OPEN' AND severity = 'CRITICAL') as critical_alerts
         FROM ble_movement_alerts WHERE tenant_id = $1`,
        tenantId,
      ),
      query<{ last_detection_at: Date | null }>(
        `SELECT MAX(detected_at) as last_detection_at
         FROM ble_detections WHERE tenant_id = $1`,
        tenantId,
      ),
    ]);

    const gw = gatewayStats[0] ?? { total: 0n, online: 0n, offline: 0n };
    const tg = tagStats[0] ?? { active_tags: 0n };
    const al = alertStats[0] ?? { open_alerts: 0n, critical_alerts: 0n };
    const lastDet = lastDetectionRes[0]?.last_detection_at;

    return NextResponse.json({
      total_gateways: Number(gw.total),
      online_gateways: Number(gw.online),
      offline_gateways: Number(gw.offline),
      active_tags: Number(tg.active_tags),
      detections_today: Number(detectionTodayRes[0]?.count ?? 0n),
      detections_last_hour: Number(detectionHourRes[0]?.count ?? 0n),
      open_alerts: Number(al.open_alerts),
      critical_alerts: Number(al.critical_alerts),
      last_detection_at: lastDet instanceof Date ? lastDet.toISOString() : lastDet ?? null,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
