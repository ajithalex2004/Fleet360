export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireRelyingParty, startAssertion } from '@/lib/auth/passkeys';
import { passkeyContext, passkeyErrorResponse } from '@/lib/auth/passkey-route';

export const runtime = 'nodejs';

/**
 * POST /api/auth/step-up/options
 *
 * Starts a passkey check for the person behind the session (the platform
 * admin during impersonation). 409 no_passkey when they have none yet: the
 * app then offers to add one.
 */
export async function POST(req: NextRequest) {
  const ctx = await passkeyContext(req);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const options = await startAssertion(ctx.actor, requireRelyingParty());
    if (!options) {
      return NextResponse.json({
        error: 'no_passkey',
        message: ctx.session.impersonatedBy
          ? 'Add a passkey to your own account first (stop impersonating).'
          : 'Add a passkey to confirm high-impact actions.',
        canEnroll: !ctx.session.impersonatedBy,
      }, { status: 409 });
    }
    return NextResponse.json(options);
  } catch (err) {
    return passkeyErrorResponse(err, 'step-up/options');
  }
}
