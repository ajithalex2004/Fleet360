export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { ensureFleetSchema } from '@/lib/fleet/schema';
import { revalidateCache } from '@/lib/server-cache';
import { recordLifecycleEvent } from '@/lib/fleet/lifecycle-events';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';

const FLEET_STATS_TAG = 'fleet:stats';

const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const rowToCamel = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));

let schemaEnsured = false;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  if (!schemaEnsured) {
    await ensureFleetSchema().catch(() => {});
    schemaEnsured = true;
  }
  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const { id } = await params;
      const [rows, lastPing] = await Promise.all([
        tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT v.*,
                  vt.name AS vehicle_type_name,
                  vt.vehicle_group,
                  vt.vehicle_class,
                  vt.num_passengers,
                  vt.fuel_type,
                  vt.transmission_type,
                  z.name AS zone_name,
                  COALESCE(NULLIF(d.name, ''), TRIM(CONCAT(COALESCE(d.first_name, ''), ' ', COALESCE(d.last_name, '')))) AS assigned_driver_name,
                  d.contact_number AS assigned_driver_phone
           FROM vehicles v
           LEFT JOIN vehicle_types vt ON vt.id::text = v.vehicle_type_id
           LEFT JOIN spatial.places z ON z.id = v.zone_id
           LEFT JOIN drivers d ON d.id::text = v.assigned_driver_id::text
           WHERE v.id = $1 AND v.deleted_at IS NULL`,
          id,
        ),
        tx.busGpsPing.findFirst({
          where: { vehicleId: id },
          orderBy: { occurredAt: 'desc' },
          select: {
            latitude: true,
            longitude: true,
            speedKmh: true,
            headingDeg: true,
            accuracyM: true,
            occurredAt: true,
            source: true,
          },
        }).catch(() => null),
      ]);

      if (rows.length === 0) {
        return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
      }

      const vehicleData = rowToCamel(rows[0]);
      return NextResponse.json({
        ...vehicleData,
        lastPing: lastPing ? {
          ...lastPing,
          occurredAt: lastPing.occurredAt.toISOString(),
        } : null,
      });
    } catch (e) {
      console.error('Error fetching vehicle:', e);
      return NextResponse.json({ error: 'Failed to fetch vehicle' }, { status: 500 });
    }
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  await ensureFleetSchema();
  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const { id } = await params;
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);

      // Fetch previous state for lifecycle delta tracking
      const prevRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT id, status, lifecycle_stage, assigned_driver_id, odometer_reading, device_id, sim_card_no FROM vehicles WHERE id = $1`,
        id,
      );
      const prev = prevRows[0] || null;

      const fieldMap: Record<string, string> = {
        vehicleCode: 'vehicle_code',
        make: 'make',
        model: 'model',
        type: 'type',
        year: 'year',
        vin: 'vin',
        chassisNo: 'chassis_no',
        color: 'color',
        yearOfManufacture: 'year_of_manufacture',
        licensePlate: 'license_plate',
        registrationNo: 'registration_no',
        plateNumber: 'plate_number',
        plateCode: 'plate_code',
        plateCategory: 'plate_category',
        emirate: 'emirate',
        vehicleTypeId: 'vehicle_type_id',
        vehicleUsage: 'vehicle_usage',
        hierarchyId: 'hierarchy_id',
        hierarchyName: 'hierarchy_name',
        regionId: 'region_id',
        regionName: 'region_name',
        departmentId: 'department_id',
        departmentName: 'department_name',
        unitId: 'unit_id',
        unitName: 'unit_name',
        branchId: 'branch_id',
        branchName: 'branch_name',
        zoneId: 'zone_id',
        deviceId: 'device_id',
        simCardNo: 'sim_card_no',
        stopModeCommFrequency: 'stop_mode_comm_frequency',
        lifecycleStage: 'lifecycle_stage',
        purchaseDate: 'purchase_date',
        purchasePrice: 'purchase_price',
        acquisitionType: 'acquisition_type',
        odometerReading: 'odometer_reading',
        fuelLevel: 'fuel_level',
        assignedDriverId: 'assigned_driver_id',
        status: 'status',
        notes: 'notes',
        category: 'category',
        registrationExpiryDate: 'registration_expiry',
        insuranceExpiryDate: 'insurance_expiry',
        registrationExpiry: 'registration_expiry',
        insuranceExpiry: 'insurance_expiry',
        mulkiyaExpiry: 'mulkiya_expiry',
      };

      const dateFields = new Set([
        'purchaseDate',
        'registrationExpiryDate',
        'insuranceExpiryDate',
        'registrationExpiry',
        'insuranceExpiry',
        'mulkiyaExpiry',
      ]);

      const setClauses: string[] = [];
      const queryParams: unknown[] = [new Date()];
      setClauses.push(`updated_at = $1`);

      const assignedColumns = new Set<string>();
      for (const [camelKey, snakeKey] of Object.entries(fieldMap)) {
        if (assignedColumns.has(snakeKey)) continue;
        if (Object.prototype.hasOwnProperty.call(body, camelKey)) {
          let val = body[camelKey];
          // If this key is empty but an alias has value, prefer the non-empty one
          if (!val) {
            if (camelKey === 'registrationExpiryDate' && body.registrationExpiry) val = body.registrationExpiry;
            if (camelKey === 'registrationExpiry' && body.registrationExpiryDate) val = body.registrationExpiryDate;
            if (camelKey === 'insuranceExpiryDate' && body.insuranceExpiry) val = body.insuranceExpiry;
            if (camelKey === 'insuranceExpiry' && body.insuranceExpiryDate) val = body.insuranceExpiryDate;
          }
          if (dateFields.has(camelKey)) {
            if (val) {
              const parsedDate = new Date(val);
              val = isNaN(parsedDate.getTime()) ? null : parsedDate;
            } else {
              val = null;
            }
          }
          assignedColumns.add(snakeKey);
          queryParams.push(val);
          setClauses.push(`${snakeKey} = $${queryParams.length}`);
        }
      }

      queryParams.push(id);
      const idParam = queryParams.length;

      const rows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `UPDATE vehicles SET ${setClauses.join(', ')} WHERE id = $${idParam} AND deleted_at IS NULL RETURNING *`,
        ...queryParams,
      );

      if (rows.length === 0) {
        return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
      }

      // Automatically capture lifecycle events for key operational state transitions
      if (prev) {
        if (body.lifecycleStage && body.lifecycleStage !== prev.lifecycle_stage) {
          await recordLifecycleEvent(tx, {
            vehicleId: id,
            eventType: 'STAGE_TRANSITION',
            fromStage: (prev.lifecycle_stage as string) || null,
            toStage: body.lifecycleStage,
            description: `Lifecycle stage transitioned from ${prev.lifecycle_stage || 'INITIAL'} to ${body.lifecycleStage}`,
            performedBy: 'Fleet Master Update',
          }).catch(() => {});
        }
        if (body.status && body.status !== prev.status) {
          await recordLifecycleEvent(tx, {
            vehicleId: id,
            eventType: 'STATUS_CHANGE',
            description: `Operational status updated from ${prev.status || 'UNKNOWN'} to ${body.status}`,
            performedBy: 'Fleet Master Update',
          }).catch(() => {});
        }
        if (body.assignedDriverId !== undefined && body.assignedDriverId !== prev.assigned_driver_id) {
          // Keep Driver.assignedVehicleId synchronized bidirectionally
          if (prev.assigned_driver_id) {
            await tx.$executeRawUnsafe(
              `UPDATE drivers SET assigned_vehicle_id = NULL WHERE id::text = $1 AND tenant_id = $2`,
              prev.assigned_driver_id,
              tenantId,
            ).catch(() => {});
          }
          if (body.assignedDriverId) {
            // Clear any other driver that had this vehicle
            await tx.$executeRawUnsafe(
              `UPDATE drivers SET assigned_vehicle_id = NULL WHERE assigned_vehicle_id::text = $1 AND id::text != $2 AND tenant_id = $3`,
              id,
              body.assignedDriverId,
              tenantId,
            ).catch(() => {});
            // Set the new driver's assigned vehicle
            await tx.$executeRawUnsafe(
              `UPDATE drivers SET assigned_vehicle_id = $1 WHERE id::text = $2 AND tenant_id = $3`,
              id,
              body.assignedDriverId,
              tenantId,
            ).catch(() => {});
          } else {
            // Unassigning: clear any driver assigned to this vehicle
            await tx.$executeRawUnsafe(
              `UPDATE drivers SET assigned_vehicle_id = NULL WHERE assigned_vehicle_id::text = $1 AND tenant_id = $2`,
              id,
              tenantId,
            ).catch(() => {});
          }

          await recordLifecycleEvent(tx, {
            vehicleId: id,
            eventType: 'DRIVER_ALLOCATION',
            description: body.assignedDriverId
              ? `Vehicle assigned to driver (ID: ${body.assignedDriverId})`
              : 'Driver unassigned from vehicle',
            performedBy: 'Fleet Master Update',
          }).catch(() => {});
        }
        if (body.odometerReading !== undefined && body.odometerReading !== null && Number(body.odometerReading) !== Number(prev.odometer_reading)) {
          await recordLifecycleEvent(tx, {
            vehicleId: id,
            eventType: 'ODOMETER_UPDATE',
            description: `Odometer reading updated to ${Number(body.odometerReading).toLocaleString()} km (prev: ${Number(prev.odometer_reading || 0).toLocaleString()} km)`,
            metadata: { prev: prev.odometer_reading, current: body.odometerReading },
            performedBy: 'Fleet Master Update',
          }).catch(() => {});
        }
        if (body.deviceId !== undefined && body.deviceId !== prev.device_id) {
          await recordLifecycleEvent(tx, {
            vehicleId: id,
            eventType: body.deviceId ? 'DEVICE_PAIRING' : 'DEVICE_UNPAIRED',
            description: body.deviceId
              ? `Hardware GPS device paired: ${body.deviceId}${body.simCardNo ? ` (SIM: ${body.simCardNo})` : ''}`
              : 'Hardware GPS device unlinked',
            metadata: { deviceId: body.deviceId, simCardNo: body.simCardNo },
            performedBy: 'Fleet Master Update',
          }).catch(() => {});
        }
      }

      revalidateCache([FLEET_STATS_TAG]);
      return NextResponse.json(rowToCamel(rows[0]));
    } catch (e) {
      console.error('Error updating vehicle:', e);
      return NextResponse.json({ error: 'Failed to update vehicle' }, { status: 500 });
    }
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  await ensureFleetSchema();
  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const { id } = await params;
      await tx.$executeRawUnsafe(
        `UPDATE vehicles SET deleted_at = NOW() WHERE id = $1`,
        id,
      );

      // Record decommissioned lifecycle event
      await recordLifecycleEvent(tx, {
        vehicleId: id,
        eventType: 'DECOMMISSIONED',
        description: 'Vehicle decommissioned / archived from active fleet',
        performedBy: 'Fleet Master Removal',
      }).catch(() => {});

      revalidateCache([FLEET_STATS_TAG]);
      return NextResponse.json({ success: true });
    } catch (e) {
      console.error('Error deleting vehicle:', e);
      return NextResponse.json({ error: 'Failed to delete vehicle' }, { status: 500 });
    }
  });
}
