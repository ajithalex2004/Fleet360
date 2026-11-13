export const dynamic = 'force-dynamic';

/**
 * Rental Inquiries API — /api/rental/inquiries
 * Tracks rental leads before booking is confirmed
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { requireRentalPermission } from '@/lib/rental/rbac';
import { nextRentalSerial, withSavepoint } from '@/lib/rental/locks';
import {
  assertRentalForeignKeysInTenant,
  escapeIlikePattern,
  isRentalSecurityError,
} from '@/lib/rental/security-guards';

type Row = Record<string, unknown>;

const ALLOWED_CREATE_STATUSES = new Set(['NEW', 'CONTACTED', 'QUOTED']);
const ALLOWED_PATCH_STATUSES = new Set([
  'NEW',
  'CONTACTED',
  'QUOTED',
  'CONVERTED',
  'LOST',
  'CANCELLED',
]);

async function nextInquiryNo(tx: TxClient, tenantId: string): Promise<string> {
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  if (typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function') {
    return nextRentalSerial(tx, {
      tenantId,
      series: `RIQ-${ym}`,
      prefix: `RIQ-${ym}-`,
      table: 'rental_inquiries',
      column: 'inquiry_no',
      padWidth: 4,
    });
  }
  return `RIQ-${ym}-0001`;
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'view',
    'inquiries',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const sp = req.nextUrl.searchParams;
      const status = sp.get('status');
      const search = sp.get('search');
      const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '50', 10) || 50));
      const offset = (page - 1) * limit;

      let where = 'WHERE deleted_at IS NULL AND tenant_id::text = $1';
      const params: unknown[] = [tenantId];
      let pi = 2;
      if (status) {
        where += ` AND status = $${pi++}`;
        params.push(status);
      }
      if (search) {
        where += ` AND (customer_name ILIKE $${pi} ESCAPE '\\' OR phone ILIKE $${pi} ESCAPE '\\' OR email ILIKE $${pi} ESCAPE '\\')`;
        params.push(`%${escapeIlikePattern(search)}%`);
        pi++;
      }

      const rows = await withSavepoint<Row[]>(
        tx,
        'inquiries_list',
        () =>
          tx.$queryRawUnsafe<Row[]>(
            `SELECT * FROM rental_inquiries ${where} ORDER BY created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`,
            ...params,
            limit,
            offset,
          ),
        [],
      );

      const counts = await withSavepoint<{ status: string; count: string }[]>(
        tx,
        'inquiries_counts',
        () =>
          tx.$queryRawUnsafe<{ status: string; count: string }[]>(
            `SELECT status, COUNT(*)::text AS count
               FROM rental_inquiries
              WHERE deleted_at IS NULL
                AND tenant_id::text = $1
              GROUP BY status`,
            tenantId,
          ),
        [],
      );

      return NextResponse.json({ data: rows, counts, page, limit });
    } catch (err) {
      console.error('[GET /api/rental/inquiries] error:', err);
      return NextResponse.json({ error: 'Failed to fetch inquiries' }, { status: 500 });
    }
  });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'create',
    'inquiries',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(
        (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
      );

      const customerName =
        typeof body.customerName === 'string' ? body.customerName.trim() : '';
      const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
      if (!customerName) {
        return NextResponse.json({ error: 'customerName is required' }, { status: 400 });
      }
      if (!phone) {
        return NextResponse.json({ error: 'phone is required' }, { status: 400 });
      }

      const rawStatus =
        typeof body.status === 'string' && body.status.trim()
          ? body.status.trim().toUpperCase()
          : 'NEW';
      const initialStatus = ALLOWED_CREATE_STATUSES.has(rawStatus) ? rawStatus : 'NEW';

      const inquiryNo = await nextInquiryNo(tx, tenantId);
      const days =
        body.pickupDate && body.returnDate
          ? Math.max(
              1,
              Math.ceil(
                (new Date(String(body.returnDate)).getTime() -
                  new Date(String(body.pickupDate)).getTime()) /
                  86_400_000,
              ),
            )
          : null;

      const [row] = await tx.$queryRawUnsafe<Row[]>(
        `INSERT INTO rental_inquiries (inquiry_no,customer_name,email,phone,vehicle_type,pickup_location,pickup_date,return_date,rental_days,status,source,assigned_to,notes,tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$11,$12,$13,$14) RETURNING *`,
        inquiryNo,
        customerName,
        typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null,
        phone,
        typeof body.vehicleType === 'string' && body.vehicleType.trim()
          ? body.vehicleType.trim()
          : null,
        typeof body.pickupLocation === 'string' && body.pickupLocation.trim()
          ? body.pickupLocation.trim()
          : null,
        body.pickupDate ?? null,
        body.returnDate ?? null,
        days,
        initialStatus,
        typeof body.source === 'string' && body.source.trim() ? body.source.trim() : 'WALK_IN',
        typeof body.assignedTo === 'string' && body.assignedTo.trim()
          ? body.assignedTo.trim()
          : null,
        typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
        tenantId,
      );

      if (!row) return NextResponse.json({ error: 'Failed to create inquiry' }, { status: 500 });
      return NextResponse.json(row, { status: 201 });
    } catch (err: unknown) {
      console.error('[POST /api/rental/inquiries] INSERT error:', err);
      return NextResponse.json({ error: 'Failed to create inquiry' }, { status: 500 });
    }
  });
}

export async function PATCH(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'edit',
    'inquiries',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(
        (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
      );
      const { id, ...fields } = body;
      if (typeof id !== 'string' || !id.trim()) {
        return NextResponse.json({ error: 'id is required' }, { status: 400 });
      }

      if ('status' in fields && fields.status != null) {
        const st = String(fields.status).trim().toUpperCase();
        if (!ALLOWED_PATCH_STATUSES.has(st)) {
          return NextResponse.json({ error: 'Invalid inquiry status' }, { status: 400 });
        }
        fields.status = st;
      }

      if (
        'convertedTo' in fields &&
        typeof fields.convertedTo === 'string' &&
        fields.convertedTo.trim()
      ) {
        const refVal = fields.convertedTo.trim();
        if (/^(RQT|QT)-/i.test(refVal)) {
          const qtCheck = await withSavepoint<Row[]>(
            tx,
            'inq_patch_chk_qt_ref',
            () =>
              tx.$queryRawUnsafe<Row[]>(
                `SELECT id FROM rental_quotations WHERE quote_no = $1 AND tenant_id::text = $2 AND deleted_at IS NULL LIMIT 1`,
                refVal,
                tenantId,
              ),
            [],
          );
          if (qtCheck.length === 0) {
            return NextResponse.json({ error: 'Referenced quotation not found' }, { status: 404 });
          }
        } else if (/^RBK-/i.test(refVal)) {
          const bkCheck = await withSavepoint<Row[]>(
            tx,
            'inq_patch_chk_bk_ref',
            () =>
              tx.$queryRawUnsafe<Row[]>(
                `SELECT id FROM rental_bookings WHERE booking_ref = $1 AND tenant_id::text = $2 AND deleted_at IS NULL LIMIT 1`,
                refVal,
                tenantId,
              ),
            [],
          );
          if (bkCheck.length === 0) {
            return NextResponse.json({ error: 'Referenced booking not found' }, { status: 404 });
          }
        } else {
          await assertRentalForeignKeysInTenant(tx, tenantId, {
            bookingId: refVal,
          });
        }
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      let pi = 1;
      const map: Record<string, string> = {
        customerName: 'customer_name',
        email: 'email',
        phone: 'phone',
        vehicleType: 'vehicle_type',
        pickupLocation: 'pickup_location',
        pickupDate: 'pickup_date',
        returnDate: 'return_date',
        status: 'status',
        assignedTo: 'assigned_to',
        notes: 'notes',
        convertedTo: 'converted_to',
      };
      for (const [k, col] of Object.entries(map)) {
        if (k in fields) {
          sets.push(`${col}=$${pi++}`);
          params.push(fields[k]);
        }
      }
      if (!sets.length) {
        return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
      }
      sets.push('updated_at=NOW()');
      params.push(id.trim(), tenantId);
      const rows = await withSavepoint<Row[]>(
        tx,
        'inquiries_patch',
        () =>
          tx.$queryRawUnsafe<Row[]>(
            `UPDATE rental_inquiries
                SET ${sets.join(',')}
              WHERE id::text=$${pi}
                AND tenant_id::text=$${pi + 1}
                AND deleted_at IS NULL
              RETURNING *`,
            ...params,
          ),
        [],
      );
      const row = rows[0];
      if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(row);
    } catch (err) {
      if (isRentalSecurityError(err)) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      }
      console.error('[PATCH /api/rental/inquiries] error:', err);
      return NextResponse.json({ error: 'Failed to update inquiry' }, { status: 500 });
    }
  });
}
