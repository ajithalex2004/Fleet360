export const dynamic = 'force-dynamic';

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
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { classifyDamage } from '@/lib/agents/damage-classifier/agent';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { governCopilot } from '@/lib/agents/copilot-governance';
import { requireRentalPermission } from '@/lib/rental/rbac';
import {
  detectFileKind,
  fileContentProblem,
  IMAGE_KINDS,
  type FileKind,
} from '@/lib/storage/file-type';

export const runtime = 'nodejs';
export const maxDuration = 90;

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB per image

const KIND_TO_MIME: Record<Extract<FileKind, 'png' | 'jpeg' | 'gif' | 'webp'>, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

function validateImageBytes(
  file: File,
  buf: Buffer,
): { ok: true; mimeType: string } | { ok: false; error: string } {
  if (buf.length === 0) {
    return { ok: false, error: 'Uploaded image file is empty.' };
  }
  const kind = detectFileKind(buf);
  if (!kind || !IMAGE_KINDS.includes(kind)) {
    return {
      ok: false,
      error: 'Unsupported file format. Only PNG, JPEG, GIF, and WEBP images are accepted.',
    };
  }
  if (file.name && file.name.includes('.')) {
    const problem = fileContentProblem(file.name, buf, IMAGE_KINDS);
    if (problem) {
      return { ok: false, error: problem };
    }
  }
  const verifiedMime = KIND_TO_MIME[kind as keyof typeof KIND_TO_MIME] ?? 'image/jpeg';
  return { ok: true, mimeType: verifiedMime };
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
    'view',
    '*',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  try {
    const form = await req.formData();
    const single = form.get('photo');
    const before = form.get('beforePhoto');
    const after = form.get('afterPhoto');

    const images: {
      buffer: Buffer;
      mimeType: string;
      label?: 'BEFORE_HANDOVER' | 'AFTER_RETURN' | 'PHOTO';
    }[] = [];

    if (single instanceof File && !before && !after) {
      if (single.size > MAX_BYTES) {
        return NextResponse.json(
          { error: `File too large (${single.size} bytes). Max ${MAX_BYTES}.` },
          { status: 413 },
        );
      }
      const buf = Buffer.from(await single.arrayBuffer());
      const check = validateImageBytes(single, buf);
      if (!check.ok) {
        return NextResponse.json({ error: check.error }, { status: 415 });
      }
      images.push({
        buffer: buf,
        mimeType: check.mimeType,
        label: 'PHOTO',
      });
    } else if (before instanceof File && after instanceof File) {
      if (before.size > MAX_BYTES || after.size > MAX_BYTES) {
        return NextResponse.json(
          { error: `One or both files exceed ${MAX_BYTES} bytes.` },
          { status: 413 },
        );
      }
      const beforeBuf = Buffer.from(await before.arrayBuffer());
      const beforeCheck = validateImageBytes(before, beforeBuf);
      if (!beforeCheck.ok) {
        return NextResponse.json({ error: `beforePhoto: ${beforeCheck.error}` }, { status: 415 });
      }

      const afterBuf = Buffer.from(await after.arrayBuffer());
      const afterCheck = validateImageBytes(after, afterBuf);
      if (!afterCheck.ok) {
        return NextResponse.json({ error: `afterPhoto: ${afterCheck.error}` }, { status: 415 });
      }

      images.push({
        buffer: beforeBuf,
        mimeType: beforeCheck.mimeType,
        label: 'BEFORE_HANDOVER',
      });
      images.push({
        buffer: afterBuf,
        mimeType: afterCheck.mimeType,
        label: 'AFTER_RETURN',
      });
    } else {
      return NextResponse.json(
        {
          error:
            'Send either { photo } for single mode OR { beforePhoto, afterPhoto } for diff mode.',
        },
        { status: 400 },
      );
    }

    const governed = await governCopilot(
      {
        tenantId,
        agentId: 'damage-classifier',
        eventType: 'rental.damage_classify_requested',
        modelAlias: 'VISION_HIGH_ACCURACY',
      },
      () => classifyDamage({ images }),
    );
    if (!governed.ok) {
      return NextResponse.json({ error: governed.reason }, { status: 403 });
    }
    const result = governed.value;
    if (!result.ok) {
      console.error('[damage classifier] upstream failure:', result.error, result.detail);
      return NextResponse.json(
        { error: 'AI damage classification failed. Please try again later.' },
        { status: 502 },
      );
    }

    void logAudit({
      tenantId,
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
