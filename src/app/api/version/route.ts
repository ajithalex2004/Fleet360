/**
 * GET /api/version
 * Returns the current API version and build metadata.
 * Public route — no auth required.
 */
import { NextResponse } from 'next/server';
import { CURRENT_API_VERSION, DEPRECATED_VERSIONS } from '@/lib/api-version';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function GET() {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return NextResponse.json({
    apiVersion:         CURRENT_API_VERSION,
    deprecatedVersions: DEPRECATED_VERSIONS,
    versionPrefix:      `/api/v${CURRENT_API_VERSION}`,
    buildTime:          process.env.NEXT_PUBLIC_BUILD_TIME ?? null,
  });
}
