export const dynamic = 'force-dynamic';

/**
 * POST /api/documents/intelligence/apply
 * ---------------------------------------
 * Applies extracted document entities to Fleet360 records (Vehicles, Drivers, Billing, Work Orders, Shipments).
 * Updates the auto_populate_status in `document_intelligence_extractions`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { ensureAgentSchema } from '@/lib/agents/schema';
import { autoPopulateFleet360Record } from '@/lib/agents/document-intelligence/auto-populator';
import { DocumentExtractionResult } from '@/lib/agents/types';
import { dispatchDocumentWebhook } from '@/lib/agents/document-intelligence/pipeline/webhook-dispatcher';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  await ensureAgentSchema();

  return withTenantRls(prisma, tenantId, async () => {
    try {
      const body = await req.json();
      const { extractionId, extractionData, action = 'APPLY' } = body as {
        extractionId?: string;
        extractionData?: DocumentExtractionResult;
        action?: 'APPLY' | 'REJECT';
      };

      if (action === 'REJECT') {
        if (extractionId) {
          try {
            await prisma.$queryRawUnsafe(`
              UPDATE document_intelligence_extractions
              SET auto_populate_status = 'REJECTED'
              WHERE id = $1 AND tenant_id = $2
            `, extractionId, tenantId);
          } catch (dbErr) {
            console.warn('[DocIntelligenceApplyAPI] Reject DB update warning:', dbErr);
          }
        }

        dispatchDocumentWebhook(tenantId, 'DOCUMENT_REJECTED', {
          documentId: extractionId || 'UNKNOWN',
          reason: body.reason || 'Rejected during Human-in-the-Loop review',
        }).catch((whErr) => console.warn('[DocIntelligenceApplyAPI] Webhook error:', whErr));

        return NextResponse.json({
          success: true,
          message: 'Document rejected successfully.',
          status: 'REJECTED',
        });
      }

      if (!extractionData) {
        return NextResponse.json({ error: 'extractionData is required for APPLY action' }, { status: 400 });
      }

      const result = await autoPopulateFleet360Record(tenantId, extractionData);

      if (extractionId) {
        try {
          await prisma.$queryRawUnsafe(`
            UPDATE document_intelligence_extractions
            SET auto_populate_status = $1,
                linked_entity_type = $2,
                linked_entity_id = $3
            WHERE id = $4 AND tenant_id = $5
          `,
            result.success ? 'APPLIED' : 'REJECTED',
            result.linkedEntityType !== 'NONE' ? result.linkedEntityType : null,
            result.linkedEntityId || null,
            extractionId,
            tenantId
          );
        } catch (dbErr) {
          console.warn('[DocIntelligenceApplyAPI] DB update warning:', dbErr);
        }

        // Dispatch Webhook on Approval / Rejection
        dispatchDocumentWebhook(
          tenantId,
          result.success ? 'DOCUMENT_APPROVED' : 'DOCUMENT_REJECTED',
          {
            documentId: extractionId,
            docCategory: extractionData.docCategory,
            linkedEntityType: result.linkedEntityType,
            linkedEntityId: result.linkedEntityId,
            updatedFields: result.updatedFields,
          }
        ).catch((whErr) => console.warn('[DocIntelligenceApplyAPI] Webhook error:', whErr));
      }

      return NextResponse.json({
        success: result.success,
        message: result.message,
        linkedEntityType: result.linkedEntityType,
        linkedEntityId: result.linkedEntityId,
        updatedFields: result.updatedFields,
      });
    } catch (err: any) {
      console.error('[DocIntelligenceApplyAPI] Error:', err);
      return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
  });
}
