/**
 * Body-parser tests for the Route Consolidation apply/preview endpoints.
 *
 * Focus areas from PR #24 review:
 *   - Audit identity (appliedBy) MUST come from the trusted header,
 *     never the body. Body-supplied appliedBy is a 400.
 *   - tenantId same story.
 *   - operatorResolutions RP: keys validate as UUID (RoutePassenger.id
 *     is UUID in the DB); TE: keys stay TEXT.
 */

import { describe, it, expect } from 'vitest';
import { parseApplyBody } from '@/lib/bus-ops/route-consolidation-apply-body';

const T = 'tenant-A';

function baseBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recommendationId: 'rec-1',
    sourceRouteIds: ['route-a', 'route-b'],
    mergedRoute: { stopIds: ['stop-1', 'stop-2'] },
    ...over,
  };
}

describe('parseApplyBody — audit identity', () => {
  it('REJECTS a body-supplied appliedBy on apply', () => {
    const r = parseApplyBody(
      baseBody({ idempotencyKey: 'idem-1', appliedBy: 'attacker-user' }),
      T,
      { requireIdempotencyKey: true, appliedBy: 'legit-user' }
    );
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error).toContain('appliedBy is not accepted from the request body');
  });

  it('REJECTS a body-supplied appliedBy on preview even when no idempotencyKey is required', () => {
    const r = parseApplyBody(
      baseBody({ appliedBy: 'attacker' }),
      T,
      { requireIdempotencyKey: false }
    );
    expect('error' in r).toBe(true);
  });

  it('REJECTS a body-supplied tenantId (never override the trusted tenant context)', () => {
    const r = parseApplyBody(
      baseBody({ tenantId: 'tenant-B' }),
      T,
      { requireIdempotencyKey: false }
    );
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error).toContain('tenantId is not accepted');
  });

  it('populates appliedBy from opts (the trusted x-user-id header) on apply', () => {
    const r = parseApplyBody(
      baseBody({ idempotencyKey: 'idem-1' }),
      T,
      { requireIdempotencyKey: true, appliedBy: 'user-authenticated' }
    );
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect('appliedBy' in r.input && (r.input as { appliedBy: string }).appliedBy).toBe('user-authenticated');
  });

  it('errors when apply is invoked without opts.appliedBy (route-handler misconfiguration)', () => {
    const r = parseApplyBody(
      baseBody({ idempotencyKey: 'idem-1' }),
      T,
      { requireIdempotencyKey: true } // no appliedBy!
    );
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error).toContain('server misconfigured');
  });
});

describe('parseApplyBody — operatorResolutions UUID validation', () => {
  const UUID_A = '01234567-89ab-cdef-0123-456789abcdef';

  it('accepts a valid UUID after RP:', () => {
    const r = parseApplyBody(
      baseBody({
        operatorResolutions: { [`RP:${UUID_A}`]: { pickupStopId: 'stop-x' } },
      }),
      T,
      { requireIdempotencyKey: false }
    );
    expect('error' in r).toBe(false);
  });

  it('REJECTS a non-UUID after RP:', () => {
    const r = parseApplyBody(
      baseBody({
        operatorResolutions: { 'RP:not-a-uuid': { pickupStopId: 'stop-x' } },
      }),
      T,
      { requireIdempotencyKey: false }
    );
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error).toContain('must be a UUID');
  });

  it('accepts arbitrary non-empty text after TE: (transport_enrollments.id is TEXT)', () => {
    const r = parseApplyBody(
      baseBody({
        operatorResolutions: { 'TE:some-arbitrary-text-id': { pickupStopId: 'stop-x' } },
      }),
      T,
      { requireIdempotencyKey: false }
    );
    expect('error' in r).toBe(false);
  });

  it('REJECTS a malformed key (missing prefix)', () => {
    const r = parseApplyBody(
      baseBody({
        operatorResolutions: { 'no-prefix-id': { pickupStopId: 'stop-x' } },
      }),
      T,
      { requireIdempotencyKey: false }
    );
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error).toContain('"RP:<id>" or "TE:<id>"');
  });
});
