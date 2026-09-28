export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { passkeyCounts, reauthenticate, requireRelyingParty, startRegistration, type ReauthInput } from '@/lib/auth/passkeys';
import { passkeyContext, passkeyErrorResponse, refuseWhileImpersonating } from '@/lib/auth/passkey-route';
import { hasStepUp, STEP_UP_REQUIRED_BODY } from '@/lib/auth/step-up-cookie';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * POST /api/auth/passkeys/register/options  { password?, mfaCode?, recoveryCode? }
 *
 * Starts adding a passkey. A user with no passkey re-authenticates (password,
 * plus the authenticator or a recovery code when MFA is on; a recent sign-in
 * for users without a password). A user who already has one needs a
 * passkey step-up instead, so a stolen session cannot add its own passkey.
 */
export async function POST(req: NextRequest) {
  const ctx = await passkeyContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const refused = refuseWhileImpersonating(ctx);
  if (refused) return refused;
  try {
    const rp = requireRelyingParty();
    const userId = ctx.session.userId;
    const counts = await passkeyCounts(userId, rp.rpID);
    if (counts.total > 0) {
      if (!(await hasStepUp(req, ctx.subject))) {
        // Passkeys only for another domain cannot pass a step-up here.
        if (counts.here === 0) {
          return NextResponse.json({
            error: 'passkey_reset_required',
            message: 'Your passkeys were registered for another address. Ask a platform administrator to reset them, then add a new one.',
          }, { status: 409 });
        }
        return NextResponse.json(STEP_UP_REQUIRED_BODY, { status: 403 });
      }
    } else {
      const body = (await req.json().catch(() => ({}))) as ReauthInput;
      try {
        await reauthenticate(userId, {
          password: typeof body.password === 'string' ? body.password : undefined,
          mfaCode: typeof body.mfaCode === 'string' ? body.mfaCode : undefined,
          recoveryCode: typeof body.recoveryCode === 'string' ? body.recoveryCode : undefined,
        }, ctx.session.issuedAt);
      } catch (err) {
        await logAudit({
          tenantId: ctx.session.tenantId, entityType: 'Passkey', entityId: userId, action: 'UPDATE',
          details: 'Passkey registration refused: re-authentication failed', userId,
        });
        throw err;
      }
    }
    return NextResponse.json(await startRegistration(userId, rp));
  } catch (err) {
    return passkeyErrorResponse(err, 'register/options');
  }
}
