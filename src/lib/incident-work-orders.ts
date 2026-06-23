import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureFleetSchema } from '@/lib/fleet/schema';
import { recordOperationalChange, type OperationalContext } from '@/lib/cross-module-governance';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

type IncidentLike = Record<string, unknown> & {
  id?: string | null;
  incidentNo?: string | null;
  incident_no?: string | null;
  incidentType?: string | null;
  incident_type?: string | null;
  severity?: string | null;
  vehicleId?: string | null;
  vehicle_id?: string | null;
  description?: string | null;
  location?: string | null;
  actionTaken?: string | null;
  action_taken?: string | null;
};

export interface IncidentWorkOrderLink {
  workOrderId: string;
  workOrderNo: string;
  status?: string | null;
  priority?: string | null;
  reused?: boolean;
}

export type IncidentWorkOrderResult =
  | ({ created: true; skipped?: false } & IncidentWorkOrderLink)
  | ({ created: false; skipped: true; reason: string } & Partial<IncidentWorkOrderLink>);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function val(incident: IncidentLike, camel: string, snake: string): string | null {
  const raw = incident[camel] ?? incident[snake];
  return raw == null ? null : String(raw);
}

function clean(value: string | null | undefined) {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function priorityFromSeverity(severity: string | null) {
  const normalized = String(severity ?? '').toUpperCase();
  if (normalized === 'CRITICAL' || normalized === 'HIGH') return 'HIGH';
  if (normalized === 'MEDIUM') return 'MEDIUM';
  return 'LOW';
}

function typeToWorkOrderType(incidentType: string | null) {
  const normalized = String(incidentType ?? '').toUpperCase();
  if (normalized === 'ACCIDENT') return 'ACCIDENT';
  return 'CORRECTIVE';
}

function shouldAutoCreateWorkOrder(incident: IncidentLike, explicit?: boolean): boolean {
  if (typeof explicit === 'boolean') return explicit;
  const type = String(val(incident, 'incidentType', 'incident_type') ?? '').toUpperCase();
  const severity = String(incident.severity ?? '').toUpperCase();
  return (
    ['ACCIDENT', 'BREAKDOWN', 'VEHICLE_DAMAGE', 'MECHANICAL_FAILURE'].includes(type)
    || severity === 'HIGH'
    || severity === 'CRITICAL'
  );
}

export async function ensureIncidentWorkOrderSchema() {
  await ensureFleetSchema();
  await prisma.$executeRawUnsafe(`ALTER TABLE fleet_work_orders ADD COLUMN IF NOT EXISTS tenant_id TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE fleet_work_orders ADD COLUMN IF NOT EXISTS source_module TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE fleet_work_orders ADD COLUMN IF NOT EXISTS source_entity_type TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE fleet_work_orders ADD COLUMN IF NOT EXISTS source_entity_id TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE fleet_work_orders ADD COLUMN IF NOT EXISTS source_entity_no TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE fleet_work_orders ADD COLUMN IF NOT EXISTS incident_id TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE fleet_work_orders ADD COLUMN IF NOT EXISTS incident_no TEXT`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_fwo_tenant_id ON fleet_work_orders(tenant_id)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_fwo_source_entity ON fleet_work_orders(source_entity_type, source_entity_id)`);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fwo_incident_unique
    ON fleet_work_orders(tenant_id, source_entity_type, source_entity_id)
    WHERE source_entity_type = 'TripIncident' AND source_entity_id IS NOT NULL
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE trip_incidents ADD COLUMN IF NOT EXISTS work_order_id TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE trip_incidents ADD COLUMN IF NOT EXISTS work_order_no TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_trip_incidents_work_order_id ON trip_incidents(work_order_id)`).catch(() => {});
}

export async function listIncidentWorkOrderLinks(
  incidentIds: string[],
  tenantId?: string | null,
): Promise<Map<string, IncidentWorkOrderLink>> {
  const ids = [...new Set(incidentIds.filter(Boolean))];
  const links = new Map<string, IncidentWorkOrderLink>();
  if (ids.length === 0) return links;

  const params: unknown[] = [...ids];
  let where = `source_entity_type = 'TripIncident' AND source_entity_id IN (${ids.map((_, i) => `$${i + 1}`).join(', ')})`;
  if (tenantId) {
    params.push(tenantId);
    where += ` AND tenant_id::text = $${params.length}`;
  }

  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    wo_number: string;
    status: string | null;
    priority: string | null;
    source_entity_id: string;
  }>>(
    `SELECT id::text, wo_number, status, priority, source_entity_id
       FROM fleet_work_orders
      WHERE ${where}`,
    ...params,
  ).catch(() => []);

  for (const row of rows) {
    links.set(row.source_entity_id, {
      workOrderId: row.id,
      workOrderNo: row.wo_number,
      status: row.status,
      priority: row.priority,
      reused: true,
    });
  }
  return links;
}

export async function maybeCreateIncidentWorkOrder(args: {
  req: NextRequest;
  ctx?: OperationalContext | null;
  incident: IncidentLike;
  createWorkOrder?: boolean;
  sourceModule?: string;
}): Promise<IncidentWorkOrderResult> {
  const incidentId = clean(args.incident.id);
  if (!incidentId) return { created: false, skipped: true, reason: 'incident_id_missing' };
  if (!shouldAutoCreateWorkOrder(args.incident, args.createWorkOrder)) {
    return { created: false, skipped: true, reason: 'not_work_order_trigger' };
  }

  const vehicleId = clean(val(args.incident, 'vehicleId', 'vehicle_id'));
  if (!vehicleId) return { created: false, skipped: true, reason: 'vehicle_required' };
  if (!UUID_RE.test(vehicleId)) return { created: false, skipped: true, reason: 'vehicle_id_invalid' };

  const tenantId = args.ctx?.tenantId ?? args.req.headers.get('x-tenant-id');
  if (!tenantId) return { created: false, skipped: true, reason: 'tenant_required' };

  await ensureIncidentWorkOrderSchema();

  const existing = await listIncidentWorkOrderLinks([incidentId], tenantId);
  const existingLink = existing.get(incidentId);
  if (existingLink) {
    return { created: false, skipped: true, reason: 'already_linked', ...existingLink, reused: true };
  }

  const id = crypto.randomUUID();
  const incidentNo = clean(val(args.incident, 'incidentNo', 'incident_no')) ?? incidentId;
  const incidentType = clean(val(args.incident, 'incidentType', 'incident_type')) ?? 'INCIDENT';
  const severity = clean(String(args.incident.severity ?? 'LOW'));
  const location = clean(String(args.incident.location ?? ''));
  const actionTaken = clean(val(args.incident, 'actionTaken', 'action_taken'));
  const description = clean(String(args.incident.description ?? ''));
  const sourceModule = args.sourceModule ?? args.ctx?.module?.toUpperCase?.() ?? 'INCIDENT';
  const priority = priorityFromSeverity(severity);
  const woType = typeToWorkOrderType(incidentType);
  const requestedBy =
    args.req.headers.get('x-user-email')
    ?? args.req.headers.get('x-user-name')
    ?? args.ctx?.userId
    ?? 'Incident Desk';

  const seqRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*) AS count FROM fleet_work_orders`,
  ).catch(() => [{ count: BigInt(0) }]);
  const seq = Number(seqRows[0]?.count ?? 0) + 1;
  const woNumber = `FWO-${String(seq).padStart(6, '0')}`;
  const now = new Date().toISOString();
  const noteParts = [
    `Auto-created from incident ${incidentNo}`,
    location ? `Location: ${location}` : null,
    actionTaken ? `Action taken: ${actionTaken}` : null,
  ].filter(Boolean);

  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `INSERT INTO fleet_work_orders (
       id, tenant_id, wo_number, vehicle_id, wo_type, status, priority,
       description, line_items, requested_by, notes,
       source_module, source_entity_type, source_entity_id, source_entity_no,
       incident_id, incident_no, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, 'OPEN', $6,
       $7, $8, $9, $10,
       $11, 'TripIncident', $12, $13,
       $12, $13, $14, $14
     )
     ON CONFLICT DO NOTHING
     RETURNING *`,
    id,
    tenantId,
    woNumber,
    vehicleId,
    woType,
    priority,
    `[${incidentType}] ${description ?? 'Incident follow-up work order'}`,
    JSON.stringify([
      {
        source: 'INCIDENT',
        incidentId,
        incidentNo,
        incidentType,
        severity,
        description,
        location,
      },
    ]),
    requestedBy,
    noteParts.join('\n'),
    sourceModule,
    incidentId,
    incidentNo,
    now,
  );

  const created = rows[0];
  if (!created) {
    const afterConflict = await listIncidentWorkOrderLinks([incidentId], tenantId);
    const conflictLink = afterConflict.get(incidentId);
    if (conflictLink) {
      return { created: false, skipped: true, reason: 'already_linked', ...conflictLink, reused: true };
    }
    return { created: false, skipped: true, reason: 'work_order_insert_conflict' };
  }

  const workOrderId = String(created?.id ?? id);
  const workOrderNo = String(created?.wo_number ?? woNumber);

  await prisma.$executeRawUnsafe(
    `UPDATE trip_incidents
        SET work_order_id = $1, work_order_no = $2, updated_at = NOW()
      WHERE id::text = $3`,
    workOrderId,
    workOrderNo,
    incidentId,
  ).catch(() => {});

  if (args.ctx) {
    await recordOperationalChange({
      req: args.req,
      ctx: args.ctx,
      entityType: 'FleetWorkOrder',
      entityId: workOrderId,
      action: 'CREATE',
      after: created ?? { id: workOrderId, woNumber: workOrderNo },
      summary: `Auto-created work order ${workOrderNo} from incident ${incidentNo}`,
      sourceModule,
      sourceEntityType: 'TripIncident',
      sourceEntityId: incidentId,
      relatedEntityType: 'TripIncident',
      relatedEntityId: incidentId,
      riskSeverity: priority === 'HIGH' ? 'high' : priority === 'MEDIUM' ? 'medium' : 'low',
    });

    await triggerServiceWorkflow({
      req: args.req,
      ctx: args.ctx,
      serviceTypeKey: 'MAINTENANCE_WORK_ORDER',
      referenceType: 'FleetWorkOrder',
      referenceId: workOrderId,
      referenceNumber: workOrderNo,
      contextData: {
        source: 'incident',
        incidentId,
        incidentNo,
        incidentType,
        severity,
        vehicleId,
        priority,
      },
      force: true,
    }).catch(() => null);
  }

  return {
    created: true,
    workOrderId,
    workOrderNo,
    status: 'OPEN',
    priority,
  };
}
