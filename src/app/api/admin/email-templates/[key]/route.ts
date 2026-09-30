export const dynamic = 'force-dynamic';

/**
 * PUT    /api/admin/email-templates/[key]   save the wording for one language
 * DELETE /api/admin/email-templates/[key]?locale=&scope=   reset to the default
 *
 * scope 'tenant' (default) is the caller's tenant; 'platform' the platform
 * default, for platform administrators. Replaced and reset versions are kept
 * (GET .../versions).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { sessionUser } from '@/lib/session-user';
import { templateVariables } from '@/lib/email-templates/catalogue';
import { validateTemplate } from '@/lib/email-templates/render';
import { resetTemplate, saveTemplate } from '@/lib/email-templates';
import { localeFrom, scopeFor, templateFor } from '@/lib/email-templates/admin';

type Ctx = { params: Promise<{ key: string }> };

async function handlePUT(req: NextRequest, props: Ctx) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const def = templateFor((await props.params).key, req.headers);
  if (def instanceof NextResponse) return def;
  const body = await req.json().catch(() => ({}));
  const locale = localeFrom(body.locale);
  if (locale instanceof NextResponse) return locale;
  const scope = scopeFor(req.headers, tenantId, body.scope, def);
  if (scope instanceof NextResponse) return scope;

  const subject = typeof body.subject === 'string' ? body.subject : '';
  const text = typeof body.body === 'string' ? body.body : '';
  const errors = validateTemplate({ subject, body: text }, templateVariables(def));
  if (errors.length) return NextResponse.json({ error: errors.join(' '), errors }, { status: 400 });

  try {
    const me = await sessionUser(req.headers);
    const row = await scope.run(() => saveTemplate({
      tenantId: scope.owner, key: def.key, locale, subject, body: text, savedBy: me?.email ?? 'unknown',
    }));
    return NextResponse.json({ version: row.version, updatedAt: row.updated_at });
  } catch (e) {
    console.error('PUT /api/admin/email-templates error:', e);
    return NextResponse.json({ error: 'Failed to save the template' }, { status: 500 });
  }
}

async function handleDELETE(req: NextRequest, props: Ctx) {
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
    const me = await sessionUser(req.headers);
    const removed = await scope.run(() => resetTemplate({
      tenantId: scope.owner, key: def.key, locale, savedBy: me?.email ?? 'unknown',
    }));
    return NextResponse.json({ reset: removed });
  } catch (e) {
    console.error('DELETE /api/admin/email-templates error:', e);
    return NextResponse.json({ error: 'Failed to reset the template' }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PUT = withAuditedAction(handlePUT);
export const DELETE = withAuditedAction(handleDELETE);
