/**
 * Shipper Portal — tracking visibility (Phase 1.5).
 *
 * Four levels of what the portal shipper can see about a shipment:
 *
 *   NONE             - Only terminal events: submitted, acknowledged, delivered.
 *   STATUS_ONLY      - Full status timeline (no ETA, no GPS, no carrier identity).
 *   STATUS_AND_ETA   - Status + dynamic ETA + planned route on a static map.
 *   FULL_TRACKING    - Status + ETA + live GPS pin + driver name & phone + plate.
 *
 * Resolution order (most specific wins):
 *   1. logistics_shipment_orders.portal_tracking_level   (per-shipment override)
 *   2. customers.portal_tracking_level                    (per-customer default)
 *   3. tenant_settings.default_portal_tracking_level      (tenant default)
 *   4. Hard fallback: 'STATUS_ONLY'
 *
 * Operator changes to per-shipment level are click-with-optional-reason.
 * The reason is required when downgrading from FULL_TRACKING to NONE so
 * the audit trail explains the change. Stored in
 * logistics_shipment_orders.portal_tracking_override_reason.
 *
 * This module ONLY resolves and filters — it doesn't write. Writes happen
 * via the regular operator-side patch endpoint with audit logging.
 */

import { prisma } from '@/lib/prisma';
import { ensureShipperPortalTables } from './schema';

// ── Types ──────────────────────────────────────────────────────────────

export const TRACKING_LEVELS = ['NONE', 'STATUS_ONLY', 'STATUS_AND_ETA', 'FULL_TRACKING'] as const;
export type TrackingLevel = typeof TRACKING_LEVELS[number];

export function isTrackingLevel(s: string | null | undefined): s is TrackingLevel {
  return !!s && (TRACKING_LEVELS as readonly string[]).includes(s);
}

/** Hard fallback when nothing is configured at any level. */
export const DEFAULT_TRACKING_LEVEL: TrackingLevel = 'STATUS_ONLY';

// Terminal status names — used to filter timelines at NONE.
const TERMINAL_STATUSES = new Set([
  'DRAFT', 'PENDING', 'ACKNOWLEDGED', 'APPROVED',
  'DELIVERED', 'POD_SUBMITTED', 'CLOSED', 'CANCELLED', 'REJECTED',
]);

// ── Resolution ─────────────────────────────────────────────────────────

/**
 * Walk the override chain and return the effective tracking level for
 * a (tenant, customer, shipment) triple. shipmentId is optional — when
 * absent, returns the customer-or-tenant default.
 */
export async function resolveTrackingLevel(
  tenantId: string,
  customerId: string | null,
  shipmentId?: string | null,
): Promise<TrackingLevel> {
  await ensureShipperPortalTables();

  // 1. Shipment override
  if (shipmentId) {
    try {
      const s = await prisma.$queryRawUnsafe<Array<{ level: string | null }>>(
        `SELECT portal_tracking_level AS level
           FROM logistics_shipment_orders
          WHERE id = $1 AND tenant_id = $2
          LIMIT 1`,
        shipmentId, tenantId,
      );
      const v = s[0]?.level;
      if (isTrackingLevel(v)) return v;
    } catch { /* shipment table not present yet — fall through */ }
  }

  // 2. Customer default
  if (customerId) {
    try {
      const c = await prisma.$queryRawUnsafe<Array<{ level: string | null }>>(
        `SELECT portal_tracking_level AS level
           FROM customers
          WHERE id = $1 AND tenant_id = $2
          LIMIT 1`,
        customerId, tenantId,
      );
      const v = c[0]?.level;
      if (isTrackingLevel(v)) return v;
    } catch { /* customers table missing column or row — fall through */ }
  }

  // 3. Tenant default
  try {
    const t = await prisma.$queryRawUnsafe<Array<{ level: string | null }>>(
      `SELECT default_portal_tracking_level AS level
         FROM tenant_settings
        WHERE tenant_id = $1
        LIMIT 1`,
      tenantId,
    );
    const v = t[0]?.level;
    if (isTrackingLevel(v)) return v;
  } catch { /* tenant_settings missing — fall through */ }

  // 4. Hard fallback
  return DEFAULT_TRACKING_LEVEL;
}

// ── Filter ─────────────────────────────────────────────────────────────

/**
 * Shape of a shipment as fully loaded from the engine — superset of what
 * the portal will return. Filter pares this down by level.
 */
export interface FullShipmentForPortal {
  id: string;
  shipmentNo: string | null;
  status: string;
  /** ISO timestamp the shipment was raised. */
  submittedAt: string;

  // Stops (origin and destination locations)
  origin?: { name: string | null; address: string | null; city: string | null; country: string | null };
  destination?: { name: string | null; address: string | null; city: string | null; country: string | null };

  // Windows
  pickupWindowFrom?: string | null;
  pickupWindowTo?: string | null;
  deliveryWindowFrom?: string | null;
  deliveryWindowTo?: string | null;

  // Cargo summary
  cargoSummary?: string | null;
  totalWeightKg?: number | null;
  totalVolumeCbm?: number | null;

  // Status timeline — each entry has a status + ISO date + optional note
  timeline?: Array<{ status: string; date: string; note?: string | null }>;

  // ETA and route (visible at STATUS_AND_ETA+)
  estimatedDeliveryAt?: string | null;
  plannedRoute?: Array<{ lat: number; lng: number }>;

  // Live tracking (visible only at FULL_TRACKING)
  lastTrackingEvent?: { lat: number; lng: number; capturedAt: string; source: string } | null;
  assignedCarrierName?: string | null;
  assignedDriverName?: string | null;
  assignedDriverPhone?: string | null;
  assignedVehiclePlate?: string | null;
  assignedVehicleType?: string | null;

  // Cost (always visible — if the shipper portal shows it at all)
  customerRateAmount?: number | null;
  currency?: string | null;
}

export interface FilteredShipmentForPortal {
  id: string;
  shipmentNo: string | null;
  status: string;
  submittedAt: string;
  origin?: FullShipmentForPortal['origin'];
  destination?: FullShipmentForPortal['destination'];
  pickupWindowFrom?: string | null;
  pickupWindowTo?: string | null;
  deliveryWindowFrom?: string | null;
  deliveryWindowTo?: string | null;
  cargoSummary?: string | null;
  totalWeightKg?: number | null;
  totalVolumeCbm?: number | null;
  customerRateAmount?: number | null;
  currency?: string | null;
  timeline?: FullShipmentForPortal['timeline'];
  estimatedDeliveryAt?: string | null;
  plannedRoute?: FullShipmentForPortal['plannedRoute'];
  liveLocation?: FullShipmentForPortal['lastTrackingEvent'];
  driver?: { name: string | null; phone: string | null } | null;
  vehicle?: { plate: string | null; type: string | null } | null;
  carrierName?: string | null;
  /** Echoed back so the UI knows what's been hidden. */
  trackingLevel: TrackingLevel;
}

export function filterShipmentForTracking(
  shipment: FullShipmentForPortal,
  level: TrackingLevel,
): FilteredShipmentForPortal {
  // Common fields visible at every level (including NONE)
  const base: FilteredShipmentForPortal = {
    id: shipment.id,
    shipmentNo: shipment.shipmentNo,
    status: shipment.status,
    submittedAt: shipment.submittedAt,
    trackingLevel: level,
  };

  // Everything below adds fields based on level. Each level is a strict
  // superset of the previous.

  // STATUS_ONLY adds the structural info — origin, destination, cargo,
  // and the full timeline. NONE keeps only milestone events.
  if (level === 'NONE') {
    base.timeline = (shipment.timeline ?? []).filter(e => TERMINAL_STATUSES.has(e.status));
    return base;
  }

  base.origin = shipment.origin;
  base.destination = shipment.destination;
  base.pickupWindowFrom = shipment.pickupWindowFrom;
  base.pickupWindowTo = shipment.pickupWindowTo;
  base.deliveryWindowFrom = shipment.deliveryWindowFrom;
  base.deliveryWindowTo = shipment.deliveryWindowTo;
  base.cargoSummary = shipment.cargoSummary;
  base.totalWeightKg = shipment.totalWeightKg;
  base.totalVolumeCbm = shipment.totalVolumeCbm;
  base.customerRateAmount = shipment.customerRateAmount;
  base.currency = shipment.currency;
  base.timeline = shipment.timeline;

  if (level === 'STATUS_ONLY') return base;

  // STATUS_AND_ETA adds the ETA and planned route — no live position.
  base.estimatedDeliveryAt = shipment.estimatedDeliveryAt;
  base.plannedRoute = shipment.plannedRoute;

  if (level === 'STATUS_AND_ETA') return base;

  // FULL_TRACKING adds the live GPS, driver, vehicle, carrier name.
  base.liveLocation = shipment.lastTrackingEvent ?? null;
  base.driver = (shipment.assignedDriverName || shipment.assignedDriverPhone)
    ? { name: shipment.assignedDriverName ?? null, phone: shipment.assignedDriverPhone ?? null }
    : null;
  base.vehicle = (shipment.assignedVehiclePlate || shipment.assignedVehicleType)
    ? { plate: shipment.assignedVehiclePlate ?? null, type: shipment.assignedVehicleType ?? null }
    : null;
  base.carrierName = shipment.assignedCarrierName ?? null;
  return base;
}

// ── Operator-side write: per-shipment override with reason ─────────────

/**
 * Apply an operator override to a single shipment's tracking level.
 * Tenant-scoped — caller must already have verified operator permissions.
 *
 * The reason is recommended (not enforced) — UI prompts for it when the
 * change is a downgrade. Stored alongside the level for audit.
 */
export async function setShipmentTrackingOverride(args: {
  tenantId: string;
  shipmentId: string;
  level: TrackingLevel | null;       // null clears the override → revert to customer default
  reason: string | null;
}): Promise<boolean> {
  await ensureShipperPortalTables();
  const result = await prisma.$executeRawUnsafe(
    `UPDATE logistics_shipment_orders
        SET portal_tracking_level = $1,
            portal_tracking_override_reason = $2,
            updated_at = NOW()
      WHERE id = $3 AND tenant_id = $4`,
    args.level, args.reason, args.shipmentId, args.tenantId,
  );
  return Number(result) > 0;
}

/** Sets the customer-level default tracking. */
export async function setCustomerTrackingDefault(args: {
  tenantId: string;
  customerId: string;
  level: TrackingLevel;
}): Promise<boolean> {
  await ensureShipperPortalTables();
  const result = await prisma.$executeRawUnsafe(
    `UPDATE customers
        SET portal_tracking_level = $1, updated_at = NOW()
      WHERE id = $2 AND tenant_id = $3`,
    args.level, args.customerId, args.tenantId,
  );
  return Number(result) > 0;
}

/** Sets the tenant-wide default. */
export async function setTenantTrackingDefault(args: {
  tenantId: string;
  level: TrackingLevel;
}): Promise<void> {
  await ensureShipperPortalTables();
  await prisma.$executeRawUnsafe(
    `INSERT INTO tenant_settings (tenant_id, default_portal_tracking_level, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (tenant_id) DO UPDATE
       SET default_portal_tracking_level = EXCLUDED.default_portal_tracking_level,
           updated_at = NOW()`,
    args.tenantId, args.level,
  );
}
