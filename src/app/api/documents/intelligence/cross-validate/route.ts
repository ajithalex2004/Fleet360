export const dynamic = 'force-dynamic';

/**
 * POST /api/documents/intelligence/cross-validate
 * ------------------------------------------------
 * Runs real-time Master Data cross-validation and Cross-Document Chain reconciliation
 * for an extracted entity payload against Fleet360 records.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { ensureAgentSchema } from '@/lib/agents/schema';
import { crossCheckWithMasterData } from '@/lib/agents/document-intelligence/pipeline/cross-checker';
import { reconcileCrossDocumentChain } from '@/lib/agents/document-intelligence/pipeline/cross-doc-intelligence';
import { DocumentExtractionResult } from '@/lib/agents/types';

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
      const { extraction, linkedQuotation, linkedPo, linkedWorkOrder } = body as {
        extraction: DocumentExtractionResult;
        linkedQuotation?: any;
        linkedPo?: any;
        linkedWorkOrder?: any;
      };

      if (!extraction) {
        return NextResponse.json({ error: 'extraction object is required' }, { status: 400 });
      }

      // 1. Cross-check Master Records
      const masterCheck = await crossCheckWithMasterData(tenantId, extraction);

      // 2. Reconcile Multi-Document Chain
      const crossDocResult = reconcileCrossDocumentChain({
        currentExtraction: extraction,
        linkedQuotation,
        linkedPo,
        linkedWorkOrder,
      });

      return NextResponse.json({
        masterCheck,
        crossDocResult,
        isValid: masterCheck.passed && !crossDocResult.anomalyDetected,
      });
    } catch (err: any) {
      console.error('[DocCrossValidateAPI] Error:', err);
      return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
  });
}
