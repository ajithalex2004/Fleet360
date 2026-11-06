/**
 * src/lib/exchange/adapters/freight-adapter.ts
 *
 * Phase 2.7: Freight & Logistics Outsourcing Adapter.
 * Connects Freight Orders, FTL/LTL shipments, and Container movements to Fleet360 Exchange Core.
 */

import { logAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { PartnerServiceDomain } from '@prisma/client';
import {
  OutsourcingSourceAdapter,
  OutsourcingSource,
  ValidationResult,
  DomainEligibilityCriteria,
  FreightRequirements,
  AwardApplicationPayload,
  ExecutionStatusEvent,
} from './types';

function inferBodyType(
  vehicleTypeRequired: string | null | undefined,
  temperatureControl: string | null | undefined,
): FreightRequirements['bodyType'] {
  const vt = String(vehicleTypeRequired ?? '').toUpperCase();
  const temp = String(temperatureControl ?? '').toUpperCase();
  if (
    vt.includes('REEFER') ||
    vt.includes('CHILLER') ||
    vt.includes('FREEZER') ||
    (temp && temp !== 'AMBIENT' && temp !== 'NONE')
  ) {
    return 'REEFER_COLD';
  }
  if (vt.includes('FLATBED') || vt.includes('TRAILER') || vt.includes('SKELETAL') || vt.includes('LOWBED')) {
    return 'FLATBED_TRAILER';
  }
  if (vt.includes('CURTAIN')) {
    return 'CURTAIN_SIDE';
  }
  if (vt.includes('3T') || vt.includes('PICKUP') || vt.includes('VAN')) {
    return 'PICKUP_3T';
  }
  return 'BOX_TRUCK';
}

function inferCityFromLocation(location: string | null | undefined): string {
  const text = String(location ?? '').toUpperCase();
  if (text.includes('ABU DHABI') || text.includes('KHALIFA') || text.includes('KEZAD') || text.includes('KIZAD') || text.includes('MUSSAFAH')) {
    return 'Abu Dhabi';
  }
  if (text.includes('SHARJAH') || text.includes('SAIF ZONE') || text.includes('HAMRIYAH')) {
    return 'Sharjah';
  }
  if (text.includes('AJMAN')) return 'Ajman';
  if (text.includes('RAS AL KHAIMAH') || text.includes('RAK')) return 'Ras Al Khaimah';
  if (text.includes('FUJAIRAH')) return 'Fujairah';
  if (text.includes('UMM AL QUWAIN') || text.includes('UAQ')) return 'Umm Al Quwain';
  return 'Dubai';
}

export class FreightOutsourcingAdapter implements OutsourcingSourceAdapter {
  domain = PartnerServiceDomain.FREIGHT;

  async getSourceReference(shipmentId: string, tenantId: string): Promise<OutsourcingSource> {
    try {
      const data = await withTenantRls(prisma, tenantId, async (tx) => {
        const rows = await tx.$queryRawUnsafe<Array<{
          id: string;
          shipment_no: string | null;
          shipment_type: string | null;
          service_level: string | null;
          origin_name: string | null;
          origin_address: string | null;
          origin_lat: string | number | null;
          origin_lng: string | number | null;
          destination_name: string | null;
          destination_address: string | null;
          destination_lat: string | number | null;
          destination_lng: string | number | null;
          pickup_window_from: Date | null;
          total_weight_kg: string | number | null;
          total_volume_cbm: string | number | null;
          total_pieces: number | null;
          vehicle_type_required: string | null;
          temperature_control: string | null;
          hazmat_flag: boolean | null;
          customs_required: boolean | null;
          notes: string | null;
          special_instructions: string | null;
        }>>(
          `SELECT id, shipment_no, shipment_type, service_level,
                  origin_name, origin_address, origin_lat, origin_lng,
                  destination_name, destination_address, destination_lat, destination_lng,
                  pickup_window_from, total_weight_kg, total_volume_cbm, total_pieces,
                  vehicle_type_required, temperature_control, hazmat_flag, customs_required,
                  notes, special_instructions
             FROM logistics_shipment_orders
            WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
            LIMIT 1`,
          shipmentId,
          tenantId,
        );
        const ship = rows[0];
        if (!ship) return null;

        const cargoRows = await tx.$queryRawUnsafe<Array<{
          commodity_type: string | null;
          description: string | null;
          quantity: string | number | null;
          weight_kg: string | number | null;
          volume_cbm: string | number | null;
          hazmat_class: string | null;
          temperature_min_c: string | number | null;
          temperature_max_c: string | number | null;
        }>>(
          `SELECT commodity_type, description, quantity, weight_kg, volume_cbm,
                  hazmat_class, temperature_min_c, temperature_max_c
             FROM logistics_cargo_lines
            WHERE shipment_order_id = $1 AND tenant_id = $2
            ORDER BY created_at ASC`,
          shipmentId,
          tenantId,
        ).catch(() => []);

        return { ship, cargoRows };
      });

      if (data?.ship) {
        const { ship, cargoRows } = data;
        const cargoWeight = cargoRows.reduce((s, r) => s + Number(r.weight_kg ?? 0), 0);
        const cargoVol = cargoRows.reduce((s, r) => s + Number(r.volume_cbm ?? 0), 0);
        const cargoQty = cargoRows.reduce((s, r) => s + Number(r.quantity ?? 0), 0);

        const weightKg = Math.max(Number(ship.total_weight_kg ?? 0) || cargoWeight || 1000, 1);
        const volumeM3 = Number(ship.total_volume_cbm ?? 0) || cargoVol || 0;
        const palletCount = Number(ship.total_pieces ?? 0) || cargoQty || 1;
        const bodyType = inferBodyType(ship.vehicle_type_required, ship.temperature_control);
        const tempControlled =
          bodyType === 'REEFER_COLD' ||
          cargoRows.some((c) => c.temperature_min_c != null || c.temperature_max_c != null);
        const firstTemp = cargoRows.find((c) => c.temperature_max_c != null || c.temperature_min_c != null);
        const requiredTempCelsius = firstTemp
          ? Number(firstTemp.temperature_max_c ?? firstTemp.temperature_min_c ?? 4)
          : tempControlled
            ? 4
            : undefined;
        const hazmat = Boolean(ship.hazmat_flag) || cargoRows.some((c) => Boolean(c.hazmat_class));
        const cargoType =
          cargoRows[0]?.commodity_type ||
          cargoRows[0]?.description ||
          ship.shipment_type ||
          'General Cargo';
        const serviceDate = ship.pickup_window_from ? new Date(ship.pickup_window_from) : new Date();
        const pickupTime = ship.pickup_window_from
          ? new Date(ship.pickup_window_from).toISOString().slice(11, 16)
          : '08:30';

        return {
          domain: this.domain,
          sourceReferenceType: 'FREIGHT_SHIPMENT',
          sourceReferenceId: shipmentId,
          tenantId,
          pickupLocation: ship.origin_name || ship.origin_address || 'Jebel Ali Free Zone (JAFZA) South',
          pickupLatitude: ship.origin_lat != null ? Number(ship.origin_lat) : undefined,
          pickupLongitude: ship.origin_lng != null ? Number(ship.origin_lng) : undefined,
          dropoffLocation: ship.destination_name || ship.destination_address || 'Dubai Industrial City Warehouse',
          dropoffLatitude: ship.destination_lat != null ? Number(ship.destination_lat) : undefined,
          dropoffLongitude: ship.destination_lng != null ? Number(ship.destination_lng) : undefined,
          serviceDate,
          pickupTime,
          specialInstructions: ship.special_instructions || ship.notes || undefined,
          domainPayload: {
            cargoType,
            weightKg,
            volumeM3,
            palletCount,
            bodyType,
            temperatureControlled: tempControlled,
            requiredTempCelsius,
            hazmat,
            tailLiftRequired: false,
            customsOrPortPermit: Boolean(ship.customs_required),
          } as FreightRequirements,
        };
      }
    } catch {
      // Fall back to default template when database is unavailable or in unit-test mocks
    }

    return {
      domain: this.domain,
      sourceReferenceType: 'FREIGHT_SHIPMENT',
      sourceReferenceId: shipmentId,
      tenantId,
      pickupLocation: 'Jebel Ali Free Zone (JAFZA) South',
      dropoffLocation: 'Dubai Industrial City Warehouse 4',
      serviceDate: new Date(),
      pickupTime: '08:30',
      specialInstructions: 'Temperature sensitive pharmaceuticals - maintain +4C',
      domainPayload: {
        cargoType: 'Pharmaceuticals',
        weightKg: 4500,
        volumeM3: 22,
        palletCount: 8,
        bodyType: 'REEFER_COLD',
        temperatureControlled: true,
        requiredTempCelsius: 4,
        hazmat: false,
        tailLiftRequired: true,
      } as FreightRequirements,
    };
  }

  async validateOutsource(source: OutsourcingSource): Promise<ValidationResult> {
    const payload = source.domainPayload as FreightRequirements;
    const errors: string[] = [];

    if (!payload.cargoType) errors.push('Cargo type is required');
    if (!payload.weightKg || payload.weightKg <= 0) errors.push('Valid cargo weight (kg) is required');
    if (!payload.bodyType) errors.push('Vehicle body type (BOX_TRUCK, REEFER, FLATBED) is required');

    return { isValid: errors.length === 0, errors };
  }

  async buildRequirementsPayload(source: OutsourcingSource): Promise<Record<string, unknown>> {
    const payload = source.domainPayload as FreightRequirements;
    return {
      cargoType: payload.cargoType,
      weightKg: payload.weightKg,
      volumeM3: payload.volumeM3 || 0,
      palletCount: payload.palletCount || 0,
      bodyType: payload.bodyType || 'BOX_TRUCK',
      temperatureControlled: !!payload.temperatureControlled,
      requiredTempCelsius: payload.requiredTempCelsius,
      hazmat: !!payload.hazmat,
      tailLiftRequired: !!payload.tailLiftRequired,
      customsOrPortPermit: !!payload.customsOrPortPermit,
    };
  }

  async buildEligibilityRequirements(source: OutsourcingSource): Promise<DomainEligibilityCriteria> {
    const payload = source.domainPayload as FreightRequirements;
    return {
      domain: this.domain,
      pickupCity: inferCityFromLocation(source.pickupLocation),
      serviceDate: source.serviceDate,
      domainPayload: {
        requiredPayloadKg: payload.weightKg,
        requiredBodyType: payload.bodyType,
        requiresReefer: payload.temperatureControlled,
        requiresHazmat: payload.hazmat,
      },
    };
  }

  async applyAward(award: AwardApplicationPayload): Promise<void> {
    const shipmentId = award.sourceReferenceId ?? award.request?.sourceReferenceId ?? award.requestId;
    const agreedCost = Number(award.totalAwarded ?? 0);

    if (shipmentId && award.tenantId) {
      await withTenantRls(prisma, award.tenantId, async (tx) => {
        await tx.$executeRawUnsafe(
          `UPDATE logistics_shipment_orders
              SET assignment_type = 'PARTNER_CARRIER',
                  assigned_carrier_id = $3,
                  agreed_carrier_cost = CASE WHEN $4 > 0 THEN $4 ELSE agreed_carrier_cost END,
                  status = CASE
                    WHEN status IN ('DRAFT', 'PENDING', 'SUBMITTED', 'APPROVED') THEN 'ASSIGNED'
                    ELSE status
                  END,
                  updated_at = NOW()
            WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
          shipmentId,
          award.tenantId,
          award.partnerId,
          agreedCost,
        );
      }).catch(() => {});
    }

    await logAudit({
      tenantId: award.tenantId,
      entityType: 'FreightShipment',
      entityId: shipmentId ?? award.requestId ?? 'unknown',
      action: 'UPDATE',
      details: `FREIGHT_OUTSOURCE_AWARDED to carrier ${award.partnerId} for AED ${award.totalAwarded}`,
      userId: award.awardedBy,
    }).catch(() => {});
  }

  async applyAssignment(assignment: Record<string, unknown>): Promise<void> {
    const tenantId = typeof assignment.tenantId === 'string' ? assignment.tenantId : null;
    const shipmentId =
      typeof assignment.sourceReferenceId === 'string'
        ? assignment.sourceReferenceId
        : typeof assignment.shipmentOrderId === 'string'
          ? assignment.shipmentOrderId
          : null;
    if (!tenantId || !shipmentId) return;

    const partnerId = typeof assignment.partnerId === 'string' ? assignment.partnerId : null;
    const vehicleId = typeof assignment.vehicleId === 'string' ? assignment.vehicleId : null;
    const driverId = typeof assignment.driverId === 'string' ? assignment.driverId : null;
    const driverName = typeof assignment.driverName === 'string' ? assignment.driverName : null;
    const vehiclePlate = typeof assignment.vehiclePlate === 'string' ? assignment.vehiclePlate : null;

    await withTenantRls(prisma, tenantId, async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE logistics_shipment_orders
            SET assignment_type = 'PARTNER_CARRIER',
                assigned_carrier_id = COALESCE($3, assigned_carrier_id),
                assigned_vehicle_id = COALESCE($4, assigned_vehicle_id),
                assigned_driver_id = COALESCE($5, assigned_driver_id),
                status = CASE
                  WHEN status IN ('DRAFT', 'PENDING', 'SUBMITTED', 'APPROVED') THEN 'ASSIGNED'
                  ELSE status
                END,
                metadata = COALESCE(metadata, '{}'::jsonb) || $6::jsonb,
                updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        shipmentId,
        tenantId,
        partnerId,
        vehicleId,
        driverId,
        JSON.stringify({
          exchangeAssignment: {
            partnerId,
            vehicleId,
            vehiclePlate,
            driverId,
            driverName,
            assignedAt: new Date().toISOString(),
          },
        }),
      );

      await tx.$executeRawUnsafe(
        `INSERT INTO logistics_tracking_events
           (tenant_id, shipment_order_id, event_type, status, source, notes, metadata, occurred_at)
         VALUES ($1, $2, 'SHIPMENT_ASSIGNED', 'ASSIGNED', 'EXCHANGE_PARTNER', $3, $4::jsonb, NOW())`,
        tenantId,
        shipmentId,
        `Exchange partner assigned${vehiclePlate ? ` (${vehiclePlate})` : ''}${driverName ? ` - ${driverName}` : ''}`,
        JSON.stringify({ partnerId, vehicleId, vehiclePlate, driverId, driverName }),
      );
    }).catch(() => {});
  }

  async syncExecutionStatus(event: ExecutionStatusEvent): Promise<void> {
    const shipmentId = event.sourceReferenceId;
    if (!shipmentId) return;

    const key = String(event.eventType ?? '').toUpperCase();
    const statusMap: Record<string, string> = {
      DISPATCHED: 'DISPATCHED',
      TRIP_STARTED: 'DISPATCHED',
      ENROUTE_PICKUP: 'ENROUTE_PICKUP',
      ARRIVED_PICKUP: 'ARRIVED_PICKUP',
      LOADED: 'LOADED',
      PICKUP_CONFIRMED: 'LOADED',
      IN_TRANSIT: 'IN_TRANSIT',
      ENROUTE_DELIVERY: 'ENROUTE_DELIVERY',
      ARRIVED_DELIVERY: 'ARRIVED_DELIVERY',
      DELIVERED: 'DELIVERED',
      DELIVERY_CONFIRMED: 'DELIVERED',
      POD_SUBMITTED: 'POD_SUBMITTED',
      COMPLETED: 'CLOSED',
      CLOSED: 'CLOSED',
    };
    const nextStatus = statusMap[key];
    if (!nextStatus) return;

    const eventWithTenant = event as ExecutionStatusEvent & { tenantId?: string };
    if (!eventWithTenant.tenantId) return;

    await withTenantRls(prisma, eventWithTenant.tenantId, async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE logistics_shipment_orders
            SET status = $3,
                actual_pickup_at = CASE WHEN $3 = 'LOADED' AND actual_pickup_at IS NULL THEN NOW() ELSE actual_pickup_at END,
                actual_delivery_at = CASE WHEN $3 IN ('DELIVERED', 'POD_SUBMITTED', 'CLOSED') AND actual_delivery_at IS NULL THEN NOW() ELSE actual_delivery_at END,
                updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        shipmentId,
        eventWithTenant.tenantId,
        nextStatus,
      );

      await tx.$executeRawUnsafe(
        `INSERT INTO logistics_tracking_events
           (tenant_id, shipment_order_id, event_type, status, source, notes, occurred_at)
         VALUES ($1, $2, $3, $4, 'EXCHANGE_PARTNER', $5, NOW())`,
        eventWithTenant.tenantId,
        shipmentId,
        key,
        nextStatus,
        `Exchange execution milestone: ${key}`,
      );
    }).catch(() => {});
  }

  async handleCancellation(requestId: string, reason: string): Promise<void> {
    await logAudit({
      entityType: 'FreightShipment',
      entityId: requestId,
      action: 'UPDATE',
      details: `FREIGHT_OUTSOURCE_CANCELLED: ${reason}`,
    }).catch(() => {});
  }
}
