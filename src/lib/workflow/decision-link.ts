/**
 * Email decision links: the approval request email carries a link for each
 * approver to approve or reject from any device without signing in
 * (/approval-link/<token>). The token names the tenant, the approval, the
 * level and the approver it was sent to, signed with the session secret
 * (HMAC-SHA256, its own domain prefix so no other signed token of the app
 * verifies as one) and valid for LINK_TTL_DAYS.
 *
 * What a link can do is narrow: decide that one level, as that approver,
 * while it is still the level waiting and they are still one of its
 * approvers (decideAs re-checks both). Opening it changes nothing — the
 * decision is a separate POST from the page — so mail scanners that fetch
 * links cannot approve anything.
 */
import crypto from 'crypto';
import { requireSessionSecret } from '@/lib/session-secret';

export const LINK_TTL_DAYS = 7;
const DOMAIN = 'fleet360.approval-decision-link.v1:';

export interface DecisionLinkPayload {
  /** tenant */
  t: string;
  /** workflow instance (the approval) */
  i: string;
  /** step instance (the level) */
  s: string;
  /** approver email */
  e: string;
  /** expiry, ms since epoch */
  x: number;
}

const b64url = (input: string) => Buffer.from(input).toString('base64url');

function sign(encoded: string): string {
  return crypto.createHmac('sha256', requireSessionSecret()).update(DOMAIN + encoded).digest('base64url');
}

export function signDecisionLink(args: {
  tenantId: string; instanceId: string; stepInstanceId: string; email: string; now?: number;
}): string {
  const payload: DecisionLinkPayload = {
    t: args.tenantId, i: args.instanceId, s: args.stepInstanceId,
    e: args.email.trim().toLowerCase(),
    x: (args.now ?? Date.now()) + LINK_TTL_DAYS * 86_400_000,
  };
  const encoded = b64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export type DecisionLinkCheck =
  | { ok: true; link: { tenantId: string; instanceId: string; stepInstanceId: string; email: string; expiresAt: number } }
  | { ok: false; reason: 'invalid' | 'expired' };

export function verifyDecisionLink(token: string, now: number = Date.now()): DecisionLinkCheck {
  if (typeof token !== 'string' || token.length > 2048) return { ok: false, reason: 'invalid' };
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return { ok: false, reason: 'invalid' };
  const encoded = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(encoded));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok: false, reason: 'invalid' };
  let p: DecisionLinkPayload;
  try {
    p = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!p || typeof p.t !== 'string' || typeof p.i !== 'string' || typeof p.s !== 'string'
    || typeof p.e !== 'string' || typeof p.x !== 'number') {
    return { ok: false, reason: 'invalid' };
  }
  if (p.x <= now) return { ok: false, reason: 'expired' };
  return { ok: true, link: { tenantId: p.t, instanceId: p.i, stepInstanceId: p.s, email: p.e, expiresAt: p.x } };
}

/** The link for an approver, on this deployment. */
export function decisionLinkUrl(token: string): string {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/approval-link/${token}`;
}
