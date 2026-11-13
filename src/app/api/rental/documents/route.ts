export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { requireRentalPermission } from '@/lib/rental/rbac';
import { nextRentalSerial, withSavepoint } from '@/lib/rental/locks';
import {
  assertRentalForeignKeysInTenant,
  escapeIlikePattern,
  isRentalSecurityError,
  validateSafeDocumentOrSignatureUrl,
} from '@/lib/rental/security-guards';

/**
 * RAC Compliance Document Vault API
 * Table: rental_documents
 *
 * GET   /api/rental/documents?doc_type=&status=&search=
 * POST  /api/rental/documents        — upload new document record (auto-generates doc_ref)
 * PATCH /api/rental/documents        — verify or reject document (`rental:approve:documents`), or edit metadata
 */

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
    'documents',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const { searchParams } = new URL(req.url);
      const docType = searchParams.get('doc_type') ?? '';
      const status = searchParams.get('status') ?? '';
      const search = searchParams.get('search') ?? '';
      const customerId = searchParams.get('customerId') ?? '';
      const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit') ?? 100) || 100));

      const conds: string[] = ['d.tenant_id::text = $1', 'd.deleted_at IS NULL'];
      const params: unknown[] = [tenantId];
      let pi = 2;

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
        conds.push(
          `(d.customer_name ILIKE $${pi} ESCAPE '\\' OR d.doc_number ILIKE $${pi} ESCAPE '\\' OR d.doc_ref ILIKE $${pi} ESCAPE '\\')`,
        );
        params.push(`%${escapeIlikePattern(search)}%`);
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

      const documents = await withSavepoint<DocRow[]>(
        tx,
        'rental_docs_list',
        () =>
          tx.$queryRawUnsafe<DocRow[]>(
            `SELECT d.*,
                    CASE WHEN d.expiry_date IS NOT NULL
                      THEN CAST(CEIL(EXTRACT(EPOCH FROM (d.expiry_date::TIMESTAMPTZ - NOW())) / 86400) AS INT)
                      ELSE NULL
                    END AS days_to_expiry
               FROM rental_documents d
               ${where}
               ORDER BY d.created_at DESC
               LIMIT $${pi}`,
            ...params,
            limit,
          ),
        [],
      );

      type StatRow = {
        total: bigint;
        verified: bigint;
        pending: bigint;
        rejected: bigint;
        expired_or_expiring: bigint;
      };
      const statRows = await withSavepoint<StatRow[]>(
        tx,
        'rental_docs_stats',
        () =>
          tx.$queryRawUnsafe<StatRow[]>(
            `SELECT
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
             WHERE tenant_id::text = $1`,
            tenantId,
          ),
        [{ total: 0n, verified: 0n, pending: 0n, rejected: 0n, expired_or_expiring: 0n }],
      );
      const stats = statRows[0] ?? {
        total: 0n,
        verified: 0n,
        pending: 0n,
        rejected: 0n,
        expired_or_expiring: 0n,
      };

      return NextResponse.json({
        documents: documents.map((d) => ({
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
    'documents',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(
        (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
      );
      const {
        customerId,
        customerName,
        docType,
        docNumber,
        issuingAuthority,
        issueDate,
        expiryDate,
        nationality,
        fileUrl,
        notes,
      } = body;

      if (typeof customerName !== 'string' || !customerName.trim()) {
        return NextResponse.json({ error: 'Customer name is required' }, { status: 400 });
      }
      if (typeof docType !== 'string' || !docType.trim()) {
        return NextResponse.json({ error: 'Document type is required' }, { status: 400 });
      }

      const safeFileUrl = validateSafeDocumentOrSignatureUrl(fileUrl, {
        allowPdfDataUrl: true,
        fieldName: 'fileUrl',
      });

      const normalizedCustomerId =
        typeof customerId === 'string' && customerId.trim() ? customerId.trim() : null;
      if (normalizedCustomerId) {
        await assertRentalForeignKeysInTenant(tx, tenantId, {
          customerId: normalizedCustomerId,
        });
      }

      const now = new Date();
      const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
      const docRef = await nextRentalSerial(tx, {
        tenantId,
        series: `rental-document:${ym}`,
        prefix: `RDV-${ym}-`,
        table: 'rental_documents',
        column: 'doc_ref',
        padWidth: 4,
      });

      type NewDoc = { id: string; doc_ref: string };
      const [doc] = await tx.$queryRawUnsafe<NewDoc[]>(
        `INSERT INTO rental_documents
           (tenant_id, doc_ref, customer_id, customer_name, doc_type, doc_number, issuing_authority,
            issue_date, expiry_date, nationality, file_url, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id, doc_ref`,
        tenantId,
        docRef,
        normalizedCustomerId,
        customerName.trim(),
        docType.trim(),
        typeof docNumber === 'string' && docNumber.trim() ? docNumber.trim() : null,
        typeof issuingAuthority === 'string' && issuingAuthority.trim()
          ? issuingAuthority.trim()
          : null,
        issueDate || null,
        expiryDate || null,
        typeof nationality === 'string' && nationality.trim() ? nationality.trim() : null,
        safeFileUrl,
        typeof notes === 'string' && notes.trim() ? notes.trim() : null,
      );

      return NextResponse.json({ id: doc.id, docRef: doc.doc_ref }, { status: 201 });
    } catch (err) {
      if (isRentalSecurityError(err)) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      }
      console.error('[documents POST]', err);
      return NextResponse.json({ error: 'Failed to create document record' }, { status: 500 });
    }
  });
}

export async function PATCH(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const body = stripTenantOwnershipFields(
    (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
  );
  const { id, action, ...fields } = body;

  if (typeof id !== 'string' || !id.trim()) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }
  const docId = id.trim();

  if (action === 'verify' || action === 'reject') {
    const denied = await requireRentalPermission(
      req.headers,
      tenantId,
      'approve',
      'documents',
      req.nextUrl.pathname,
    );
    if (denied) return denied;
  } else {
    const denied = await requireRentalPermission(
      req.headers,
      tenantId,
      'edit',
      'documents',
      req.nextUrl.pathname,
    );
    if (denied) return denied;

    if ('status' in fields && fields.status != null) {
      const requestedStatus = String(fields.status).trim().toUpperCase();
      if (requestedStatus === 'VERIFIED' || requestedStatus === 'REJECTED') {
        return NextResponse.json(
          {
            error:
              'Use action="verify" or action="reject" with rental:approve:documents permission to verify or reject documents',
          },
          { status: 422 },
        );
      }
    }
  }

  const actorUserId = req.headers.get('x-user-id')?.trim() || 'staff';

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      if (action === 'verify') {
        const updated = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `UPDATE rental_documents
              SET status = 'VERIFIED',
                  verified_by = $1,
                  verified_at = NOW(),
                  updated_at = NOW()
            WHERE id::text = $2
              AND tenant_id::text = $3
              AND deleted_at IS NULL
            RETURNING id::text AS id`,
          actorUserId,
          docId,
          tenantId,
        );
        if (updated.length === 0) {
          return NextResponse.json({ error: 'Document not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true, status: 'VERIFIED' });
      }

      if (action === 'reject') {
        const rejectionReason =
          typeof fields.rejectionReason === 'string' ? fields.rejectionReason.trim() : '';
        if (!rejectionReason) {
          return NextResponse.json({ error: 'Rejection reason is required' }, { status: 400 });
        }
        const updated = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `UPDATE rental_documents
              SET status = 'REJECTED',
                  rejection_reason = $1,
                  verified_by = $2,
                  verified_at = NOW(),
                  updated_at = NOW()
            WHERE id::text = $3
              AND tenant_id::text = $4
              AND deleted_at IS NULL
            RETURNING id::text AS id`,
          rejectionReason,
          actorUserId,
          docId,
          tenantId,
        );
        if (updated.length === 0) {
          return NextResponse.json({ error: 'Document not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true, status: 'REJECTED' });
      }

      if ('fileUrl' in fields) {
        fields.fileUrl = validateSafeDocumentOrSignatureUrl(fields.fileUrl, {
          allowPdfDataUrl: true,
          fieldName: 'fileUrl',
        });
      }

      if (
        'customerId' in fields &&
        typeof fields.customerId === 'string' &&
        fields.customerId.trim()
      ) {
        await assertRentalForeignKeysInTenant(tx, tenantId, {
          customerId: fields.customerId.trim(),
        });
      }

      // General metadata update (status restricted to non-verification states)
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

      params.push(docId, tenantId);
      const updated = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `UPDATE rental_documents
            SET ${setClauses.join(', ')}
          WHERE id::text = $${pi}
            AND tenant_id::text = $${pi + 1}
            AND deleted_at IS NULL
          RETURNING id::text AS id`,
        ...params,
      );
      if (updated.length === 0) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }

      return NextResponse.json({ success: true });
    } catch (err) {
      if (isRentalSecurityError(err)) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      }
      console.error('[documents PATCH]', err);
      return NextResponse.json({ error: 'Failed to update document' }, { status: 500 });
    }
  });
}
