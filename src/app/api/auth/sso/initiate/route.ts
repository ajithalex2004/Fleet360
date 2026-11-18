/**
 * GET /api/auth/sso/initiate?email=user@acme.com
 *
 * Looks up the tenant SSO config by the email's domain. If a config exists,
 * builds an OIDC authorization URL (with PKCE + nonce + state) and redirects
 * the browser to the IdP. Stores PKCE verifier + nonce + state + tenant_id
 * in a short-lived signed cookie so the callback can complete the dance.
 *
 * If no config matches, redirects back to /login?sso=unknown.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as oidc from 'openid-client';
import { findSsoConfigByEmail } from '@/lib/sso';
import { signSsoState } from '@/lib/sso-state';
import { captureException } from '@/lib/sentry';
import { getPublicOrigin } from '@/lib/public-origin';

export const runtime = 'nodejs';

const SSO_STATE_COOKIE = 'xl-sso-state';

export async function GET(req: NextRequest) {
  const url   = new URL(req.url);
  const email = (url.searchParams.get('email') ?? '').trim().toLowerCase();
  const ret   = url.searchParams.get('returnTo') ?? '/platform';

  if (!email || !/.+@.+\..+/.test(email)) {
    return redirectTo(req, '/login?sso=missing-email');
  }

  const cfg = await findSsoConfigByEmail(email);
  if (!cfg || !cfg.isActive) {
    return redirectTo(req, `/login?sso=unknown&email=${encodeURIComponent(email)}`);
  }

  try {
    const config = await oidc.discovery(
      new URL(cfg.issuer),
      cfg.clientId,
      cfg.clientSecret,
    );

    const codeVerifier  = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state         = oidc.randomState();
    const nonce         = oidc.randomNonce();

    const baseUrl    = getPublicOrigin(req);
    const redirectUri = `${baseUrl}/api/auth/sso/callback`;

    const authUrl = oidc.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });

    const stateToken = await signSsoState({
      tenantId: cfg.tenantId,
      email,
      codeVerifier,
      state,
      nonce,
      returnTo: ret,
    });

    const res = NextResponse.redirect(authUrl.href);
    res.cookies.set(SSO_STATE_COOKIE, stateToken, {
      httpOnly: true, sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 600, // 10 min
      path: '/',
    });
    return res;
  } catch (err) {
    captureException(err, { context: 'auth.sso.initiate', tags: { tenantId: cfg.tenantId } });
    return redirectTo(req, '/login?sso=discovery-failed');
  }
}

function redirectTo(req: NextRequest, path: string): NextResponse {
  const url = new URL(path, getPublicOrigin(req));
  return NextResponse.redirect(url);
}
