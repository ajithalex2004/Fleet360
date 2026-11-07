/**
 * What approving a staged document writes (review-fields.ts lists which
 * documents are staged). Runs inside the approving request's tenant
 * transaction; every statement names the tenant.
 *
 *   Invoice / tax invoice  → finance.finance_payables, status DRAFT (Finance
 *                            still approves and pays it in the AP workflow)
 *   Maintenance job card   → fleet_work_orders on the matched vehicle
 *   Proof of delivery      → ePOD on the matched drayage job
 *   Quotation              → nothing; it is marked reviewed
 *
 * Each write is idempotent per extraction: approving twice links the record
 * made the first time.
 */
import { nextPayableNumber } from '@/lib/finance/payable-number';
import { submitJobPodEvidence } from '@/lib/logistics/drayage-domain';
import type { ReviewFields, StagedRecordKind } from './review-fields';

type Tx = {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

export type StagedWrite =
  | { ok: true; entityType: 'INVOICE' | 'WORK_ORDER' | 'SHIPMENT' | 'NONE'; entityId?: string; message: string }
  | { ok: false; error: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const t = (v: unknown) => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim());
const money = (v: unknown): number | null => {
  const n = Number(t(v).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

async function writePayable(tx: Tx, tenantId: string, extractionId: string, f: ReviewFields, actor: string): Promise<StagedWrite> {
  const vendorName = t(f.vendorName);
  const invoiceNumber = t(f.invoiceNumber);
  const trn = t(f.vendorTrn).replace(/\s/g, '');
  const issueDate = t(f.issueDate);
  const dueDate = t(f.dueDate);
  const total = money(f.totalAmount);
  const vat = money(f.vatAmount) ?? 0;
  const subtotal = money(f.subtotal) ?? (total !== null ? Math.round((total - vat) * 100) / 100 : null);

  if (!vendorName) return { ok: false, error: 'Vendor name is required.' };
  if (!invoiceNumber) return { ok: false, error: 'Invoice number is required.' };
  if (total === null || !(total > 0)) return { ok: false, error: 'Total amount must be a positive number.' };
  if (subtotal === null || subtotal < 0 || vat < 0) return { ok: false, error: 'Subtotal and VAT must be zero or more.' };
  if (Math.abs(subtotal + vat - total) > 0.05) {
    return { ok: false, error: `Subtotal (${subtotal}) plus VAT (${vat}) does not equal the total (${total}).` };
  }
  if (trn && !/^\d{15}$/.test(trn)) return { ok: false, error: 'Vendor TRN must be 15 digits.' };
  if (issueDate && !DATE.test(issueDate)) return { ok: false, error: 'Invoice date must be YYYY-MM-DD.' };
  if (dueDate && !DATE.test(dueDate)) return { ok: false, error: 'Due date must be YYYY-MM-DD.' };

  const existing = await tx.$queryRawUnsafe<Array<{ id: string; payable_number: string }>>(
    `SELECT id::text, payable_number FROM finance.finance_payables
      WHERE tenant_id = $1 AND source_type = 'VENDOR_INVOICE' AND source_id = $2 AND deleted_at IS NULL
      LIMIT 1`,
    tenantId,
    extractionId,
  );
  if (existing[0]) {
    return { ok: true, entityType: 'INVOICE', entityId: existing[0].id, message: `Already created as payable ${existing[0].payable_number}.` };
  }

  const ym = (issueDate || new Date().toISOString().slice(0, 10)).slice(0, 7).replace('-', '');
  const payableNumber = await nextPayableNumber(tx, tenantId, `AP-${ym}`);
  const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO finance.finance_payables
       (payable_number, vendor_name, module, source_type, source_id, description,
        subtotal, vat_amount, total_amount, currency, issue_date, due_date,
        prepared_by, notes, tenant_id)
     VALUES ($1, $2, 'GENERAL', 'VENDOR_INVOICE', $3, $4,
             $5::numeric, $6::numeric, $7::numeric, $8, $9::date, $10::date,
             $11, $12, $13)
     RETURNING id::text`,
    payableNumber,
    vendorName,
    extractionId,
    `Vendor invoice ${invoiceNumber}`,
    subtotal,
    vat,
    total,
    t(f.currency) || 'AED',
    issueDate || new Date().toISOString().slice(0, 10),
    dueDate || null,
    actor,
    [`From Document Intelligence extraction ${extractionId}, reviewed by ${actor}.`, trn ? `Vendor TRN ${trn}.` : 'No vendor TRN on the invoice.'].join(' '),
    tenantId,
  );
  return { ok: true, entityType: 'INVOICE', entityId: rows[0].id, message: `Created draft payable ${payableNumber} for ${vendorName}, ${t(f.currency) || 'AED'} ${total}.` };
}

async function writeWorkOrder(tx: Tx, tenantId: string, extractionId: string, f: ReviewFields, actor: string): Promise<StagedWrite> {
  const plate = t(f.vehiclePlate);
  const repairDate = t(f.repairDate);
  const cost = t(f.cost) ? money(f.cost) : null;
  if (!plate) return { ok: false, error: 'Vehicle plate or code is required.' };
  if (repairDate && !DATE.test(repairDate)) return { ok: false, error: 'Repair date must be YYYY-MM-DD.' };
  if (cost !== null && cost < 0) return { ok: false, error: 'Cost must be zero or more.' };

  const compact = plate.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const vehicles = await tx.$queryRawUnsafe<Array<{ id: string; label: string }>>(
    `SELECT id::text, COALESCE(license_plate, plate_number, vehicle_code, id::text) AS label
       FROM vehicles
      WHERE tenant_id::text = $1 AND deleted_at IS NULL
        AND (UPPER(REGEXP_REPLACE(COALESCE(license_plate, ''), '[^a-zA-Z0-9]', '', 'g')) = $2
          OR UPPER(REGEXP_REPLACE(COALESCE(plate_number, ''), '[^a-zA-Z0-9]', '', 'g')) = $2
          OR UPPER(COALESCE(vehicle_code, '')) = UPPER($3))
      LIMIT 2`,
    tenantId,
    compact,
    plate,
  );
  if (vehicles.length === 0) return { ok: false, error: `No vehicle in this organisation matches "${plate}".` };
  if (vehicles.length > 1) return { ok: false, error: `More than one vehicle matches "${plate}"; enter the exact plate or vehicle code.` };
  const vehicleId = vehicles[0].id;
  // fleet_work_orders.vehicle_id is a UUID; vehicles.id also holds legacy ids.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(vehicleId)) {
    return { ok: false, error: `Vehicle ${vehicles[0].label} has a legacy id a work order cannot reference; create this one by hand.` };
  }

  const marker = `[doc-intel:${extractionId}]`;
  const existing = await tx.$queryRawUnsafe<Array<{ id: string; wo_number: string }>>(
    `SELECT id::text, wo_number FROM fleet_work_orders WHERE tenant_id = $1 AND notes LIKE $2 LIMIT 1`,
    tenantId,
    `%${marker}%`,
  );
  if (existing[0]) {
    return { ok: true, entityType: 'WORK_ORDER', entityId: existing[0].id, message: `Already created as work order ${existing[0].wo_number}.` };
  }

  // Numbers are per tenant; the lock makes concurrent creators take turns.
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, `fleet-work-order-number:${tenantId}`);
  const [{ count }] = await tx.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `SELECT COUNT(*) AS count FROM fleet_work_orders WHERE tenant_id = $1`,
    tenantId,
  );
  const woNumber = 'FWO-' + String(Number(count) + 1).padStart(6, '0');
  const jobCard = t(f.jobCardNumber);
  const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO fleet_work_orders (
       wo_number, vehicle_id, wo_type, status, priority, garage_name, end_date,
       actual_cost, description, requested_by, notes, tenant_id, created_at, updated_at
     ) VALUES ($1, $2::uuid, 'CORRECTIVE', 'OPEN', 'MEDIUM', $3, $4::timestamptz,
               $5::numeric, $6, $7, $8, $9, NOW(), NOW())
     RETURNING id::text`,
    woNumber,
    vehicleId,
    t(f.garageName) || null,
    repairDate || null,
    cost,
    t(f.description) || (jobCard ? `Workshop job card ${jobCard}` : 'Workshop job card'),
    actor,
    `${jobCard ? `Job card ${jobCard}. ` : ''}From Document Intelligence, reviewed by ${actor}. ${marker}`,
    tenantId,
  );
  return { ok: true, entityType: 'WORK_ORDER', entityId: rows[0].id, message: `Created work order ${woNumber} on ${vehicles[0].label}.` };
}

async function writePod(tx: Tx, tenantId: string, fileName: string, f: ReviewFields, actor: string): Promise<StagedWrite> {
  const ref = t(f.jobReference);
  const receiver = t(f.receiverName);
  if (!ref) return { ok: false, error: 'Drayage job code or container number is required.' };
  if (!receiver) return { ok: false, error: 'Enter who received / signed for the delivery.' };

  const jobs = await tx.$queryRawUnsafe<Array<{ id: string; job_code: string; pod_signed_at: string | null }>>(
    `SELECT id, job_code, pod_signed_at FROM logistics_drayage_jobs
      WHERE tenant_id = $1 AND (UPPER(job_code) = UPPER($2) OR UPPER(container_number) = UPPER($2))
      ORDER BY created_at DESC LIMIT 2`,
    tenantId,
    ref,
  );
  if (jobs.length === 0) return { ok: false, error: `No drayage job in this organisation matches "${ref}".` };
  if (jobs.length > 1) return { ok: false, error: `More than one drayage job matches "${ref}"; enter the job code.` };
  if (jobs[0].pod_signed_at) {
    return { ok: true, entityType: 'SHIPMENT', entityId: jobs[0].id, message: `Job ${jobs[0].job_code} already has a signed proof of delivery.` };
  }
  await submitJobPodEvidence(tx as never, {
    tenantId,
    jobId: jobs[0].id,
    receiverName: receiver,
    notes: `From POD document ${fileName}, reviewed by ${actor}.`,
    actor: `${actor} (Document Intelligence review)`,
  });
  return { ok: true, entityType: 'SHIPMENT', entityId: jobs[0].id, message: `Recorded proof of delivery on job ${jobs[0].job_code}, signed by ${receiver}.` };
}

/** Write the record an approved staged document stands for. */
export function writeApprovedRecord(
  tx: Tx,
  args: { tenantId: string; extractionId: string; fileName: string; kind: StagedRecordKind; fields: ReviewFields; actor: string },
): Promise<StagedWrite> {
  switch (args.kind) {
    case 'PAYABLE':
      return writePayable(tx, args.tenantId, args.extractionId, args.fields, args.actor);
    case 'WORK_ORDER':
      return writeWorkOrder(tx, args.tenantId, args.extractionId, args.fields, args.actor);
    case 'POD':
      return writePod(tx, args.tenantId, args.fileName, args.fields, args.actor);
    case 'QUOTATION':
      return Promise.resolve({ ok: true, entityType: 'NONE', message: 'Quotation reviewed. Quotations create no Finance record.' });
  }
}
