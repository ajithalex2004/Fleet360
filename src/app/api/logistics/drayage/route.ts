export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import crypto from 'crypto';
import {
  getDrayageWorkspaceData,
  createDrayageJobsBatch,
  assignDrayageJob,
  updateDrayageJobExecutionStatus,
  activateL2EmptyReturnJob,
  ensureDrayageSchema,
  verifyPortEdiForJob,
  appendDrayageItineraryLeg,
  sendDispatchChatMessage,
  acknowledgeDrayageAlert,
  extendContainerDeliveryOrder,
  calculateMissingAllowances,
  recordDrayageStatusLog,
} from '@/lib/logistics/drayage-domain';

let drayageSchemaEnsured = false;

interface WorkspaceCacheEntry {
  timestamp: number;
  data: unknown;
}
const workspaceCache = new Map<string, WorkspaceCacheEntry>();
const CACHE_TTL_MS = 4000; // 4s cache for instantaneous tab switching and burst requests

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const now = Date.now();
  const cached = workspaceCache.get(tenantId);
  if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
    return NextResponse.json(cached.data, {
      headers: {
        'X-Cache': 'HIT',
        'Cache-Control': 'private, max-age=4',
      },
    });
  }

  if (!drayageSchemaEnsured) {
    await ensureDrayageSchema(prisma).catch(() => {});
    drayageSchemaEnsured = true;
  }

  try {
    const data = await withTenantRls(prisma, tenantId, async (tx) => {
      return getDrayageWorkspaceData(tx, tenantId);
    }, { timeoutMs: 30000 });
    workspaceCache.set(tenantId, { timestamp: Date.now(), data });
    return NextResponse.json(data, {
      headers: {
        'X-Cache': 'MISS',
        'Cache-Control': 'private, max-age=4',
      },
    });
  } catch (error) {
    console.error('[api/logistics/drayage GET]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load port & container drayage workspace' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId, userId } = authz;

  if (!drayageSchemaEnsured) {
    await ensureDrayageSchema(prisma).catch(() => {});
    drayageSchemaEnsured = true;
  }

  try {
    const body = await req.json();
    const action = String(body.action ?? '');

    const result = await withTenantRls(prisma, tenantId, async (tx) => {

      switch (action) {
        case 'create_jobs': {
          return createDrayageJobsBatch(tx, {
            tenantId,
            shipmentType: body.shipmentType === 'EXPORT' ? 'EXPORT' : 'IMPORT',
            priority: body.priority || 'STANDARD',
            customerId: body.customerId ?? null,
            customerName: body.customerName || 'Enterprise Shipper',
            warehouseId: body.warehouseId ?? null,
            warehouseName: body.warehouseName || 'JAFZA South Bonded Hub',
            terminalId: body.terminalId ?? null,
            terminalName: body.terminalName || 'Jebel Ali Port - Terminal 1',
            rateAmountAed: Number(body.rateAmountAed ?? 1550),
            driverAllowanceAed: Number(body.driverAllowanceAed ?? 150),
            notes: body.notes ?? null,
            containers: Array.isArray(body.containers) ? body.containers : [],
          });
        }

        case 'assign_job': {
          return assignDrayageJob(tx, {
            tenantId,
            jobId: String(body.jobId),
            vehicleId: String(body.vehicleId),
            vehiclePlate: String(body.vehiclePlate),
            driverId: String(body.driverId),
            driverName: String(body.driverName),
            trailerId: String(body.trailerId),
            trailerPlate: String(body.trailerPlate),
            tokenNumber: String(body.tokenNumber ?? ''),
          });
        }

        case 'update_token': {
          const token = String(body.tokenNumber ?? '').trim().toUpperCase();
          if (!token) throw new Error('Token number is required');
          await tx.$executeRawUnsafe(
            `UPDATE logistics_drayage_jobs
                SET token_number = $3,
                    updated_at = NOW()
              WHERE id = $1 AND tenant_id = $2`,
            String(body.jobId),
            tenantId,
            token,
          );
          return { ok: true, tokenNumber: token };
        }

        case 'create_bogie_trip': {
          const jobIds: string[] = Array.isArray(body.jobIds) ? body.jobIds.map(String) : [];
          if (jobIds.length !== 2) {
            throw new Error('A Bogie trip can only carry exactly two (2) twenty-foot containers on a single prime mover & chassis');
          }
          // Validate that both containers are 20FT
          const containers = (await tx.$queryRawUnsafe(
            `SELECT id, container_size, container_number FROM logistics_drayage_jobs WHERE id = ANY($1::text[]) AND tenant_id = $2`,
            jobIds,
            tenantId,
          )) as Array<{ id: string; container_size: string | null; container_number: string }>;
          const non20 = containers.find((c) => c.container_size && c.container_size.trim().toUpperCase() !== '20FT');
          if (non20) {
            throw new Error(`Container ${non20.container_number} is ${non20.container_size}. A Bogie setup only accommodates two 20FT containers.`);
          }
          const bogieRef = `BOGIE-${Math.floor(1000 + Math.random() * 9000)}`;
          for (const jId of jobIds) {
            await tx.$executeRawUnsafe(
              `UPDATE logistics_drayage_jobs
                  SET notes = COALESCE(notes || ' | ', '') || $3,
                      priority = 'HIGH',
                      updated_at = NOW()
                WHERE id = $1 AND tenant_id = $2`,
              jId,
              tenantId,
              `Paired in 2x20FT Bogie Dispatch (${bogieRef})`,
            );
            if (body.vehicleId && body.driverId && body.trailerId) {
              await assignDrayageJob(tx, {
                tenantId,
                jobId: jId,
                vehicleId: String(body.vehicleId),
                vehiclePlate: String(body.vehiclePlate ?? 'DXB-TRACTOR'),
                driverId: String(body.driverId),
                driverName: String(body.driverName ?? 'Assigned Driver'),
                trailerId: String(body.trailerId),
                trailerPlate: String(body.trailerPlate ?? 'DXB-TR-9901'),
                tokenNumber: String(body.tokenNumber || `DPW-BG-${Math.floor(1000 + Math.random() * 9000)}`),
              });
            }
          }
          return { ok: true, bogieRef, count: jobIds.length };
        }

        case 'batch_dispatch': {
          const dispatches: Array<{
            type?: 'BOGIE' | 'STREET_TURN' | 'SINGLE';
            jobIds: string[];
            vehicleId: string;
            vehiclePlate: string;
            driverId: string;
            driverName: string;
            trailerId: string;
            trailerPlate: string;
            tokenNumber?: string;
            notes?: string;
          }> = Array.isArray(body.dispatches) ? body.dispatches : [];

          if (dispatches.length === 0) throw new Error('No dispatches provided in batch');

          let assignedCount = 0;
          for (const d of dispatches) {
            const jobIds = Array.isArray(d.jobIds) ? d.jobIds.map(String) : [];
            if (jobIds.length === 0) continue;

            const token = d.tokenNumber || (d.type === 'BOGIE' ? `DPW-BG-${Math.floor(1000 + Math.random() * 9000)}` : `DPW-TKN-${Math.floor(1000 + Math.random() * 9000)}`);

            for (const jId of jobIds) {
              const noteText = d.notes || (d.type === 'BOGIE' ? `Dual-20FT Bogie Combo (${token})` : d.type === 'STREET_TURN' ? `Terminal Street Turn Pair (${token})` : undefined);
              if (noteText) {
                await tx.$executeRawUnsafe(
                  `UPDATE logistics_drayage_jobs
                      SET notes = COALESCE(notes || ' | ', '') || $3,
                          priority = CASE WHEN priority = 'URGENT' THEN 'URGENT' ELSE 'HIGH' END,
                          updated_at = NOW()
                    WHERE id = $1 AND tenant_id = $2`,
                  jId,
                  tenantId,
                  noteText,
                );
              }

              await assignDrayageJob(tx, {
                tenantId,
                jobId: jId,
                vehicleId: String(d.vehicleId),
                vehiclePlate: String(d.vehiclePlate ?? 'DXB-TRACTOR'),
                driverId: String(d.driverId),
                driverName: String(d.driverName ?? 'Assigned Driver'),
                trailerId: String(d.trailerId),
                trailerPlate: String(d.trailerPlate ?? 'DXB-TR-9901'),
                tokenNumber: token,
              });
              assignedCount++;
            }
          }

          return { ok: true, count: assignedCount, batches: dispatches.length };
        }

        case 'update_status': {
          return updateDrayageJobExecutionStatus(tx, {
            tenantId,
            jobId: String(body.jobId),
            status: String(body.status),
            placementLocation: body.placementLocation ?? undefined,
            detachTrailer: body.detachTrailer,
          });
        }

        case 'activate_l2': {
          return activateL2EmptyReturnJob(tx, {
            tenantId,
            l1JobId: String(body.l1JobId),
          });
        }

        case 'verify_port_edi': {
          return verifyPortEdiForJob(tx, {
            tenantId,
            jobId: String(body.jobId),
            provider: body.provider === 'AD_PORTS_MAQTA' ? 'AD_PORTS_MAQTA' : 'DUBAI_TRADE_DPWORLD',
          });
        }

        case 'append_itinerary_leg': {
          return appendDrayageItineraryLeg(tx, {
            tenantId,
            jobId: String(body.jobId),
            legType: String(body.legType ?? 'CUSTOMS_INSPECTION'),
            pickupLocation: String(body.pickupLocation ?? 'Jebel Ali Port Gate'),
            dropoffLocation: String(body.dropoffLocation ?? 'JAFZA Customs Inspection Bay'),
            rateAed: Number(body.rateAed ?? 250),
          });
        }

        case 'send_dispatch_message': {
          return sendDispatchChatMessage(tx, {
            tenantId,
            jobId: String(body.jobId),
            senderRole: body.senderRole === 'DRIVER' ? 'DRIVER' : 'DISPATCHER',
            senderName: String(body.senderName ?? 'Port Operations Desk'),
            message: String(body.message ?? '').trim(),
            isUrgent: Boolean(body.isUrgent),
          });
        }

        case 'acknowledge_alert': {
          return acknowledgeDrayageAlert(tx, {
            tenantId,
            alertKey: String(body.alertKey),
          });
        }

        case 'extend_do': {
          return extendContainerDeliveryOrder(tx, {
            tenantId,
            containerId: String(body.containerId),
            daysToAdd: Number(body.daysToAdd ?? 3),
          });
        }

        case 'create_container': {
          const items = Array.isArray(body.containers) ? body.containers : [body];
          const createdIds: string[] = [];
          for (const item of items) {
            const cntNum = String(item.containerNumber ?? '').trim().toUpperCase();
            if (!cntNum) continue;
            const id = `cnt-${crypto.randomUUID().slice(0, 12)}`;
            const doExp = item.doExpiryDate
              ? new Date(String(item.doExpiryDate)).toISOString()
              : new Date(Date.now() + 5 * 86400000).toISOString();
            const disch = item.dischargeDate
              ? new Date(String(item.dischargeDate)).toISOString()
              : new Date().toISOString();
            await tx.$executeRawUnsafe(
              `INSERT INTO logistics_drayage_containers (
                id, tenant_id, container_number, size, container_type, shipment_type, status,
                customer_id, customer_name, terminal_id, terminal_name, warehouse_id, warehouse_name,
                do_expiry_date, discharge_date, seal_number, weight_kg,
                customs_inspection, municipality_inspection, cpip_inspection, merc_inspection, boxcare_inspection
              ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                $14::timestamptz,$15::timestamptz,$16,$17,$18,$19,$20,$21,$22
              )`,
              id,
              tenantId,
              cntNum,
              String(item.size ?? '40HC'),
              String(item.containerType ?? 'DRY'),
              String(item.shipmentType ?? 'IMPORT'),
              String(item.status ?? 'AT_PORT_DISCHARGED'),
              item.customerId ? String(item.customerId) : null,
              String(item.customerName ?? 'Al-Futtaim Logistics LLC'),
              item.terminalId ? String(item.terminalId) : null,
              String(item.terminalName ?? 'Jebel Ali Port - Terminal 1 (DP World)'),
              item.warehouseId ? String(item.warehouseId) : null,
              String(item.warehouseName ?? 'JAFZA South Bonded Fulfillment Hub (Gate 5)'),
              doExp,
              disch,
              String(item.sealNumber ?? `SL-${Math.floor(100000 + Math.random() * 900000)}`),
              Number(item.weightKg ?? 22000),
              Boolean(item.customsInspection),
              Boolean(item.municipalityInspection),
              Boolean(item.cpipInspection),
              Boolean(item.mercInspection),
              Boolean(item.boxcareInspection),
            );
            createdIds.push(id);
          }
          return { ok: true, createdCount: createdIds.length, ids: createdIds };
        }

        case 'create_trailer': {
          const id = `tr-${crypto.randomUUID().slice(0, 10)}`;
          await tx.$executeRawUnsafe(
            `INSERT INTO logistics_drayage_trailers (
              id, tenant_id, plate_number, trailer_type, capacity_tons,
              master_status, operational_status, current_location
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            id,
            tenantId,
            String(body.plateNumber ?? '').trim().toUpperCase(),
            String(body.trailerType ?? '40FT_SKELETAL'),
            Number(body.capacityTons ?? 45),
            String(body.masterStatus ?? 'AVAILABLE'),
            String(body.operationalStatus ?? 'EMPTY'),
            String(body.currentLocation ?? 'Jebel Ali Main Yard'),
          );
          return { ok: true, id };
        }

        case 'update_trailer': {
          await tx.$executeRawUnsafe(
            `UPDATE logistics_drayage_trailers
                SET plate_number = $3,
                    trailer_type = $4,
                    capacity_tons = $5,
                    master_status = $6,
                    operational_status = $7,
                    current_location = $8,
                    updated_at = NOW()
              WHERE id = $1 AND tenant_id = $2`,
            String(body.id),
            tenantId,
            String(body.plateNumber ?? '').trim().toUpperCase(),
            String(body.trailerType ?? '40FT_SKELETAL'),
            Number(body.capacityTons ?? 45),
            String(body.masterStatus ?? 'AVAILABLE'),
            String(body.operationalStatus ?? 'EMPTY'),
            String(body.currentLocation ?? 'Jebel Ali Main Yard'),
          );
          return { ok: true };
        }

        case 'delete_trailer': {
          await tx.$executeRawUnsafe(
            `DELETE FROM logistics_drayage_trailers WHERE id = $1 AND tenant_id = $2`,
            String(body.id),
            tenantId,
          );
          return { ok: true };
        }

        case 'save_geofence': {
          const id = body.id ? String(body.id) : `gf-${crypto.randomUUID().slice(0, 10)}`;
          const coords = Array.isArray(body.coordinates)
            ? JSON.stringify(body.coordinates)
            : String(body.coordinatesJson ?? '[]');
          await tx.$executeRawUnsafe(
            `INSERT INTO logistics_drayage_geofences (
              id, tenant_id, terminal_id, terminal_name, name, type, center_lat, center_lng, radius_meters, coordinates_json
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            ON CONFLICT (id) DO UPDATE
               SET terminal_id = EXCLUDED.terminal_id,
                   terminal_name = EXCLUDED.terminal_name,
                   name = EXCLUDED.name,
                   type = EXCLUDED.type,
                   center_lat = EXCLUDED.center_lat,
                   center_lng = EXCLUDED.center_lng,
                   radius_meters = EXCLUDED.radius_meters,
                   coordinates_json = EXCLUDED.coordinates_json`,
            id,
            tenantId,
            body.terminalId ? String(body.terminalId) : null,
            String(body.terminalName ?? 'Jebel Ali Port - Terminal 1 (DP World)'),
            String(body.name ?? 'Port Gate Zone'),
            body.type === 'POLYGON' ? 'POLYGON' : 'CIRCLE',
            Number(body.centerLat ?? 25.0112),
            Number(body.centerLng ?? 55.0612),
            Number(body.radiusMeters ?? 1500),
            coords,
          );

          // If mapped to a client warehouse destination, synchronize the warehouse geofence parameters
          if (body.terminalId) {
            await tx.$executeRawUnsafe(
              `UPDATE logistics_drayage_warehouses
                  SET geofence_configured = true,
                      geofence_type = $3,
                      geofence_radius_meters = $4,
                      geofence_coordinates_json = $5,
                      lat = $6,
                      lng = $7,
                      updated_at = NOW()
                WHERE (id = $1 OR customer_id = $1) AND tenant_id = $2`,
              String(body.terminalId),
              tenantId,
              body.type === 'POLYGON' ? 'POLYGON' : 'CIRCLE',
              Number(body.radiusMeters ?? 1000),
              coords,
              Number(body.centerLat ?? 25.0112),
              Number(body.centerLng ?? 55.0612),
            ).catch(() => {});

            // Also synchronize with port terminal if matching terminal ID
            await tx.$executeRawUnsafe(
              `UPDATE logistics_drayage_terminals
                  SET lat = $3,
                      lng = $4,
                      geofence_radius_meters = $5,
                      updated_at = NOW()
                WHERE id = $1 AND tenant_id = $2`,
              String(body.terminalId),
              tenantId,
              Number(body.centerLat ?? 25.0112),
              Number(body.centerLng ?? 55.0612),
              Number(body.radiusMeters ?? 1500),
            ).catch(() => {});
          }

          return { ok: true, id };
        }

        case 'delete_geofence': {
          await tx.$executeRawUnsafe(
            `DELETE FROM logistics_drayage_geofences WHERE id = $1 AND tenant_id = $2`,
            String(body.id),
            tenantId,
          );
          return { ok: true };
        }

        case 'create_terminal':
        case 'save_terminal': {
          const id = body.id ? String(body.id) : `term-${crypto.randomUUID().slice(0, 10)}`;
          const termName = String(body.name ?? 'New Port Terminal').trim();
          const termCode = String(body.code ?? 'DPW-JA-T1').toUpperCase().trim();
          const termPort = String(body.portName ?? 'Jebel Ali Port').trim();
          const termEmirate = String(body.emirate ?? 'Dubai').trim();
          const termLat = Number(body.lat ?? 25.0112);
          const termLng = Number(body.lng ?? 55.0612);
          const termRadius = Number(body.geofenceRadiusMeters ?? 1500);

          await tx.$executeRawUnsafe(
            `INSERT INTO logistics_drayage_terminals (
              id, tenant_id, name, code, port_name, emirate, lat, lng,
              geofence_radius_meters, free_days_dry, free_days_reefer, operating_hours, status, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'ACTIVE',NOW())
            ON CONFLICT (id) DO UPDATE
               SET name = EXCLUDED.name,
                   code = EXCLUDED.code,
                   port_name = EXCLUDED.port_name,
                   emirate = EXCLUDED.emirate,
                   lat = EXCLUDED.lat,
                   lng = EXCLUDED.lng,
                   geofence_radius_meters = EXCLUDED.geofence_radius_meters,
                   free_days_dry = EXCLUDED.free_days_dry,
                   free_days_reefer = EXCLUDED.free_days_reefer,
                   operating_hours = EXCLUDED.operating_hours,
                   updated_at = NOW()`,
            id,
            tenantId,
            termName,
            termCode,
            termPort,
            termEmirate,
            termLat,
            termLng,
            termRadius,
            Number(body.freeDaysDry ?? 5),
            Number(body.freeDaysReefer ?? 3),
            String(body.operatingHours ?? '24/7 Gate Operations').trim(),
          );

          // Automatically upsert an associated perimeter geofence for this port terminal
          const existingGfRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id FROM logistics_drayage_geofences WHERE terminal_id = $1 AND tenant_id = $2 LIMIT 1`,
            id,
            tenantId,
          ).catch(() => []);

          if (existingGfRows.length > 0) {
            await tx.$executeRawUnsafe(
              `UPDATE logistics_drayage_geofences
                  SET terminal_name = $1,
                      name = $2,
                      center_lat = $3,
                      center_lng = $4,
                      radius_meters = $5
                WHERE id = $6 AND tenant_id = $7`,
              termName,
              `${termName} Perimeter Geofence`,
              termLat,
              termLng,
              termRadius,
              existingGfRows[0].id,
              tenantId,
            ).catch(() => {});
          } else {
            const gfId = `gf-${id}`;
            await tx.$executeRawUnsafe(
              `INSERT INTO logistics_drayage_geofences (
                id, tenant_id, terminal_id, terminal_name, name, type, center_lat, center_lng, radius_meters, coordinates_json
              ) VALUES ($1,$2,$3,$4,$5,'CIRCLE',$6,$7,$8,$9)
              ON CONFLICT (id) DO UPDATE
                 SET terminal_name = EXCLUDED.terminal_name,
                     name = EXCLUDED.name,
                     center_lat = EXCLUDED.center_lat,
                     center_lng = EXCLUDED.center_lng,
                     radius_meters = EXCLUDED.radius_meters`,
              gfId,
              tenantId,
              id,
              termName,
              `${termName} Perimeter Geofence`,
              termLat,
              termLng,
              termRadius,
              JSON.stringify([{ lat: termLat, lng: termLng }]),
            ).catch(() => {});
          }

          return { ok: true, id };
        }

        case 'delete_terminal': {
          await tx.$executeRawUnsafe(
            `DELETE FROM logistics_drayage_geofences WHERE terminal_id = $1 AND tenant_id = $2`,
            String(body.id),
            tenantId,
          ).catch(() => {});
          await tx.$executeRawUnsafe(
            `DELETE FROM logistics_drayage_terminals WHERE id = $1 AND tenant_id = $2`,
            String(body.id),
            tenantId,
          );
          return { ok: true };
        }

        case 'create_client':
        case 'save_client': {
          const id = body.id ? String(body.id) : `cli-${crypto.randomUUID().slice(0, 10)}`;
          const name = String(body.name ?? 'Enterprise Client').trim();
          const code = String(body.code ?? 'CLI').trim().toUpperCase();
          const contactPerson = body.contactPerson ? String(body.contactPerson).trim() : null;
          const contactNo = body.contactNo ? String(body.contactNo).trim() : null;
          const streetAddress = body.streetAddress ? String(body.streetAddress).trim() : null;
          const city = String(body.city ?? 'Dubai').trim();
          const trn = body.trn ? String(body.trn).trim() : null;
          const tradeLicense = body.tradeLicense ? String(body.tradeLicense).trim() : null;
          const defaultTripAmountAed = Number(body.defaultTripAmountAed ?? 1550);
          const defaultDriverAllowanceAed = Number(body.defaultDriverAllowanceAed ?? 150);
          const notes = body.notes ? String(body.notes).trim() : null;

          await tx.$executeRawUnsafe(
            `INSERT INTO logistics_drayage_clients (
              id, tenant_id, name, code, contact_person, contact_no, street_address, city,
              trn, trade_license, default_trip_amount_aed, default_driver_allowance_aed, notes, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
            ON CONFLICT (id) DO UPDATE
               SET name = EXCLUDED.name,
                   code = EXCLUDED.code,
                   contact_person = EXCLUDED.contact_person,
                   contact_no = EXCLUDED.contact_no,
                   street_address = EXCLUDED.street_address,
                   city = EXCLUDED.city,
                   trn = EXCLUDED.trn,
                   trade_license = EXCLUDED.trade_license,
                   default_trip_amount_aed = EXCLUDED.default_trip_amount_aed,
                   default_driver_allowance_aed = EXCLUDED.default_driver_allowance_aed,
                   notes = EXCLUDED.notes,
                   updated_at = NOW()`,
            id,
            tenantId,
            name,
            code,
            contactPerson,
            contactNo,
            streetAddress,
            city,
            trn,
            tradeLicense,
            defaultTripAmountAed,
            defaultDriverAllowanceAed,
            notes,
          );

          return { ok: true, id };
        }

        case 'delete_client': {
          await tx.$executeRawUnsafe(
            `DELETE FROM logistics_drayage_clients WHERE id = $1 AND tenant_id = $2`,
            String(body.id),
            tenantId,
          );
          return { ok: true };
        }

        case 'create_warehouse':
        case 'save_warehouse': {
          const id = body.id ? String(body.id) : `wh-${crypto.randomUUID().slice(0, 10)}`;
          const geofenceConfigured = Boolean(body.geofenceConfigured);
          const geofenceType = body.geofenceType === 'POLYGON' ? 'POLYGON' : 'CIRCLE';
          const geofenceRadiusMeters = Number(body.geofenceRadiusMeters ?? 800);
          const geofenceCoords = Array.isArray(body.geofenceCoordinates)
            ? JSON.stringify(body.geofenceCoordinates)
            : String(body.geofenceCoordinatesJson ?? '[]');
          const tripAmountAed = body.tripAmountAed != null ? Number(body.tripAmountAed) : 1550;
          const driverAllowanceAed = body.driverAllowanceAed != null ? Number(body.driverAllowanceAed) : 150;

          await tx.$executeRawUnsafe(
            `INSERT INTO logistics_drayage_warehouses (
              id, tenant_id, customer_id, customer_name, name, code, zone, address, lat, lng,
              ramps_count, contact_person, contact_phone, geofence_configured, geofence_type,
              geofence_radius_meters, geofence_coordinates_json, trip_amount_aed, driver_allowance_aed, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW())
            ON CONFLICT (id) DO UPDATE
               SET customer_id = EXCLUDED.customer_id,
                   customer_name = EXCLUDED.customer_name,
                   name = EXCLUDED.name,
                   code = EXCLUDED.code,
                   zone = EXCLUDED.zone,
                   address = EXCLUDED.address,
                   lat = EXCLUDED.lat,
                   lng = EXCLUDED.lng,
                   ramps_count = EXCLUDED.ramps_count,
                   contact_person = EXCLUDED.contact_person,
                   contact_phone = EXCLUDED.contact_phone,
                   geofence_configured = EXCLUDED.geofence_configured,
                   geofence_type = EXCLUDED.geofence_type,
                   geofence_radius_meters = EXCLUDED.geofence_radius_meters,
                   geofence_coordinates_json = EXCLUDED.geofence_coordinates_json,
                   trip_amount_aed = EXCLUDED.trip_amount_aed,
                   driver_allowance_aed = EXCLUDED.driver_allowance_aed,
                   updated_at = NOW()`,
            id,
            tenantId,
            body.customerId ? String(body.customerId) : null,
            String(body.customerName ?? 'Enterprise Shipper').trim(),
            String(body.name ?? 'Distribution Hub').trim(),
            body.code ? String(body.code).trim().toUpperCase() : null,
            String(body.zone ?? 'JAFZA South').trim(),
            String(body.address ?? 'Jebel Ali Free Zone, Dubai').trim(),
            Number(body.lat ?? 24.9642),
            Number(body.lng ?? 55.0915),
            Number(body.rampsCount ?? 8),
            body.contactPerson ? String(body.contactPerson).trim() : null,
            body.contactPhone ? String(body.contactPhone).trim() : null,
            geofenceConfigured,
            geofenceType,
            geofenceRadiusMeters,
            geofenceCoords,
            tripAmountAed,
            driverAllowanceAed,
          );

          if (geofenceConfigured) {
            const gfId = `gf-wh-${id}`;
            await tx.$executeRawUnsafe(
              `INSERT INTO logistics_drayage_geofences (
                id, tenant_id, terminal_id, terminal_name, name, type, center_lat, center_lng, radius_meters, coordinates_json
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
              ON CONFLICT (id) DO UPDATE
                 SET name = EXCLUDED.name,
                     type = EXCLUDED.type,
                     center_lat = EXCLUDED.center_lat,
                     center_lng = EXCLUDED.center_lng,
                     radius_meters = EXCLUDED.radius_meters,
                     coordinates_json = EXCLUDED.coordinates_json`,
              gfId,
              tenantId,
              null,
              String(body.customerName ?? 'Warehouse'),
              `${String(body.name ?? 'Warehouse')} (Facility Geofence)`,
              geofenceType,
              Number(body.lat ?? 24.9642),
              Number(body.lng ?? 55.0915),
              geofenceRadiusMeters,
              geofenceCoords,
            );
          }

          return { ok: true, id };
        }

        case 'delete_warehouse': {
          await tx.$executeRawUnsafe(
            `DELETE FROM logistics_drayage_warehouses WHERE id = $1 AND tenant_id = $2`,
            String(body.id),
            tenantId,
          );
          await tx.$executeRawUnsafe(
            `DELETE FROM logistics_drayage_geofences WHERE id = $1 AND tenant_id = $2`,
            `gf-wh-${String(body.id)}`,
            tenantId,
          );
          return { ok: true };
        }

        case 'create_mapped_vehicle': {
          const id = crypto.randomUUID();
          const plate = String(body.plateNumber ?? '').trim().toUpperCase();
          await tx.$executeRawUnsafe(
            `INSERT INTO vehicles (
              id, tenant_id, plate_number, license_plate, registration_no,
              make, model, year, type, status, vehicle_usage, fuel_type, is_active, created_at, updated_at
            ) VALUES ($1,$2,$3,$3,$3,$4,$5,$6,'HEAVY_TRUCK','AVAILABLE','LOGISTICS','DIESEL',true,NOW(),NOW())`,
            id,
            tenantId,
            plate,
            String(body.make ?? 'Mercedes-Benz'),
            String(body.model ?? 'Actros 2645 Tractor Head'),
            Number(body.year ?? 2025),
          );
          return { ok: true, id };
        }

        case 'create_mapped_driver': {
          const id = crypto.randomUUID();
          const firstName = String(body.firstName ?? '').trim() || 'Driver';
          const lastName = String(body.lastName ?? '').trim();
          const fullName = `${firstName} ${lastName}`.trim();
          const licExpiry = body.licenseExpiry
            ? new Date(String(body.licenseExpiry)).toISOString()
            : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
          await tx.$executeRawUnsafe(
            `INSERT INTO drivers (
              id, tenant_id, name, first_name, last_name, phone, contact_number,
              license_number, license_expiry, status, assignment_type, created_at, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8::timestamptz,'ACTIVE','LOGISTICS',NOW(),NOW())`,
            id,
            tenantId,
            fullName,
            firstName,
            lastName,
            String(body.phone ?? '+971 50 000 0000'),
            String(body.licenseNumber ?? `UAE-HVY-${Math.floor(10000 + Math.random() * 90000)}`),
            licExpiry,
          );
          return { ok: true, id };
        }

        case 'calculate_payments': {
          return calculateMissingAllowances(tx, tenantId);
        }

        case 'update_allowance_status': {
          const newStatus = ['APPROVED', 'PAID', 'PENDING'].includes(String(body.status))
            ? String(body.status)
            : 'APPROVED';
          await tx.$executeRawUnsafe(
            `UPDATE logistics_drayage_allowances
                SET status = $3,
                    approved_by = $4,
                    approved_at = NOW()
              WHERE id = $1 AND tenant_id = $2`,
            String(body.allowanceId),
            tenantId,
            newStatus,
            userId ?? 'Fleet Supervisor',
          );
          return { ok: true, status: newStatus };
        }

        case 'bulk_update_allowances': {
          const ids: string[] = Array.isArray(body.allowanceIds) ? body.allowanceIds.map(String) : [];
          const newStatus = ['APPROVED', 'PAID', 'PENDING'].includes(String(body.status))
            ? String(body.status)
            : 'APPROVED';
          for (const id of ids) {
            await tx.$executeRawUnsafe(
              `UPDATE logistics_drayage_allowances
                  SET status = $3,
                      approved_by = $4,
                      approved_at = NOW()
                WHERE id = $1 AND tenant_id = $2`,
              id,
              tenantId,
              newStatus,
              userId ?? 'Fleet Supervisor',
            );
          }
          return { ok: true, updatedCount: ids.length, status: newStatus };
        }

        case 'record_log': {
          return recordDrayageStatusLog(tx, {
            tenantId,
            jobId: String(body.jobId),
            jobCode: String(body.jobCode ?? 'DRY-JOB'),
            status: String(body.status ?? 'NOTE'),
            notes: String(body.notes ?? ''),
            actor: String(body.actor ?? 'Dispatch Console'),
          });
        }

        default:
          throw new Error(`Unsupported drayage action: ${action}`);
      }
    });

    // Invalidate workspace cache on any state-changing mutation
    workspaceCache.delete(tenantId);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[api/logistics/drayage POST]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Operation failed' },
      { status: 400 },
    );
  }
}
