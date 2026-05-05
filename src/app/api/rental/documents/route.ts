import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * RAC Compliance Document Vault API
 * Table: rental_documents
 *
 * GET   /api/rental/documents?doc_type=&status=&search=
 * POST  /api/rental/documents        — upload new document record (auto-generates doc_ref)
 * PATCH /api/rental/documents        — verify or reject document
 */

async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS rental_documents (
      id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at          TIMESTAMPTZ,
      doc_ref             TEXT        UNIQUE NOT NULL,
      customer_id         TEXT,
      customer_name       TEXT        NOT NULL,
      doc_type            TEXT        NOT NULL,
      doc_number          TEXT,
      issuing_authority   TEXT,
      issue_date          DATE,
      expiry_date         DATE,
      nationality         TEXT,
      status              TEXT        NOT NULL DEFAULT 'PENDING_VERIFICATION',
      verified_by         TEXT,
      verified_at         TIMESTAMPTZ,
      rejection_reason    TEXT,
      file_url            TEXT,
      notes               TEXT
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_rdv_status ON rental_documents(status)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_rdv_doc_type ON rental_documents(doc_type)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_rdv_expiry ON rental_documents(expiry_date)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_rdv_customer ON rental_documents(customer_id)
  `);
}

export async function GET(req: NextRequest) {
  try {
    await ensureTable();
    const { searchParams } = new URL(req.url);
    const docType  = searchParams.get('doc_type')  ?? '';
    const status   = searchParams.get('status')    ?? '';
    const search   = searchParams.get('search')    ?? '';
    const customerId = searchParams.get('customerId') ?? '';
    const limit    = Math.min(200, Number(searchParams.get('limit') ?? 100));

    const conds: string[] = ['d.deleted_at IS NULL'];
    const params: unknown[] = [];
    let pi = 1;

    if (docType && docType !== 'ALL') {
      conds.push(`d.doc_type = $${pi++}`);
      params.push(docType);
    }

    if (status && status !== 'ALL') {
      if (status === 'EXPIRED') {
        conds.push(`d.expiry_date < NOW()`);
      } else {
        conds.push(`d.status = $${pi++}`);
        params.push(status);
      }
    }

    if (customerId) {
      conds.push(`d.customer_id = $${pi++}`);
      params.push(customerId);
    }

    if (search) {
      conds.push(`(d.customer_name ILIKE $${pi} OR d.doc_number ILIKE $${pi} OR d.doc_ref ILIKE $${pi})`);
      params.push(`%${search}%`);
      pi++;
    }

    const where = `WHERE ${conds.join(' AND ')}`;

    type DocRow = {
      id: string;
      doc_ref: string;
      customer_id: string | null;
      customer_name: string;
      doc_type: string;
      doc_number: string | null;
      issuing_authority: string | null;
      issue_date: string | null;
      expiry_date: string | null;
      nationality: string | null;
      status: string;
      verified_by: string | null;
      verified_at: string | null;
      rejection_reason: string | null;
      file_url: string | null;
      notes: string | null;
      created_at: string;
      updated_at: string;
      days_to_expiry: number | null;
    };

    const documents = await prisma.$queryRawUnsafe<DocRow[]>(
      `SELECT d.*,
              CASE WHEN d.expiry_date IS NOT NULL
                THEN CAST(CEIL(EXTRACT(EPOCH FROM (d.expiry_date::TIMESTAMPTZ - NOW())) / 86400) AS INT)
                ELSE NULL
              END AS days_to_expiry
         FROM rental_documents d
         ${where}
         ORDER BY d.created_at DESC
         LIMIT $${pi}`,
      ...params, limit
    ).catch(() => [] as DocRow[]);

    // KPI Stats
    type StatRow = {
      total: bigint;
      verified: bigint;
      pending: bigint;
      rejected: bigint;
      expired_or_expiring: bigint;
    };
    const [stats] = await prisma.$queryRawUnsafe<StatRow[]>(`
      SELECT
        COUNT(*) FILTER (WHERE deleted_at IS NULL) AS total,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'VERIFIED') AS verified,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'PENDING_VERIFICATION') AS pending,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'REJECTED') AS rejected,
        COUNT(*) FILTER (
          WHERE deleted_at IS NULL
            AND expiry_date IS NOT NULL
            AND expiry_date <= NOW() + INTERVAL '30 days'
        ) AS expired_or_expiring
      FROM rental_documents
    `).catch(() => [{ total: 0n, verified: 0n, pending: 0n, rejected: 0n, expired_or_expiring: 0n }]);

    return NextResponse.json({
      documents: documents.map(d => ({
        id: d.id,
        docRef: d.doc_ref,
        customerId: d.customer_id,
        customerName: d.customer_name,
        docType: d.doc_type,
        docNumber: d.doc_number,
        issuingAuthority: d.issuing_authority,
        issueDate: d.issue_date,
        expiryDate: d.expiry_date,
        nationality: d.nationality,
        status: d.status,
        verifiedBy: d.verified_by,
        verifiedAt: d.verified_at,
        rejectionReason: d.rejection_reason,
        fileUrl: d.file_url,
        notes: d.notes,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
        daysToExpiry: d.days_to_expiry,
      })),
      stats: {
        total: Number(stats.total),
        verified: Number(stats.verified),
        pending: Number(stats.pending),
        rejected: Number(stats.rejected),
        expiredOrExpiring: Number(stats.expired_or_expiring),
      },
    });
  } catch (err) {
    console.error('[documents GET]', err);
    return NextResponse.json({ error: 'Failed to load documents' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTable();
    const body = await req.json();
    const {
      customerId, customerName, docType, docNumber, issuingAuthority,
      issueDate, expiryDate, nationality, fileUrl, notes,
    } = body;

    if (!customerName?.trim()) return NextResponse.json({ error: 'Customer name is required' }, { status: 400 });
    if (!docType?.trim())      return NextResponse.json({ error: 'Document type is required' }, { status: 400 });

    // Auto-generate doc_ref: RDV-YYYYMM-XXXX
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const rand = Math.floor(Math.random() * 9000) + 1000;
    const docRef = `RDV-${ym}-${rand}`;

    type NewDoc = { id: string; doc_ref: string };
    const [doc] = await prisma.$queryRawUnsafe<NewDoc[]>(
      `INSERT INTO rental_documents
         (doc_ref, customer_id, customer_name, doc_type, doc_number, issuing_authority,
          issue_date, expiry_date, nationality, file_url, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, doc_ref`,
      docRef,
      customerId || null,
      customerName.trim(),
      docType.trim(),
      docNumber || null,
      issuingAuthority || null,
      issueDate || null,
      expiryDate || null,
      nationality || null,
      fileUrl || null,
      notes || null
    );

    return NextResponse.json({ id: doc.id, docRef: doc.doc_ref }, { status: 201 });
  } catch (err) {
    console.error('[documents POST]', err);
    return NextResponse.json({ error: 'Failed to create document record' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureTable();
    const body = await req.json();
    const { id, action, ...fields } = body;

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    if (action === 'verify') {
      const { verifiedBy } = fields;
      await prisma.$executeRawUnsafe(
        `UPDATE rental_documents
            SET status = 'VERIFIED', verified_by = $1, verified_at = NOW(), updated_at = NOW()
          WHERE id = $2`,
        verifiedBy || 'System',
        id
      );
      return NextResponse.json({ success: true, status: 'VERIFIED' });
    }

    if (action === 'reject') {
      const { rejectionReason } = fields;
      if (!rejectionReason?.trim()) {
        return NextResponse.json({ error: 'Rejection reason is required' }, { status: 400 });
      }
      await prisma.$executeRawUnsafe(
        `UPDATE rental_documents
            SET status = 'REJECTED', rejection_reason = $1, updated_at = NOW()
          WHERE id = $2`,
        rejectionReason.trim(),
        id
      );
      return NextResponse.json({ success: true, status: 'REJECTED' });
    }

    // General update
    const colMap: Record<string, string> = {
      customerId: 'customer_id',
      customerName: 'customer_name',
      docType: 'doc_type',
      docNumber: 'doc_number',
      issuingAuthority: 'issuing_authority',
      issueDate: 'issue_date',
      expiryDate: 'expiry_date',
      nationality: 'nationality',
      status: 'status',
      fileUrl: 'file_url',
      notes: 'notes',
    };

    const setClauses: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    let pi = 1;

    for (const [key, col] of Object.entries(colMap)) {
      if (key in fields) {
        setClauses.push(`${col} = $${pi++}`);
        params.push(fields[key] === '' ? null : fields[key]);
      }
    }

    params.push(id);
    await prisma.$executeRawUnsafe(
      `UPDATE rental_documents SET ${setClauses.join(', ')} WHERE id = $${pi}`,
      ...params
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[documents PATCH]', err);
    return NextResponse.json({ error: 'Failed to update document' }, { status: 500 });
  }
}
