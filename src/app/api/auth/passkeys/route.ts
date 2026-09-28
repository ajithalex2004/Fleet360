export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { listPasskeys, reauthMethod, relyingParty } from '@/lib/auth/passkeys';
import { passkeyContext, passkeyErrorResponse } from '@/lib/auth/passkey-route';

export const runtime = 'nodejs';

/**
 * GET /api/auth/passkeys
 *
 * The signed-in user's passkeys (during impersonation: the platform
 * admin's), whether passkeys are configured on this server, and what adding
 * a first passkey asks for (password, password + authenticator code, or a
 * recent sign-in for users without a password).
 */
export async function GET(req: NextRequest) {
  const ctx = await passkeyContext(req);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const rp = relyingParty();
    const passkeys = await listPasskeys(ctx.actor);
    return NextResponse.json({
      configured: !!rp,
      rpId: rp?.rpID ?? null,
      passkeys: passkeys.map((p) => ({ ...p, usableHere: !!rp && p.rpId === rp.rpID })),
      firstPasskeyReauth: await reauthMethod(ctx.actor),
      impersonating: !!ctx.session.impersonatedBy,
    });
  } catch (err) {
    return passkeyErrorResponse(err, 'list');
  }
}
