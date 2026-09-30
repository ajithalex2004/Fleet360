/**
 * Shared checks for the Email templates admin API
 * (src/app/api/admin/email-templates). Tenant administrators edit their own
 * tenant's templates; platform administrators also edit the platform
 * defaults (scope 'platform'), which run in platform context.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { isSuperAdmin } from '@/lib/admin-access';
import { runAsTenant } from '@/lib/rls-scope';
import { getTemplateDef, isEmailLocale, type EmailLocale, type EmailTemplateDef } from './catalogue';

export type TemplateScope = 'tenant' | 'platform';

/** The template a request names; platform-only ones exist only for platform administrators. */
export function templateFor(key: string, headers: Headers): EmailTemplateDef | NextResponse {
  const def = getTemplateDef(decodeURIComponent(key));
  if (!def || (def.platformOnly && !isSuperAdmin(headers))) {
    return NextResponse.json({ error: 'Unknown email template' }, { status: 404 });
  }
  return def;
}

export function localeFrom(value: unknown): EmailLocale | NextResponse {
  return isEmailLocale(value)
    ? value
    : NextResponse.json({ error: 'locale must be en or ar' }, { status: 400 });
}

/**
 * Whose template a request edits: the caller's tenant, or the platform
 * default (platform administrators only). `run` executes the storage call in
 * the matching database context.
 */
export function scopeFor(headers: Headers, tenantId: string, scope: unknown, def?: EmailTemplateDef):
  | { owner: string | null; run: <T>(fn: () => Promise<T>) => Promise<T> }
  | NextResponse {
  if (def?.platformOnly && scope !== 'platform') {
    return NextResponse.json({ error: 'This email is sent by the platform: edit it as the platform default (scope=platform).' }, { status: 400 });
  }
  if (scope === 'platform') {
    if (!isSuperAdmin(headers)) {
      return NextResponse.json({ error: 'Only a platform administrator can change the platform defaults.' }, { status: 403 });
    }
    return { owner: null, run: (fn) => runAsTenant('*', fn) };
  }
  if (scope !== undefined && scope !== null && scope !== 'tenant') {
    return NextResponse.json({ error: 'scope must be tenant or platform' }, { status: 400 });
  }
  return { owner: tenantId, run: (fn) => fn() };
}
