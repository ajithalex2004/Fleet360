/**
 * Batch Worker & Multi-File Split Service
 * ----------------------------------------
 * Manages asynchronous or synchronous processing of document batches:
 *  - Supports multi-document array uploads.
 *  - Supports single Zip archive unpack & processing using Node.js built-in `zlib`.
 *  - Tracks batch job state, progress metrics, and per-document results in `document_batch_jobs`.
 *  - Calculates Straight-Through Processing (STP) vs HITL review counts.
 */

import zlib from 'zlib';
import { prisma } from '@/lib/prisma';
import { executeDocumentControlPipeline, PipelineExecutionResult } from './index';

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
 * Lightweight in-memory Zip unpacker using Node.js native zlib.
 * Parses standard PKZIP 2.0 headers (PK\x03\x04).
 */
export function unpackZipBuffer(buffer: Buffer): BatchJobDocumentInput[] {
  const files: BatchJobDocumentInput[] = [];
  let offset = 0;

  while (offset < buffer.length - 30) {
    // Check for Local File Header Signature: 0x04034b50 ("PK\x03\x04")
    if (
      buffer[offset] === 0x50 &&
      buffer[offset + 1] === 0x4b &&
      buffer[offset + 2] === 0x03 &&
      buffer[offset + 3] === 0x04
    ) {
      const compressionMethod = buffer.readUInt16LE(offset + 8);
      const compressedSize = buffer.readUInt32LE(offset + 18);
      const uncompressedSize = buffer.readUInt32LE(offset + 22);
      const fileNameLength = buffer.readUInt16LE(offset + 26);
      const extraFieldLength = buffer.readUInt16LE(offset + 28);

      const fileNameStart = offset + 30;
      const fileNameEnd = fileNameStart + fileNameLength;
      const fileName = buffer.toString('utf8', fileNameStart, fileNameEnd);

      const fileDataStart = fileNameEnd + extraFieldLength;
      const fileDataEnd = fileDataStart + compressedSize;

      // Skip directory entries and hidden/OS metadata (e.g., __MACOSX)
      if (!fileName.endsWith('/') && !fileName.includes('__MACOSX') && !fileName.startsWith('.')) {
        let fileContentBuffer: Buffer | null = null;

        if (compressionMethod === 0) {
          // Stored (no compression)
          fileContentBuffer = buffer.subarray(fileDataStart, fileDataEnd);
        } else if (compressionMethod === 8) {
          // Deflated
          try {
            const compressedSlice = buffer.subarray(fileDataStart, fileDataEnd);
            fileContentBuffer = zlib.inflateRawSync(compressedSlice);
          } catch (zlibErr) {
            console.warn(`[BatchWorker] Failed to inflate entry "${fileName}":`, zlibErr);
          }
        }

        if (fileContentBuffer) {
          const lowerName = fileName.toLowerCase();
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
            ? fileContentBuffer.toString('utf8')
            : fileContentBuffer.toString('utf8', 0, Math.min(fileContentBuffer.length, 10000));

          files.push({
            fileName: fileName.split('/').pop() || fileName,
            documentText: docText,
            imageBase64: isImg ? fileContentBuffer.toString('base64') : undefined,
            mimeType,
          });
        }
      }

      // Advance to next record: Header (30) + Name + Extra + CompressedData
      offset = fileDataEnd;
    } else {
      offset++;
    }
  }

  return files;
}

/**
 * Creates and executes a document batch job, persisting progress in `document_batch_jobs`.
 */
export async function executeBatchJob(input: BatchProcessingInput): Promise<BatchJobSummary> {
  const { tenantId, batchName, autoApply = true } = input;
  let docsToProcess: BatchJobDocumentInput[] = [];

  if (input.zipBufferBase64) {
    try {
      const zipBuf = Buffer.from(input.zipBufferBase64, 'base64');
      docsToProcess = unpackZipBuffer(zipBuf);
    } catch (zipErr: any) {
      throw new Error(`Failed to extract Zip archive: ${zipErr.message}`);
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
    const insertRes = await prisma.$queryRawUnsafe<any[]>(`
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
    } catch (procErr: any) {
      processedCount++;
      failedCount++;
      reviewCount++;

      results.push({
        fileName: doc.fileName,
        error: procErr.message || 'Processing failed',
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
    const rows = await prisma.$queryRawUnsafe<any[]>(`
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
    const parsedResults = typeof r.results === 'string' ? JSON.parse(r.results) : r.results || [];

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
