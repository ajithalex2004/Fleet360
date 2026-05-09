/**
 * POST /api/rental/damage-claims/classify
 *
 * Multipart form-data:
 *   photo (single mode) — one image
 *   OR
 *   beforePhoto + afterPhoto (diff mode) — both images
 *
 * Returns: { ok, classification, meta } on success.
 *
 * The classification is NOT persisted — staff review the AI output and
 * create / edit a DamageClaim with the prefilled fields.
 */

import { NextRequest, NextResponse } from 'next/server';
import { classifyDamage } from '@/lib/agents/damage-classifier/agent';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';
export const maxDuration = 90;

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB per image

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const single = form.get('photo');
    const before = form.get('beforePhoto');
    const after = form.get('afterPhoto');

    const images: { buffer: Buffer; mimeType: string; label?: 'BEFORE_HANDOVER' | 'AFTER_RETURN' | 'PHOTO' }[] = [];

    if (single instanceof File && !before && !after) {
      if (single.size > MAX_BYTES) {
        return NextResponse.json({ error: `File too large (${single.size} bytes). Max ${MAX_BYTES}.` }, { status: 413 });
      }
      images.push({
        buffer: Buffer.from(await single.arrayBuffer()),
        mimeType: single.type || 'image/jpeg',
        label: 'PHOTO',
      });
    } else if (before instanceof File && after instanceof File) {
      if (before.size > MAX_BYTES || after.size > MAX_BYTES) {
        return NextResponse.json({ error: `One or both files exceed ${MAX_BYTES} bytes.` }, { status: 413 });
      }
      images.push({
        buffer: Buffer.from(await before.arrayBuffer()),
        mimeType: before.type || 'image/jpeg',
        label: 'BEFORE_HANDOVER',
      });
      images.push({
        buffer: Buffer.from(await after.arrayBuffer()),
        mimeType: after.type || 'image/jpeg',
        label: 'AFTER_RETURN',
      });
    } else {
      return NextResponse.json(
        { error: 'Send either { photo } for single mode OR { beforePhoto, afterPhoto } for diff mode.' },
        { status: 400 },
      );
    }

    const result = await classifyDamage({ images });
    if (!result.ok) {
      return NextResponse.json({ error: result.error, detail: result.detail }, { status: 502 });
    }

    void logAudit({
      tenantId: req.headers.get('x-tenant-id') ?? undefined,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      entityType: 'AIDamageClassifier',
      action: 'EXPORT',
      details: `Damage Classifier (${result.classification.mode}): ${result.classification.damages.length} damage(s), AED ${result.classification.billableEstimateMin}-${result.classification.billableEstimateMax} billable. Condition=${result.classification.overallCondition}, roadworthy=${result.classification.vehicleLooksRoadworthy}. ${result.modelUsed}, ${result.promptTokens + result.completionTokens} tokens, ${result.durationMs}ms.`,
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
    captureException(err, { context: 'rental.damage-claims.classify' });
    console.error('[damage classifier] error:', err);
    return NextResponse.json({ error: 'Classification failed' }, { status: 500 });
  }
}
