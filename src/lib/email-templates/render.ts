/**
 * Turns a template (see catalogue.ts for the markup) into an email.
 *
 * Tenant-written text never becomes raw HTML: the template is escaped and its
 * markup (**bold**, [label](url), paragraphs) converted first; variable values
 * are escaped and inserted last, so a value cannot add markup either. Links
 * must end up http(s) or mailto, else only their label is shown. Block
 * variables are HTML the platform generated itself (e.g. the quotation table)
 * and are the only unescaped content. Pure functions, no I/O.
 */
import type { EmailLocale, TemplateVariable } from './catalogue';

export const PLACEHOLDER_RE = /\{\{?\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}?\}/g;
const LINK_RE = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const LONE_PLACEHOLDER_RE = /^\{\{?\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}?\}$/;
const LONE_LINK_RE = /^\[([^\]\n]+)\]\(([^)\s]+)\)$/;

export const SUBJECT_MAX = 200;
export const BODY_MAX = 20_000;

export interface EmailBlock { html: string; text: string }

export interface EmailBranding {
  companyName: string;
  productName?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
}

export interface RenderedEmail { subject: string; html: string; text: string }

export const escapeHtml = (v: string) => v
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Variable names used in a template, in order of first use. */
export function placeholdersIn(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER_RE)) names.add(m[1]);
  return [...names];
}

/** Problems that stop a template from being saved (empty = fine). */
export function validateTemplate(
  input: { subject: string; body: string },
  allowed: Array<{ name: string; block?: boolean }>,
): string[] {
  const errors: string[] = [];
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!subject) errors.push('Subject is required.');
  if (subject.length > SUBJECT_MAX) errors.push(`Subject must be at most ${SUBJECT_MAX} characters.`);
  if (/[\r\n]/.test(input.subject.trim())) errors.push('Subject must be a single line.');
  if (!body) errors.push('Body is required.');
  if (body.length > BODY_MAX) errors.push(`Body must be at most ${BODY_MAX} characters.`);
  const names = new Map(allowed.map((v) => [v.name, v]));
  const unknown = placeholdersIn(`${subject}\n${body}`).filter((n) => !names.has(n));
  if (unknown.length) errors.push(`Unknown variables: ${unknown.map((n) => `{{${n}}}`).join(', ')}.`);
  const blockInSubject = placeholdersIn(subject).filter((n) => names.get(n)?.block);
  if (blockInSubject.length) errors.push(`{{${blockInSubject[0]}}} can only be used in the body.`);
  return errors;
}

const fill = (text: string, values: Record<string, string>, encode: (v: string) => string) =>
  text.replace(PLACEHOLDER_RE, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? encode(values[name]) : encode(match));

const safeHref = (raw: string, values: Record<string, string>): string | null => {
  const href = fill(raw, values, (v) => v).trim();
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
};

/** Escapes, then **bold**, then variables (escaped), then line breaks. */
function inlineHtml(raw: string, values: Record<string, string>): string {
  const bolded = escapeHtml(raw).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return fill(bolded, values, escapeHtml).replace(/\n/g, '<br>');
}

function inlineText(raw: string, values: Record<string, string>): string {
  return fill(raw.replace(/\*\*(.+?)\*\*/g, '$1'), values, (v) => v);
}

function paragraphHtml(raw: string, values: Record<string, string>, color: string): string {
  let out = '';
  let last = 0;
  for (const m of raw.matchAll(LINK_RE)) {
    out += inlineHtml(raw.slice(last, m.index), values);
    const href = safeHref(m[2], values);
    const label = inlineHtml(m[1], values);
    out += href ? `<a href="${escapeHtml(href)}" style="color:${color};">${label}</a>` : label;
    last = (m.index ?? 0) + m[0].length;
  }
  return out + inlineHtml(raw.slice(last), values);
}

function paragraphText(raw: string, values: Record<string, string>): string {
  return raw.replace(LINK_RE, (_m, label: string, href: string) => {
    const url = safeHref(href, values);
    return url ? `${inlineText(label, values)}: ${url}` : inlineText(label, values);
  }).replace(/[^\n]+/g, (line) => inlineText(line, values));
}

const colorOr = (value: string | null | undefined, fallback: string) =>
  value && /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : fallback;

/** One language's subject and body, rendered but not yet laid out. */
interface RenderedSection { locale: EmailLocale; subject: string; html: string; text: string }

function renderSection(args: {
  subject: string; body: string; values: Record<string, string>;
  blocks?: Record<string, EmailBlock>; locale: EmailLocale; color: string;
}): RenderedSection {
  const { values, blocks = {}, locale, color } = args;
  const subject = fill(args.subject, values, (v) => v)
    .replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 250);

  const paragraphs = args.body.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean);
  const htmlParts: string[] = [];
  const textParts: string[] = [];
  for (const p of paragraphs) {
    const lone = LONE_PLACEHOLDER_RE.exec(p);
    if (lone && blocks[lone[1]]) {
      htmlParts.push(blocks[lone[1]].html);
      textParts.push(blocks[lone[1]].text);
      continue;
    }
    const button = LONE_LINK_RE.exec(p);
    const href = button ? safeHref(button[2], values) : null;
    if (button && href) {
      htmlParts.push(`<p style="margin:24px 0;text-align:center;"><a href="${escapeHtml(href)}" style="display:inline-block;background:${color};color:#ffffff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">${inlineHtml(button[1], values)}</a></p>`);
      textParts.push(`${inlineText(button[1], values)}: ${href}`);
      continue;
    }
    htmlParts.push(`<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">${paragraphHtml(p, values, color)}</p>`);
    textParts.push(paragraphText(p, values));
  }
  return { locale, subject, html: htmlParts.join('\n'), text: textParts.join('\n\n') };
}

/** Wraps rendered sections (one per language, first one leading) in the branded layout. */
function layout(sections: RenderedSection[], subject: string, branding: EmailBranding, color: string): string {
  const lead = sections[0].locale;
  const leadRtl = lead === 'ar';
  const logo = branding.logoUrl && /^https:\/\//i.test(branding.logoUrl)
    ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(branding.companyName)}" style="max-height:40px;max-width:200px;display:block;">`
    : `<div style="color:#ffffff;font-size:18px;font-weight:700;">${escapeHtml(branding.companyName)}</div>`;
  const footer = leadRtl
    ? `مرسلة من ${escapeHtml(branding.companyName)}`
    : `Sent by ${escapeHtml(branding.companyName)}`;
  const body = sections.map((sec, i) => {
    const rtl = sec.locale === 'ar';
    const border = i > 0 ? 'border-top:1px solid #e5e7eb;' : '';
    return `<tr><td dir="${rtl ? 'rtl' : 'ltr'}" lang="${sec.locale}" style="padding:32px;${border}text-align:${rtl ? 'right' : 'left'};">${sec.html}</td></tr>`;
  }).join('\n');
  return `<!DOCTYPE html>
<html lang="${lead}" dir="${leadRtl ? 'rtl' : 'ltr'}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;"><tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" dir="${leadRtl ? 'rtl' : 'ltr'}" style="max-width:640px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;text-align:${leadRtl ? 'right' : 'left'};">
<tr><td style="background:${color};padding:20px 32px;">${logo}</td></tr>
${body}
<tr><td style="background:#f9fafb;padding:16px 32px;color:#9ca3af;font-size:12px;">${footer}</td></tr>
</table>
</td></tr></table>
</body>
</html>`;
}

/**
 * Renders subject, HTML and plain text. `values` are the variable values
 * (unknown placeholders are left as written); `blocks` are block variables.
 */
export function renderEmailContent(args: {
  subject: string;
  body: string;
  values: Record<string, string>;
  blocks?: Record<string, EmailBlock>;
  locale: EmailLocale;
  branding: EmailBranding;
}): RenderedEmail {
  const color = colorOr(args.branding.primaryColor, '#4f46e5');
  const section = renderSection({ ...args, color });
  return { subject: section.subject, html: layout([section], section.subject, args.branding, color), text: section.text };
}

/**
 * One email carrying two languages (e.g. formal notices): each language's
 * section rendered from its own template, the `lead` language first. The
 * subject joins both subjects; the plain text holds both, separated.
 */
export function renderBilingualEmailContent(args: {
  lead: EmailLocale;
  sections: Record<EmailLocale, { subject: string; body: string; values: Record<string, string>; blocks?: Record<string, EmailBlock> }>;
  branding: EmailBranding;
}): RenderedEmail {
  const color = colorOr(args.branding.primaryColor, '#4f46e5');
  const order: EmailLocale[] = args.lead === 'ar' ? ['ar', 'en'] : ['en', 'ar'];
  const sections = order.map((locale) => renderSection({ ...args.sections[locale], locale, color }));
  const subject = sections.map((s) => s.subject).join(' / ').slice(0, 250);
  return {
    subject,
    html: layout(sections, subject, args.branding, color),
    text: sections.map((s) => s.text).join('\n\n----------\n\n'),
  };
}

/**
 * Sample values for previews and test sends: each variable's sample, and a
 * placeholder box for block variables.
 */
export function sampleValues(variables: TemplateVariable[], companyName: string) {
  const values: Record<string, string> = {};
  const blocks: Record<string, EmailBlock> = {};
  for (const v of variables) {
    if (v.block) {
      blocks[v.name] = {
        html: `<div style="margin:0 0 16px;padding:16px;border:1px dashed #cbd5e1;border-radius:8px;color:#64748b;font-size:13px;text-align:center;">${escapeHtml(v.description)}</div>`,
        text: `[${v.description}]`,
      };
    } else {
      values[v.name] = v.sample;
    }
  }
  values.companyName = companyName;
  return { values, blocks };
}

/** A bulleted list block (e.g. the policies in a digest); items are escaped. */
export function listBlock(items: string[]): EmailBlock {
  return {
    html: `<ul style="margin:0 0 16px;padding-inline-start:20px;color:#374151;font-size:14px;line-height:1.7;">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`,
    text: items.map((i) => `- ${i}`).join('\n'),
  };
}
