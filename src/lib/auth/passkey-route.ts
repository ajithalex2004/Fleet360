/**
 * Shared plumbing for the passkey and step-up routes (/api/auth/passkeys/*,
 * /api/auth/step-up/*): the verified session, who must pass the passkey
 * check, and error responses.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getVerifiedRequestSession, type VerifiedSession } from '@/lib/tenant-session';
import { PasskeyError } from '@/lib/auth/passkeys';
import { stepUpActor, type StepUpSubject } from '@/lib/auth/step-up-token';

export interface PasskeyContext {
  session: VerifiedSession;
  subject: StepUpSubject;
  /** Whose passkeys are checked: the user, or the platform admin impersonating them. */
  actor: string;
}

export async function passkeyContext(req: NextRequest): Promise<PasskeyContext | NextResponse> {
  const session = await getVerifiedRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized', message: 'Valid session required' }, { status: 401 });
  const subject: StepUpSubject = {
    userId: session.userId,
    tenantId: session.tenantId,
    issuedAt: session.issuedAt,
    ...(session.impersonatedBy ? { impersonatedBy: session.impersonatedBy } : {}),
  };
  return { session, subject, actor: stepUpActor(subject) };
}

/** Passkeys are managed by their owner in their own session, never while impersonating. */
export function refuseWhileImpersonating(ctx: PasskeyContext): NextResponse | null {
  if (!ctx.session.impersonatedBy) return null;
  return NextResponse.json({ error: 'Stop impersonating to manage passkeys.' }, { status: 403 });
}

export function passkeyErrorResponse(err: unknown, where: string): NextResponse {
  if (err instanceof PasskeyError) {
    return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
  }
  console.error(`[passkeys] ${where} failed:`, err);
  return NextResponse.json({ error: 'passkey_error', message: 'Something went wrong with the passkey request.' }, { status: 500 });
}
