import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureAssetsSchema } from '@/lib/assets/schema';
import { ensureBleHwSchema } from '@/lib/assets/ble-hw-schema';
import crypto from 'crypto';

type Row = Record<string, unknown>;
const query = <T = Row>(sql: string, ...v: unknown[]) =>
  prisma.$queryRawUnsafe<T[]>(sql, ...v).catch(() => [] as T[]);
const exec = (sql: string, ...v: unknown[]) =>
  prisma.$executeRawUnsafe(sql, ...v).catch(() => 0);

interface Detection {
  tag_mac: string;
  rssi?: number;
  tx_power?: number;
  battery_pct?: number;
  raw_payload?: Record<string, unknown>;
  detected_at?: string;
}

export async function POST(req: NextRequest) {
  try {
    await ensureAssetsSchema();
    await ensureBleHwSchema();

    const body = await req.json();

    // Extract api key — header takes priority
    const headerKey = req.headers.get('X-Gateway-Key');
    const apiKey: string = headerKey ?? body.api_key ?? '';
    const gatewayCode: string = body.gateway_code ?? '';
    const detections: Detection[] = Array.isArray(body.detections) ? body.detections : [];
    const tenantId = 'default';

    if (!gatewayCode) {
      return NextResponse.json({ error: 'gateway_code is required' }, { status: 400 });
    }
    if (!apiKey) {
      return NextResponse.json({ error: 'API key is required' }, { status: 401 });
    }

    // Look up gateway
    const [gateway] = await query(
      `SELECT * FROM ble_gateways WHERE gateway_code = $1 AND tenant_id = $2`,
      gatewayCode,
      tenantId,
    );

    if (!gateway) {
      return NextResponse.json({ error: 'Gateway not found' }, { status: 404 });
    }

    // Validate API key
    const storedHash = gateway.api_key_hash as string | null;
    if (!storedHash) {
      return NextResponse.json({ error: 'Gateway has no API key configured' }, { status: 401 });
    }
    const incomingHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    if (incomingHash !== storedHash) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
    }

    const gatewayId = gateway.id as string;
    const gatewayZone = gateway.location_zone as string | null;

    // Update gateway heartbeat
    const uniqueMacs = new Set(detections.map(d => d.tag_mac.toUpperCase()));
    await exec(
      `UPDATE ble_gateways SET
         last_heartbeat = NOW(),
         status = 'ONLINE',
         last_detection_at = NOW(),
         total_detections = COALESCE(total_detections, 0) + $1,
         tags_visible = $2,
         updated_at = NOW()
       WHERE id = $3 AND tenant_id = $4`,
      detections.length,
      uniqueMacs.size,
      gatewayId,
      tenantId,
    );

    // Fetch active zone rules for this gateway
    const zoneRules = await query(
      `SELECT * FROM ble_zone_rules WHERE gateway_id = $1 AND tenant_id = $2 AND is_active = TRUE`,
      gatewayId,
      tenantId,
    );

    let tagsUpdated = 0;
    let tagsNew = 0;
    let alertsCreated = 0;

    for (const det of detections) {
      const tagMac = det.tag_mac.toUpperCase();
      const detectedAt = det.detected_at ?? new Date().toISOString();

      // Look up tag
      const [tag] = await query(
        `SELECT * FROM ble_tags WHERE UPPER(tag_mac) = $1 AND tenant_id = $2`,
        tagMac,
        tenantId,
      );

      const tagId = tag ? (tag.id as string) : null;
      const assetName = tag ? (tag.assigned_asset_name as string | null) : null;
      const previousGatewayId = tag ? (tag.last_gateway_id as string | null) : null;
      const previousZone = tag ? (tag.last_location_zone as string | null) : null;

      // Insert detection
      const detectionId = crypto.randomUUID();
      await exec(
        `INSERT INTO ble_detections (
           id, tenant_id, gateway_id, gateway_code, gateway_zone,
           tag_mac, tag_id, asset_name,
           rssi, tx_power, battery_pct,
           raw_payload, detected_at, created_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,NOW()
         ) ON CONFLICT DO NOTHING`,
        detectionId,
        tenantId,
        gatewayId,
        gatewayCode,
        gatewayZone,
        tagMac,
        tagId,
        assetName,
        det.rssi ?? null,
        det.tx_power ?? null,
        det.battery_pct ?? null,
        det.raw_payload ? JSON.stringify(det.raw_payload) : null,
        detectedAt,
      );

      // Update or note the tag
      if (tag) {
        tagsUpdated++;
        // Build update
        const sets: string[] = [
          'last_seen_at = $1',
          'signal_rssi = $2',
          'last_gateway_id = $3',
          'last_location_zone = $4',
          'current_gateway_id = $3',
          'current_gateway_zone = $4',
          'updated_at = NOW()',
        ];
        const vals: unknown[] = [detectedAt, det.rssi ?? null, gatewayId, gatewayZone];

        if (det.battery_pct !== undefined) {
          vals.push(det.battery_pct);
          sets.push(`battery_pct = $${vals.length}`);
        }
        if (det.tx_power !== undefined) {
          vals.push(det.tx_power);
          sets.push(`tx_power = $${vals.length}`);
        }

        vals.push(tagMac, tenantId);
        await exec(
          `UPDATE ble_tags SET ${sets.join(', ')}
           WHERE UPPER(tag_mac) = $${vals.length - 1} AND tenant_id = $${vals.length}`,
          ...vals,
        );
      } else {
        tagsNew++;
      }

      // Zone rule check — only if the tag has an assigned asset
      if (tag && tag.assigned_asset_id && zoneRules.length > 0) {
        // Look up asset domain from asset_registry
        const [asset] = await query(
          `SELECT domain, asset_no FROM asset_registry WHERE id::text = $1 AND tenant_id = $2`,
          tag.assigned_asset_id as string,
          tenantId,
        );

        const assetDomain = asset ? (asset.domain as string) : null;

        for (const rule of zoneRules) {
          const allowedDomains = rule.allowed_domains as string[] | null;
          if (
            rule.alert_on_violation &&
            assetDomain &&
            allowedDomains &&
            allowedDomains.length > 0 &&
            !allowedDomains.includes(assetDomain)
          ) {
            // Violation — create alert
            await exec(
              `INSERT INTO ble_movement_alerts (
                 id, tenant_id, detection_id,
                 tag_mac, tag_id, asset_name, asset_no, asset_domain,
                 from_gateway_id, from_zone,
                 to_gateway_id, to_zone,
                 rule_id, severity, status,
                 detected_at, created_at
               ) VALUES (
                 $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'OPEN',$15,NOW()
               )`,
              crypto.randomUUID(),
              tenantId,
              detectionId,
              tagMac,
              tagId,
              assetName,
              asset ? (asset.asset_no as string) : null,
              assetDomain,
              previousGatewayId,
              previousZone,
              gatewayId,
              gatewayZone,
              rule.id as string,
              (rule.severity as string) ?? 'MEDIUM',
              detectedAt,
            );
            alertsCreated++;
          }
        }
      }

      // Log movement if gateway changed
      if (tag && previousGatewayId && previousGatewayId !== gatewayId) {
        await exec(
          `INSERT INTO asset_movements (
             id, tenant_id, asset_id, asset_type, asset_name,
             movement_type, from_location, to_location,
             moved_by, moved_at, gateway_id, created_at
           ) VALUES (
             $1,$2,$3,'BLE_TAG',$4,'BLE_ZONE_CHANGE',$5,$6,'system',$7,$8,NOW()
           )`,
          crypto.randomUUID(),
          tenantId,
          tag.id as string,
          assetName ?? tagMac,
          previousZone ?? 'Unknown',
          gatewayZone ?? 'Unknown',
          detectedAt,
          gatewayId,
        );
      }
    }

    return NextResponse.json({
      success: true,
      gateway_code: gatewayCode,
      detections_received: detections.length,
      tags_updated: tagsUpdated,
      tags_new: tagsNew,
      alerts_created: alertsCreated,
      processed_at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
