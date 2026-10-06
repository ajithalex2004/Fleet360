'use client';
/**
 * One row per active Attachment Type (Admin > Attachment Types): pick a
 * file, and optionally a document number and expiry date. Used by the
 * Create Tenant modal (drafts sent with the create request) and by the
 * tenant Manage page (drafts uploaded with "Upload").
 *
 * The server repeats every check here (src/lib/tenant-attachments.ts).
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

export interface AttachmentDraft {
  file: File;
  documentNumber: string;
  expiryDate: string;
}

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

export function TenantAttachmentFields({ types, drafts, onChange, alreadyUploaded, showErrors }: {
  types: readonly AttachmentTypeOption[];
  drafts: AttachmentDrafts;
  onChange: (next: AttachmentDrafts) => void;
  /** Type ids that already have a document (shown as "On file"). */
  alreadyUploaded?: ReadonlySet<string>;
  /** Highlight missing mandatory documents (after a failed submit). */
  showErrors?: boolean;
}) {
  const set = (typeId: string, d: AttachmentDraft | undefined) => onChange({ ...drafts, [typeId]: d });

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
                    if (file) set(t.id, { file, documentNumber: d?.documentNumber ?? '', expiryDate: d?.expiryDate ?? '' });
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
                  <input type="text" value={d.documentNumber}
                    onChange={(e) => set(t.id, { ...d, documentNumber: e.target.value })}
                    placeholder="Optional"
                    className="mt-1 w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs focus:border-blue-500 focus:outline-none" />
                </label>
                <label className="text-[11px] text-[var(--text-muted)]">
                  Expiry date {t.requiresExpiry && <span className="text-rose-400">*</span>}
                  <input type="date" value={d.expiryDate}
                    onChange={(e) => set(t.id, { ...d, expiryDate: e.target.value })}
                    className={`mt-1 w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border text-[var(--text-main)] text-xs focus:border-blue-500 focus:outline-none ${expiryMissing ? 'border-rose-500/60' : 'border-[var(--border-subtle)]'}`} />
                </label>
              </div>
            )}
            {missing && <p className="mt-2 text-xs text-rose-300">{t.name} is mandatory.</p>}
          </div>
        );
      })}
      <p className="text-[11px] text-[var(--text-faint)]">PDF, PNG, JPEG or WebP, up to 10 MB each.</p>
    </div>
  );
}
