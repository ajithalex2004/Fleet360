'use client';

import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  FileText,
  Image as ImageIcon,
  CheckCircle2,
  Trash2,
  ExternalLink,
  AlertCircle,
  Loader2,
  ShieldCheck,
} from 'lucide-react';

export interface UploadedBookingDocument {
  url: string;
  key: string;
  originalName: string;
  mimeType: string;
  size: number;
  domain: 'logistics' | 'school-bus';
  docType: string;
  label: string;
  backend?: 'local' | 's3';
  uploadedAt: string;
}

export interface DocumentUploadSlot {
  docType: string;
  label: string;
  description: string;
  accept: string;
  maxMb: number;
  imagePreview?: boolean;
  required?: boolean;
  highlighted?: boolean;
  highlightNote?: string;
}

interface BookingDocumentDropzoneProps {
  domain: 'logistics' | 'school-bus';
  title: string;
  subtitle: string;
  slots: DocumentUploadSlot[];
  documents: UploadedBookingDocument[];
  onChange: (docs: UploadedBookingDocument[]) => void;
  uploadEndpoint?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function BookingDocumentDropzone({
  domain,
  title,
  subtitle,
  slots,
  documents,
  onChange,
  uploadEndpoint = '/api/booking-portal/uploads',
}: BookingDocumentDropzoneProps) {
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const [dragSlot, setDragSlot] = useState<string | null>(null);
  const [slotErrors, setSlotErrors] = useState<Record<string, string>>({});
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const uploadFile = async (slot: DocumentUploadSlot, file: File) => {
    setSlotErrors((prev) => {
      const next = { ...prev };
      delete next[slot.docType];
      return next;
    });

    if (file.size === 0) {
      setSlotErrors((prev) => ({ ...prev, [slot.docType]: 'Selected file is empty.' }));
      return;
    }
    if (file.size > slot.maxMb * 1024 * 1024) {
      setSlotErrors((prev) => ({
        ...prev,
        [slot.docType]: `File exceeds the ${slot.maxMb} MB limit for ${slot.label}.`,
      }));
      return;
    }

    setUploadingSlot(slot.docType);
    try {
      const body = new FormData();
      body.append('domain', domain);
      body.append('docType', slot.docType);
      body.append('file', file);

      const res = await fetch(uploadEndpoint, {
        method: 'POST',
        body,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok || !json.file) {
        throw new Error(json.error || 'Upload failed. Please check file type and size.');
      }

      const uploaded = json.file as UploadedBookingDocument;
      // Replace any previous upload for the same single-document slot (e.g. student photo)
      const existingForSlot = documents.find((d) => d.docType === slot.docType);
      if (existingForSlot) {
        void fetch(`${uploadEndpoint}?key=${encodeURIComponent(existingForSlot.key)}`, {
          method: 'DELETE',
        }).catch(() => {});
      }

      const nextDocs = [...documents.filter((d) => d.docType !== slot.docType), uploaded];
      onChange(nextDocs);
    } catch (err) {
      setSlotErrors((prev) => ({
        ...prev,
        [slot.docType]: err instanceof Error ? err.message : 'Upload failed.',
      }));
    } finally {
      setUploadingSlot(null);
      const inputEl = inputRefs.current[slot.docType];
      if (inputEl) inputEl.value = '';
    }
  };

  const handleRemove = async (doc: UploadedBookingDocument) => {
    setRemovingKey(doc.key);
    try {
      await fetch(`${uploadEndpoint}?key=${encodeURIComponent(doc.key)}`, {
        method: 'DELETE',
      }).catch(() => {});
      onChange(documents.filter((d) => d.key !== doc.key));
    } finally {
      setRemovingKey(null);
    }
  };

  const handleDrop = (e: React.DragEvent, slot: DocumentUploadSlot) => {
    e.preventDefault();
    setDragSlot(null);
    const file = e.dataTransfer.files?.[0];
    if (file) void uploadFile(slot, file);
  };

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-cyan-500/30 rounded-2xl overflow-hidden shadow-sm transition-all">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-main)]/50 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center text-cyan-600 dark:text-cyan-400">
            <UploadCloud className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[var(--text-main)] tracking-wide">{title}</h3>
            <p className="text-xs text-[var(--text-muted)]">{subtitle}</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-1 rounded-full">
          <ShieldCheck className="w-3 h-3" />
          CLOUD VAULT · PRIVATE STORAGE
        </span>
      </div>

      {/* Dropzone Grid */}
      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {slots.map((slot) => {
          const uploaded = documents.find((d) => d.docType === slot.docType);
          const isUploading = uploadingSlot === slot.docType;
          const isDragging = dragSlot === slot.docType;
          const slotError = slotErrors[slot.docType];

          return (
            <div
              key={slot.docType}
              className={`rounded-xl border p-4 flex flex-col justify-between gap-3 transition-all ${
                uploaded
                  ? 'bg-emerald-500/5 border-emerald-500/40'
                  : isDragging
                  ? 'bg-blue-500/10 border-blue-500 border-dashed ring-2 ring-blue-500/20'
                  : slot.highlighted || slot.required
                  ? 'bg-amber-500/5 border-amber-500/40 border-dashed'
                  : 'bg-[var(--bg-main)] border-[var(--border-subtle)] border-dashed hover:border-blue-500/40'
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragSlot(slot.docType);
              }}
              onDragLeave={() => setDragSlot((curr) => (curr === slot.docType ? null : curr))}
              onDrop={(e) => handleDrop(e, slot)}
            >
              {/* Slot Top Label */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center flex-shrink-0 text-blue-600 dark:text-cyan-400">
                    {slot.imagePreview ? <ImageIcon className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[var(--text-main)] leading-snug">
                      {slot.label}
                      {slot.required && <span className="text-cyan-500 ml-0.5">*</span>}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-snug">
                      {slot.highlightNote && slot.highlighted ? slot.highlightNote : slot.description}
                    </p>
                  </div>
                </div>
                <span
                  className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${
                    uploaded
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                      : slot.required || slot.highlighted
                      ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30'
                      : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border-subtle)]'
                  }`}
                >
                  {uploaded ? 'UPLOADED' : slot.required ? 'REQUIRED' : slot.highlighted ? 'RECOMMENDED' : 'OPTIONAL'}
                </span>
              </div>

              {/* Uploaded Preview OR Upload Action */}
              {uploaded ? (
                <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {slot.imagePreview && uploaded.mimeType.startsWith('image/') ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={uploaded.url}
                        alt={slot.label}
                        className="w-11 h-11 rounded-lg object-cover border border-[var(--border-subtle)] flex-shrink-0"
                      />
                    ) : (
                      <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[var(--text-main)] truncate" title={uploaded.originalName}>
                        {uploaded.originalName}
                      </p>
                      <p className="text-[10px] font-mono text-[var(--text-muted)]">
                        {formatBytes(uploaded.size)} · {uploaded.backend === 's3' ? 'S3 Cloud' : 'Secure Vault'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <a
                      href={uploaded.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Preview / Download"
                      className="p-1.5 rounded-lg text-blue-600 dark:text-cyan-400 hover:bg-blue-500/10 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => handleRemove(uploaded)}
                      disabled={removingKey === uploaded.key}
                      title="Remove file"
                      className="p-1.5 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                    >
                      {removingKey === uploaded.key ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <input
                    ref={(el) => {
                      inputRefs.current[slot.docType] = el;
                    }}
                    type="file"
                    accept={slot.accept}
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadFile(slot, f);
                    }}
                  />
                  <button
                    type="button"
                    disabled={isUploading}
                    onClick={() => inputRefs.current[slot.docType]?.click()}
                    className="w-full py-2.5 px-3 rounded-xl bg-[var(--bg-surface)] hover:bg-blue-500/10 border border-[var(--border-subtle)] hover:border-blue-500/40 text-xs font-semibold text-[var(--text-main)] flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                        Uploading to Cloud Storage…
                      </>
                    ) : (
                      <>
                        <UploadCloud className="w-3.5 h-3.5 text-blue-600 dark:text-cyan-400" />
                        Drop file here or Browse (Max {slot.maxMb} MB)
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Slot Error */}
              {slotError && (
                <p className="text-[11px] text-red-600 dark:text-red-400 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>{slotError}</span>
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
