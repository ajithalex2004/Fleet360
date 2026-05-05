/**
 * POST /api/leasing/contracts-v2/[id]/qa
 *
 * Body: { question: string }   (English, Arabic, or mixed)
 *
 * Returns: { ok, answer, toolsCalled[], meta } on success.
 *
 * The agent looks up the contract / payment schedule / mileage / invoices
 * via tool calls and returns a concise NL answer in the user's language.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { answerContractQuestion } from '@/lib/agents/contract-qa/agent';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';
export const maxDuration = 60;

const bodySchema = z.object({
  question: z.string().min(3).max(2000),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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

    const result = await answerContractQuestion(id, parsed.data.question);
    if (!result.ok) {
      return NextResponse.json({ error: result.error, detail: result.detail }, { status: 502 });
    }

    void logAudit({
      tenantId: req.headers.get('x-tenant-id') ?? undefined,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      entityType: 'AIContractQA',
      entityId: id,
      action: 'EXPORT',
      details: `Contract Q&A: tools=[${result.toolsCalled.join(',')}], ${result.modelUsed}, ${result.promptTokens + result.completionTokens} tokens, ${result.durationMs}ms.`,
    });

    return NextResponse.json({
      ok: true,
      answer: result.answer,
      toolsCalled: result.toolsCalled,
      meta: {
        modelUsed: result.modelUsed,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        durationMs: result.durationMs,
      },
    });
  } catch (err) {
    captureException(err, { context: 'leasing.contract-qa', tags: { contractId: id } });
    console.error('[contract qa] error:', err);
    return NextResponse.json({ error: 'Q&A request failed' }, { status: 500 });
  }
}
