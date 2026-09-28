export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { finishRegistration, requireRelyingParty, type RegistrationResponse } from '@/lib/auth/passkeys';
import { passkeyContext, passkeyErrorResponse, refuseWhileImpersonating } from '@/lib/auth/passkey-route';
import { setStepUpCookie } from '@/lib/auth/step-up-cookie';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * POST /api/auth/passkeys/register/verify  { response, deviceName? }
 *
 * Finishes adding a passkey (the challenge from register/options, single
 * use). Registering proved both the re-authentication and the user's
 * presence on the new passkey, so it also counts as a step-up.
 */
export async function POST(req: NextRequest) {
  const ctx = await passkeyContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const refused = refuseWhileImpersonating(ctx);
  if (refused) return refused;
  try {
    const rp = requireRelyingParty();
    const body = (await req.json().catch(() => ({}))) as { response?: RegistrationResponse; deviceName?: string };
    if (!body.response) return NextResponse.json({ error: 'response required' }, { status: 400 });
    const userId = ctx.session.userId;
    const added = await finishRegistration(userId, body.response, typeof body.deviceName === 'string' ? body.deviceName : undefined, rp);
    await logAudit({
      tenantId: ctx.session.tenantId, entityType: 'Passkey', entityId: added.id, action: 'CREATE',
      details: `Passkey "${added.deviceName}" added`, userId,
    });
    const res = NextResponse.json({ ok: true, passkey: added });
    await setStepUpCookie(res, ctx.subject);
    return res;
  } catch (err) {
    return passkeyErrorResponse(err, 'register/verify');
  }
}
