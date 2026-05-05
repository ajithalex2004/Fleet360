/**
 * Rental Inquiries API — /api/rental/inquiries
 * Tracks rental leads before booking is confirmed
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const INIT = `
  CREATE TABLE IF NOT EXISTS rental_inquiries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    inquiry_no      TEXT UNIQUE NOT NULL,
    customer_name   TEXT NOT NULL,
    email           TEXT,
    phone           TEXT NOT NULL,
    vehicle_type    TEXT,
    pickup_location TEXT,
    pickup_date     DATE,
    return_date     DATE,
    rental_days     INT,
    status          TEXT DEFAULT 'NEW',
    source          TEXT DEFAULT 'WALK_IN',
    assigned_to     TEXT,
    notes           TEXT,
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
  const [r] = await prisma.$queryRawUnsafe<{count:string}[]>(`SELECT COUNT(*)::text as count FROM rental_inquiries`).catch(()=>[{count:'0'}]);
  const seq = (parseInt(r?.count??'0')+1).toString().padStart(4,'0');
  const ym = new Date().toISOString().slice(0,7).replace('-','');
  return `RIQ-${ym}-${seq}`;
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
  if (search) { where += ` AND (customer_name ILIKE $${pi} OR phone ILIKE $${pi} OR email ILIKE $${pi})`; params.push(`%${search}%`); pi++; }

  const [rows, counts] = await Promise.all([
    prisma.$queryRawUnsafe<Row[]>(`SELECT * FROM rental_inquiries ${where} ORDER BY created_at DESC LIMIT $${pi} OFFSET $${pi+1}`, ...params, limit, offset).catch(()=>[]),
    prisma.$queryRawUnsafe<{status:string;count:string}[]>(`SELECT status, COUNT(*)::text as count FROM rental_inquiries WHERE deleted_at IS NULL GROUP BY status`).catch(()=>[]),
  ]);
  return NextResponse.json({ data: rows, counts, page, limit });
}

export async function POST(req: NextRequest) {
  await ensureSchema();
  const body = await req.json();
  const inquiryNo = await nextNo();
  const days = body.pickupDate && body.returnDate
    ? Math.max(1, Math.ceil((new Date(body.returnDate).getTime() - new Date(body.pickupDate).getTime()) / 86400000))
    : null;
  let row: Row | undefined;
  try {
    [row] = await prisma.$queryRawUnsafe<Row[]>(
      `INSERT INTO rental_inquiries (inquiry_no,customer_name,email,phone,vehicle_type,pickup_location,pickup_date,return_date,rental_days,status,source,assigned_to,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$11,$12,$13) RETURNING *`,
      inquiryNo, body.customerName, body.email??null, body.phone, body.vehicleType??null,
      body.pickupLocation??null, body.pickupDate??null, body.returnDate??null, days,
      body.status??'NEW', body.source??'WALK_IN', body.assignedTo??null, body.notes??null
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/rental/inquiries] INSERT error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  if (!row) return NextResponse.json({error:'No row returned'},{status:500});
  return NextResponse.json(row, {status:201});
}

export async function PATCH(req: NextRequest) {
  await ensureSchema();
  const body = await req.json();
  const { id, ...fields } = body;
  const sets: string[] = [];
  const params: unknown[] = [];
  let pi = 1;
  const map: Record<string,string> = {
    customerName:'customer_name', email:'email', phone:'phone', vehicleType:'vehicle_type',
    pickupLocation:'pickup_location', pickupDate:'pickup_date', returnDate:'return_date',
    status:'status', assignedTo:'assigned_to', notes:'notes', convertedTo:'converted_to'
  };
  for (const [k,col] of Object.entries(map)) {
    if (k in fields) { sets.push(`${col}=$${pi++}`); params.push(fields[k]); }
  }
  if (!sets.length) return NextResponse.json({error:'Nothing to update'},{status:400});
  sets.push(`updated_at=NOW()`);
  params.push(id);
  const [row] = await prisma.$queryRawUnsafe<Row[]>(`UPDATE rental_inquiries SET ${sets.join(',')} WHERE id=$${pi} RETURNING *`, ...params).catch(()=>[]);
  if (!row) return NextResponse.json({error:'Not found'},{status:404});
  return NextResponse.json(row);
}
