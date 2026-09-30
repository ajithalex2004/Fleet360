export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/email-templates
 *
 * Every editable email with, per language, the caller's tenant's saved
 * wording, the platform default and the built-in wording; and the tenant's
 * branding, for the live preview the screen renders itself.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { isSuperAdmin } from '@/lib/admin-access';
import { EMAIL_LOCALES, EMAIL_TEMPLATES, templateVariables } from '@/lib/email-templates/catalogue';
import { listTemplateRows, tenantEmailContext, type TemplateRow } from '@/lib/email-templates';

const saved = (row: TemplateRow | undefined) => row
  ? { subject: row.subject, body: row.body, version: row.version, updatedBy: row.updated_by, updatedAt: row.updated_at }
  : null;

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const [rows, ctx] = await Promise.all([listTemplateRows(tenantId), tenantEmailContext(tenantId)]);
    const find = (key: string, locale: string, tenant: string | null) =>
      rows.find((r) => r.template_key === key && r.locale === locale && r.tenant_id === tenant);
    return NextResponse.json({
      canEditPlatform: isSuperAdmin(req.headers),
      defaultLocale: ctx.locale,
      // For the screen's live preview (rendered in the browser with render.ts).
      branding: { companyName: ctx.companyName, productName: ctx.productName, logoUrl: ctx.logoUrl, primaryColor: ctx.primaryColor },
      locales: EMAIL_LOCALES,
      templates: EMAIL_TEMPLATES.map((def) => ({
        key: def.key,
        module: def.module,
        name: def.name,
        description: def.description,
        variables: templateVariables(def),
        entries: Object.fromEntries(EMAIL_LOCALES.map((locale) => [locale, {
          tenant: saved(find(def.key, locale, tenantId)),
          platform: saved(find(def.key, locale, null)),
          builtIn: def.defaults[locale],
        }])),
      })),
    });
  } catch (e) {
    console.error('GET /api/admin/email-templates error:', e);
    return NextResponse.json({ error: 'Failed to load email templates' }, { status: 500 });
  }
}
