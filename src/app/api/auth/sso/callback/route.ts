export const dynamic = 'force-dynamic';

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
import { withPlatformAdmin } from '@/lib/rls';
import { pickProvisioningRole } from '@/lib/sso-provisioning';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
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

    // Role for a membership this sign-in creates: the tenant's SSO default
    // role, else read-only VIEWER — never TENANT_ADMIN by default. See
    // src/lib/sso-provisioning.ts.
    const provisioningRole = await pickProvisioningRole(
      cfg.tenantId,
      cfg.defaultRoleId,
      (where) => withPlatformAdmin(prisma, (tx) =>
        tx.role.findFirst({ where, select: { id: true, code: true } })),
    );

    // The role signed into the session: the user's own membership role. It
    // was previously always the provisioning role, so every SSO sign-in —
    // existing members included — got the SSO default (TENANT_ADMIN when
    // none was configured) instead of the role the tenant assigned them.
    let sessionRoleCode: string;

    // Match or JIT-create user.
    let user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      if (!cfg.jitEnabled) {
        return redirectAndClear(req, '/login?sso=user-not-provisioned');
      }
      if (!provisioningRole) return redirectAndClear(req, '/login?sso=no-role');
      const role = provisioningRole;
      // First/last name fallbacks.
      const first = givenN || (fullName.split(' ')[0]  ?? email.split('@')[0]);
      const last  = familyN || (fullName.split(' ').slice(1).join(' ') || '—');
      const newId = crypto.randomUUID();
      // withPlatformAdmin rather than a bare $transaction: this writes
      // user_tenants, which is RLS-protected, and a plain transaction sets no
      // app.tenant_id. SSO callback runs before any tenant session exists.
      await withPlatformAdmin(prisma, async (tx) => {
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
      sessionRoleCode = role.code;
    } else {
      if (!user.isActive) return redirectAndClear(req, '/login?sso=account-disabled');
      // Bound to a const so the non-null narrowing survives into the closure
      // below — `user` is a let and TypeScript re-widens it inside callbacks.
      const existingUser = user;

      // Ensure UserTenant exists / is active. user_tenants is RLS-protected
      // and there is no tenant session yet, so this reads and writes under
      // platform scope. The membership-missing redirect is computed inside and
      // returned out, so the early exit still works.
      type MembershipOutcome = { redirect: string } | { roleCode: string };
      const outcome = await withPlatformAdmin(prisma, async (tx): Promise<MembershipOutcome> => {
        const membership = await tx.userTenant.findUnique({
          where: { userId_tenantId: { userId: existingUser.id, tenantId: cfg.tenantId } },
          include: { role: { select: { code: true } } },
        }).catch(() => null);
        if (!membership) {
          if (!cfg.jitEnabled) return { redirect: '/login?sso-membership-missing' };
          if (!provisioningRole) return { redirect: '/login?sso=no-role' };
          await tx.userTenant.create({
            data: { id: crypto.randomUUID(), userId: existingUser.id, tenantId: cfg.tenantId, roleId: provisioningRole.id, isActive: true },
          });
          return { roleCode: provisioningRole.code };
        }
        if (!membership.isActive) {
          await tx.userTenant.update({ where: { id: membership.id }, data: { isActive: true } });
        }
        return { roleCode: membership.role.code };
      });
      if ('redirect' in outcome) return redirectAndClear(req, outcome.redirect);
      sessionRoleCode = outcome.roleCode;
    }

    void logAudit({
      tenantId: tenant.id, tenantName: tenant.name,
      userId: user.id, userRole: sessionRoleCode, userEmail: email,
      entityType: 'Login', action: 'LOGIN',
      details: `OIDC SSO login (issuer=${cfg.issuer}, sub=${sub}).`,
    });

    const sessionToken = await signSession({
      userId:   user.id,
      tenantId: tenant.id,
      plan:     tenant.plan ?? 'TRIAL',
      role:     sessionRoleCode,
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
