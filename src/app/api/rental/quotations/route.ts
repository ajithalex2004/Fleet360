export const dynamic = 'force-dynamic';

/**
 * Rental Quotations API — /api/rental/quotations
 * Formal quote generation from inquiry to rental agreement
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
import { quoteRentalRateInTx } from '@/lib/rental-rate-engine';

type Row = Record<string, unknown>;

const ALLOWED_QUOTE_STATUSES = new Set([
  'DRAFT',
  'SENT',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'CONVERTED',
]);

async function nextQuoteNo(tx: TxClient, tenantId: string): Promise<string> {
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  if (typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function') {
    return nextRentalSerial(tx, {
      tenantId,
      series: `RQT-${ym}`,
      prefix: `RQT-${ym}-`,
      table: 'rental_quotations',
      column: 'quote_no',
      padWidth: 4,
    });
  }
  return `RQT-${ym}-0001`;
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
    'quotations',
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
        where += ` AND (customer_name ILIKE $${pi} ESCAPE '\\' OR quote_no ILIKE $${pi} ESCAPE '\\')`;
        params.push(`%${escapeIlikePattern(search)}%`);
        pi++;
      }

      const rows = await withSavepoint<Row[]>(
        tx,
        'quotations_list',
        () =>
          tx.$queryRawUnsafe<Row[]>(
            `SELECT * FROM rental_quotations ${where} ORDER BY created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`,
            ...params,
            limit,
            offset,
          ),
        [],
      );

      const summary = await withSavepoint<{ status: string; count: string; total: string }[]>(
        tx,
        'quotations_summary',
        () =>
          tx.$queryRawUnsafe<{ status: string; count: string; total: string }[]>(
            `SELECT
               status,
               COUNT(*)::text AS count,
               COALESCE(SUM(grand_total), 0)::text AS total
             FROM rental_quotations
             WHERE deleted_at IS NULL
               AND tenant_id::text = $1
             GROUP BY status`,
            tenantId,
          ),
        [],
      );

      return NextResponse.json({ data: rows, summary, page, limit });
    } catch (err) {
      console.error('[GET /api/rental/quotations] error:', err);
      return NextResponse.json({ error: 'Failed to fetch quotations' }, { status: 500 });
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
    'quotations',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(
        (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
      );

      if (body.rateOverride === true) {
        const rateDenied = await requireRentalPermission(
          req.headers,
          tenantId,
          'approve',
          'rates',
          req.nextUrl.pathname,
        );
        if (rateDenied) return rateDenied;
      }

      const customerName =
        typeof body.customerName === 'string' ? body.customerName.trim() : '';
      if (!customerName) {
        return NextResponse.json({ error: 'customerName is required' }, { status: 400 });
      }
      if (!body.pickupDate || !body.returnDate) {
        return NextResponse.json(
          { error: 'pickupDate and returnDate are required' },
          { status: 400 },
        );
      }

      const pickupDateObj = new Date(String(body.pickupDate));
      const returnDateObj = new Date(String(body.returnDate));
      const pickupMs = pickupDateObj.getTime();
      const returnMs = returnDateObj.getTime();
      if (Number.isNaN(pickupMs) || Number.isNaN(returnMs) || returnMs < pickupMs) {
        return NextResponse.json(
          { error: 'Invalid pickupDate or returnDate' },
          { status: 400 },
        );
      }

      const parsedDailyRate = parseFloat(String(body.dailyRate ?? '0'));
      const depositAmount = parseFloat(String(body.depositAmount ?? '0'));
      if (!Number.isFinite(parsedDailyRate) || parsedDailyRate < 0) {
        return NextResponse.json(
          { error: 'dailyRate must be zero or more' },
          { status: 422 },
        );
      }
      if (!Number.isFinite(depositAmount) || depositAmount < 0) {
        return NextResponse.json(
          { error: 'depositAmount must be zero or more' },
          { status: 422 },
        );
      }

      const inquiryId =
        typeof body.inquiryId === 'string' && body.inquiryId.trim()
          ? body.inquiryId.trim()
          : null;
      if (inquiryId) {
        await assertRentalForeignKeysInTenant(tx, tenantId, { inquiryId });
      }

      const vehicleTypeStr =
        typeof body.vehicleType === 'string' && body.vehicleType.trim()
          ? body.vehicleType.trim()
          : null;

      const quoteNo = await nextQuoteNo(tx, tenantId);
      const days = Math.max(1, Math.ceil((returnMs - pickupMs) / 86_400_000));

      let dailyRate = parsedDailyRate;
      let subtotal = Math.round(days * dailyRate * 100) / 100;
      let vat = Math.round(subtotal * 0.05 * 100) / 100;
      let grand = Math.round((subtotal + vat) * 100) / 100;

      // Default to Master Price List unless caller explicitly requested rateOverride
      if (body.rateOverride !== true) {
        const masterQuote = await quoteRentalRateInTx(tx, tenantId, {
          vehicleCategory: vehicleTypeStr ?? 'ECONOMY',
          pickupDate: pickupDateObj,
          dropoffDate: returnDateObj,
          promoCode:
            typeof body.promoCode === 'string' && body.promoCode.trim()
              ? body.promoCode.trim()
              : undefined,
          insurancePlanCode:
            typeof body.insurancePlanCode === 'string' && body.insurancePlanCode.trim()
              ? body.insurancePlanCode.trim()
              : undefined,
          channel: 'DIRECT',
          currency: 'AED',
        });
        if (masterQuote.appliedRuleId != null && masterQuote.dailyRate > 0) {
          dailyRate = masterQuote.dailyRate;
          subtotal = masterQuote.subtotal;
          vat = masterQuote.taxAmount;
          grand = masterQuote.totalAmount;
        }
      }

      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + 7);

      const [row] = await tx.$queryRawUnsafe<Row[]>(
        `INSERT INTO rental_quotations (quote_no,inquiry_id,customer_name,email,phone,vehicle_type,vehicle_name,pickup_date,return_date,rental_days,daily_rate,subtotal,vat_amount,grand_total,deposit_amount,status,valid_until,notes,tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10,$11,$12,$13,$14,$15,$16,$17::date,$18,$19) RETURNING *`,
        quoteNo,
        inquiryId,
        customerName,
        typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null,
        typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null,
        vehicleTypeStr,
        typeof body.vehicleName === 'string' && body.vehicleName.trim()
          ? body.vehicleName.trim()
          : null,
        body.pickupDate,
        body.returnDate,
        days,
        dailyRate,
        subtotal,
        vat,
        grand,
        depositAmount,
        'DRAFT',
        validUntil.toISOString().slice(0, 10),
        typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
        tenantId,
      );

      if (!row) return NextResponse.json({ error: 'Failed to create quotation' }, { status: 500 });

      if (inquiryId) {
        await withSavepoint(
          tx,
          'quotations_post_sync_inquiry',
          () =>
            tx.$executeRawUnsafe(
              `UPDATE rental_inquiries
                  SET status = CASE WHEN status IN ('NEW', 'CONTACTED') THEN 'QUOTED' ELSE status END,
                      converted_to = COALESCE(converted_to, $1),
                      updated_at = NOW()
                WHERE id::text = $2
                  AND tenant_id::text = $3
                  AND deleted_at IS NULL`,
              quoteNo,
              inquiryId,
              tenantId,
            ),
          0,
        );
      }

      return NextResponse.json(row, { status: 201 });
    } catch (err: unknown) {
      if (isRentalSecurityError(err)) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      }
      console.error('[POST /api/rental/quotations] INSERT error:', err);
      return NextResponse.json({ error: 'Failed to create quotation' }, { status: 500 });
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
    'quotations',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(
        (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
      );
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      const status = typeof body.status === 'string' ? body.status.trim().toUpperCase() : '';
      if (!id) {
        return NextResponse.json({ error: 'id is required' }, { status: 400 });
      }
      if (!status || !ALLOWED_QUOTE_STATUSES.has(status)) {
        return NextResponse.json({ error: 'Invalid quotation status' }, { status: 400 });
      }

      const extra: Record<string, string> = {
        SENT: 'sent_at',
        ACCEPTED: 'accepted_at',
        REJECTED: 'rejected_at',
      };
      let sql = 'UPDATE rental_quotations SET status=$1, updated_at=NOW()';
      const params: unknown[] = [status];
      if (extra[status]) {
        sql += `, ${extra[status]}=NOW()`;
      }
      sql += ' WHERE id::text=$2 AND tenant_id::text=$3 AND deleted_at IS NULL RETURNING *';
      params.push(id, tenantId);
      const rows = await withSavepoint<Row[]>(
        tx,
        'quotations_patch',
        () => tx.$queryRawUnsafe<Row[]>(sql, ...params),
        [],
      );
      const row = rows[0];
      if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(row);
    } catch (err) {
      console.error('[PATCH /api/rental/quotations] error:', err);
      return NextResponse.json({ error: 'Failed to update quotation' }, { status: 500 });
    }
  });
}
