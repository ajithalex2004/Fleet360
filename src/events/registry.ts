/**
 * Fleet360 Event Registry
 *
 * Single source of truth for all domain event types and their metadata.
 * Import event-type constants from here rather than from individual contract files.
 *
 * Adding a new event:
 *  1. Define its payload type in src/events/contracts/<domain>.events.ts
 *  2. Add an entry to FLEET360_EVENTS below
 *  3. Write a consumer in src/events/consumers/ and register it in initEventConsumers()
 */

import {
  TRIP_COMPLETED, TRIP_DEPARTED, TRIP_CANCELLED,
  TRIP_ARRIVING, TRIP_DELAYED,
  VEHICLE_CHANGED, DRIVER_CHANGED, BOARDING_MISSED,
} from '@/events/contracts/trip.events';
import { FUEL_FILLED }              from '@/events/contracts/fuel.events';
import {
  MAINTENANCE_COMPLETED,
  MAINTENANCE_REPAIR_COMPLETED,
  MAINTENANCE_QC_STARTED,
  MAINTENANCE_INSPECTION_FAILED,
  MAINTENANCE_VEHICLE_READY,
  MAINTENANCE_WORK_ORDER_COMPLETED,
  // Phase D
  MAINTENANCE_REQUESTED,
  MAINTENANCE_APPROVED,
  MAINTENANCE_REJECTED,
  MAINTENANCE_QUOTATION_REQUESTED,
  MAINTENANCE_QUOTATION_RECEIVED,
  MAINTENANCE_ESTIMATION_APPROVED,
  MAINTENANCE_WORK_ORDER_CREATED,
  MAINTENANCE_WORK_ORDER_STARTED,
  MAINTENANCE_PM_TRIGGERED,
  MAINTENANCE_WARRANTY_CLAIMED,
  // Phase E
  MAINTENANCE_BREAKDOWN_REPORTED,
  MAINTENANCE_RECOVERY_DISPATCHED,
  MAINTENANCE_RECOVERY_COMPLETED,
}                                   from '@/events/contracts/maintenance.events';
import { QUOTATION_APPROVED }       from '@/events/contracts/quotation.events';
import { SHIPMENT_CLOSED }          from '@/events/contracts/shipment.events';
import { RENTAL_INVOICE_GENERATED } from '@/events/contracts/rental-invoice.events';

export {
  TRIP_COMPLETED,
  TRIP_DEPARTED,
  TRIP_CANCELLED,
  TRIP_ARRIVING,
  TRIP_DELAYED,
  VEHICLE_CHANGED,
  DRIVER_CHANGED,
  BOARDING_MISSED,
  FUEL_FILLED,
  MAINTENANCE_COMPLETED,
  MAINTENANCE_REPAIR_COMPLETED,
  MAINTENANCE_QC_STARTED,
  MAINTENANCE_INSPECTION_FAILED,
  MAINTENANCE_VEHICLE_READY,
  MAINTENANCE_WORK_ORDER_COMPLETED,
  // Phase D
  MAINTENANCE_REQUESTED,
  MAINTENANCE_APPROVED,
  MAINTENANCE_REJECTED,
  MAINTENANCE_QUOTATION_REQUESTED,
  MAINTENANCE_QUOTATION_RECEIVED,
  MAINTENANCE_ESTIMATION_APPROVED,
  MAINTENANCE_WORK_ORDER_CREATED,
  MAINTENANCE_WORK_ORDER_STARTED,
  MAINTENANCE_PM_TRIGGERED,
  MAINTENANCE_WARRANTY_CLAIMED,
  // Phase E
  MAINTENANCE_BREAKDOWN_REPORTED,
  MAINTENANCE_RECOVERY_DISPATCHED,
  MAINTENANCE_RECOVERY_COMPLETED,
  QUOTATION_APPROVED,
  SHIPMENT_CLOSED,
  RENTAL_INVOICE_GENERATED,
};

// ── Registry ──────────────────────────────────────────────────────────────────

export interface EventRegistryEntry {
  /** Canonical event type string */
  type:          string;
  /** Source bounded context */
  sourceModule:  string;
  /** Domain aggregate type */
  aggregateType: string;
  /** Schema version */
  version:       string;
  description:   string;
}

export const FLEET360_EVENTS: EventRegistryEntry[] = [
  {
    type:          TRIP_COMPLETED,
    sourceModule:  'bus-ops',
    aggregateType: 'TripSchedule',
    version:       '1',
    description:   'A bus/school trip has been completed and a trip log written',
  },
  {
    type:          TRIP_DEPARTED,
    sourceModule:  'bus-ops',
    aggregateType: 'TripSchedule',
    version:       '1',
    description:   'A bus/school trip has departed — trip log created, no-shows auto-marked',
  },
  {
    type:          TRIP_CANCELLED,
    sourceModule:  'bus-ops',
    aggregateType: 'TripSchedule',
    version:       '1',
    description:   'A bus/school trip has been cancelled before departure',
  },
  {
    type:          TRIP_ARRIVING,
    sourceModule:  'bus-ops',
    aggregateType: 'TripSchedule',
    version:       '1',
    description:   'Bus is within N minutes of a stop / destination — published once per stop by the ETA evaluator',
  },
  {
    type:          TRIP_DELAYED,
    sourceModule:  'bus-ops',
    aggregateType: 'TripSchedule',
    version:       '1',
    description:   'Bus is running late beyond the delay tolerance — published at most once per stop',
  },
  {
    type:          VEHICLE_CHANGED,
    sourceModule:  'bus-ops',
    aggregateType: 'TripSchedule',
    version:       '1',
    description:   'Assigned vehicle on a scheduled trip swapped mid-trip or pre-departure',
  },
  {
    type:          DRIVER_CHANGED,
    sourceModule:  'bus-ops',
    aggregateType: 'TripSchedule',
    version:       '1',
    description:   'Assigned driver on a scheduled trip swapped mid-trip or pre-departure',
  },
  {
    type:          BOARDING_MISSED,
    sourceModule:  'bus-ops',
    aggregateType: 'TripPassenger',
    version:       '1',
    description:   'Bus left a stop without recording a BOARDED event for a still-CONFIRMED passenger',
  },
  {
    type:          FUEL_FILLED,
    sourceModule:  'fleet',
    aggregateType: 'FuelLog',
    version:       '1',
    description:   'A fuel-log entry has been created for a vehicle',
  },
  // ── Maintenance: existing ───────────────────────────────────────────────────
  {
    type:          MAINTENANCE_COMPLETED,
    sourceModule:  'maintenance',
    aggregateType: 'MaintenanceRequest',
    version:       '1',
    description:   'A maintenance request has been marked COMPLETED',
  },
  {
    type:          MAINTENANCE_REPAIR_COMPLETED,
    sourceModule:  'maintenance',
    aggregateType: 'MaintenanceRequest',
    version:       '1',
    description:   'Garage has marked repair done — QC inspection required',
  },
  {
    type:          MAINTENANCE_QC_STARTED,
    sourceModule:  'maintenance',
    aggregateType: 'MaintenanceRequest',
    version:       '1',
    description:   'Fleet QC inspector has begun reviewing the vehicle',
  },
  {
    type:          MAINTENANCE_INSPECTION_FAILED,
    sourceModule:  'maintenance',
    aggregateType: 'MaintenanceRequest',
    version:       '1',
    description:   'QC inspection failed — vehicle returned to garage for re-repair',
  },
  {
    type:          MAINTENANCE_VEHICLE_READY,
    sourceModule:  'maintenance',
    aggregateType: 'MaintenanceRequest',
    version:       '1',
    description:   'QC inspection passed — vehicle cleared for redeployment',
  },
  {
    type:          MAINTENANCE_WORK_ORDER_COMPLETED,
    sourceModule:  'maintenance',
    aggregateType: 'MaintenanceRequest',
    version:       '1',
    description:   'Garage has submitted their invoice — triggers AP payable + DRAFT JE in Finance',
  },
  // ── Maintenance: Phase D lifecycle ─────────────────────────────────────────
  {
    type:          MAINTENANCE_REQUESTED,
    sourceModule:  'maintenance',
    aggregateType: 'MaintenanceRequest',
    version:       '1',
    description:   'A new maintenance request has been submitted',
  },
  {
    type:          MAINTENANCE_APPROVED,
    sourceModule:  'maintenance',
    aggregateType: 'MaintenanceRequest',
    version:       '1',
    description:   'Fleet manager approved the maintenance request',
  },
  {
    type:          MAINTENANCE_REJECTED,
    sourceModule:  'maintenance',
    aggregateType: 'MaintenanceRequest',
    version:       '1',
    description:   'Fleet manager rejected the maintenance request',
  },
  {
    type:          MAINTENANCE_QUOTATION_REQUESTED,
    sourceModule:  'maintenance',
    aggregateType: 'MaintenanceRequest',
    version:       '1',
    description:   'Request sent to garage for quotation',
  },
  {
    type:          MAINTENANCE_QUOTATION_RECEIVED,
    sourceModule:  'maintenance',
    aggregateType: 'MaintenanceRequest',
    version:       '1',
    description:   'Garage submitted a quotation — awaiting cost approval',
  },
  {
    type:          MAINTENANCE_ESTIMATION_APPROVED,
    sourceModule:  'maintenance',
    aggregateType: 'MaintenanceRequest',
    version:       '1',
    description:   'Fleet manager approved the cost estimate — Finance creates DRAFT AP accrual',
  },
  {
    type:          MAINTENANCE_WORK_ORDER_CREATED,
    sourceModule:  'maintenance',
    aggregateType: 'MaintenanceRequest',
    version:       '1',
    description:   'A work order has been created for this maintenance request',
  },
  {
    type:          MAINTENANCE_WORK_ORDER_STARTED,
    sourceModule:  'maintenance',
    aggregateType: 'MaintenanceRequest',
    version:       '1',
    description:   'Garage has started work — vehicle is under repair',
  },
  {
    type:          MAINTENANCE_PM_TRIGGERED,
    sourceModule:  'maintenance',
    aggregateType: 'MaintenancePlan',
    version:       '1',
    description:   'PM engine triggered maintenance requests for scheduled vehicles',
  },
  {
    type:          MAINTENANCE_WARRANTY_CLAIMED,
    sourceModule:  'maintenance',
    aggregateType: 'WarrantyClaim',
    version:       '1',
    description:   'A warranty claim has been raised against a vehicle warranty',
  },
  // ── Maintenance: Phase E — Breakdown ───────────────────────────────────────
  {
    type:          MAINTENANCE_BREAKDOWN_REPORTED,
    sourceModule:  'maintenance',
    aggregateType: 'BreakdownReport',
    version:       '1',
    description:   'Driver reported a vehicle breakdown — auto-creates a BREAKDOWN maintenance request',
  },
  {
    type:          MAINTENANCE_RECOVERY_DISPATCHED,
    sourceModule:  'maintenance',
    aggregateType: 'BreakdownReport',
    version:       '1',
    description:   'A recovery vehicle has been dispatched to the breakdown location',
  },
  {
    type:          MAINTENANCE_RECOVERY_COMPLETED,
    sourceModule:  'maintenance',
    aggregateType: 'BreakdownReport',
    version:       '1',
    description:   'Recovery complete — breakdown vehicle delivered to workshop',
  },
  // ── Other modules ───────────────────────────────────────────────────────────
  {
    type:          QUOTATION_APPROVED,
    sourceModule:  'maintenance',
    aggregateType: 'Quotation',
    version:       '1',
    description:   'A garage quotation has been approved — triggers AP payable + DRAFT JE',
  },
  {
    type:          SHIPMENT_CLOSED,
    sourceModule:  'logistics',
    aggregateType: 'ShipmentOrder',
    version:       '1',
    description:   'A logistics shipment has been closed — triggers AR invoice in finance',
  },
  {
    type:          RENTAL_INVOICE_GENERATED,
    sourceModule:  'rental',
    aggregateType: 'RentalInvoice',
    version:       '1',
    description:   'A rental invoice has been generated — mirrors AR receivable to finance',
  },
];

export const EVENT_TYPE_MAP = new Map<string, EventRegistryEntry>(
  FLEET360_EVENTS.map(e => [e.type, e]),
);
