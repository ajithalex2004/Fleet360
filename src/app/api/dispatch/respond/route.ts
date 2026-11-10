export const dynamic = 'force-dynamic';

/**
 * GET  /api/dispatch/respond?token=XXX&action=accept|reject
 * POST /api/dispatch/respond   body: { token, action, reason? }
 *
 * Handles driver accept/reject links from WhatsApp and in-app.
 * GET version is used by the WhatsApp accept link (opens in browser).
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { handleDriverResponse } from '@/lib/dispatch/engine';
import { prisma }               from '@/lib/prisma';
import { dispatch as agentDispatch } from '@/lib/agents/orchestrator';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';

async function resolveTenantFromToken(token: string): Promise<string | null> {
  if (!token) return null;
  const rows = await prisma.$queryRawUnsafe<{ tenant_id: string }[]>(
    `SELECT dj.tenant_id
     FROM dispatch_attempts da
     JOIN dispatch_jobs dj ON dj.id = da.dispatch_job_id
     WHERE da.accept_token = $1
     LIMIT 1`,
    token,
  ).catch(() => [] as { tenant_id: string }[]);
  return rows[0]?.tenant_id ? String(rows[0].tenant_id) : null;
}

async function handle(tenantId: string, token: string, action: string, reason: string | undefined, baseUrl: string) {
  if (!token)  return NextResponse.json({ error: 'token is required' },  { status: 400 });
  if (!action) return NextResponse.json({ error: 'action is required' }, { status: 400 });
  if (!['accept', 'reject', 'timeout'].includes(action)) {
    return NextResponse.json({ error: 'action must be accept | reject | timeout' }, { status: 400 });
  }

  return withTenantRls(prisma, tenantId, async () => {
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
      prisma.$queryRawUnsafe<{ tenant_id: string }[]>(
        `SELECT tenant_id FROM dispatch_jobs WHERE id = $1::uuid LIMIT 1`,
        result.jobId,
      ).then(rows => {
        return agentDispatch({
          agent_id:   'dispatch-optimiser',
          event_type: 'dispatch.job_reassign',
          tenant_id:  rows[0]?.tenant_id ?? tenantId,
          entity_id:  result.jobId,
          payload:    { reason: reason ?? action },
        });
      }).catch(err =>
        console.warn('[dispatch/respond] reassign optimiser trigger failed (non-fatal):', err),
      );
    }

    return NextResponse.json({ ok: true, jobId: result.jobId, message: result.message });
  });
}

/** GET — WhatsApp link click (opens in browser, returns JSON) */
export async function GET(req: NextRequest) {
  const sp      = new URL(req.url).searchParams;
  const token   = sp.get('token')  ?? '';
  const action  = sp.get('action') ?? '';
  const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  let tenantId = authz.ok ? authz.tenantId : '';
  if (!tenantId && token) {
    tenantId = (await resolveTenantFromToken(token)) ?? '';
  }
  if (!tenantId) {
    return NextResponse.json(
      { error: authz.ok ? 'Invalid or expired token' : authz.error },
      { status: authz.ok ? 404 : authz.status },
    );
  }

  return handle(tenantId, token, action, undefined, baseUrl);
}

/** POST — in-app React Native driver response */
export async function POST(req: NextRequest) {
  const bodyRaw = await req.json().catch(() => ({} as Record<string, unknown>));
  const { token, action, reason } = stripTenantOwnershipFields(bodyRaw) as {
    token?: string;
    action?: string;
    reason?: string;
  };
  const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  const tokenStr = String(token ?? '');

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  let tenantId = authz.ok ? authz.tenantId : '';
  if (!tenantId && tokenStr) {
    tenantId = (await resolveTenantFromToken(tokenStr)) ?? '';
  }
  if (!tenantId) {
    return NextResponse.json(
      { error: authz.ok ? 'Invalid or expired token' : authz.error },
      { status: authz.ok ? 404 : authz.status },
    );
  }

  return handle(tenantId, tokenStr, String(action ?? ''), reason, baseUrl);
}
