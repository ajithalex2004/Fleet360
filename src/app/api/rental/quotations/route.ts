export const dynamic = 'force-dynamic';

/**
 * Rental Quotations API — /api/rental/quotations
 * Formal quote generation from inquiry to rental agreement
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';

type Row = Record<string, unknown>;

async function nextNo(): Promise<string> {
  const [r] = await prisma.$queryRawUnsafe<{count:string}[]>(`SELECT COUNT(*)::text as count FROM rental_quotations`).catch(()=>[{count:'0'}]);
  const seq = (parseInt(r?.count??'0')+1).toString().padStart(4,'0');
  const ym = new Date().toISOString().slice(0,7).replace('-','');
  return `RQT-${ym}-${seq}`;
}

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
      const sp = req.nextUrl.searchParams;
      const status = sp.get('status');
      const search = sp.get('search');
      const page = Math.max(1, parseInt(sp.get('page')??'1'));
      const limit = Math.min(100, parseInt(sp.get('limit')??'50'));
      const offset = (page-1)*limit;

      let where = `WHERE deleted_at IS NULL`;
      const params: unknown[] = [];
      let pi = 1;
      if (status) { where += ` AND status=$${pi++}`; params.push(status); }
      if (search) { where += ` AND (customer_name ILIKE $${pi} OR quote_no ILIKE $${pi})`; params.push(`%${search}%`); pi++; }

      const [rows, summary] = await Promise.all([
        tx.$queryRawUnsafe<Row[]>(`SELECT * FROM rental_quotations ${where} ORDER BY created_at DESC LIMIT $${pi} OFFSET $${pi+1}`, ...params, limit, offset).catch(()=>[]),
        tx.$queryRawUnsafe<{status:string;count:string;total:string}[]>(`SELECT status, COUNT(*)::text as count, COALESCE(SUM(grand_total),0)::text as total FROM rental_quotations WHERE deleted_at IS NULL GROUP BY status`).catch(()=>[]),
      ]);
      return NextResponse.json({ data: rows, summary, page, limit });
  });
}

export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const quoteNo = await nextNo();
      const days = Math.max(1, Math.ceil((new Date(body.returnDate).getTime() - new Date(body.pickupDate).getTime()) / 86400000));
      const dailyRate = parseFloat(body.dailyRate??'0');
      const subtotal = days * dailyRate;
      const vat = subtotal * 0.05;
      const grand = subtotal + vat;
      const validUntil = new Date(); validUntil.setDate(validUntil.getDate()+7);

      let row: Row | undefined;
      try {
        [row] = await tx.$queryRawUnsafe<Row[]>(
          `INSERT INTO rental_quotations (quote_no,inquiry_id,customer_name,email,phone,vehicle_type,vehicle_name,pickup_date,return_date,rental_days,daily_rate,subtotal,vat_amount,grand_total,deposit_amount,status,valid_until,notes,tenant_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10,$11,$12,$13,$14,$15,$16,$17::date,$18,$19) RETURNING *`,
          quoteNo, body.inquiryId??null, body.customerName, body.email??null, body.phone??null,
          body.vehicleType??null, body.vehicleName??null, body.pickupDate, body.returnDate,
          days, dailyRate, subtotal, vat, grand, parseFloat(body.depositAmount??'0'),
          'DRAFT', validUntil.toISOString().slice(0,10), body.notes??null, tenantId,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[POST /api/rental/quotations] INSERT error:', msg);
        return NextResponse.json({ error: msg }, { status: 500 });
      }
      if (!row) return NextResponse.json({error:'No row returned'},{status:500});
      return NextResponse.json(row, {status:201});
  });
}

export async function PATCH(req: NextRequest) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const { id, status } = body;
      const extra: Record<string,string> = { SENT:'sent_at', ACCEPTED:'accepted_at', REJECTED:'rejected_at' };
      let sql = `UPDATE rental_quotations SET status=$1, updated_at=NOW()`;
      const params: unknown[] = [status];
      if (extra[status]) { sql += `, ${extra[status]}=NOW()`; }
      sql += ` WHERE id::text=$2 RETURNING *`;
      params.push(id);
      const [row] = await tx.$queryRawUnsafe<Row[]>(sql, ...params).catch(()=>[]);
      if (!row) return NextResponse.json({error:'Not found'},{status:404});
      return NextResponse.json(row);
  });
}

