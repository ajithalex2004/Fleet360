/**
 * GET  /api/dispatch/respond?token=XXX&action=accept|reject
 * POST /api/dispatch/respond   body: { token, action, reason? }
 *
 * Handles driver accept/reject links from WhatsApp and in-app.
 * GET version is used by the WhatsApp accept link (opens in browser).
 */
import { NextRequest, NextResponse } from 'next/server';
import { handleDriverResponse } from '@/lib/dispatch/engine';
import { prisma }               from '@/lib/prisma';
import { dispatch as agentDispatch } from '@/lib/agents/orchestrator';

async function handle(token: string, action: string, reason: string | undefined, baseUrl: string) {
  if (!token)  return NextResponse.json({ error: 'token is required' },  { status: 400 });
  if (!action) return NextResponse.json({ error: 'action is required' }, { status: 400 });
  if (!['accept', 'reject', 'timeout'].includes(action)) {
    return NextResponse.json({ error: 'action must be accept | reject | timeout' }, { status: 400 });
  }

  const result = await handleDriverResponse(
    token,
    action as 'accept' | 'reject' | 'timeout',
    reason,
    baseUrl,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 404 });
  }

  // ── On rejection / timeout — re-run optimiser so a new driver is ranked immediately ──
  if ((action === 'reject' || action === 'timeout') && result.jobId) {
    // Look up tenant_id from the job (needed for the agent's SQL filter)
    prisma.$queryRawUnsafe<{ tenant_id: string }[]>(
      `SELECT tenant_id FROM dispatch_jobs WHERE id = $1::uuid LIMIT 1`,
      result.jobId,
    ).then(rows => {
      const tenantId = rows[0]?.tenant_id ?? 'default';
      return agentDispatch({
        agent_id:   'dispatch-optimiser',
        event_type: 'dispatch.job_reassign',
        tenant_id:  tenantId,
        entity_id:  result.jobId,
        payload:    { reason: reason ?? action },
      });
    }).catch(err =>
      console.warn('[dispatch/respond] reassign optimiser trigger failed (non-fatal):', err),
    );
  }

  return NextResponse.json({ ok: true, jobId: result.jobId, message: result.message });
}

/** GET — WhatsApp link click (opens in browser, returns JSON) */
export async function GET(req: NextRequest) {
  const sp      = new URL(req.url).searchParams;
  const token   = sp.get('token')  ?? '';
  const action  = sp.get('action') ?? '';
  const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  return handle(token, action, undefined, baseUrl);
}

/** POST — in-app React Native driver response */
export async function POST(req: NextRequest) {
  const { token, action, reason } = await req.json().catch(() => ({} as any));
  const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  return handle(String(token ?? ''), String(action ?? ''), reason, baseUrl);
}
