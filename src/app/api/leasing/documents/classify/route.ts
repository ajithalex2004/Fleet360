/**
 * POST /api/leasing/documents/classify
 *
 * Multipart form-data:
 *   file: image of a UAE compliance document (PNG / JPEG / WebP)
 *   expectedDocType?: hint for the classifier
 *
 * Returns: { ok, classification, meta } on success.
 *
 * The classification is NOT persisted — the UI uses it to prefill the
 * upload form. The user reviews the suggested fields and then submits
 * via the regular /api/leasing/documents/upload endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';
import { classifyDocument } from '@/lib/agents/doc-classifier/agent';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB cap on classification input

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    const expectedDocType = form.get('expectedDocType')
      ? String(form.get('expectedDocType'))
      : undefined;

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'No file uploaded. Send multipart form-data with a "file" field.' },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large for classification (${file.size} bytes). Max ${MAX_BYTES}.` },
        { status: 413 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await classifyDocument({
      buffer,
      mimeType: file.type || 'image/jpeg',
      expectedDocType,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error, detail: result.detail }, { status: 502 });
    }

    void logAudit({
      tenantId: req.headers.get('x-tenant-id') ?? undefined,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      entityType: 'AIDocClassifier',
      action: 'EXPORT',
      details: `Doc Classifier: ${result.classification.docType} (${result.classification.confidence} confidence) for "${file.name}" — ${result.modelUsed}, ${result.promptTokens + result.completionTokens} tokens, ${result.durationMs}ms.`,
    });

    return NextResponse.json({
      ok: true,
      classification: result.classification,
      meta: {
        modelUsed: result.modelUsed,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        durationMs: result.durationMs,
      },
    });
  } catch (err) {
    captureException(err, { context: 'leasing.documents.classify' });
    console.error('[doc classifier] error:', err);
    return NextResponse.json({ error: 'Classification failed' }, { status: 500 });
  }
}
