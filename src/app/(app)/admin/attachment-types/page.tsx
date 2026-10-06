'use client';
/**
 * Admin > Attachment Types — the master list of documents a tenant can be
 * asked for (Trade License, Commercial License, VAT Certificate, Permits …).
 * Active types appear in the Create Tenant attachments step and on the
 * tenant's Attachments tab; mandatory ones must be attached before a tenant
 * can be created. Types are deactivated rather than deleted, because tenant
 * documents reference them.
 */
import React, { useCallback, useEffect, useState } from 'react';

interface AttachmentType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isMandatory: boolean;
  requiresExpiry: boolean;
  isActive: boolean;
  sortOrder: number;
}

const emptyNew = { code: '', name: '', description: '', isMandatory: false, requiresExpiry: false, sortOrder: 100 };

export default function AttachmentTypesPage() {
  const [types, setTypes] = useState<AttachmentType[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyNew);
  const [editing, setEditing] = useState<Record<string, Partial<AttachmentType>>>({});

  const load = useCallback(async () => {
    setLoadError('');
    const r = await fetch('/api/admin/attachment-types', { cache: 'no-store' });
    const d = await r.json().catch(() => null);
    if (!r.ok) { setLoadError(d?.error ?? `Could not load attachment types (HTTP ${r.status})`); setTypes([]); return; }
    setTypes(d as AttachmentType[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const flash = (kind: 'ok' | 'error', text: string) => {
    setMessage({ kind, text });
    if (kind === 'ok') setTimeout(() => setMessage(null), 3000);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('new');
    try {
      const r = await fetch('/api/admin/attachment-types', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, description: draft.description || null, sortOrder: Number(draft.sortOrder) || 100 }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { flash('error', d.error ?? `Save failed (HTTP ${r.status})`); return; }
      setDraft(emptyNew);
      flash('ok', `Added ${draft.name}.`);
      await load();
    } finally { setBusy(null); }
  };

  const update = async (t: AttachmentType, patch: Partial<AttachmentType>) => {
    setBusy(t.id);
    try {
      const r = await fetch(`/api/admin/attachment-types/${t.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { flash('error', d.error ?? `Save failed (HTTP ${r.status})`); return; }
      setEditing((p) => { const n = { ...p }; delete n[t.id]; return n; });
      flash('ok', `Saved ${patch.name ?? t.name}.`);
      await load();
    } finally { setBusy(null); }
  };

  const inputCls = 'w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm focus:border-blue-500 focus:outline-none';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-main)] mb-1">Attachment Types</h1>
        <p className="text-xs text-[var(--text-muted)]">
          Documents collected for each tenant. Active types appear in Create Tenant → Attachments; mandatory types must be attached before a tenant can be created.
        </p>
      </div>

      {message && (
        <div role={message.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-xl px-4 py-3 text-sm border ${message.kind === 'error'
            ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'}`}>
          {message.text}
        </div>
      )}
      {loadError && <div className="rounded-xl px-4 py-3 text-sm border bg-rose-500/10 border-rose-500/30 text-rose-300">{loadError}</div>}

      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/50 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Name</th>
              <th className="text-left px-4 py-3 font-medium">Code</th>
              <th className="text-center px-3 py-3 font-medium">Mandatory</th>
              <th className="text-center px-3 py-3 font-medium">Expiry date</th>
              <th className="text-center px-3 py-3 font-medium">Order</th>
              <th className="text-center px-3 py-3 font-medium">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {types === null && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-[var(--text-muted)] animate-pulse">Loading…</td></tr>
            )}
            {types?.length === 0 && !loadError && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-[var(--text-muted)]">No attachment types yet.</td></tr>
            )}
            {types?.map((t) => {
              const e = editing[t.id];
              const v = { ...t, ...e };
              return (
                <tr key={t.id} className={`border-t border-[var(--border-subtle)] ${t.isActive ? '' : 'opacity-60'}`}>
                  <td className="px-4 py-2.5 align-top">
                    {e ? (
                      <div className="space-y-1.5">
                        <input className={inputCls} value={v.name} aria-label="Name"
                          onChange={(ev) => setEditing((p) => ({ ...p, [t.id]: { ...p[t.id], name: ev.target.value } }))} />
                        <input className={inputCls} value={v.description ?? ''} placeholder="Description" aria-label="Description"
                          onChange={(ev) => setEditing((p) => ({ ...p, [t.id]: { ...p[t.id], description: ev.target.value } }))} />
                      </div>
                    ) : (
                      <>
                        <div className="font-medium text-[var(--text-main)]">{t.name}</div>
                        {t.description && <div className="text-xs text-[var(--text-muted)]">{t.description}</div>}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-2.5 align-top font-mono text-xs text-[var(--text-muted)]">{t.code}</td>
                  <td className="px-3 py-2.5 align-top text-center">
                    <input type="checkbox" className="w-4 h-4 accent-rose-500" checked={v.isMandatory} disabled={busy === t.id}
                      aria-label={`${t.name} mandatory`}
                      onChange={(ev) => (e
                        ? setEditing((p) => ({ ...p, [t.id]: { ...p[t.id], isMandatory: ev.target.checked } }))
                        : void update(t, { isMandatory: ev.target.checked }))} />
                  </td>
                  <td className="px-3 py-2.5 align-top text-center">
                    <input type="checkbox" className="w-4 h-4 accent-blue-500" checked={v.requiresExpiry} disabled={busy === t.id}
                      aria-label={`${t.name} requires expiry date`}
                      onChange={(ev) => (e
                        ? setEditing((p) => ({ ...p, [t.id]: { ...p[t.id], requiresExpiry: ev.target.checked } }))
                        : void update(t, { requiresExpiry: ev.target.checked }))} />
                  </td>
                  <td className="px-3 py-2.5 align-top text-center">
                    {e ? (
                      <input type="number" min={0} max={10000} className={`${inputCls} w-20 text-center`} value={v.sortOrder} aria-label="Sort order"
                        onChange={(ev) => setEditing((p) => ({ ...p, [t.id]: { ...p[t.id], sortOrder: Number(ev.target.value) } }))} />
                    ) : <span className="text-[var(--text-muted)]">{t.sortOrder}</span>}
                  </td>
                  <td className="px-3 py-2.5 align-top text-center">
                    <button type="button" disabled={busy === t.id} onClick={() => void update(t, { isActive: !t.isActive })}
                      className={`text-xs px-2 py-1 rounded-full border ${t.isActive
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : 'bg-slate-500/15 text-[var(--text-muted)] border-slate-500/30'}`}>
                      {t.isActive ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 align-top text-right whitespace-nowrap">
                    {e ? (
                      <>
                        <button type="button" disabled={busy === t.id}
                          onClick={() => void update(t, {
                            name: v.name, description: v.description?.trim() || null,
                            isMandatory: v.isMandatory, requiresExpiry: v.requiresExpiry, sortOrder: v.sortOrder,
                          })}
                          className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:opacity-90 disabled:opacity-50">Save</button>
                        <button type="button" onClick={() => setEditing((p) => { const n = { ...p }; delete n[t.id]; return n; })}
                          className="ml-2 text-xs px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-muted)]">Cancel</button>
                      </>
                    ) : (
                      <button type="button" onClick={() => setEditing((p) => ({ ...p, [t.id]: {} }))}
                        className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]">Edit</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <form onSubmit={create} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/50 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-[var(--text-main)]">Add attachment type</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="text-xs text-[var(--text-muted)]">Name *
            <input className={`${inputCls} mt-1`} required value={draft.name} placeholder="e.g. Insurance Certificate"
              onChange={(e) => setDraft((p) => ({
                ...p, name: e.target.value,
                // Suggest a code from the name until the admin types one.
                code: p.code && p.code !== suggestCode(p.name) ? p.code : suggestCode(e.target.value),
              }))} />
          </label>
          <label className="text-xs text-[var(--text-muted)]">Code *
            <input className={`${inputCls} mt-1 font-mono`} required value={draft.code} placeholder="INSURANCE_CERTIFICATE"
              onChange={(e) => setDraft((p) => ({ ...p, code: e.target.value.toUpperCase() }))} />
          </label>
          <label className="text-xs text-[var(--text-muted)] md:col-span-2">Description
            <input className={`${inputCls} mt-1`} value={draft.description} placeholder="Optional"
              onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-5">
          <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <input type="checkbox" className="w-4 h-4 accent-rose-500" checked={draft.isMandatory}
              onChange={(e) => setDraft((p) => ({ ...p, isMandatory: e.target.checked }))} /> Mandatory
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <input type="checkbox" className="w-4 h-4 accent-blue-500" checked={draft.requiresExpiry}
              onChange={(e) => setDraft((p) => ({ ...p, requiresExpiry: e.target.checked }))} /> Requires expiry date
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            Order
            <input type="number" min={0} max={10000} className={`${inputCls} w-24`} value={draft.sortOrder}
              onChange={(e) => setDraft((p) => ({ ...p, sortOrder: Number(e.target.value) }))} />
          </label>
          <button type="submit" disabled={busy === 'new'}
            className="ml-auto px-5 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-medium hover:opacity-90 disabled:opacity-50">
            {busy === 'new' ? 'Adding…' : '+ Add type'}
          </button>
        </div>
      </form>
    </div>
  );
}

function suggestCode(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);
}
