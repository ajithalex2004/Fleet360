/**
 * Route-handler helpers for the step-up cookie (src/lib/auth/step-up-token.ts).
 */
import type { NextRequest, NextResponse } from 'next/server';
import { STEP_UP_COOKIE, STEP_UP_COOKIE_PATH, STEP_UP_TTL_MS } from '@/lib/auth/step-up-policy';
import { signStepUp, verifyStepUp, type StepUpSubject } from '@/lib/auth/step-up-token';

export { STEP_UP_REQUIRED_BODY } from '@/lib/auth/step-up-policy';

export async function setStepUpCookie(res: NextResponse, subject: StepUpSubject): Promise<void> {
  res.cookies.set(STEP_UP_COOKIE, await signStepUp(subject), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: STEP_UP_COOKIE_PATH,
    maxAge: Math.floor(STEP_UP_TTL_MS / 1000),
  });
}

export function clearStepUpCookie(res: NextResponse): void {
  res.cookies.set(STEP_UP_COOKIE, '', { httpOnly: true, sameSite: 'strict', path: STEP_UP_COOKIE_PATH, maxAge: 0 });
}

/** True when the request carries a current step-up for this session. */
export function hasStepUp(req: NextRequest, subject: StepUpSubject): Promise<boolean> {
  return verifyStepUp(req.cookies.get(STEP_UP_COOKIE)?.value, subject);
}
