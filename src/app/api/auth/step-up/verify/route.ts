export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { finishAssertion, requireRelyingParty, type AuthenticationResponse } from '@/lib/auth/passkeys';
import { passkeyContext, passkeyErrorResponse } from '@/lib/auth/passkey-route';
import { setStepUpCookie } from '@/lib/auth/step-up-cookie';
import { STEP_UP_TTL_MS } from '@/lib/auth/step-up-policy';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * POST /api/auth/step-up/verify  { response }
 *
 * Verifies the passkey check started by step-up/options (single-use
 * challenge) and sets the step-up cookie: high-impact admin actions in this
 * session are allowed for the next 5 minutes. Failures are audited.
 */
export async function POST(req: NextRequest) {
  const ctx = await passkeyContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const audit = (details: string) => logAudit({
    tenantId: ctx.session.tenantId, entityType: 'StepUp', entityId: ctx.actor, action: 'LOGIN', details, userId: ctx.actor,
  });
  try {
    const rp = requireRelyingParty();
    const body = (await req.json().catch(() => ({}))) as { response?: AuthenticationResponse };
    if (!body.response) return NextResponse.json({ error: 'response required' }, { status: 400 });
    let passkeyId: string;
    try {
      ({ passkeyId } = await finishAssertion(ctx.actor, body.response, rp));
    } catch (err) {
      await audit(`Passkey step-up failed${ctx.session.impersonatedBy ? ` (impersonating ${ctx.session.userId})` : ''}`);
      throw err;
    }
    await audit(`Passkey step-up passed with ${passkeyId}${ctx.session.impersonatedBy ? ` (impersonating ${ctx.session.userId})` : ''}`);
    const res = NextResponse.json({ ok: true, validForSeconds: STEP_UP_TTL_MS / 1000 });
    await setStepUpCookie(res, ctx.subject);
    return res;
  } catch (err) {
    return passkeyErrorResponse(err, 'step-up/verify');
  }
}
