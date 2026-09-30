/**
 * tests/unit/email-templates-render.test.ts
 *
 * The email template renderer (src/lib/email-templates/render.ts) and the
 * built-in catalogue.
 *
 * Covered:
 *  - markup: paragraphs, line breaks, **bold**, links, a lone link as a button
 *  - tenant text and variable values are escaped; a value cannot add markup
 *  - links must be http(s) or mailto after filling, else only the label shows
 *  - block variables are inserted as generated HTML, only on their own line
 *  - the subject is one line; unknown variables are left as written
 *  - Arabic renders right-to-left; the plain-text part mirrors the HTML
 *  - validation: required fields, lengths, unknown and misplaced variables
 *  - every built-in template only uses its own variables, in both languages
 */
import { describe, it, expect } from 'vitest';
import { renderEmailContent, validateTemplate, placeholdersIn } from '@/lib/email-templates/render';
import { EMAIL_TEMPLATES, templateVariables, EMAIL_LOCALES } from '@/lib/email-templates/catalogue';

const branding = { companyName: 'Acme <Fleet>', primaryColor: '#123456' };
const render = (body: string, values: Record<string, string> = {}, extra: Partial<Parameters<typeof renderEmailContent>[0]> = {}) =>
  renderEmailContent({ subject: 'S', body, values, locale: 'en', branding, ...extra });

describe('renderEmailContent', () => {
  it('renders paragraphs, line breaks and bold', () => {
    const { html, text } = render('Hello **{{name}}**\nsecond line\n\nNext paragraph', { name: 'Sam' });
    expect(html).toContain('Hello <strong>Sam</strong><br>second line</p>');
    expect(html).toContain('>Next paragraph</p>');
    expect(text).toBe('Hello Sam\nsecond line\n\nNext paragraph');
  });

  it('escapes template text and values; a value cannot add markup', () => {
    const { html, text } = render('<b>x</b> {{v}}', { v: '**bold** [x](https://evil.test) <script>' });
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('**bold** [x](https://evil.test) &lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="https://evil.test"');
    expect(text).toContain('<script>');
  });

  it('links inline, turns a lone link into a button, and drops unsafe links', () => {
    const inline = render('See [our site]({{url}}) now', { url: 'https://acme.example/a?b=1&c=2' });
    expect(inline.html).toContain('<a href="https://acme.example/a?b=1&amp;c=2"');
    expect(inline.text).toContain('our site: https://acme.example/a?b=1&c=2');
    const button = render('[Approve]({{url}})', { url: 'https://acme.example/approvals' });
    expect(button.html).toMatch(/display:inline-block;background:#123456[^>]*>Approve<\/a>/);
    const unsafe = render('[Click]({{url}})', { url: 'javascript:alert(1)' });
    expect(unsafe.html).not.toContain('javascript:');
    expect(unsafe.html).toContain('>Click</p>');
  });

  it('inserts block variables only on their own line', () => {
    const blocks = { table: { html: '<table id="t"></table>', text: 'TABLE' } };
    const own = render('Intro\n\n{{table}}\n\nEnd', {}, { blocks });
    expect(own.html).toContain('<table id="t"></table>');
    expect(own.text).toBe('Intro\n\nTABLE\n\nEnd');
    const inline = render('Intro {{table}}', {}, { blocks });
    expect(inline.html).not.toContain('<table id="t">');
  });

  it('keeps the subject to one line and leaves unknown variables as written', () => {
    const r = renderEmailContent({ subject: 'Hi {{name}}\r\nBcc: x@y {{other}}', body: 'b', values: { name: 'A' }, locale: 'en', branding });
    expect(r.subject).toBe('Hi A Bcc: x@y {{other}}');
  });

  it('renders Arabic right-to-left and escapes the company name', () => {
    const r = render('مرحبا', {}, { locale: 'ar' });
    expect(r.html).toContain('<html lang="ar" dir="rtl">');
    expect(r.html).toContain('text-align:right');
    expect(r.html).toContain('Acme &lt;Fleet&gt;');
  });

  it('only shows an https logo', () => {
    expect(render('x', {}, { branding: { ...branding, logoUrl: 'https://cdn.example/l.png' } }).html).toContain('<img src="https://cdn.example/l.png"');
    expect(render('x', {}, { branding: { ...branding, logoUrl: 'javascript:1' } }).html).not.toContain('<img');
  });
});

describe('validateTemplate', () => {
  const allowed = [{ name: 'a' }, { name: 'blk', block: true }];
  it('accepts a valid template', () => {
    expect(validateTemplate({ subject: 'Hi {{a}}', body: 'x {a}\n\n{{blk}}' }, allowed)).toEqual([]);
  });
  it('reports missing, oversized, unknown and misplaced content', () => {
    expect(validateTemplate({ subject: '', body: '' }, allowed)).toEqual(['Subject is required.', 'Body is required.']);
    expect(validateTemplate({ subject: 'x'.repeat(201), body: 'b' }, allowed)[0]).toContain('at most 200');
    expect(validateTemplate({ subject: 's', body: '{{nope}} {x}' }, allowed)).toEqual(['Unknown variables: {{nope}}, {{x}}.']);
    expect(validateTemplate({ subject: '{{blk}}', body: 'b' }, allowed)).toEqual(['{{blk}} can only be used in the body.']);
  });
});

describe('catalogue', () => {
  it('every built-in template uses only its own variables, in every language', () => {
    for (const def of EMAIL_TEMPLATES) {
      for (const locale of EMAIL_LOCALES) {
        expect(validateTemplate(def.defaults[locale], templateVariables(def)), `${def.key} ${locale}`).toEqual([]);
      }
    }
  });
  it('finds variables in both brace styles', () => {
    expect(placeholdersIn('{a} {{ b }} {{a}}')).toEqual(['a', 'b']);
  });
});
