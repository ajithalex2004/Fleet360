'use client';
/**
 * One row per active Attachment Type (Admin > Attachment Types): pick a
 * file, and optionally a document number and expiry date. Used by the
 * Create Tenant modal (drafts sent with the create request) and by the
 * tenant Manage page (drafts uploaded with "Upload").
 *
 * The server repeats every check here (src/lib/tenant-attachments.ts).
 *
 * Choosing a file asks the server to read its Document Number and Expiry
 * Date (POST /api/admin/attachment-types/[id]/autofill). Values read are
 * only put into empty fields, are marked for checking, and stay editable.
 */
import React from 'react';

export interface AttachmentTypeOption {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isMandatory: boolean;
  requiresExpiry: boolean;
}

export interface AttachmentAutofill {
  state: 'reading' | 'done' | 'skipped' | 'unavailable';
  /** Fields whose current value came from the document. */
  filledNumber?: boolean;
  filledExpiry?: boolean;
  warnings?: string[];
  message?: string;
}

export interface AttachmentDraft {
  file: File;
  documentNumber: string;
  expiryDate: string;
  autofill?: AttachmentAutofill;
}

type AutofillReply =
  | { status: 'ok'; documentNumber: string | null; expiryDate: string | null; warnings: string[] }
  | { status: 'skipped' | 'unavailable'; reason: string }
  | { error: string };

/** typeId → the file chosen for that type. */
export type AttachmentDrafts = Record<string, AttachmentDraft | undefined>;

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp';
const ACCEPTED_EXT = /\.(pdf|png|jpe?g|webp)$/i;

export const formatBytes = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/**
 * Problems with the drafts, one per message. `alreadyUploaded` holds the
 * type ids the tenant already has a document for (Manage page).
 */
export function attachmentDraftProblems(
  types: readonly AttachmentTypeOption[],
  drafts: AttachmentDrafts,
  opts: { requireMandatory: boolean; alreadyUploaded?: ReadonlySet<string> },
): string[] {
  const problems: string[] = [];
  for (const t of types) {
    const d = drafts[t.id];
    if (!d) {
      if (opts.requireMandatory && t.isMandatory && !opts.alreadyUploaded?.has(t.id)) {
        problems.push(`${t.name} is mandatory: attach it to continue.`);
      }
      continue;
    }
    if (d.file.size > MAX_BYTES) problems.push(`${t.name}: files can be at most 10 MB.`);
    if (!ACCEPTED_EXT.test(d.file.name)) problems.push(`${t.name}: upload a PDF, PNG, JPEG or WebP file.`);
    if (t.requiresExpiry && !d.expiryDate) problems.push(`${t.name}: enter the expiry date.`);
  }
  return problems;
}

/** Add the drafts to a multipart body in the fields the API reads. */
export function appendAttachmentDrafts(form: FormData, drafts: AttachmentDrafts): void {
  for (const [typeId, d] of Object.entries(drafts)) {
    if (!d) continue;
    form.append(`file:${typeId}`, d.file, d.file.name);
    if (d.documentNumber.trim()) form.append(`documentNumber:${typeId}`, d.documentNumber.trim());
    if (d.expiryDate) form.append(`expiryDate:${typeId}`, d.expiryDate);
  }
}

export function TenantAttachmentFields({ types, drafts, onChange, alreadyUploaded, showErrors, tenantId }: {
  types: readonly AttachmentTypeOption[];
  drafts: AttachmentDrafts;
  /** Receives an updater, like a useState setter (autofill replies arrive later). */
  onChange: (update: (prev: AttachmentDrafts) => AttachmentDrafts) => void;
  /** The tenant, once it exists: autofill is skipped for region-resident tenants. */
  tenantId?: string;
  /** Type ids that already have a document (shown as "On file"). */
  alreadyUploaded?: ReadonlySet<string>;
  /** Highlight missing mandatory documents (after a failed submit). */
  showErrors?: boolean;
}) {
  const set = (typeId: string, d: AttachmentDraft | undefined) => onChange((prev) => ({ ...prev, [typeId]: d }));

  /** Apply `patch` to the draft of `typeId`, but only while it still holds `file`. */
  const patchIfSameFile = (typeId: string, file: File, patch: (d: AttachmentDraft) => AttachmentDraft) =>
    onChange((prev) => {
      const d = prev[typeId];
      return d && d.file === file ? { ...prev, [typeId]: patch(d) } : prev;
    });

  const readDocument = async (typeId: string, file: File) => {
    const body = new FormData();
    body.append('file', file, file.name);
    if (tenantId) body.append('tenantId', tenantId);
    let reply: AutofillReply;
    try {
      const r = await fetch(`/api/admin/attachment-types/${typeId}/autofill`, { method: 'POST', body });
      reply = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    } catch {
      reply = { status: 'unavailable', reason: 'The document could not be read right now.' };
    }
    patchIfSameFile(typeId, file, (d) => {
      if ('error' in reply) return { ...d, autofill: { state: 'unavailable', message: reply.error } };
      if (reply.status !== 'ok') return { ...d, autofill: { state: reply.status, message: reply.reason } };
      // Never overwrite what the admin typed while the document was read.
      const fillNumber = !d.documentNumber && !!reply.documentNumber;
      const fillExpiry = !d.expiryDate && !!reply.expiryDate;
      return {
        ...d,
        documentNumber: fillNumber ? reply.documentNumber! : d.documentNumber,
        expiryDate: fillExpiry ? reply.expiryDate! : d.expiryDate,
        autofill: { state: 'done', filledNumber: fillNumber, filledExpiry: fillExpiry, warnings: reply.warnings },
      };
    });
  };

  return (
    <div className="space-y-2">
      {types.map((t) => {
        const d = drafts[t.id];
        const onFile = alreadyUploaded?.has(t.id);
        const missing = showErrors && t.isMandatory && !d && !onFile;
        const expiryMissing = showErrors && d && t.requiresExpiry && !d.expiryDate;
        const inputId = `attachment-${t.id}`;
        return (
          <div key={t.id}
            className={`rounded-xl border p-3 transition-all ${missing
              ? 'border-rose-500/60 bg-rose-500/5'
              : d ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]/40'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-semibold text-[var(--text-main)]">{t.name}</span>
                  {t.isMandatory
                    ? <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium bg-rose-500/15 text-rose-300 border-rose-500/30">Mandatory</span>
                    : <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium bg-slate-500/15 text-[var(--text-muted)] border-slate-500/30">Optional</span>}
                  {onFile && <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium bg-emerald-500/15 text-emerald-300 border-emerald-500/30">On file</span>}
                </div>
                {t.description && <p className="text-xs text-[var(--text-muted)] mt-0.5">{t.description}</p>}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <label htmlFor={inputId}
                  className="cursor-pointer text-xs px-3 py-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20">
                  {d ? 'Change file' : onFile ? 'Upload new' : 'Choose file'}
                </label>
                <input id={inputId} type="file" accept={ACCEPT} className="sr-only"
                  aria-label={`${t.name} file`}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    // A new file: its own details are read; earlier values belonged to the old file.
                    set(t.id, { file, documentNumber: '', expiryDate: '', autofill: { state: 'reading' } });
                    void readDocument(t.id, file);
                  }} />
                {d && (
                  <button type="button" onClick={() => set(t.id, undefined)}
                    className="text-xs px-2 py-1.5 rounded-lg text-[var(--text-muted)] hover:text-rose-300" aria-label={`Remove ${t.name} file`}>
                    ✕
                  </button>
                )}
              </div>
            </div>

            {d && (
              <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                <div className="text-xs text-[var(--text-main)] truncate" title={d.file.name}>
                  📄 {d.file.name} <span className="text-[var(--text-faint)]">({formatBytes(d.file.size)})</span>
                </div>
                <label className="text-[11px] text-[var(--text-muted)]">
                  Document number
                  {d.autofill?.filledNumber && <ReadBadge />}
                  <input type="text" value={d.documentNumber}
                    onChange={(e) => set(t.id, { ...d, documentNumber: e.target.value, autofill: d.autofill && { ...d.autofill, filledNumber: false } })}
                    placeholder={d.autofill?.state === 'reading' ? 'Reading document…' : 'Optional'}
                    className="mt-1 w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs focus:border-blue-500 focus:outline-none" />
                </label>
                <label className="text-[11px] text-[var(--text-muted)]">
                  Expiry date {t.requiresExpiry && <span className="text-rose-400">*</span>}
                  {d.autofill?.filledExpiry && <ReadBadge />}
                  <input type="date" value={d.expiryDate}
                    onChange={(e) => set(t.id, { ...d, expiryDate: e.target.value, autofill: d.autofill && { ...d.autofill, filledExpiry: false } })}
                    className={`mt-1 w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border text-[var(--text-main)] text-xs focus:border-blue-500 focus:outline-none ${expiryMissing ? 'border-rose-500/60' : 'border-[var(--border-subtle)]'}`} />
                </label>
              </div>
            )}
            {d?.autofill && <AutofillStatus autofill={d.autofill} />}
            {missing && <p className="mt-2 text-xs text-rose-300">{t.name} is mandatory.</p>}
          </div>
        );
      })}
      <p className="text-[11px] text-[var(--text-faint)]">PDF, PNG, JPEG or WebP, up to 10 MB each.</p>
    </div>
  );
}

function ReadBadge() {
  return (
    <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded border font-medium bg-violet-500/15 text-violet-300 border-violet-500/30"
      title="Read from the document: please check it">
      ✨ Read from document — please check
    </span>
  );
}

function AutofillStatus({ autofill }: { autofill: AttachmentAutofill }) {
  if (autofill.state === 'reading') {
    return <p className="mt-2 text-xs text-violet-300 animate-pulse" role="status">✨ Reading document number and expiry date…</p>;
  }
  if (autofill.state === 'done') {
    const filled = autofill.filledNumber || autofill.filledExpiry;
    return (
      <div className="mt-2 space-y-1" role="status">
        {!filled && !autofill.warnings?.length && (
          <p className="text-xs text-[var(--text-faint)]">Nothing could be read from the document: enter the details manually.</p>
        )}
        {autofill.warnings?.map((w) => (
          <p key={w} className="text-xs text-amber-300">⚠ {w}</p>
        ))}
      </div>
    );
  }
  return <p className="mt-2 text-xs text-[var(--text-faint)]" role="status">{autofill.message ?? 'Enter the details manually.'}</p>;
}
