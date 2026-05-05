/**
 * @gravity/agent-sdk — Universal Platform Adapter
 * --------------------------------------------------
 * Normalises events from different fleet platforms into the standard AgentEvent format.
 * Extend with your platform's data shape.
 *
 * Usage:
 *   import { UniversalAdapter } from '@gravity/agent-sdk';
 *
 *   const adapter = new UniversalAdapter({ tenantId: 'your-org', apiKey: 'key' });
 *
 *   // Fleetio-style vehicle event
 *   const event = adapter.fromFleetioVehicle({ vehicle_id: 'abc', mileage: 50000 });
 *
 *   // Samsara telematics event
 *   const event = adapter.fromSamsara({ vehicleId: 'abc', odometerMeters: 50000000 });
 *
 *   // Generic event builder
 *   const event = adapter.build('predictive-maintenance', 'vehicle.odometer_updated', 'vehicle-id');
 */

import type { AgentEvent, AgentId, AgentEventType } from './types';

export interface AdapterConfig {
  tenantId: string;
  apiKey?: string;
}

export class UniversalAdapter {
  private tenantId: string;
  private apiKey?: string;

  constructor(config: AdapterConfig) {
    this.tenantId = config.tenantId;
    this.apiKey   = config.apiKey;
  }

  /** Generic event builder — use when your platform has a custom data shape. */
  build(
    agentId:    AgentId,
    eventType:  AgentEventType,
    entityId?:  string,
    payload?:   Record<string, unknown>,
    callbackUrl?: string,
  ): AgentEvent {
    return {
      tenant_id:  this.tenantId,
      agent_id:   agentId,
      event_type: eventType,
      entity_id:  entityId,
      payload,
      callback_url: callbackUrl,
      api_key:    this.apiKey,
    };
  }

  // ── Platform-specific adapters ─────────────────────────────────────────────

  /** Samsara telematics — vehicle location + odometer update */
  fromSamsara(data: {
    vehicleId: string;
    odometerMeters?: number;
    engineHours?: number;
    faultCodes?: string[];
  }): AgentEvent {
    return this.build(
      'predictive-maintenance',
      'vehicle.odometer_updated',
      data.vehicleId,
      {
        odometer_km:    data.odometerMeters ? data.odometerMeters / 1000 : undefined,
        engine_hours:   data.engineHours,
        fault_codes:    data.faultCodes ?? [],
        source:         'samsara',
      },
    );
  }

  /** Fleetio — vehicle service record */
  fromFleetioService(data: {
    vehicle_id: string;
    service_type?: string;
    mileage?: number;
    completed_at?: string;
  }): AgentEvent {
    return this.build(
      'predictive-maintenance',
      'vehicle.work_order_created',
      data.vehicle_id,
      {
        wo_type:     data.service_type,
        odometer:    data.mileage,
        completed_at: data.completed_at,
        source:      'fleetio',
      },
    );
  }

  /** Geotab — fuel transaction */
  fromGeotabFuel(data: {
    deviceId: string;
    litres: number;
    pricePer: number;
    odometer?: number;
  }): AgentEvent {
    return this.build(
      'predictive-maintenance',
      'vehicle.fuel_log_added',
      data.deviceId,
      {
        quantity_litres: data.litres,
        price_per_litre: data.pricePer,
        odometer:        data.odometer,
        source:          'geotab',
      },
    );
  }

  /** Generic ERP/TMS booking created */
  fromBookingCreated(data: {
    bookingId: string;
    serviceType: string;
    pickupLat?: number;
    pickupLng?: number;
    vehicleType?: string;
    scheduledAt?: string;
    priority?: string;
  }): AgentEvent {
    return this.build(
      'dispatch-optimiser',
      'dispatch.job_created',
      data.bookingId,
      {
        service_type: data.serviceType,
        pickup_lat:   data.pickupLat,
        pickup_lng:   data.pickupLng,
        vehicle_type: data.vehicleType,
        scheduled_at: data.scheduledAt,
        priority:     data.priority ?? 'NORMAL',
        source:       'erp',
      },
    );
  }

  /** Emergency incident reported */
  fromIncidentCreated(data: {
    incidentId: string;
    type: string;
    severity: string;
    description?: string;
    location?: string;
    injuriesReported?: boolean;
  }): AgentEvent {
    return this.build(
      'incident-triage',
      'incident.created',
      data.incidentId,
      {
        incident_type:      data.type,
        severity:           data.severity,
        description:        data.description,
        location:           data.location,
        injuries_reported:  data.injuriesReported,
        source:             'platform',
      },
    );
  }

  /** Route updated — trigger re-optimisation */
  fromRouteUpdated(data: {
    routeId: string;
    stopCount?: number;
    changeType?: 'stop_added' | 'stop_removed' | 'reorder';
  }): AgentEvent {
    const eventType: AgentEventType = data.changeType === 'stop_added' ? 'stop.added'
      : data.changeType === 'stop_removed' ? 'stop.removed'
      : 'route.updated';

    return this.build(
      'route-optimiser',
      eventType,
      data.routeId,
      { stop_count: data.stopCount, change_type: data.changeType },
    );
  }

  /** Week-end trigger for driver coaching */
  fromWeekEnd(driverId?: string): AgentEvent {
    return this.build(
      'driver-coach',
      'driver.week_end',
      driverId,
      { week: new Date().toISOString().slice(0, 10) },
    );
  }
}
