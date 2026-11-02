/**
 * Every public route says how it authenticates.
 *
 * The middleware lets PUBLIC_EXACT / PUBLIC_PREFIXES through with no
 * session, so for those paths the handler is the whole authentication. The
 * static checkers do not cover this: scripts/check-tenant-auth.js exempts
 * src/app/api/auth/ entirely, and check-tenant-rls.js only looks for
 * prisma calls in route files. That is how POST /api/auth/session — public,
 * signing a session for any { userId, tenantId } in the body — went
 * unnoticed.
 *
 * 1. Each public entry is listed below with the mechanism its handler uses.
 *    A new public path fails this test until someone writes that down.
 * 2. A public route file that signs a staff session (signSession) must also
 *    call the credential check declared for it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PUBLIC_EXACT, PUBLIC_PREFIXES, isPublicPath } from '@/lib/auth-route-policies';

const PUBLIC_ROUTE_AUTH: Record<string, string> = {
  // Pages: render without data; their API calls are protected or listed here.
  '/': 'none — marketing page',
  '/login': 'none — sign-in page',
  '/platform': 'none — shell page; data comes from protected APIs',
  '/platform/': 'none — shell pages; data comes from protected APIs',
  '/operations-review': 'none — marketing page',
  '/onboarding': 'none — sign-up page',
  '/onboarding/': 'none — sign-up pages',
  '/forgot-password': 'none — page',
  '/reset-password': 'none — page',
  '/invitation/': 'none — page; the token is checked by /api/auth/invitation/',
  '/track/': 'capability token in the URL, checked by its API',
  '/track-ticket': 'capability token in the URL, checked by its API',
  '/track-ticket/': 'capability token in the URL, checked by its API',
  '/sign/': 'signing capability token, checked by the signing API',
  '/approval-link/': 'signed per-approver decision token',
  '/shipper-portal': 'shipper-portal-session cookie (requireShipperPortal)',
  '/leasing-portal': 'leasing-portal-session cookie (requireLeasingPortal)',
  '/carrier-portal/': 'carrier invite token',

  // APIs
  '/api/public/operations-review': 'none — validated, rate-limited form post',
  '/api/public/analytics': 'none — rate-limited, non-sensitive events',
  '/api/auth/session': "caller's own xl-session (verifySession); same user only",
  '/api/auth/login': 'email + password (verifyPassword)',
  '/api/auth/logout': 'none — clears the cookie and blocklists the token',
  '/api/auth/forgot-password': 'none — emails a reset token; same answer for any email',
  '/api/auth/reset-password': 'reset token (hashed, single-use)',
  '/api/auth/invitation/accept': 'invitation token (hashed, single-use)',
  '/api/auth/invitation/': 'invitation token lookup',
  '/api/auth/sso/initiate': 'none — redirects to the IdP with signed state',
  '/api/auth/sso/callback': 'signed SSO state + OIDC code exchange (verifySsoState, authorizationCodeGrant)',
  '/api/branding': 'none — public tenant branding',
  '/api/stripe/webhook': 'Stripe signature',
  '/api/tenants/provision': 'none — public sign-up; creates a new account only, never an existing one',
  '/api/tenants/verify-domain': 'domain verification token',
  '/api/tenants/pre-verify-domain': 'none — starts domain verification',
  '/api/platform/plans': 'none — public plan catalogue',
  '/api/admin/session': 'xl-session cookie checked in the handler',
  '/api/health': 'none — health probe, no tenant data',
  '/api/readyz': 'none — readiness probe',
  '/api/health/db-role': 'x-deployment-health-secret header',
  '/api/version': 'none — build info',
  '/api/assets/ble/ingest': 'X-Gateway-Key (SHA-256 lookup)',
  '/api/approval-link/': 'signed per-approver decision token',
  '/api/setup/': 'SETUP_SECRET',
  '/api/shipper-portal/': 'shipper-portal-session cookie (requireShipperPortal)',
  '/api/leasing-portal/': 'leasing-portal-session cookie (requireLeasingPortal)',
  '/api/carrier-portal/': 'carrier invite token',
  '/api/driver-app/': 'driver-app device session (verified in middleware) / WebAuthn',
  '/api/mobile/': 'none — static APK downloads; no database or tenant data',
  '/health': 'none — status page; data from the public /api/health, admin calls are SUPER_ADMIN-gated',
  '/api/bus-ops/gateway/': 'per-gateway HMAC signature',
  '/api/push/': 'operator session or scheduler secret, checked in the handler',
  '/api/cron/': 'CRON_SECRET bearer token',
  '/api/jobs/': 'scheduler secret or operator session, checked in the handler',
  '/api/webhooks/': 'provider signature (Twilio / Meta)',
};

/**
 * Public route files that sign a staff session, and the credential check
 * each must call before doing so.
 */
const SESSION_ISSUERS: Record<string, RegExp> = {
  'src/app/api/auth/session/route.ts': /verifySession\(/,
  'src/app/api/auth/login/route.ts': /verifyPassword\(/,
  'src/app/api/auth/invitation/accept/route.ts': /token_hash|tokenHash/,
  'src/app/api/auth/sso/callback/route.ts': /authorizationCodeGrant\(/,
  'src/app/api/driver-app/auth/biometric/login/finish/route.ts': /verifyAuthenticationResponse\(/,
  // Re-issues the driver session for an already signed-in caller's own
  // driver profile (session user id = driver id) after binding a vehicle.
  'src/app/api/driver-app/auth/vehicle-login/route.ts': /requireAuthorizedTenant\(/,
  // Sign-up: the session is for the account the request just created.
  'src/app/api/tenants/provision/route.ts': /An account with this email already exists/,
};

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return routeFiles(p);
    return e.name === 'route.ts' ? [p.replace(/\\/g, '/')] : [];
  });
}

/** src/app/api/foo/[id]/route.ts → /api/foo/[id] (route groups dropped). */
function urlOf(file: string): string {
  return file
    .replace(/^src\/app/, '')
    .replace(/\/route\.ts$/, '')
    .replace(/\/\([^)]+\)/g, '');
}

describe('public route inventory', () => {
  it('declares how every public path authenticates', () => {
    const undeclared = [...PUBLIC_EXACT, ...PUBLIC_PREFIXES].filter((p) => !(p in PUBLIC_ROUTE_AUTH));
    expect(undeclared, 'add these to PUBLIC_ROUTE_AUTH with the mechanism the handler uses').toEqual([]);
  });

  it('has no declarations for paths that are no longer public', () => {
    const all = new Set([...PUBLIC_EXACT, ...PUBLIC_PREFIXES]);
    expect(Object.keys(PUBLIC_ROUTE_AUTH).filter((p) => !all.has(p))).toEqual([]);
  });

  it('only lets public routes sign a session after checking a credential', () => {
    const issuers = routeFiles('src/app/api')
      .filter((f) => isPublicPath(urlOf(f)))
      .filter((f) => /\bsignSession\(/.test(fs.readFileSync(f, 'utf8')));

    const unlisted = issuers.filter((f) => !(f in SESSION_ISSUERS));
    expect(unlisted, 'public routes that sign sessions must be listed in SESSION_ISSUERS with their credential check').toEqual([]);

    const unchecked = issuers.filter((f) => !SESSION_ISSUERS[f].test(fs.readFileSync(f, 'utf8')));
    expect(unchecked, 'these public routes sign a session without their declared credential check').toEqual([]);
  });
});
