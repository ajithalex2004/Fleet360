export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/schema-status — platform admins only.
 *
 * Every table/column the app checks at runtime (src/lib/db/schema-registry.ts)
 * that is missing from the database, per module, checked now. The public
 * /api/readyz and /api/health report only a count.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { REQUIRED_SCHEMAS, schemaReport } from '@/lib/db/schema-registry';
import { runtimeDdlAllowed } from '@/lib/db/schema-init';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const report = await schemaReport({ fresh: true });
  return NextResponse.json({
    ...report,
    modules: Object.entries(REQUIRED_SCHEMAS).map(([name, spec]) => ({
      name,
      tables: spec.tables.length,
      columns: spec.columns?.length ?? 0,
      missing: report.missing[name] ?? [],
    })),
    runtimeDdl: runtimeDdlAllowed() ? 'allowed' : 'disabled',
  }, { headers: { 'Cache-Control': 'no-store' } });
}
