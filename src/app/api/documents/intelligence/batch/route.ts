export const dynamic = 'force-dynamic';

/**
 * /api/documents/intelligence/batch
 * ----------------------------------
 * POST: Initiates a batch processing job (accepts either a Zip base64 string or an array of documents)
 * GET:  Queries batch job status and processing metrics by batchId
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { ensureAgentSchema } from '@/lib/agents/schema';
import {
  executeBatchJob,
  getBatchJobStatus,
  BatchProcessingInput,
} from '@/lib/agents/document-intelligence/pipeline/batch-worker';

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
      const {
        batchName = `Batch-${new Date().toISOString().slice(0, 10)}`,
        documents,
        zipBufferBase64,
        autoApply = true,
      } = body as {
        batchName?: string;
        documents?: any[];
        zipBufferBase64?: string;
        autoApply?: boolean;
      };

      if (!zipBufferBase64 && (!documents || documents.length === 0)) {
        return NextResponse.json(
          { error: 'Either zipBufferBase64 or documents array must be provided' },
          { status: 400 }
        );
      }

      const input: BatchProcessingInput = {
        tenantId,
        batchName,
        documents,
        zipBufferBase64,
        autoApply,
      };

      const result = await executeBatchJob(input);

      return NextResponse.json({
        success: true,
        batch: result,
      });
    } catch (err: any) {
      console.error('[DocIntelligenceBatchAPI] POST error:', err);
      return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
  });
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  await ensureAgentSchema();

  return withTenantRls(prisma, tenantId, async () => {
    try {
      const batchId = req.nextUrl.searchParams.get('batchId');
      if (!batchId) {
        // Return latest 20 batch jobs for this tenant
        const rows = await prisma.$queryRawUnsafe<any[]>(`
          SELECT id, batch_name, status, total_documents, processed_count,
                 success_count, failed_count, stp_count, review_count, results,
                 created_at, updated_at
          FROM document_batch_jobs
          WHERE tenant_id = $1
          ORDER BY created_at DESC
          LIMIT 20
        `, tenantId);

        const batches = (rows || []).map((r) => ({
          batchId: r.id,
          batchName: r.batch_name,
          status: r.status,
          totalDocuments: Number(r.total_documents) || 0,
          processedCount: Number(r.processed_count) || 0,
          successCount: Number(r.success_count) || 0,
          failedCount: Number(r.failed_count) || 0,
          stpCount: Number(r.stp_count) || 0,
          reviewCount: Number(r.review_count) || 0,
          results: typeof r.results === 'string' ? JSON.parse(r.results) : r.results || [],
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        }));

        return NextResponse.json({ success: true, batches });
      }

      const status = await getBatchJobStatus(tenantId, batchId);
      if (!status) {
        return NextResponse.json({ error: 'Batch job not found' }, { status: 404 });
      }

      return NextResponse.json({ success: true, batch: status });
    } catch (err: any) {
      console.error('[DocIntelligenceBatchAPI] GET error:', err);
      return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
  });
}
