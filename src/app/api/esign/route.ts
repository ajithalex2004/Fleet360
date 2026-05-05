import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * E-Signing — Admin List API
 *
 * GET /api/esign?status=&contractType=&search=&page=&limit=
 * Returns all signing requests with filters + summary counts by status
 */

type EsignRow = {
  id: string;
  signing_token: string;
  contract_id: string;
  contract_type: string;
  contract_ref: string;
  document_title: string;
  signer_name: string;
  signer_email: string | null;
  signer_phone: string;
  otp_expires_at: string;
  status: string;
  signed_at: string | null;
  signer_ip: string | null;
  signer_user_agent: string | null;
  sent_via: string;
  resend_count: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type CountRow = {
  status: string;
  count: string;
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status       = searchParams.get('status')       ?? '';
    const contractType = searchParams.get('contractType') ?? '';
    const search       = searchParams.get('search')       ?? '';
    const page         = Math.max(1, Number(searchParams.get('page') ?? 1));
    const limit        = Math.min(100, Number(searchParams.get('limit') ?? 50));
    const offset       = (page - 1) * limit;

    // ── Summary counts ────────────────────────────────────────────────────────
    const countRows = await prisma.$queryRawUnsafe<CountRow[]>(`
      SELECT status, COUNT(*)::text AS count
      FROM esign_requests
      GROUP BY status
    `);

    const summary = { PENDING: 0, SIGNED: 0, EXPIRED: 0, CANCELLED: 0, total: 0 };
    for (const row of countRows) {
      const n = parseInt(row.count, 10);
      summary.total += n;
      if (row.status === 'PENDING')   summary.PENDING   = n;
      if (row.status === 'SIGNED')    summary.SIGNED    = n;
      if (row.status === 'EXPIRED')   summary.EXPIRED   = n;
      if (row.status === 'CANCELLED') summary.CANCELLED = n;
    }

    // ── Build filters ─────────────────────────────────────────────────────────
    const conds: string[] = [];
    const params: unknown[] = [];
    let pi = 1;

    if (status) {
      conds.push(`status = $${pi++}`);
      params.push(status);
    }
    if (contractType) {
      conds.push(`contract_type = $${pi++}`);
      params.push(contractType);
    }
    if (search) {
      conds.push(`(signer_name ILIKE $${pi} OR contract_ref ILIKE $${pi} OR signer_phone ILIKE $${pi})`);
      params.push(`%${search}%`);
      pi++;
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    // ── Fetch total count for pagination ──────────────────────────────────────
    const totalRows = await prisma.$queryRawUnsafe<{ count: string }[]>(`
      SELECT COUNT(*)::text AS count FROM esign_requests ${where}
    `, ...params);
    const total = parseInt(totalRows[0]?.count ?? '0', 10);

    // ── Fetch paginated rows ──────────────────────────────────────────────────
    const rows = await prisma.$queryRawUnsafe<EsignRow[]>(`
      SELECT
        id, signing_token, contract_id, contract_type, contract_ref,
        document_title, signer_name, signer_email, signer_phone,
        otp_expires_at, status, signed_at, signer_ip, signer_user_agent,
        sent_via, resend_count, notes, created_at, updated_at
      FROM esign_requests
      ${where}
      ORDER BY created_at DESC
      LIMIT $${pi++} OFFSET $${pi++}
    `, ...params, limit, offset);

    return NextResponse.json({
      data: rows,
      summary,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });

  } catch (err: unknown) {
    console.error('[esign GET]', err);
    return NextResponse.json({ error: 'Failed to fetch signing requests' }, { status: 500 });
  }
}

// ── PATCH — cancel a signing request ─────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, action } = body;

    if (!id || action !== 'cancel') {
      return NextResponse.json({ error: 'id and action="cancel" are required' }, { status: 400 });
    }

    const rows = await prisma.$queryRawUnsafe<{ status: string }[]>(`
      SELECT status FROM esign_requests WHERE id = $1 LIMIT 1
    `, id);

    if (!rows.length) {
      return NextResponse.json({ error: 'Signing request not found' }, { status: 404 });
    }

    if (rows[0].status !== 'PENDING') {
      return NextResponse.json(
        { error: `Cannot cancel a ${rows[0].status} signing request` },
        { status: 409 }
      );
    }

    await prisma.$executeRawUnsafe(`
      UPDATE esign_requests SET status = 'CANCELLED', updated_at = NOW()
      WHERE id = $1
    `, id);

    return NextResponse.json({ success: true, message: 'Signing request cancelled.' });

  } catch (err: unknown) {
    console.error('[esign PATCH]', err);
    return NextResponse.json({ error: 'Failed to cancel signing request' }, { status: 500 });
  }
}
