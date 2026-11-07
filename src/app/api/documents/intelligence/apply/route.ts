export const dynamic = 'force-dynamic';

/**
 * POST /api/documents/intelligence/apply
 * ---------------------------------------
 * The Document Intelligence review queue's Approve / Reject.
 *
 *   { extractionId, action: 'APPLY', fields? }   approve
 *   { extractionId, action: 'REJECT', reason? }  reject: nothing is written
 *
 * Approval works from the stored extraction, never from data the browser
 * sends: only the reviewer's corrections in `fields` (the review form's
 * fields, review-fields.ts) are taken from the request.
 *
 *   Invoice, tax invoice, quotation, job card, proof of delivery: writes the
 *   real record (staged-records.ts).
 *   Vehicle and driver documents: updates the matched vehicle or driver, as
 *   before.
 *
 * Only an extraction still pending review can be approved or rejected. Each
 * decision leaves an audit row.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { ensureAgentSchema } from '@/lib/agents/schema';
import { autoPopulateFleet360Record } from '@/lib/agents/document-intelligence/auto-populator';
import { reviewFieldsFrom, stagedRecordKind, REVIEW_FIELD_LABELS, type ReviewFields } from '@/lib/agents/document-intelligence/review-fields';
import { writeApprovedRecord } from '@/lib/agents/document-intelligence/staged-records';
import { DocumentExtractionResult } from '@/lib/agents/types';
import { dispatchDocumentWebhook } from '@/lib/agents/document-intelligence/pipeline/webhook-dispatcher';
import { logAuditInTx } from '@/lib/audit';
import { withAuditedAction } from '@/lib/audited-action';

export const runtime = 'nodejs';

type ExtractionRow = {
  id: string;
  file_name: string | null;
  doc_category: string | null;
  extracted_data: unknown;
  auto_populate_status: string | null;
};

const parse = (v: unknown): DocumentExtractionResult =>
  (typeof v === 'string' ? JSON.parse(v) : v ?? {}) as DocumentExtractionResult;

/** The reviewer's corrections: only the review form's own fields, as strings. */
function correctionsFor(kind: ReturnType<typeof stagedRecordKind>, raw: unknown): ReviewFields {
  if (!kind || !raw || typeof raw !== 'object') return {};
  const out: ReviewFields = {};
  for (const [key] of REVIEW_FIELD_LABELS[kind]) {
    const v = (raw as Record<string, unknown>)[key];
    if (v !== undefined && v !== null) out[key] = String(v).slice(0, 500);
  }
  return out;
}

async function handlePOST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  try {
    return await review(req, authz);
  } catch (err) {
    console.error('[DocIntelligenceApplyAPI] Error:', err);
    return NextResponse.json({ error: 'Could not complete the review action' }, { status: 500 });
  }
}

async function review(req: NextRequest, authz: Extract<ReturnType<typeof requireAuthorizedTenant>, { ok: true }>) {
  const { tenantId } = authz;
  const actor = req.headers.get('x-user-email') || authz.userId || 'reviewer';
  await ensureAgentSchema();

  const body = stripTenantOwnershipFields(await req.json().catch(() => ({}))) as {
    extractionId?: string;
    action?: 'APPLY' | 'REJECT';
    reason?: string;
    fields?: Record<string, unknown>;
  };
  const extractionId = typeof body.extractionId === 'string' ? body.extractionId.trim() : '';
  const action = body.action === 'REJECT' ? 'REJECT' : 'APPLY';
  if (!extractionId) {
    return NextResponse.json({ error: 'extractionId is required' }, { status: 400 });
  }

  const outcome = await withTenantRls(prisma, tenantId, async (tx) => {
    const rows = await tx.$queryRawUnsafe<ExtractionRow[]>(
      `SELECT id::text, file_name, doc_category, extracted_data, auto_populate_status
         FROM document_intelligence_extractions
        WHERE id::text = $1 AND tenant_id = $2
        FOR UPDATE`,
      extractionId,
      tenantId,
    );
    const row = rows[0];
    if (!row) return { status: 404, body: { error: 'Extraction not found' } } as const;
    if (row.auto_populate_status === 'APPLIED' || row.auto_populate_status === 'REJECTED') {
      return { status: 409, body: { error: `This document was already ${row.auto_populate_status.toLowerCase()}.` } } as const;
    }

    const extraction = parse(row.extracted_data);
    const docCategory = row.doc_category || extraction.docCategory;

    if (action === 'REJECT') {
      await tx.$executeRawUnsafe(
        `UPDATE document_intelligence_extractions SET auto_populate_status = 'REJECTED' WHERE id::text = $1 AND tenant_id = $2`,
        extractionId,
        tenantId,
      );
      await logAuditInTx(
        {
          tenantId,
          entityType: 'DocumentExtraction',
          entityId: extractionId,
          entityName: row.file_name ?? undefined,
          userId: authz.userId ?? undefined,
          userRole: authz.role ?? undefined,
          action: 'REJECT',
          details: `Rejected ${docCategory} in review${body.reason ? `: ${String(body.reason).slice(0, 300)}` : ''}. Nothing was written.`,
        },
        tx,
      );
      return { status: 200, body: { success: true, status: 'REJECTED', message: 'Document rejected. Nothing was written.' }, event: 'DOCUMENT_REJECTED' as const, docCategory };
    }

    const kind = stagedRecordKind(docCategory);
    let result: { ok: boolean; entityType?: string; entityId?: string; message: string; fields?: ReviewFields };
    if (kind) {
      const fields = { ...reviewFieldsFrom({ ...extraction, docCategory: docCategory as DocumentExtractionResult['docCategory'] }), ...correctionsFor(kind, body.fields) };
      const written = await writeApprovedRecord(tx, { tenantId, extractionId, fileName: row.file_name || extractionId, kind, fields, actor });
      if (!written.ok) return { status: 400, body: { error: written.error } } as const;
      result = { ok: true, entityType: written.entityType, entityId: written.entityId, message: written.message, fields };
    } else {
      const populated = await autoPopulateFleet360Record(tenantId, extraction);
      if (!populated.success) return { status: 400, body: { error: populated.message } } as const;
      result = { ok: true, entityType: populated.linkedEntityType, entityId: populated.linkedEntityId, message: populated.message };
    }

    await tx.$executeRawUnsafe(
      `UPDATE document_intelligence_extractions
          SET auto_populate_status = 'APPLIED',
              lifecycle_status = 'ACTIVE',
              linked_entity_type = $3,
              linked_entity_id = $4,
              extracted_data = COALESCE(extracted_data, '{}'::jsonb) || jsonb_build_object('reviewedFields', $5::jsonb, 'reviewedBy', $6::text)
        WHERE id::text = $1 AND tenant_id = $2`,
      extractionId,
      tenantId,
      result.entityType && result.entityType !== 'NONE' ? result.entityType : null,
      result.entityId ?? null,
      JSON.stringify(result.fields ?? {}),
      actor,
    );
    await logAuditInTx(
      {
        tenantId,
        entityType: 'DocumentExtraction',
        entityId: extractionId,
        entityName: row.file_name ?? undefined,
        userId: authz.userId ?? undefined,
        userRole: authz.role ?? undefined,
        action: 'APPROVE',
        details: `Approved ${docCategory}: ${result.message}${result.entityId ? ` (${result.entityType} ${result.entityId})` : ''}`,
      },
      tx,
    );
    return {
      status: 200,
      body: { success: true, status: 'APPLIED', message: result.message, linkedEntityType: result.entityType ?? 'NONE', linkedEntityId: result.entityId ?? null },
      event: 'DOCUMENT_APPROVED' as const,
      docCategory,
      linked: { type: result.entityType, id: result.entityId },
    };
  });

  if ('event' in outcome && outcome.event) {
    dispatchDocumentWebhook(tenantId, outcome.event, {
      documentId: extractionId,
      docCategory: outcome.docCategory,
      ...('linked' in outcome && outcome.linked ? { linkedEntityType: outcome.linked.type, linkedEntityId: outcome.linked.id } : {}),
      ...(outcome.event === 'DOCUMENT_REJECTED' ? { reason: body.reason || 'Rejected during review' } : {}),
    }).catch((whErr) => console.warn('[DocIntelligenceApplyAPI] Webhook error:', whErr));
  }
  return NextResponse.json(outcome.body, { status: outcome.status });
}

// Approving writes Finance / Maintenance / Logistics records: audited.
export const POST = withAuditedAction(handlePOST);
