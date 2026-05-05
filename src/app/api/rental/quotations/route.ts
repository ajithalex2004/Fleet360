/**
 * Rental Quotations API — /api/rental/quotations
 * Formal quote generation from inquiry to rental agreement
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const INIT = `
  CREATE TABLE IF NOT EXISTS rental_quotations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    quote_no        TEXT UNIQUE NOT NULL,
    inquiry_id      UUID,
    customer_name   TEXT NOT NULL,
    email           TEXT,
    phone           TEXT,
    vehicle_type    TEXT,
    vehicle_id      TEXT,
    vehicle_name    TEXT,
    pickup_date     DATE NOT NULL,
    return_date     DATE NOT NULL,
    rental_days     INT NOT NULL,
    daily_rate      NUMERIC(10,2) NOT NULL,
    subtotal        NUMERIC(12,2) NOT NULL,
    vat_amount      NUMERIC(12,2) NOT NULL,
    grand_total     NUMERIC(12,2) NOT NULL,
    deposit_amount  NUMERIC(12,2) DEFAULT 0,
    status          TEXT DEFAULT 'DRAFT',
    valid_until     DATE,
    notes           TEXT,
    sent_at         TIMESTAMPTZ,
    accepted_at     TIMESTAMPTZ,
    rejected_at     TIMESTAMPTZ,
    converted_to    TEXT
  );
`;

type Row = Record<string, unknown>;

/** Run INIT with one retry (handles Neon serverless cold-start). */
async function ensureSchema(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(INIT);
  } catch {
    // Neon cold-start can drop the first connection; wait briefly and retry once.
    await new Promise(r => setTimeout(r, 1_500));
    await prisma.$executeRawUnsafe(INIT);
  }
}

async function nextNo(): Promise<string> {
  const [r] = await prisma.$queryRawUnsafe<{count:string}[]>(`SELECT COUNT(*)::text as count FROM rental_quotations`).catch(()=>[{count:'0'}]);
  const seq = (parseInt(r?.count??'0')+1).toString().padStart(4,'0');
  const ym = new Date().toISOString().slice(0,7).replace('-','');
  return `RQT-${ym}-${seq}`;
}

export async function GET(req: NextRequest) {
  await ensureSchema();
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
    prisma.$queryRawUnsafe<Row[]>(`SELECT * FROM rental_quotations ${where} ORDER BY created_at DESC LIMIT $${pi} OFFSET $${pi+1}`, ...params, limit, offset).catch(()=>[]),
    prisma.$queryRawUnsafe<{status:string;count:string;total:string}[]>(`SELECT status, COUNT(*)::text as count, COALESCE(SUM(grand_total),0)::text as total FROM rental_quotations WHERE deleted_at IS NULL GROUP BY status`).catch(()=>[]),
  ]);
  return NextResponse.json({ data: rows, summary, page, limit });
}

export async function POST(req: NextRequest) {
  await ensureSchema();
  const body = await req.json();
  const quoteNo = await nextNo();
  const days = Math.max(1, Math.ceil((new Date(body.returnDate).getTime() - new Date(body.pickupDate).getTime()) / 86400000));
  const dailyRate = parseFloat(body.dailyRate??'0');
  const subtotal = days * dailyRate;
  const vat = subtotal * 0.05;
  const grand = subtotal + vat;
  const validUntil = new Date(); validUntil.setDate(validUntil.getDate()+7);

  let row: Row | undefined;
  try {
    [row] = await prisma.$queryRawUnsafe<Row[]>(
      `INSERT INTO rental_quotations (quote_no,inquiry_id,customer_name,email,phone,vehicle_type,vehicle_name,pickup_date,return_date,rental_days,daily_rate,subtotal,vat_amount,grand_total,deposit_amount,status,valid_until,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10,$11,$12,$13,$14,$15,$16,$17::date,$18) RETURNING *`,
      quoteNo, body.inquiryId??null, body.customerName, body.email??null, body.phone??null,
      body.vehicleType??null, body.vehicleName??null, body.pickupDate, body.returnDate,
      days, dailyRate, subtotal, vat, grand, parseFloat(body.depositAmount??'0'),
      'DRAFT', validUntil.toISOString().slice(0,10), body.notes??null
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/rental/quotations] INSERT error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  if (!row) return NextResponse.json({error:'No row returned'},{status:500});
  return NextResponse.json(row, {status:201});
}

export async function PATCH(req: NextRequest) {
  await ensureSchema();
  const body = await req.json();
  const { id, status } = body;
  const extra: Record<string,string> = { SENT:'sent_at', ACCEPTED:'accepted_at', REJECTED:'rejected_at' };
  let sql = `UPDATE rental_quotations SET status=$1, updated_at=NOW()`;
  const params: unknown[] = [status];
  if (extra[status]) { sql += `, ${extra[status]}=NOW()`; }
  sql += ` WHERE id=$2 RETURNING *`;
  params.push(id);
  const [row] = await prisma.$queryRawUnsafe<Row[]>(sql, ...params).catch(()=>[]);
  if (!row) return NextResponse.json({error:'Not found'},{status:404});
  return NextResponse.json(row);
}
