/**
 * Tenant email templates: which wording an email uses, and storing edits.
 *
 * An email is rendered from, in order:
 *   1. an override the caller passes (a workflow step's own email wording);
 *   2. the tenant's saved template;
 *   3. the platform default (tenant_id NULL);
 *   4. the built-in wording in catalogue.ts.
 * in the tenant's default language (tenants.default_language: Arabic or
 * English), wrapped in the tenant's branding.
 *
 * Storage: email_templates / email_template_versions
 * (prisma/migrations/20261019090000_email_templates), under RLS. Queries use
 * the global client. Rendering reads the tenant's rows as that tenant
 * (runAsTenant), so it works the same from a request, a cron sweep or a
 * background job; pass only a tenant id the server derived itself (the
 * session's, or a record's), never one from request input. The admin
 * storage functions run with the request's tenant (or platform context under
 * runAsTenant('*')); every query also filters on the tenant.
 */
import 'server-only';
import { prisma } from '@/lib/prisma';
import { getBranding } from '@/lib/branding';
import { runAsTenant } from '@/lib/rls-scope';
import type { EmailSendResult } from '@/lib/email';
import {
  getTemplateDef, templateVariables, type EmailLocale, type EmailTemplateDef,
} from './catalogue';
import { renderEmailContent, type EmailBlock, type RenderedEmail } from './render';

export interface TemplateRow {
  id: string;
  tenant_id: string | null;
  template_key: string;
  locale: EmailLocale;
  subject: string;
  body: string;
  version: number;
  updated_by: string | null;
  updated_at: Date;
}

export interface VersionRow {
  id: string;
  version: number;
  subject: string;
  body: string;
  saved_by: string | null;
  saved_at: Date;
  reason: string;
}

export interface TenantEmailContext {
  companyName: string;
  locale: EmailLocale;
  productName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
}

/** Name, language and branding of a tenant; safe defaults on any failure. */
export async function tenantEmailContext(tenantId: string): Promise<TenantEmailContext> {
  const [tenant, branding] = await runAsTenant(tenantId, () => Promise.all([
    prisma.$queryRawUnsafe<Array<{ name: string | null; default_language: string | null }>>(
      `SELECT name, default_language FROM tenants WHERE id::text = $1 LIMIT 1`, tenantId,
    ).catch(() => []),
    getBranding(tenantId).catch(() => null),
  ]));
  const language = tenant[0]?.default_language ?? branding?.defaultLanguage ?? 'en';
  return {
    companyName: tenant[0]?.name || branding?.productName || 'Fleet360',
    locale: language.toLowerCase().startsWith('ar') ? 'ar' : 'en',
    productName: branding?.productName ?? null,
    logoUrl: branding?.logoUrl ?? null,
    primaryColor: branding?.primaryColor ?? null,
  };
}

const scopeCondition = (tenantId: string | null, index: number) =>
  tenantId === null ? 'tenant_id IS NULL' : `tenant_id = $${index}`;

/** The tenant's and the platform's saved rows for one template and language. */
export async function findTemplateRows(tenantId: string, key: string, locale: EmailLocale) {
  const rows = await runAsTenant(tenantId, () => prisma.$queryRawUnsafe<TemplateRow[]>(
    `SELECT * FROM email_templates
      WHERE template_key = $1 AND channel = 'EMAIL' AND locale = $2 AND is_active
        AND (tenant_id = $3 OR tenant_id IS NULL)`,
    key, locale, tenantId,
  ));
  return {
    tenant: rows.find((r) => r.tenant_id === tenantId) ?? null,
    platform: rows.find((r) => r.tenant_id === null) ?? null,
  };
}

/** Variable values with each variable's fallback applied for empty ones. */
function withFallbacks(def: EmailTemplateDef, locale: EmailLocale, values: Record<string, string>) {
  const out: Record<string, string> = { ...values };
  for (const v of templateVariables(def)) {
    if (!out[v.name] && v.fallback?.[locale]) out[v.name] = v.fallback[locale]!;
  }
  return out;
}

export type TemplateSource = 'override' | 'tenant' | 'platform' | 'default';

/**
 * Renders an email for `tenantId`. `values` fill the template's variables
 * (companyName is added from the tenant); `blocks` are its block variables.
 */
export async function renderEmail(args: {
  tenantId: string;
  key: string;
  values: Record<string, string>;
  blocks?: Record<string, EmailBlock>;
  override?: { subject?: string | null; body?: string | null };
  locale?: EmailLocale;
  context?: TenantEmailContext;
}): Promise<RenderedEmail & { locale: EmailLocale; source: TemplateSource }> {
  const def = getTemplateDef(args.key);
  if (!def) throw new Error(`Unknown email template: ${args.key}`);
  const ctx = args.context ?? await tenantEmailContext(args.tenantId);
  const locale = args.locale ?? ctx.locale;

  let saved: TemplateRow | null = null;
  let source: TemplateSource = 'default';
  try {
    const rows = await findTemplateRows(args.tenantId, def.key, locale);
    saved = rows.tenant ?? rows.platform;
    if (saved) source = rows.tenant ? 'tenant' : 'platform';
  } catch (e) {
    console.error(`[email-templates] could not load ${def.key}; using built-in wording:`, e instanceof Error ? e.message : e);
  }
  let subject = saved?.subject ?? def.defaults[locale].subject;
  let body = saved?.body ?? def.defaults[locale].body;
  if (args.override?.subject?.trim()) { subject = args.override.subject; source = 'override'; }
  if (args.override?.body?.trim()) { body = args.override.body; source = 'override'; }

  const values = withFallbacks(def, locale, { companyName: ctx.companyName, ...args.values });
  const rendered = renderEmailContent({
    subject, body, values, blocks: args.blocks, locale,
    branding: {
      companyName: values.companyName, productName: ctx.productName,
      logoUrl: ctx.logoUrl, primaryColor: ctx.primaryColor,
    },
  });
  return { ...rendered, locale, source };
}

/** An absolute link into the app. */
export function appUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Renders a template for `tenantId` and sends it through the platform email
 * sender (src/lib/email.ts). Never throws: a rendering or sending failure is
 * returned as a not-sent result (and logged), so callers that email as a
 * side effect can ignore it.
 */
export async function sendTemplatedEmail(args: Parameters<typeof renderEmail>[0] & {
  to: string | string[];
  replyTo?: string;
}): Promise<EmailSendResult> {
  try {
    const { to, replyTo, ...render } = args;
    const email = await renderEmail(render);
    // Loaded on use: the sender pulls in Sentry and env validation.
    const { sendEmail } = await import('@/lib/email');
    const result = await sendEmail({ to, subject: email.subject, html: email.html, text: email.text, ...(replyTo ? { replyTo } : {}) });
    if (!result.sent) {
      console.warn(`[email-templates] ${args.key} for tenant ${args.tenantId} not sent (${result.reason ?? 'unknown'})`);
    }
    return result;
  } catch (e) {
    console.error(`[email-templates] ${args.key} failed:`, e instanceof Error ? e.message : e);
    return { sent: false, reason: 'smtp_error', error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Storage (admin screen) ───────────────────────────────────────────────

/** Saved rows of `tenantId` and the platform, all templates and languages. */
export async function listTemplateRows(tenantId: string) {
  return prisma.$queryRawUnsafe<TemplateRow[]>(
    `SELECT * FROM email_templates
      WHERE channel = 'EMAIL' AND (tenant_id = $1 OR tenant_id IS NULL)`,
    tenantId,
  );
}

/**
 * Saves a template for a tenant (or the platform when `tenantId` is null:
 * call under runAsTenant('*')). The version it replaces is kept.
 */
export async function saveTemplate(args: {
  tenantId: string | null; key: string; locale: EmailLocale;
  subject: string; body: string; savedBy: string;
}): Promise<TemplateRow> {
  const { tenantId, key, locale, savedBy } = args;
  const subject = args.subject.trim();
  const body = args.body.replace(/\r\n?/g, '\n').trim();
  return prisma.$transaction(async (tx) => {
    const params: unknown[] = [key, locale];
    if (tenantId !== null) params.push(tenantId);
    const existing = await tx.$queryRawUnsafe<TemplateRow[]>(
      `SELECT * FROM email_templates
        WHERE template_key = $1 AND channel = 'EMAIL' AND locale = $2 AND ${scopeCondition(tenantId, 3)}
        FOR UPDATE`,
      ...params,
    );
    if (existing[0]) {
      const old = existing[0];
      await tx.$executeRawUnsafe(
        `INSERT INTO email_template_versions
           (template_id, tenant_id, template_key, locale, version, subject, body, saved_by, reason)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, 'replaced')`,
        old.id, tenantId, key, locale, old.version, old.subject, old.body, old.updated_by,
      );
      const updated = await tx.$queryRawUnsafe<TemplateRow[]>(
        `UPDATE email_templates
            SET subject = $2, body = $3, version = version + 1, is_active = true,
                updated_by = $4, updated_at = now()
          WHERE id = $1::uuid RETURNING *`,
        old.id, subject, body, savedBy,
      );
      return updated[0];
    }
    const inserted = await tx.$queryRawUnsafe<TemplateRow[]>(
      `INSERT INTO email_templates (tenant_id, template_key, locale, subject, body, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      tenantId, key, locale, subject, body, savedBy,
    );
    return inserted[0];
  });
}

/** Removes a saved template (back to the next level down), keeping it as a version. */
export async function resetTemplate(args: {
  tenantId: string | null; key: string; locale: EmailLocale; savedBy: string;
}): Promise<boolean> {
  const { tenantId, key, locale, savedBy } = args;
  return prisma.$transaction(async (tx) => {
    const params: unknown[] = [key, locale];
    if (tenantId !== null) params.push(tenantId);
    const existing = await tx.$queryRawUnsafe<TemplateRow[]>(
      `SELECT * FROM email_templates
        WHERE template_key = $1 AND channel = 'EMAIL' AND locale = $2 AND ${scopeCondition(tenantId, 3)}
        FOR UPDATE`,
      ...params,
    );
    if (!existing[0]) return false;
    const old = existing[0];
    await tx.$executeRawUnsafe(
      `INSERT INTO email_template_versions
         (template_id, tenant_id, template_key, locale, version, subject, body, saved_by, reason)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, 'reset')`,
      old.id, tenantId, key, locale, old.version, old.subject, old.body, savedBy,
    );
    await tx.$executeRawUnsafe(`DELETE FROM email_templates WHERE id = $1::uuid`, old.id);
    return true;
  });
}

/** Earlier versions of a template, newest first. */
export async function listVersions(tenantId: string | null, key: string, locale: EmailLocale) {
  const params: unknown[] = [key, locale];
  if (tenantId !== null) params.push(tenantId);
  return prisma.$queryRawUnsafe<VersionRow[]>(
    `SELECT id, version, subject, body, saved_by, saved_at, reason FROM email_template_versions
      WHERE template_key = $1 AND channel = 'EMAIL' AND locale = $2 AND ${scopeCondition(tenantId, 3)}
      ORDER BY saved_at DESC LIMIT 50`,
    ...params,
  );
}
