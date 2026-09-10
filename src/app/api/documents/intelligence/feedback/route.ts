export const dynamic = 'force-dynamic';

/**
 * POST /api/documents/intelligence/feedback
 * -----------------------------------------
 * Records human reviewer corrections into `document_feedback_records`
 * to power continuous evaluation, prompt fine-tuning, and template adaptation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { ensureAgentSchema } from '@/lib/agents/schema';

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
        documentId,
        documentType,
        fieldName,
        predictedValue,
        correctedValue,
        reviewerId = 'human_reviewer',
        templateFamily,
      } = body;

      if (!documentId || !fieldName || correctedValue === undefined) {
        return NextResponse.json(
          { error: 'documentId, fieldName, and correctedValue are required' },
          { status: 400 }
        );
      }

      await prisma.$queryRawUnsafe(`
        INSERT INTO document_feedback_records (
          tenant_id, document_id, document_type, field_name,
          predicted_value, corrected_value, reviewer_id, model_version, template_family
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8, $9
        )
      `,
        tenantId,
        String(documentId),
        documentType || 'GENERAL',
        fieldName,
        predictedValue ? String(predictedValue) : null,
        String(correctedValue),
        reviewerId,
        'v2.0.0',
        templateFamily || null
      );

      return NextResponse.json({
        success: true,
        message: `Feedback recorded for field "${fieldName}". Thank you for training Fleet360 AI.`,
      });
    } catch (err: any) {
      console.error('[DocFeedbackAPI] Error:', err);
      return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
  });
}
