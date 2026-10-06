'use client';
/**
 * Tenant Manage page → Attachments: the tenant's documents (view, remove)
 * and uploads for any active attachment type. A mandatory type cannot be
 * left empty: the server refuses to remove its last document.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  TenantAttachmentFields, attachmentDraftProblems, appendAttachmentDrafts, formatBytes,
  type AttachmentDrafts, type AttachmentTypeOption,
} from '@/components/TenantAttachmentFields';

interface Attachment {
  id: string;
  attachmentTypeId: string;
  typeName: string;
  fileUrl: string;
  originalName: string;
  sizeBytes: number;
  documentNumber: string | null;
  expiryDate: string | null;
  createdAt: string;
}

interface Loaded {
  types: AttachmentTypeOption[];
  attachments: Attachment[];
  missingMandatory: string[];
}

const today = () => new Date().toISOString().slice(0, 10);

export function TenantAttachmentsPanel({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState('');
  const [drafts, setDrafts] = useState<AttachmentDrafts>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/tenants/${tenantId}/attachments`, { cache: 'no-store' });
    const d = await r.json().catch(() => null);
    if (!r.ok) { setLoadError(d?.error ?? `Could not load attachments (HTTP ${r.status})`); return; }
    setLoadError('');
    setData(d as Loaded);
  }, [tenantId]);
  useEffect(() => { void load(); }, [load]);

  const upload = async () => {
    if (!data) return;
    const problems = attachmentDraftProblems(data.types, drafts, { requireMandatory: false });
    if (problems.length > 0) { setMessage({ kind: 'error', text: problems[0] }); return; }
    setBusy(true); setMessage(null);
    try {
      const body = new FormData();
      appendAttachmentDrafts(body, drafts);
      const r = await fetch(`/api/admin/tenants/${tenantId}/attachments`, { method: 'POST', body });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMessage({ kind: 'error', text: d.error ?? `Upload failed (HTTP ${r.status})` }); return; }
      setDrafts({});
      setMessage({ kind: 'ok', text: `Uploaded ${d.added ?? ''} document(s).` });
      await load();
    } catch { setMessage({ kind: 'error', text: 'Network error — please try again' }); }
    finally { setBusy(false); }
  };

  const remove = async (a: Attachment) => {
    if (!confirm(`Remove ${a.typeName} (${a.originalName}) from ${tenantName}?`)) return;
    setBusy(true); setMessage(null);
    try {
      const r = await fetch(`/api/admin/tenants/${tenantId}/attachments/${a.id}`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMessage({ kind: 'error', text: d.error ?? `Remove failed (HTTP ${r.status})` }); return; }
      setMessage({ kind: 'ok', text: `Removed ${a.typeName}.` });
      await load();
    } finally { setBusy(false); }
  };

  if (loadError) {
    return <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-rose-300 text-sm">{loadError}</div>;
  }
  if (!data) return <div className="text-[var(--text-muted)] text-sm animate-pulse">Loading attachments…</div>;

  const uploadedTypes = new Set(data.attachments.map((a) => a.attachmentTypeId));
  const draftCount = Object.values(drafts).filter(Boolean).length;

  return (
    <div className="space-y-6">
      {data.missingMandatory.length > 0 && (
        <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-200 text-sm">
          Missing mandatory document{data.missingMandatory.length > 1 ? 's' : ''}: <strong>{data.missingMandatory.join(', ')}</strong>. Upload below.
        </div>
      )}
      {message && (
        <div role={message.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-xl px-4 py-3 text-sm border ${message.kind === 'error'
            ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'}`}>
          {message.text}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-[var(--text-main)]">Documents on file</h2>
        {data.attachments.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No documents uploaded for {tenantName} yet.</p>
        ) : (
          <div className="rounded-2xl border border-[var(--border-subtle)] overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Type</th>
                  <th className="text-left px-4 py-2.5 font-medium">File</th>
                  <th className="text-left px-4 py-2.5 font-medium">Document no.</th>
                  <th className="text-left px-4 py-2.5 font-medium">Expiry</th>
                  <th className="text-left px-4 py-2.5 font-medium">Uploaded</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {data.attachments.map((a) => {
                  const expired = a.expiryDate !== null && a.expiryDate < today();
                  return (
                    <tr key={a.id} className="border-t border-[var(--border-subtle)]">
                      <td className="px-4 py-2.5 font-medium text-[var(--text-main)]">{a.typeName}</td>
                      <td className="px-4 py-2.5">
                        <a href={a.fileUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                          {a.originalName}
                        </a>
                        <span className="text-[var(--text-faint)] text-xs"> ({formatBytes(a.sizeBytes)})</span>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-muted)]">{a.documentNumber ?? '—'}</td>
                      <td className={`px-4 py-2.5 ${expired ? 'text-rose-300 font-medium' : 'text-[var(--text-muted)]'}`}>
                        {a.expiryDate ?? '—'}{expired && ' (expired)'}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-muted)]">{new Date(a.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button type="button" disabled={busy} onClick={() => void remove(a)}
                          className="text-xs px-3 py-1.5 rounded-lg border border-rose-500/30 text-rose-300 hover:bg-rose-500/10 disabled:opacity-50">
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-main)]">Upload documents</h2>
            <p className="text-sm text-[var(--text-muted)]">Choose a file for any type, then upload. A new file is added alongside the existing ones.</p>
          </div>
          <button type="button" onClick={() => void upload()} disabled={busy || draftCount === 0}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 flex-shrink-0">
            {busy ? 'Uploading…' : draftCount > 0 ? `Upload ${draftCount} document${draftCount > 1 ? 's' : ''}` : 'Upload'}
          </button>
        </div>
        <TenantAttachmentFields types={data.types} drafts={drafts} onChange={setDrafts} alreadyUploaded={uploadedTypes} tenantId={tenantId} />
      </section>
    </div>
  );
}
