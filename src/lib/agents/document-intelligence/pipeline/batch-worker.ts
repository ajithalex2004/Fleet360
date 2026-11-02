/**
 * Batch Worker & Multi-File Split Service
 * ----------------------------------------
 * Manages asynchronous or synchronous processing of document batches:
 *  - Supports multi-document array uploads.
 *  - Supports single Zip archive unpack & processing using Node.js built-in `zlib`.
 *  - Tracks batch job state, progress metrics, and per-document results in `document_batch_jobs`.
 *  - Calculates Straight-Through Processing (STP) vs HITL review counts.
 */

import { prisma } from '@/lib/prisma';
import { executeDocumentControlPipeline, PipelineExecutionResult } from './index';
import { readZipEntries, ZIP_LIMITS } from './zip-reader';

export interface BatchJobDocumentInput {
  fileName: string;
  documentText?: string;
  imageBase64?: string;
  mimeType?: string;
}

export interface BatchProcessingInput {
  tenantId: string;
  batchName: string;
  documents?: BatchJobDocumentInput[];
  zipBufferBase64?: string;
  autoApply?: boolean;
}

// Row shape for the `RETURNING id, created_at, updated_at` clause of the
// batch-job INSERT below — only `id` is actually read.
interface BatchJobInsertRow {
  id: string;
}

// Row shape for the `document_batch_jobs` SELECT in getBatchJobStatus below.
// `status` is safe as the strict literal union: this table is only ever
// written by this file's own INSERT ('PROCESSING') and UPDATE
// ('COMPLETED'|'FAILED'), so every value actually stored is a valid member.
interface BatchJobRow {
  id: string;
  batch_name: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  total_documents: number | string;
  processed_count: number | string;
  success_count: number | string;
  failed_count: number | string;
  stp_count: number | string;
  review_count: number | string;
  results: unknown;
  created_at: string;
  updated_at: string;
}

export interface BatchJobSummary {
  batchId: string;
  batchName: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  totalDocuments: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  stpCount: number;
  reviewCount: number;
  results: Array<{
    fileName: string;
    extractionId?: string;
    category?: string;
    riskScore?: number;
    riskLevel?: string;
    autoPopulateStatus?: string;
    error?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Unpacks a ZIP upload into batch documents, within ZIP_LIMITS
 * (zip-reader.ts). Throws ZipLimitError for an archive over the limits.
 */
export function unpackZipBuffer(buffer: Buffer): BatchJobDocumentInput[] {
  return readZipEntries(buffer).map(({ name, data }) => {
    const lowerName = name.toLowerCase();
    const isText = lowerName.endsWith('.txt') || lowerName.endsWith('.json') || lowerName.endsWith('.csv');
    const isPdf = lowerName.endsWith('.pdf');
    const isImg = lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') || lowerName.endsWith('.png');

    const mimeType = isPdf
      ? 'application/pdf'
      : isImg
      ? lowerName.endsWith('.png') ? 'image/png' : 'image/jpeg'
      : isText
      ? 'text/plain'
      : 'application/octet-stream';

    const docText = isText
      ? data.toString('utf8')
      : data.toString('utf8', 0, Math.min(data.length, 10000));

    return {
      fileName: name.split('/').pop() || name,
      documentText: docText,
      imageBase64: isImg ? data.toString('base64') : undefined,
      mimeType,
    };
  });
}

/**
 * Creates and executes a document batch job, persisting progress in `document_batch_jobs`.
 */
export async function executeBatchJob(input: BatchProcessingInput): Promise<BatchJobSummary> {
  const { tenantId, batchName, autoApply = true } = input;
  let docsToProcess: BatchJobDocumentInput[] = [];

  if (input.zipBufferBase64) {
    // Base64 is 4/3 of the bytes; refuse an oversized archive before decoding it.
    if (input.zipBufferBase64.length > Math.ceil((ZIP_LIMITS.maxTotalBytes * 4) / 3)) {
      throw new Error(`Zip archive exceeds ${ZIP_LIMITS.maxTotalBytes} bytes`);
    }
    try {
      const zipBuf = Buffer.from(input.zipBufferBase64, 'base64');
      docsToProcess = unpackZipBuffer(zipBuf);
    } catch (zipErr) {
      throw new Error(`Failed to extract Zip archive: ${zipErr instanceof Error ? zipErr.message : String(zipErr)}`);
    }
  } else if (input.documents && input.documents.length > 0) {
    docsToProcess = input.documents;
  }

  if (docsToProcess.length === 0) {
    throw new Error('No valid documents provided or extracted from batch archive');
  }

  const totalDocuments = docsToProcess.length;
  let batchId = `BATCH-${Date.now()}`;

  // 1. Initialize Batch in database
  try {
    const insertRes = await prisma.$queryRawUnsafe<BatchJobInsertRow[]>(`
      INSERT INTO document_batch_jobs (
        tenant_id, batch_name, status, total_documents, processed_count,
        success_count, failed_count, stp_count, review_count, results
      ) VALUES (
        $1, $2, 'PROCESSING', $3, 0,
        0, 0, 0, 0, '[]'::jsonb
      )
      RETURNING id, created_at, updated_at
    `,
      tenantId,
      batchName,
      totalDocuments
    );

    if (insertRes && insertRes[0]?.id) {
      batchId = insertRes[0].id;
    }
  } catch (dbErr) {
    console.warn('[BatchWorker] DB job init warning:', dbErr);
  }

  let processedCount = 0;
  let successCount = 0;
  let failedCount = 0;
  let stpCount = 0;
  let reviewCount = 0;
  const results: BatchJobSummary['results'] = [];

  // 2. Iterate and process each document through the specialist pipeline
  for (const doc of docsToProcess) {
    try {
      const pipelineRes: PipelineExecutionResult = await executeDocumentControlPipeline({
        tenantId,
        fileName: doc.fileName,
        documentText: doc.documentText,
        imageBase64: doc.imageBase64,
        mimeType: doc.mimeType,
        autoApply,
      });

      processedCount++;
      successCount++;

      if (pipelineRes.autoPopulate.status === 'APPLIED') {
        stpCount++;
      } else {
        reviewCount++;
      }

      results.push({
        fileName: doc.fileName,
        extractionId: pipelineRes.extractionId,
        category: pipelineRes.extraction.docCategory,
        riskScore: pipelineRes.riskEvaluation.riskScore,
        riskLevel: pipelineRes.riskEvaluation.riskLevel,
        autoPopulateStatus: pipelineRes.autoPopulate.status,
      });
    } catch (procErr) {
      processedCount++;
      failedCount++;
      reviewCount++;

      results.push({
        fileName: doc.fileName,
        error: procErr instanceof Error ? procErr.message : 'Processing failed',
      });
    }
  }

  const finalStatus: 'COMPLETED' | 'FAILED' = failedCount === totalDocuments ? 'FAILED' : 'COMPLETED';

  // 3. Update Batch in database
  try {
    await prisma.$queryRawUnsafe(`
      UPDATE document_batch_jobs
      SET status = $1,
          processed_count = $2,
          success_count = $3,
          failed_count = $4,
          stp_count = $5,
          review_count = $6,
          results = $7::jsonb,
          updated_at = NOW()
      WHERE id = $8::uuid AND tenant_id = $9
    `,
      finalStatus,
      processedCount,
      successCount,
      failedCount,
      stpCount,
      reviewCount,
      JSON.stringify(results),
      batchId,
      tenantId
    );
  } catch (updErr) {
    console.warn('[BatchWorker] DB job final update warning:', updErr);
  }

  return {
    batchId,
    batchName,
    status: finalStatus,
    totalDocuments,
    processedCount,
    successCount,
    failedCount,
    stpCount,
    reviewCount,
    results,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Retrieves the status and progress of a batch job.
 */
export async function getBatchJobStatus(tenantId: string, batchId: string): Promise<BatchJobSummary | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<BatchJobRow[]>(`
      SELECT id, batch_name, status, total_documents, processed_count,
             success_count, failed_count, stp_count, review_count, results,
             created_at, updated_at
      FROM document_batch_jobs
      WHERE id = $1::uuid AND tenant_id = $2
      LIMIT 1
    `, batchId, tenantId);

    if (!rows || rows.length === 0) {
      return null;
    }

    const r = rows[0];
    const parsedResults = (typeof r.results === 'string' ? JSON.parse(r.results) : r.results || []) as BatchJobSummary['results'];

    return {
      batchId: r.id,
      batchName: r.batch_name,
      status: r.status,
      totalDocuments: Number(r.total_documents) || 0,
      processedCount: Number(r.processed_count) || 0,
      successCount: Number(r.success_count) || 0,
      failedCount: Number(r.failed_count) || 0,
      stpCount: Number(r.stp_count) || 0,
      reviewCount: Number(r.review_count) || 0,
      results: parsedResults,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  } catch (err) {
    console.warn('[BatchWorker] getBatchJobStatus error:', err);
    return null;
  }
}
