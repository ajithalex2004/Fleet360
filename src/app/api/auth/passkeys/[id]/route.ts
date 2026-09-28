export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { removePasskey } from '@/lib/auth/passkeys';
import { passkeyContext, passkeyErrorResponse, refuseWhileImpersonating } from '@/lib/auth/passkey-route';
import { hasStepUp, STEP_UP_REQUIRED_BODY } from '@/lib/auth/step-up-cookie';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * DELETE /api/auth/passkeys/:id
 *
 * Removes one of the signed-in user's passkeys. Needs a passkey step-up, so
 * only the passkey's owner (not a stolen session) can remove it.
 */
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await passkeyContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const refused = refuseWhileImpersonating(ctx);
  if (refused) return refused;
  if (!(await hasStepUp(req, ctx.subject))) return NextResponse.json(STEP_UP_REQUIRED_BODY, { status: 403 });
  try {
    if (!(await removePasskey(ctx.session.userId, id))) {
      return NextResponse.json({ error: 'Passkey not found' }, { status: 404 });
    }
    await logAudit({
      tenantId: ctx.session.tenantId, entityType: 'Passkey', entityId: id, action: 'DELETE',
      details: 'Passkey removed by its owner', userId: ctx.session.userId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return passkeyErrorResponse(err, 'remove');
  }
}
