'use client';
/**
 * Admin > Email templates: each tenant's wording for the platform's emails,
 * in English and Arabic (src/lib/email-templates). Platform administrators
 * can also edit the platform defaults every tenant starts from.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mail, RotateCcw, Send, Save, History } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import { renderEmailContent, sampleValues, validateTemplate } from '@/lib/email-templates/render';

type Locale = 'en' | 'ar';
type Scope = 'tenant' | 'platform';
interface Saved { subject: string; body: string; version: number; updatedBy: string | null; updatedAt: string }
interface Variable { name: string; description: string; sample: string; block?: boolean }
interface TemplateInfo {
  key: string; module: string; name: string; description: string; variables: Variable[];
  bilingual: boolean; platformOnly: boolean;
  entries: Record<Locale, { tenant: Saved | null; platform: Saved | null; builtIn: { subject: string; body: string } }>;
}
interface Branding { companyName: string; productName: string | null; logoUrl: string | null; primaryColor: string | null }
interface ListResponse { canEditPlatform: boolean; defaultLocale: Locale; branding: Branding; platformBranding: Branding; templates: TemplateInfo[] }
interface Version { id: string; version: number; subject: string; body: string; savedBy: string | null; savedAt: string; reason: string }

const LOCALE_LABEL: Record<Locale, string> = { en: 'English', ar: 'العربية' };

/** The wording currently in effect for a scope, and where it comes from. */
function effective(t: TemplateInfo, locale: Locale, scope: Scope):
  { subject: string; body: string; source: string; version?: number; updatedBy?: string | null } {
  const e = t.entries[locale];
  if (scope === 'tenant' && e.tenant) return { ...e.tenant, source: 'Custom (your company)' };
  if (e.platform) return { ...e.platform, source: 'Platform default' };
  return { ...e.builtIn, source: 'Built-in' };
}

export default function EmailTemplatesPage() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [locale, setLocale] = useState<Locale>('en');
  const [scope, setScope] = useState<Scope>('tenant');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const lastFocus = useRef<'subject' | 'body'>('body');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/email-templates');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load');
      setData(json);
      setSelectedKey((k) => k || json.templates[0]?.key || '');
      setLocale((l) => (json.defaultLocale ?? l) as Locale);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const template = useMemo(() => data?.templates.find((t) => t.key === selectedKey) ?? null, [data, selectedKey]);
  // Emails the platform sends to tenants only have a platform version.
  const editScope: Scope = template?.platformOnly ? 'platform' : scope;
  const current = template ? effective(template, locale, editScope) : null;
  const hasOwn = template ? Boolean(editScope === 'tenant' ? template.entries[locale].tenant : template.entries[locale].platform) : false;
  const dirty = current ? subject !== current.subject || body !== current.body : false;

  // Load the effective wording whenever the template, language or scope changes.
  useEffect(() => {
    if (!current) return;
    setSubject(current.subject);
    setBody(current.body);
    setVersions(null);
    setMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, locale, editScope, data]);

  // Live preview, rendered here with the same code the server sends with.
  const preview = useMemo(() => {
    if (!template || !data) return null;
    const branding = template.platformOnly ? data.platformBranding : data.branding;
    const { values, blocks } = sampleValues(template.variables, branding.companyName);
    return {
      ...renderEmailContent({ subject, body, values, blocks, locale, branding }),
      errors: validateTemplate({ subject, body }, template.variables),
    };
  }, [template, data, subject, body, locale]);

  const insertVariable = (name: string) => {
    const token = `{{${name}}}`;
    const target = lastFocus.current === 'subject' ? subjectRef.current : bodyRef.current;
    const value = lastFocus.current === 'subject' ? subject : body;
    const set = lastFocus.current === 'subject' ? setSubject : setBody;
    const start = target?.selectionStart ?? value.length;
    const end = target?.selectionEnd ?? value.length;
    set(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => { target?.focus(); target?.setSelectionRange(start + token.length, start + token.length); });
  };

  const call = async (fn: () => Promise<Response>, ok: string) => {
    setBusy(true); setMessage(null);
    try {
      const res = await fn();
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Request failed');
      setMessage({ kind: 'ok', text: typeof ok === 'string' ? ok.replace('{to}', json.to ?? '') : ok });
      return json;
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Request failed' });
      return null;
    } finally { setBusy(false); }
  };
  const url = (suffix = '') => `/api/admin/email-templates/${encodeURIComponent(template!.key)}${suffix}`;

  const save = async () => {
    if (await call(() => fetch(url(), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale, scope: editScope, subject, body }),
    }), 'Saved.')) await load();
  };
  const reset = async () => {
    if (!confirm(editScope === 'platform'
      ? 'Remove the platform default? Tenants without their own wording go back to the built-in text.'
      : 'Go back to the default wording? Your current version is kept in History.')) return;
    if (await call(() => fetch(url(`?locale=${locale}&scope=${editScope}`), { method: 'DELETE' }), 'Back to the default wording.')) await load();
  };
  const sendTest = () => call(() => fetch(url('/test'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locale, subject, body }),
  }), 'Test email sent to {to}.');
  const loadVersions = async () => {
    const res = await fetch(url(`/versions?locale=${locale}&scope=${editScope}`));
    setVersions(res.ok ? await res.json() : []);
  };

  const modules = useMemo(() => {
    const groups = new Map<string, TemplateInfo[]>();
    for (const t of data?.templates ?? []) groups.set(t.module, [...(groups.get(t.module) ?? []), t]);
    return [...groups.entries()];
  }, [data]);

  const input = 'w-full px-3 py-2.5 bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-main)] text-sm focus:outline-none focus:border-violet-500/50';
  const button = 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50';

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader title="Email templates" subtitle="Change the wording of the emails your company sends, in English and Arabic" icon={Mail} accent="violet" />

      {loadError && <p className="text-rose-400 text-sm">{loadError}</p>}
      {!data && !loadError && <p className="text-[var(--text-faint)] text-sm animate-pulse">Loading…</p>}

      {data && template && current && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Template list */}
          <aside className="lg:col-span-3 space-y-4">
            {modules.map(([module, items]) => (
              <div key={module}>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-2">{module}</p>
                <div className="space-y-1">
                  {items.map((t) => (
                    <button key={t.key} onClick={() => setSelectedKey(t.key)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${t.key === selectedKey ? 'bg-violet-500/15 text-[var(--text-main)] border border-violet-500/30' : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] border border-transparent'}`}>
                      <span className="block font-medium">{t.name}</span>
                      <span className="block text-[11px] text-[var(--text-faint)]">
                        {(['en', 'ar'] as Locale[]).map((l) => `${l.toUpperCase()}: ${t.entries[l].tenant ? 'custom' : t.entries[l].platform ? 'platform' : 'built-in'}`).join(' · ')}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </aside>

          {/* Editor */}
          <section className="lg:col-span-5 space-y-4">
            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-5 space-y-4">
              <div>
                <h2 className="text-[var(--text-main)] font-semibold">{template.name}</h2>
                <p className="text-xs text-[var(--text-muted)] mt-1">{template.description}</p>
                {template.bilingual && (
                  <p className="text-xs text-blue-300 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2 mt-2">
                    Sent in English and Arabic together in one email (your company&apos;s language first). Edit each language here.
                  </p>
                )}
                {template.platformOnly && (
                  <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mt-2">
                    Sent by the platform to your customer companies. Only platform administrators see and edit it.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {(['en', 'ar'] as Locale[]).map((l) => (
                  <button key={l} onClick={() => setLocale(l)}
                    className={`${button} ${locale === l ? 'bg-violet-600 text-white' : 'bg-[var(--bg-canvas)] text-[var(--text-muted)] border border-[var(--border-subtle)]'}`}>
                    {LOCALE_LABEL[l]}
                  </button>
                ))}
                {data.canEditPlatform && !template.platformOnly && (
                  <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}
                    className="ml-auto px-2 py-2 rounded-lg text-sm bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-main)]">
                    <option value="tenant">Editing: my company</option>
                    <option value="platform">Editing: platform default</option>
                  </select>
                )}
              </div>

              <p className="text-xs text-[var(--text-faint)]">
                Now using: <span className="text-[var(--text-muted)] font-medium">{current.source}</span>
                {current.updatedBy ? ` · v${current.version} by ${current.updatedBy}` : ''}
                {dirty && <span className="text-amber-400"> · unsaved changes</span>}
              </p>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Subject</label>
                <input ref={subjectRef} value={subject} dir={locale === 'ar' ? 'rtl' : 'ltr'}
                  onFocus={() => { lastFocus.current = 'subject'; }}
                  onChange={(e) => setSubject(e.target.value.replace(/[\r\n]/g, ' '))} className={input} maxLength={200} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Message</label>
                <textarea ref={bodyRef} value={body} rows={14} dir={locale === 'ar' ? 'rtl' : 'ltr'}
                  onFocus={() => { lastFocus.current = 'body'; }}
                  onChange={(e) => setBody(e.target.value)} className={`${input} font-mono resize-y`} />
                <p className="text-[11px] text-[var(--text-faint)] mt-1.5">
                  **bold** · [link text](https://…) · a link on its own line becomes a button · a blank line starts a new paragraph
                </p>
              </div>

              <div>
                <p className="text-xs font-semibold text-[var(--text-muted)] mb-1.5">Insert a variable</p>
                <div className="flex flex-wrap gap-1.5">
                  {template.variables.map((v) => (
                    <button key={v.name} type="button" title={`${v.description}${v.block ? ' (body only, on its own line)' : ''} — e.g. ${v.sample}`}
                      onClick={() => insertVariable(v.name)}
                      className="px-2 py-1 rounded-md text-xs font-mono bg-blue-500/15 text-blue-300 border border-blue-500/25 hover:bg-blue-500/25">
                      {`{{${v.name}}}`}
                    </button>
                  ))}
                </div>
              </div>

              {preview?.errors?.length ? (
                <ul className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2 space-y-0.5">
                  {preview.errors.map((e) => <li key={e}>{e}</li>)}
                </ul>
              ) : null}
              {message && (
                <p className={`text-sm px-3 py-2 rounded-lg border ${message.kind === 'ok' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-rose-400 bg-rose-500/10 border-rose-500/20'}`}>{message.text}</p>
              )}

              <div className="flex flex-wrap gap-2">
                <button onClick={save} disabled={busy || (!dirty && hasOwn) || Boolean(preview?.errors?.length)}
                  className={`${button} bg-violet-600 text-white hover:bg-violet-500`}><Save className="w-4 h-4" /> Save</button>
                <button onClick={sendTest} disabled={busy || Boolean(preview?.errors?.length)}
                  className={`${button} bg-[var(--bg-canvas)] text-[var(--text-main)] border border-[var(--border-subtle)]`}><Send className="w-4 h-4" /> Send test to me</button>
                <button onClick={reset} disabled={busy || !hasOwn}
                  className={`${button} bg-[var(--bg-canvas)] text-[var(--text-main)] border border-[var(--border-subtle)]`}><RotateCcw className="w-4 h-4" /> Reset to default</button>
                <button onClick={loadVersions} disabled={busy}
                  className={`${button} bg-[var(--bg-canvas)] text-[var(--text-main)] border border-[var(--border-subtle)]`}><History className="w-4 h-4" /> History</button>
              </div>

              {versions && (
                <div className="border-t border-[var(--border-subtle)] pt-3 space-y-2">
                  <p className="text-xs font-semibold text-[var(--text-muted)]">Earlier versions</p>
                  {versions.length === 0 && <p className="text-xs text-[var(--text-faint)]">No earlier versions yet.</p>}
                  {versions.map((v) => (
                    <div key={v.id} className="flex items-center justify-between gap-2 text-xs bg-[var(--bg-canvas)] rounded-lg px-3 py-2">
                      <span className="text-[var(--text-muted)] truncate">
                        v{v.version} · {new Date(v.savedAt).toLocaleString()} · {v.savedBy ?? 'unknown'} {v.reason === 'reset' ? '(before reset)' : ''}
                      </span>
                      <button onClick={() => { setSubject(v.subject); setBody(v.body); setMessage({ kind: 'ok', text: `Loaded v${v.version}. Save to restore it.` }); }}
                        className="text-violet-400 hover:text-violet-300 font-medium shrink-0">Load</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Preview */}
          <section className="lg:col-span-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">Preview (sample data)</p>
            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border-subtle)] text-sm text-[var(--text-main)] font-medium" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
                {preview?.subject ?? ''}
              </div>
              <iframe title="Email preview" sandbox="" srcDoc={preview?.html ?? ''} className="w-full h-[640px] bg-white" />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
