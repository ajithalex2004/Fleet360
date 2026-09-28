/**
 * Authorization dry run: the live answer to "may this session do this?",
 * without doing it.
 *
 * A staff API request carrying `x-authz-dry-run: 1` is decided by the
 * middleware (admin route gate, passkey step-up, authorization policy)
 * exactly as a real request would be, then answered 204 with the decision
 * in headers. No handler, proxy or side effect runs. The security harness
 * (scripts/security-harness) uses it to test every role against every
 * action on a live deployment, production included; the Go backend
 * answers the same headers (backend/authz).
 *
 * It reveals nothing beyond the caller's own authorization for the request
 * they asked about. Rate limits apply as usual.
 *
 * Edge-runtime safe.
 */
import type { Decision } from '@/lib/authz/policy';

export const DRY_RUN_HEADER = 'x-authz-dry-run';

export interface DryRunInput {
  policyVersion: string;
  /** AUTHZ_MODE in force. */
  mode: 'report' | 'enforce' | 'off';
  decision: Decision;
  /** Level the admin route gate requires, when it refuses this role; null when it passes. */
  adminGateRefusal: string | null;
  /** STEP_UP_ROUTES template when the action needs a passkey step-up, else null. */
  stepUpRoute: string | null;
  stepUpSatisfied: boolean;
  stepUpMode: 'enforce' | 'report' | 'off';
}

/** The headers of a dry-run answer. */
export function dryRunHeaders(i: DryRunInput): Record<string, string> {
  const allow = i.adminGateRefusal === null && i.decision.allow;
  const reason = i.adminGateRefusal !== null ? `admin-gate:${i.adminGateRefusal}` : i.decision.reason;
  const stepUp = !i.stepUpRoute ? 'none' : i.stepUpSatisfied ? 'satisfied' : 'required';
  // What a real request would meet at the middleware right now.
  const refused =
    i.adminGateRefusal !== null
    || (stepUp === 'required' && i.stepUpMode === 'enforce')
    || (!i.decision.allow && i.mode === 'enforce');
  return {
    'x-authz-backend': 'next',
    'x-authz-policy': i.policyVersion,
    'x-authz-mode': i.mode,
    'x-authz-decision': allow ? 'allow' : 'deny',
    'x-authz-reason': reason,
    'x-authz-area': i.decision.area ?? '',
    'x-authz-required': i.decision.required ?? '',
    'x-authz-outcome': refused ? 'refused' : 'allowed',
    'x-step-up': stepUp,
    'x-step-up-mode': i.stepUpMode,
  };
}
