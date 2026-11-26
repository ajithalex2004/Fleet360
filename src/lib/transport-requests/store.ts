/**
 * Customer Transport requests (customer_transport_requests).
 *
 * A customer submits a request for one of its Transport categories; the
 * answers are checked against the tenant's form for that category
 * (src/lib/transport-catalog) before anything is saved. When the category
 * needs approval the request waits in PENDING_APPROVAL; otherwise it is
 * SUBMITTED straight away and, for categories with a module handler, routed
 * there (Logistics → a shipping request in the Logistics review inbox).
 * Staff move requests through their stages in Booking Portal → Customer
 * requests; every change is added to `lifecycle`, which the customer sees.
 */

import { prisma } from '@/lib/prisma';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { isTransportCategory, TRANSPORT_CATEGORY_LABEL, type TransportCategory } from '@/lib/customer-portal/catalog';
import { getCustomer } from '@/lib/service-tickets/customer-context';
import { customerTransportCategories, getTenantCategory } from '@/lib/transport-catalog/store';
import { validateRequestValues, type RequestValues } from '@/lib/transport-catalog/form-schema';
import { createShippingRequest } from '@/lib/logistics/domain';

export type TransportRequestStatus =
  | 'PENDING_APPROVAL' | 'SUBMITTED' | 'CONFIRMED' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';

export const ACTIVE_TRANSPORT_STATUSES: TransportRequestStatus[] = ['PENDING_APPROVAL', 'SUBMITTED', 'CONFIRMED', 'ASSIGNED', 'IN_PROGRESS'];

export interface LifecycleEntry { status: TransportRequestStatus; at: string; by: string; note?: string }

/** What the customer sees (no staff note). */
export interface CustomerTransportRequest {
  id: string;
  requestNo: string;
  category: TransportCategory;
  categoryTitle: string;
  status: TransportRequestStatus;
  values: RequestValues;
  pickup: string | null;
  dropoff: string | null;
  serviceDate: string | null;
  serviceTime: string | null;
  vehicleCategory: string | null;
  requestedByName: string | null;
  driver: { name: string; phone: string | null } | null;
  vehicle: string | null;
  routed: { module: string; ref: string | null } | null;
  customerNote: string | null;
  lifecycle: LifecycleEntry[];
  createdAt: string;
  updatedAt: string;
}

/** What staff see. */
export interface StaffTransportRequest extends CustomerTransportRequest {
  customerId: string;
  customerName: string | null;
  customerCode: string | null;
  staffNote: string | null;
}

interface Row {
  id: string; customer_id: string; request_no: string; category: string; status: TransportRequestStatus;
  form_values: RequestValues | null; pickup: string | null; dropoff: string | null; service_date: string | null;
  service_time: string | null; vehicle_category: string | null; requested_by_name: string | null;
  assigned_driver_name: string | null; assigned_driver_phone: string | null; assigned_vehicle: string | null;
  routed_module: string | null; routed_record_ref: string | null; customer_note: string | null; staff_note: string | null;
  lifecycle: LifecycleEntry[] | null; created_at: string; updated_at: string;
  customer_name?: string | null; customer_code?: string | null;
}

const COLS = `r.id::text, r.customer_id, r.request_no, r.category, r.status, r.form_values, r.pickup, r.dropoff,
  r.service_date::text, r.service_time, r.vehicle_category, r.requested_by_name, r.assigned_driver_name,
  r.assigned_driver_phone, r.assigned_vehicle, r.routed_module, r.routed_record_ref, r.customer_note, r.staff_note,
  r.lifecycle, r.created_at::text, r.updated_at::text`;

export class TransportRequestError extends Error {
  constructor(message: string, readonly status = 400, readonly fieldErrors?: Record<string, string>) { super(message); }
}

function toCustomer(r: Row): CustomerTransportRequest {
  const category = (isTransportCategory(r.category) ? r.category : 'RAC') as TransportCategory;
  return {
    id: r.id, requestNo: r.request_no, category, categoryTitle: TRANSPORT_CATEGORY_LABEL[category], status: r.status,
    values: r.form_values ?? {}, pickup: r.pickup, dropoff: r.dropoff, serviceDate: r.service_date, serviceTime: r.service_time,
    vehicleCategory: r.vehicle_category, requestedByName: r.requested_by_name,
    driver: r.assigned_driver_name ? { name: r.assigned_driver_name, phone: r.assigned_driver_phone } : null,
    vehicle: r.assigned_vehicle, routed: r.routed_module ? { module: r.routed_module, ref: r.routed_record_ref } : null,
    customerNote: r.customer_note, lifecycle: r.lifecycle ?? [], createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function toStaff(r: Row): StaffTransportRequest {
  return { ...toCustomer(r), customerId: r.customer_id, customerName: r.customer_name ?? null, customerCode: r.customer_code ?? null, staffNote: r.staff_note };
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Copies the common answers to columns used by lists and search. */
function summary(values: RequestValues) {
  const date = str(values.startDate);
  return {
    pickup: str(values.origin),
    dropoff: str(values.destination),
    serviceDate: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    serviceTime: str(values.pickupTime),
    vehicleCategory: str(values.vehicleCategory),
  };
}

async function nextRequestNo(tx: TxClient, tenantId: string, customerCode: string): Promise<string> {
  const yy = String(new Date().getUTCFullYear()).slice(-2);
  // One series per tenant per year; the lock keeps concurrent submissions apart.
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `customer-transport-requests:${tenantId}:${yy}`);
  const [row] = await tx.$queryRawUnsafe<Array<{ max: number | null }>>(
    `SELECT MAX(RIGHT(request_no, 4)::int) AS max FROM customer_transport_requests
      WHERE tenant_id = $1 AND request_no ~ ('-' || $2 || '[0-9]{4}$')`,
    tenantId, yy,
  );
  const seq = Number(row?.max ?? 0) + 1;
  return `TR-${customerCode}-${yy}${String(seq).padStart(4, '0')}`;
}

/** Logistics form → Logistics shipping request (the operator's review inbox). */
async function routeLogistics(tx: TxClient, tenantId: string, req: Row, actorId: string | null) {
  const v = req.form_values ?? {};
  const at = (d: unknown, t: unknown) => (str(d) ? `${str(d)}T${str(t) ?? '00:00'}:00+04:00` : null);
  const shipmentType = str(v.shipmentType)?.split(' ')[0] ?? null;
  const created = await createShippingRequest({
    tenantId,
    shipperId: req.customer_id,
    source: 'CUSTOMER_PORTAL',
    createdBy: actorId,
    shipmentType,
    requestedVehicleType: str(v.vehicleCategory),
    originName: str(v.origin), originAddress: str(v.origin),
    destinationName: str(v.destination), destinationAddress: str(v.destination),
    pickupWindowFrom: at(v.startDate, v.pickupTime),
    deliveryWindowFrom: at(v.deliveryDate, null),
    totalWeightKg: typeof v.weight === 'number' ? v.weight : null,
    totalVolumeCbm: typeof v.cbm === 'number' ? v.cbm : null,
    goodsDescription: str(v.cargo),
    specialInstructions: str(v.notes),
    referenceNo: req.request_no,
    metadata: { customerTransportRequestId: req.id, customerTransportRequestNo: req.request_no, formValues: v },
  }, tx);
  if (!created) throw new Error('Logistics did not return the shipping request');
  return { module: 'LOGISTICS', id: created.id, ref: created.requestNo };
}

/** Sends a request to its category's module, when one is set up. Returns null when staff handle it here. */
async function routeToModule(tx: TxClient, tenantId: string, req: Row, actorId: string | null) {
  if (req.category === 'LOGISTICS') return routeLogistics(tx, tenantId, req, actorId);
  return null;
}

async function saveRouting(tx: TxClient, tenantId: string, id: string, routed: { module: string; id: string; ref: string | null }) {
  await tx.$executeRawUnsafe(
    `UPDATE customer_transport_requests SET routed_module = $3, routed_record_id = $4, routed_record_ref = $5, updated_at = NOW()
      WHERE id::text = $1 AND tenant_id = $2`,
    id, tenantId, routed.module, routed.id, routed.ref,
  );
}

// ── Customer side ──────────────────────────────────────────────────────────

export async function createTransportRequest(args: {
  tenantId: string; customerId: string; user: { id: string; name: string };
  category: unknown; values: unknown; customerNote?: unknown;
}): Promise<CustomerTransportRequest> {
  const { tenantId, customerId, user } = args;
  if (!isTransportCategory(args.category)) throw new TransportRequestError('Unknown Transport category.');
  const category = args.category;
  const allowed = await customerTransportCategories(tenantId, customerId);
  if (!allowed.some((c) => c.category === category)) {
    throw new TransportRequestError(`${TRANSPORT_CATEGORY_LABEL[category]} is not available for your company.`, 403);
  }
  const cat = await getTenantCategory(tenantId, category);
  const check = validateRequestValues(cat.effectiveForm, args.values);
  if (!check.ok) throw new TransportRequestError('Some answers need attention.', 400, check.errors);
  const note = str(args.customerNote)?.slice(0, 1000) ?? null;
  const status: TransportRequestStatus = cat.approvalRequired ? 'PENDING_APPROVAL' : 'SUBMITTED';
  const s = summary(check.values);
  const lifecycle: LifecycleEntry[] = [{ status, at: new Date().toISOString(), by: `${user.name} (customer)` }];

  return withTenantRls(prisma, tenantId, async (tx) => {
    const customer = await getCustomer(tx, tenantId, customerId);
    const requestNo = await nextRequestNo(tx, tenantId, customer.code || customerId);
    const [row] = await tx.$queryRawUnsafe<Row[]>(
      `INSERT INTO customer_transport_requests AS r
         (tenant_id, customer_id, request_no, category, status, form_values, pickup, dropoff, service_date, service_time,
          vehicle_category, requested_by_user_id, requested_by_name, customer_note, lifecycle)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::date, $10, $11, $12, $13, $14, $15::jsonb)
       RETURNING ${COLS}`,
      tenantId, customerId, requestNo, category, status, JSON.stringify(check.values), s.pickup, s.dropoff, s.serviceDate,
      s.serviceTime, s.vehicleCategory, user.id, user.name, note, JSON.stringify(lifecycle),
    );
    if (status === 'SUBMITTED') {
      const routed = await routeToModule(tx, tenantId, row, null);
      if (routed) {
        await saveRouting(tx, tenantId, row.id, routed);
        row.routed_module = routed.module; row.routed_record_ref = routed.ref;
      }
    }
    return toCustomer(row);
  });
}

export async function listCustomerTransportRequests(
  tenantId: string, customerId: string, opts: { scope?: 'active' | 'all'; category?: string | null; from?: string | null } = {},
): Promise<CustomerTransportRequest[]> {
  const where = ['r.tenant_id = $1', 'r.customer_id = $2'];
  const args: unknown[] = [tenantId, customerId];
  if (opts.scope === 'active') { args.push(ACTIVE_TRANSPORT_STATUSES); where.push(`r.status = ANY($${args.length}::text[])`); }
  if (opts.category && isTransportCategory(opts.category)) { args.push(opts.category); where.push(`r.category = $${args.length}`); }
  if (opts.from && !Number.isNaN(Date.parse(opts.from))) { args.push(opts.from); where.push(`r.created_at >= $${args.length}::timestamptz`); }
  const rows = await withTenantRls(prisma, tenantId, (tx) =>
    tx.$queryRawUnsafe<Row[]>(
      `SELECT ${COLS} FROM customer_transport_requests r WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC LIMIT 500`,
      ...args,
    ),
  );
  return rows.map(toCustomer);
}

export async function getCustomerTransportRequest(tenantId: string, customerId: string, id: string): Promise<CustomerTransportRequest | null> {
  const rows = await withTenantRls(prisma, tenantId, (tx) =>
    tx.$queryRawUnsafe<Row[]>(
      `SELECT ${COLS} FROM customer_transport_requests r WHERE r.tenant_id = $1 AND r.customer_id = $2 AND r.id::text = $3`,
      tenantId, customerId, id,
    ),
  ).catch(() => [] as Row[]);
  return rows[0] ? toCustomer(rows[0]) : null;
}

/** A customer may cancel while nothing has been arranged yet. */
export async function cancelCustomerTransportRequest(
  tenantId: string, customerId: string, id: string, userName: string,
): Promise<CustomerTransportRequest> {
  return withTenantRls(prisma, tenantId, async (tx) => {
    const [cur] = await tx.$queryRawUnsafe<Row[]>(
      `SELECT ${COLS} FROM customer_transport_requests r
        WHERE r.tenant_id = $1 AND r.customer_id = $2 AND r.id::text = $3 FOR UPDATE`,
      tenantId, customerId, id,
    );
    if (!cur) throw new TransportRequestError('Request not found.', 404);
    if (!['PENDING_APPROVAL', 'SUBMITTED'].includes(cur.status)) {
      throw new TransportRequestError('This request is already being arranged. Contact your service provider to cancel it.', 409);
    }
    return toCustomer(await applyStatus(tx, tenantId, cur, 'CANCELLED', `${userName} (customer)`, {}));
  });
}

// ── Staff side ─────────────────────────────────────────────────────────────

export type StaffAction = 'approve' | 'reject' | 'confirm' | 'assign' | 'start' | 'complete' | 'cancel';

/** Allowed moves: action → [from statuses, to status]. */
const TRANSITIONS: Record<StaffAction, [TransportRequestStatus[], TransportRequestStatus]> = {
  approve: [['PENDING_APPROVAL'], 'SUBMITTED'],
  reject: [['PENDING_APPROVAL', 'SUBMITTED'], 'REJECTED'],
  confirm: [['SUBMITTED'], 'CONFIRMED'],
  assign: [['SUBMITTED', 'CONFIRMED', 'ASSIGNED'], 'ASSIGNED'],
  start: [['ASSIGNED'], 'IN_PROGRESS'],
  complete: [['CONFIRMED', 'ASSIGNED', 'IN_PROGRESS'], 'COMPLETED'],
  cancel: [['PENDING_APPROVAL', 'SUBMITTED', 'CONFIRMED', 'ASSIGNED', 'IN_PROGRESS'], 'CANCELLED'],
};
export const STAFF_ACTIONS = Object.keys(TRANSITIONS) as StaffAction[];

async function applyStatus(
  tx: TxClient, tenantId: string, cur: Row, to: TransportRequestStatus, by: string,
  extra: { driverName?: string | null; driverPhone?: string | null; vehicle?: string | null; note?: string | null; staffNote?: string | null },
): Promise<Row> {
  const entry: LifecycleEntry = { status: to, at: new Date().toISOString(), by, ...(extra.note ? { note: extra.note } : {}) };
  const [row] = await tx.$queryRawUnsafe<Row[]>(
    `UPDATE customer_transport_requests AS r
        SET status = $3,
            assigned_driver_name = COALESCE($4, assigned_driver_name),
            assigned_driver_phone = COALESCE($5, assigned_driver_phone),
            assigned_vehicle = COALESCE($6, assigned_vehicle),
            staff_note = COALESCE($7, staff_note),
            lifecycle = lifecycle || $8::jsonb,
            updated_at = NOW()
      WHERE r.id::text = $1 AND r.tenant_id = $2
      RETURNING ${COLS}`,
    cur.id, tenantId, to, extra.driverName ?? null, extra.driverPhone ?? null, extra.vehicle ?? null,
    extra.staffNote ?? null, JSON.stringify([entry]),
  );
  return row;
}

export async function listTenantTransportRequests(
  tenantId: string, opts: { status?: string | null; category?: string | null } = {},
): Promise<StaffTransportRequest[]> {
  const where = ['r.tenant_id = $1'];
  const args: unknown[] = [tenantId];
  if (opts.status === 'active') { args.push(ACTIVE_TRANSPORT_STATUSES); where.push(`r.status = ANY($${args.length}::text[])`); }
  else if (opts.status) { args.push(opts.status); where.push(`r.status = $${args.length}`); }
  if (opts.category && isTransportCategory(opts.category)) { args.push(opts.category); where.push(`r.category = $${args.length}`); }
  const rows = await withTenantRls(prisma, tenantId, (tx) =>
    tx.$queryRawUnsafe<Row[]>(
      `SELECT ${COLS}, c.name_en AS customer_name, c.customer_code
         FROM customer_transport_requests r
         LEFT JOIN customers c ON c.id = r.customer_id AND c.tenant_id = r.tenant_id
        WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC LIMIT 500`,
      ...args,
    ),
  );
  return rows.map(toStaff);
}

/** Moves a request to its next stage (see TRANSITIONS); approving also routes it to its module. */
export async function staffTransportAction(
  tenantId: string, id: string, action: unknown,
  input: { driverName?: unknown; driverPhone?: unknown; vehicle?: unknown; note?: unknown; staffNote?: unknown },
  staff: { id: string; name: string },
): Promise<StaffTransportRequest> {
  if (!STAFF_ACTIONS.includes(action as StaffAction)) throw new TransportRequestError('Unknown action.');
  const [from, to] = TRANSITIONS[action as StaffAction];
  const driverName = str(input.driverName)?.slice(0, 120) ?? null;
  const driverPhone = str(input.driverPhone)?.slice(0, 40) ?? null;
  const vehicle = str(input.vehicle)?.slice(0, 120) ?? null;
  if (action === 'assign' && !driverName && !vehicle) throw new TransportRequestError('Enter the driver or the vehicle.');
  const note = str(input.note)?.slice(0, 500) ?? null;
  if (action === 'reject' && !note) throw new TransportRequestError('Give the customer a reason for rejecting.');

  return withTenantRls(prisma, tenantId, async (tx) => {
    const [cur] = await tx.$queryRawUnsafe<Row[]>(
      `SELECT ${COLS} FROM customer_transport_requests r WHERE r.tenant_id = $1 AND r.id::text = $2 FOR UPDATE`,
      tenantId, id,
    );
    if (!cur) throw new TransportRequestError('Request not found.', 404);
    if (!from.includes(cur.status)) {
      throw new TransportRequestError(`Cannot ${action} a request that is ${cur.status.replace(/_/g, ' ').toLowerCase()}.`, 409);
    }
    let row = await applyStatus(tx, tenantId, cur, to, staff.name, {
      driverName, driverPhone, vehicle, note, staffNote: str(input.staffNote)?.slice(0, 1000) ?? null,
    });
    if (action === 'approve' && !row.routed_module) {
      const routed = await routeToModule(tx, tenantId, row, staff.id);
      if (routed) {
        await saveRouting(tx, tenantId, row.id, routed);
        row = { ...row, routed_module: routed.module, routed_record_ref: routed.ref };
      }
    }
    const [named] = await tx.$queryRawUnsafe<Array<{ name_en: string | null; customer_code: string | null }>>(
      `SELECT name_en, customer_code FROM customers WHERE id = $1 AND tenant_id = $2`, row.customer_id, tenantId,
    );
    return toStaff({ ...row, customer_name: named?.name_en ?? null, customer_code: named?.customer_code ?? null });
  });
}
