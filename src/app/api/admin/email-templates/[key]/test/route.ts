export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/email-templates/[key]/test  { locale, subject, body }
 *
 * Sends the email, with sample values, to the signed-in user only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { sessionUser } from '@/lib/session-user';
import { sendEmail } from '@/lib/email';
import { templateVariables } from '@/lib/email-templates/catalogue';
import { renderEmailContent, sampleValues, validateTemplate } from '@/lib/email-templates/render';
import { PLATFORM_NAME, tenantEmailContext } from '@/lib/email-templates';
import { localeFrom, templateFor } from '@/lib/email-templates/admin';

async function handlePOST(req: NextRequest, props: { params: Promise<{ key: string }> }) {
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
  const subject = typeof body.subject === 'string' ? body.subject : '';
  const text = typeof body.body === 'string' ? body.body : '';
  const errors = validateTemplate({ subject, body: text }, templateVariables(def));
  if (errors.length) return NextResponse.json({ error: errors.join(' '), errors }, { status: 400 });

  const me = await sessionUser(req.headers);
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ctx = await tenantEmailContext(tenantId);
  const branding = def.platformOnly
    ? { companyName: PLATFORM_NAME }
    : { companyName: ctx.companyName, productName: ctx.productName, logoUrl: ctx.logoUrl, primaryColor: ctx.primaryColor };
  const { values, blocks } = sampleValues(templateVariables(def), branding.companyName);
  const rendered = renderEmailContent({ subject, body: text, values, blocks, locale, branding });
  const result = await sendEmail({ to: me.email, subject: `[Test] ${rendered.subject}`, html: rendered.html, text: rendered.text });
  if (!result.sent) {
    const reason = result.reason === 'smtp_not_configured' || result.reason === 'not_configured'
      ? 'Email is not set up. Configure SMTP in Admin > Settings > Notifications.'
      : (result.error ?? result.reason ?? 'Send failed');
    return NextResponse.json({ sent: false, to: me.email, error: reason }, { status: 502 });
  }
  return NextResponse.json({ sent: true, to: me.email });
}

// Sends an email: audited like other privileged actions.
export const POST = withAuditedAction(handlePOST);
