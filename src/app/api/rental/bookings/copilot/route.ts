/**
 * POST /api/rental/bookings/copilot
 *
 * Body: { brief: string }   (English / Arabic / mixed)
 * Returns: { ok, suggestion, meta } on success.
 *
 * The suggestion is NOT persisted — the UI shows it for review and the user
 * decides whether to apply it to a new booking form.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generateRentalSuggestion } from '@/lib/agents/rental-copilot/agent';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';
export const maxDuration = 60;

const bodySchema = z.object({
  brief: z.string().min(10).max(4000),
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

    const result = await generateRentalSuggestion(parsed.data.brief);
    if (!result.ok) {
      return NextResponse.json({ error: result.error, detail: result.detail }, { status: 502 });
    }

    void logAudit({
      tenantId: req.headers.get('x-tenant-id') ?? undefined,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      entityType: 'AIRentalCopilot',
      action: 'EXPORT',
      details: `Rental Co-pilot: ${result.suggestion.vehicleCategory} × ${result.suggestion.totalDays}d, ${result.suggestion.ancillaries.length} ancillaries, ${result.suggestion.confidence} confidence (${result.modelUsed}, ${result.promptTokens + result.completionTokens} tokens, ${result.durationMs}ms).`,
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
    captureException(err, { context: 'rental.bookings.copilot' });
    console.error('[rental copilot] error:', err);
    return NextResponse.json({ error: 'Co-pilot request failed' }, { status: 500 });
  }
}
