export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/email-templates/[key]/versions?locale=&scope=
 *
 * Earlier versions of the caller's tenant's (or the platform's) wording,
 * newest first, so an edit can be looked back at and restored.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { listVersions } from '@/lib/email-templates';
import { localeFrom, scopeFor, templateFor } from '@/lib/email-templates/admin';

export async function GET(req: NextRequest, props: { params: Promise<{ key: string }> }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const def = templateFor((await props.params).key, req.headers);
  if (def instanceof NextResponse) return def;
  const locale = localeFrom(req.nextUrl.searchParams.get('locale'));
  if (locale instanceof NextResponse) return locale;
  const scope = scopeFor(req.headers, tenantId, req.nextUrl.searchParams.get('scope') ?? undefined, def);
  if (scope instanceof NextResponse) return scope;

  try {
    const rows = await scope.run(() => listVersions(scope.owner, def.key, locale));
    return NextResponse.json(rows.map((r) => ({
      id: r.id, version: r.version, subject: r.subject, body: r.body,
      savedBy: r.saved_by, savedAt: r.saved_at, reason: r.reason,
    })));
  } catch (e) {
    console.error('GET /api/admin/email-templates versions error:', e);
    return NextResponse.json({ error: 'Failed to load versions' }, { status: 500 });
  }
}
