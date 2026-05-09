/**
 * POST /api/leasing/quotations/copilot
 *
 * Body: { brief: string }    (1-2 paragraphs in English or Arabic)
 *
 * Returns: { suggestion: SuggestedQuotation, ... } on success
 *          { error: string, ... }                  on failure
 *
 * The suggestion is NOT persisted — the UI shows it for review and the user
 * decides whether to apply it to a new quotation form.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generateQuotationSuggestion } from '@/lib/agents/quotation-copilot/agent';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';
export const maxDuration = 60; // OpenAI calls can take 10–30s

const bodySchema = z.object({
  brief: z.string().min(10, 'Brief must be at least 10 characters').max(4000, 'Brief is too long (max 4000 chars)'),
});

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
        },
        { status: 400 },
      );
    }

    const result = await generateQuotationSuggestion(parsed.data.brief);

    if (!result.ok) {
      return NextResponse.json({ error: result.error, detail: result.detail }, { status: 502 });
    }

    void logAudit({
      tenantId: req.headers.get('x-tenant-id') ?? undefined,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      entityType: 'AICopilot',
      action: 'EXPORT', // Closest existing action for "AI generation"
      details: `Quotation Co-pilot: ${result.suggestion.vehicles.length} vehicle line(s), ${result.suggestion.durationMonths} months, ${result.suggestion.confidence} confidence (${result.modelUsed}, ${result.promptTokens + result.completionTokens} tokens, ${result.durationMs}ms).`,
    });

    return NextResponse.json({
      ok: true,
      suggestion: result.suggestion,
      meta: {
        modelUsed: result.modelUsed,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        durationMs: result.durationMs,
      },
    });
  } catch (err) {
    captureException(err, { context: 'leasing.quotations.copilot' });
    console.error('[copilot] error:', err);
    return NextResponse.json({ error: 'Co-pilot request failed' }, { status: 500 });
  }
}
