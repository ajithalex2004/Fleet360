/**
 * GET /api/auth/sso/callback?code=…&state=…
 *
 * Receives the IdP redirect, verifies the signed state cookie, exchanges
 * the code for tokens, validates the ID-Token's nonce, then either:
 *   - JIT-creates a User + UserTenant when jitEnabled (and the email's
 *     domain is in the configured allowlist), or
 *   - matches an existing User by email and ensures a UserTenant exists.
 *
 * On success: signs an xl-session cookie and redirects to returnTo.
 * On failure: redirects to /login?sso=<reason>.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import * as oidc from 'openid-client';
import { prisma } from '@/lib/prisma';
import { findSsoConfigByTenant } from '@/lib/sso';
import { verifySsoState } from '@/lib/sso-state';
import { signSession } from '@/lib/tenant-session';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const COOKIE_NAME       = 'xl-session';
const SSO_STATE_COOKIE  = 'xl-sso-state';

export async function GET(req: NextRequest) {
  const stateToken = req.cookies.get(SSO_STATE_COOKIE)?.value;
  if (!stateToken) return redirect(req, '/login?sso=missing-state');

  const state = await verifySsoState(stateToken);
  if (!state) {
    const r = redirect(req, '/login?sso=invalid-state');
    r.cookies.delete(SSO_STATE_COOKIE);
    return r;
  }

  const cfg = await findSsoConfigByTenant(state.tenantId);
  if (!cfg || !cfg.isActive) return redirectAndClear(req, '/login?sso=config-missing');

  try {
    const config = await oidc.discovery(new URL(cfg.issuer), cfg.clientId, cfg.clientSecret);

    const tokens = await oidc.authorizationCodeGrant(config, new URL(req.url), {
      pkceCodeVerifier: state.codeVerifier,
      expectedState:    state.state,
      expectedNonce:    state.nonce,
    });

    const claims = tokens.claims();
    if (!claims) return redirectAndClear(req, '/login?sso=no-claims');

    const sub      = String(claims.sub);
    const idEmail  = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
    const email    = idEmail || state.email;
    const fullName = typeof claims.name === 'string' ? claims.name : '';
    const givenN   = typeof claims.given_name  === 'string' ? claims.given_name  : '';
    const familyN  = typeof claims.family_name === 'string' ? claims.family_name : '';

    if (!email) return redirectAndClear(req, '/login?sso=no-email');

    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain || !cfg.allowedEmailDomains.includes(domain)) {
      return redirectAndClear(req, '/login?sso=domain-not-allowed');
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: cfg.tenantId },
      select: { id: true, name: true, plan: true, isActive: true },
    });
    if (!tenant || !tenant.isActive) return redirectAndClear(req, '/login?sso=tenant-inactive');

    // Resolve role: explicit defaultRoleId, else TENANT_ADMIN for this tenant, else any tenant role.
    const role = await pickProvisioningRole(cfg.tenantId, cfg.defaultRoleId);
    if (!role) return redirectAndClear(req, '/login?sso=no-role');

    // Match or JIT-create user.
    let user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      if (!cfg.jitEnabled) {
        return redirectAndClear(req, '/login?sso=user-not-provisioned');
      }
      // First/last name fallbacks.
      const first = givenN || (fullName.split(' ')[0]  ?? email.split('@')[0]);
      const last  = familyN || (fullName.split(' ').slice(1).join(' ') || '—');
      const newId = crypto.randomUUID();
      await prisma.$transaction(async (tx) => {
        await tx.user.create({
          data: {
            id: newId, username: email, email,
            firstName: first, lastName: last,
            isActive: true, updatedAt: new Date(),
          },
        });
        await tx.userTenant.create({
          data: { id: crypto.randomUUID(), userId: newId, tenantId: cfg.tenantId, roleId: role.id, isActive: true },
        });
      });
      user = await prisma.user.findUniqueOrThrow({ where: { id: newId } });

      void logAudit({
        tenantId: tenant.id, tenantName: tenant.name,
        userId: newId, userRole: role.code, userEmail: email,
        entityType: 'User', entityId: newId, entityName: email,
        action: 'CREATE',
        details: `JIT-provisioned via OIDC SSO (sub=${sub}, issuer=${cfg.issuer}).`,
      });
    } else {
      if (!user.isActive) return redirectAndClear(req, '/login?sso=account-disabled');

      // Ensure UserTenant exists / is active.
      const membership = await prisma.userTenant.findUnique({
        where: { userId_tenantId: { userId: user.id, tenantId: cfg.tenantId } },
      }).catch(() => null);
      if (!membership) {
        if (!cfg.jitEnabled) return redirectAndClear(req, '/login?sso-membership-missing');
        await prisma.userTenant.create({
          data: { id: crypto.randomUUID(), userId: user.id, tenantId: cfg.tenantId, roleId: role.id, isActive: true },
        });
      } else if (!membership.isActive) {
        await prisma.userTenant.update({ where: { id: membership.id }, data: { isActive: true } });
      }
    }

    void logAudit({
      tenantId: tenant.id, tenantName: tenant.name,
      userId: user.id, userRole: role.code, userEmail: email,
      entityType: 'Login', action: 'LOGIN',
      details: `OIDC SSO login (issuer=${cfg.issuer}, sub=${sub}).`,
    });

    const sessionToken = await signSession({
      userId:   user.id,
      tenantId: tenant.id,
      plan:     tenant.plan ?? 'TRIAL',
      role:     role.code,
    });

    const r = NextResponse.redirect(new URL(state.returnTo || '/platform', new URL(req.url).origin));
    r.cookies.set(COOKIE_NAME, sessionToken, {
      httpOnly: true, sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 86_400, path: '/',
    });
    r.cookies.delete(SSO_STATE_COOKIE);
    return r;
  } catch (err) {
    captureException(err, { context: 'auth.sso.callback', tags: { tenantId: state.tenantId } });
    return redirectAndClear(req, '/login?sso=callback-failed');
  }
}

async function pickProvisioningRole(tenantId: string, preferredRoleId: string | null) {
  if (preferredRoleId) {
    const r = await prisma.role.findFirst({
      where: { id: preferredRoleId, OR: [{ tenantId }, { tenantId: null }] },
      select: { id: true, code: true },
    });
    if (r) return r;
  }
  const tenantAdmin = await prisma.role.findFirst({
    where: { tenantId, code: 'TENANT_ADMIN' }, select: { id: true, code: true },
  });
  if (tenantAdmin) return tenantAdmin;
  return prisma.role.findFirst({ where: { tenantId }, select: { id: true, code: true } });
}

function redirect(req: NextRequest, path: string): NextResponse {
  const url = new URL(req.url);
  url.pathname = path.split('?')[0];
  url.search   = path.includes('?') ? '?' + path.split('?')[1] : '';
  return NextResponse.redirect(url);
}
function redirectAndClear(req: NextRequest, path: string): NextResponse {
  const r = redirect(req, path);
  r.cookies.delete(SSO_STATE_COOKIE);
  return r;
}
