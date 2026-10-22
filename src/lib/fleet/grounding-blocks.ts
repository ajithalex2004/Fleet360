/**
 * Why is this vehicle grounded, and may it be released?
 *
 * A vehicle has a single `GROUNDED` status but several independent reasons
 * to be in it: an expired mandatory document (expiry sweep), a critical DVIR
 * defect (driver app), or a workshop job / breakdown (maintenance). Each
 * path used to release the vehicle on its own say-so — the expiry sweep
 * restored any GROUNDED vehicle whose documents were valid, and resolving
 * any service ticket restored the vehicle if no other ticket matched a
 * priority string nothing ever stored. Either could send a vehicle with an
 * open brake defect back to dispatch.
 *
 * Every un-grounding path now asks this module first, and only releases a
 * vehicle when no source still holds it.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { evaluateVehicleCompliance } from '@/lib/fleet/expiry-grounding-engine';

type Db = Prisma.TransactionClient | PrismaClient;

export type GroundingBlockSource = 'DOCUMENTS' | 'SERVICE_TICKET' | 'MAINTENANCE';

export interface GroundingBlock {
  source: GroundingBlockSource;
  /** Ticket / maintenance-request id; the vehicle id for DOCUMENTS. */
  id: string;
  reason: string;
}

/** Service-ticket statuses that no longer hold a vehicle. */
export const CLOSED_TICKET_STATUSES = ['Resolved', 'Completed', 'Closed', 'Rejected'] as const;

/**
 * Maintenance statuses (normalised: upper-case letters only, so both the
 * enum key `UNDER_MAINTENANCE` and the display value `Under Maintenance`
 * match) after which the vehicle is cleared for use.
 */
const MAINTENANCE_RELEASED = [
  'REJECTED', 'REJECTEDBYMAINTENANCE', 'READYFORSERVICE', 'READYFOROPERATION',
  'MAINTENANCECOMPLETED', 'COMPLETED', 'PENDINGINVOICE', 'INVOICESUBMITTED', 'CLOSED',
];
/** Maintenance statuses in which the vehicle is physically in the workshop. */
const MAINTENANCE_IN_WORKSHOP = [
  'UNDERMAINTENANCE', 'REPAIRCOMPLETED', 'QUALITYINSPECTION', 'INSPECTIONFAILED',
];

/** True when a ticket priority string means "critical", whatever its case. */
export function isCriticalPriority(priority: string | null | undefined): boolean {
  return (priority ?? '').trim().toUpperCase() === 'CRITICAL';
}

export interface GroundingBlockOptions {
  /** Ticket being resolved by the caller — it no longer counts as a block. */
  excludeTicketId?: string;
  /** Skip the document check (the expiry sweep has just evaluated them). */
  skipDocuments?: boolean;
  referenceDate?: Date;
}

/**
 * Collect every open reason each vehicle must stay grounded. Vehicles with
 * no blocks are absent from the returned map.
 */
export async function findGroundingBlocks(
  db: Db,
  tenantId: string,
  vehicleIds: string[],
  options: GroundingBlockOptions = {},
): Promise<Map<string, GroundingBlock[]>> {
  const out = new Map<string, GroundingBlock[]>();
  const ids = Array.from(new Set(vehicleIds.filter(Boolean)));
  if (ids.length === 0) return out;
  const add = (vehicleId: string, block: GroundingBlock) => {
    const list = out.get(vehicleId);
    if (list) list.push(block); else out.set(vehicleId, [block]);
  };

  // 1. Open service tickets that ground the vehicle: critical priority in
  //    any case, or a DVIR ticket that recorded it auto-grounded the unit.
  const tickets = await db.$queryRawUnsafe<Array<{ id: string; vehicle_id: string; readable_id: string | null; title: string | null }>>(
    `SELECT id::text, vehicle_id::text, readable_id, title
       FROM service_tickets
      WHERE tenant_id = $1
        AND vehicle_id::text = ANY($2::text[])
        AND ($3::text IS NULL OR id::text <> $3::text)
        AND status <> ALL($4::text[])
        AND deleted_at IS NULL
        AND (upper(coalesce(priority, '')) = 'CRITICAL'
             OR coalesce(custom_fields->>'isGrounded', 'false') = 'true'
             OR coalesce(custom_fields->>'hasCriticalDefect', 'false') = 'true')`,
    tenantId,
    ids,
    options.excludeTicketId ?? null,
    [...CLOSED_TICKET_STATUSES],
  );
  for (const t of tickets) {
    add(t.vehicle_id, {
      source: 'SERVICE_TICKET',
      id: t.id,
      reason: `Open critical ticket ${t.readable_id ?? t.id}${t.title ? ` (${t.title})` : ''}`,
    });
  }

  // 2. Unfinished maintenance that keeps the vehicle off the road: anything
  //    in the workshop, and any critical or breakdown request not yet
  //    cleared.
  const requests = await db.$queryRawUnsafe<Array<{ id: string; vehicle_id: string; status: string | null }>>(
    `SELECT id::text, vehicle_id::text, status
       FROM maintenance_requests
      WHERE tenant_id = $1
        AND vehicle_id::text = ANY($2::text[])
        AND deleted_at IS NULL
        AND upper(regexp_replace(coalesce(status, ''), '[^A-Za-z]', '', 'g')) <> ALL($3::text[])
        AND (upper(regexp_replace(coalesce(status, ''), '[^A-Za-z]', '', 'g')) = ANY($4::text[])
             OR upper(coalesce(priority, '')) = 'CRITICAL'
             OR upper(coalesce(maintenance_type, '')) = 'BREAKDOWN')`,
    tenantId,
    ids,
    MAINTENANCE_RELEASED,
    MAINTENANCE_IN_WORKSHOP,
  );
  for (const r of requests) {
    add(r.vehicle_id, {
      source: 'MAINTENANCE',
      id: r.id,
      reason: `Open maintenance request ${r.id} (${r.status ?? 'unknown status'})`,
    });
  }

  // 3. Mandatory documents.
  if (!options.skipDocuments) {
    const docs = await db.vehicleDocument.findMany({
      where: { tenantId, vehicleId: { in: ids } },
      select: { id: true, vehicleId: true, docType: true, docNumber: true, expiryDate: true },
    });
    const byVehicle = new Map<string, typeof docs>();
    for (const d of docs) {
      const list = byVehicle.get(d.vehicleId);
      if (list) list.push(d); else byVehicle.set(d.vehicleId, [d]);
    }
    for (const id of ids) {
      const evaluation = evaluateVehicleCompliance(
        { id, status: 'GROUNDED', isActive: false },
        byVehicle.get(id) ?? [],
        options.referenceDate ?? new Date(),
      );
      if (evaluation.actionTaken === 'MAINTAINED') {
        add(id, { source: 'DOCUMENTS', id, reason: evaluation.actionReason ?? 'Mandatory documents are not compliant' });
      }
    }
  }

  return out;
}

/**
 * Release `vehicleId` from GROUNDED to AVAILABLE only when nothing still
 * holds it. Returns the blocks that kept it grounded (empty when released
 * or when the vehicle was not grounded).
 */
export async function ungroundIfClear(
  db: Db,
  tenantId: string,
  vehicleId: string,
  options: GroundingBlockOptions = {},
): Promise<{ released: boolean; blocks: GroundingBlock[] }> {
  const blocks = (await findGroundingBlocks(db, tenantId, [vehicleId], options)).get(vehicleId) ?? [];
  if (blocks.length > 0) return { released: false, blocks };
  const res = await db.vehicle.updateMany({
    where: { id: vehicleId, tenantId, status: 'GROUNDED' },
    data: { status: 'AVAILABLE', isActive: true },
  });
  return { released: res.count > 0, blocks: [] };
}
