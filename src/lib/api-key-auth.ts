/**
 * API-route helper for authenticating callers with a tenant API key.
 *
 * Reads the key from either:
 *   - Authorization: Bearer xlk_…
 *   - X-Api-Key: xlk_…
 *
 * Returns a tenant context object ({ tenantId, scopes, keyId, keyName })
 * or a NextResponse 401 to short-circuit the route.
 *
 * Usage:
 *   const auth = await requireApiKey(req, ['fleet.read']);
 *   if (auth instanceof NextResponse) return auth;
 *   // auth.tenantId, auth.scopes available
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey, touchApiKeyUsage } from '@/lib/api-keys';

export interface ApiKeyAuth {
  tenantId: string;
  scopes:   string[];
  keyId:    string;
  keyName:  string;
}

function extractKey(req: NextRequest): string | null {
  const auth = req.headers.get('authorization');
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
  }
  const x = req.headers.get('x-api-key');
  if (x) return x.trim();
  return null;
}

/**
 * Validate a key and (optionally) require scopes. Returns the auth context,
 * or a NextResponse the caller should immediately return.
 *
 * Required scopes use exact match. Pass `[]` (default) to allow any scope.
 */
export async function requireApiKey(
  req: NextRequest,
  requiredScopes: string[] = [],
): Promise<ApiKeyAuth | NextResponse> {
  const key = extractKey(req);
  if (!key) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Missing API key. Send Authorization: Bearer xlk_… or X-Api-Key.' },
      { status: 401 },
    );
  }

  const match = await verifyApiKey(key);
  if (!match) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Invalid or revoked API key.' },
      { status: 401 },
    );
  }

  if (requiredScopes.length > 0) {
    const ok = requiredScopes.every(s => match.scopes.includes(s));
    if (!ok) {
      return NextResponse.json(
        { error: 'Forbidden', message: `API key missing required scope(s): ${requiredScopes.join(', ')}` },
        { status: 403 },
      );
    }
  }

  // Fire-and-forget — don't slow the request to wait on it.
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
  void touchApiKeyUsage(match.id, ip);

  return {
    tenantId: match.tenantId,
    scopes:   match.scopes,
    keyId:    match.id,
    keyName:  match.name,
  };
}
