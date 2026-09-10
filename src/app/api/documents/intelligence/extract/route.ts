export const dynamic = 'force-dynamic';

/**
 * POST /api/documents/intelligence/extract
 * -----------------------------------------
 * Ingests a document (PDF, Image, or plain text scan) and extracts key entities:
 * Vehicle (VIN, Plate, Make/Model), Driver (License, Emirates ID), Financials (Amounts, VAT, Currency),
 * Dates (Expiry, Issue), Supplier/Issuer, and Reference Numbers.
 * Optionally auto-populates/links with Fleet360 vehicle and driver records.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { ensureAgentSchema } from '@/lib/agents/schema';
import { DOCUMENT_INTELLIGENCE_AGENT } from '@/lib/agents/document-intelligence/agent';

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
      const contentType = req.headers.get('content-type') || '';

      let fileName = 'document.pdf';
      let mimeType = 'application/pdf';
      let imageBase64: string | undefined;
      let documentText: string | undefined;
      let autoApply = true;

      if (contentType.includes('multipart/form-data')) {
        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        const autoApplyField = formData.get('autoApply');
        const textParam = formData.get('documentText') as string | null;

        if (textParam) {
          documentText = textParam;
        }

        if (autoApplyField !== null) {
          autoApply = autoApplyField === 'true' || autoApplyField === '1';
        }

        if (file) {
          fileName = file.name;
          mimeType = file.type || 'application/pdf';
          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          imageBase64 = buffer.toString('base64');
        }
      } else {
        const body = await req.json();
        fileName = body.fileName || 'document.pdf';
        mimeType = body.mimeType || 'application/pdf';
        imageBase64 = body.imageBase64;
        documentText = body.documentText;
        if (body.autoApply !== undefined) {
          autoApply = Boolean(body.autoApply);
        }
      }

      const runResult = await DOCUMENT_INTELLIGENCE_AGENT.run({
        agent_id: 'document-intelligence',
        tenant_id: tenantId,
        event_type: 'document.uploaded',
        entity_id: fileName,
        metadata: {
          fileName,
          mimeType,
          imageBase64,
          documentText,
          autoApply,
        },
      });

      return NextResponse.json(runResult);
    } catch (err: any) {
      console.error('[DocIntelligenceExtractAPI] Error:', err);
      return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
  });
}
