'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TripDoc {
  id: string;
  doc_type: string;
  doc_name: string;
  file_url: string | null;
  mime_type: string | null;
  file_size: number | null;
  uploaded_by: string | null;
  notes: string | null;
  uploaded_at: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DOC_TYPES = [
  { value: 'BILL_OF_LADING',       label: 'Bill of Lading',           icon: '📄' },
  { value: 'COMMERCIAL_INVOICE',   label: 'Commercial Invoice',       icon: '🧾' },
  { value: 'PACKING_LIST',         label: 'Packing List',             icon: '📦' },
  { value: 'CUSTOMS_DECLARATION',  label: 'Customs Declaration',      icon: '🛃' },
  { value: 'CERTIFICATE_ORIGIN',   label: 'Certificate of Origin',    icon: '🌍' },
  { value: 'CERTIFICATE_ANALYSIS', label: 'Certificate of Analysis',  icon: '🔬' },
  { value: 'DELIVERY_ORDER',       label: 'Delivery Order',           icon: '🚚' },
  { value: 'WEIGHBRIDGE',          label: 'Weighbridge Certificate',  icon: '⚖️' },
  { value: 'HAZMAT_DECLARATION',   label: 'Hazmat Declaration',       icon: '⚠️' },
  { value: 'MSDS',                 label: 'MSDS / Safety Data Sheet', icon: '🧪' },
  { value: 'INSURANCE_CERT',       label: 'Cargo Insurance Cert.',    icon: '🛡️' },
  { value: 'OTHER',                label: 'Other Document',           icon: '📎' },
];

const DOC_TYPE_MAP = Object.fromEntries(DOC_TYPES.map(d => [d.value, d]));

const MIME_ICONS: Record<string, string> = {
  'application/pdf':  '📕',
  'image/jpeg':       '🖼️',
  'image/png':        '🖼️',
  'image/webp':       '🖼️',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '📊',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📝',
  'text/plain':       '📃',
};

function mimeIcon(mime: string | null) {
  return MIME_ICONS[mime ?? ''] ?? '📎';
}

function formatSize(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Upload Modal ──────────────────────────────────────────────────────────────

function UploadModal({
  bookingId,
  onClose,
  onUploaded,
}: {
  bookingId: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [docType,    setDocType]    = useState('BILL_OF_LADING');
  const [docName,    setDocName]    = useState('');
  const [fileUrl,    setFileUrl]    = useState('');
  const [fileData,   setFileData]   = useState<string | null>(null);
  const [fileName,   setFileName]   = useState('');
  const [fileSize,   setFileSize]   = useState<number | null>(null);
  const [mimeType,   setMimeType]   = useState('');
  const [uploadedBy, setUploadedBy] = useState('');
  const [notes,      setNotes]      = useState('');
  const [mode,       setMode]       = useState<'file' | 'url'>('file');
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setMimeType(file.type);
    setFileSize(file.size);
    if (!docName) setDocName(file.name.replace(/\.[^.]+$/, ''));
    const reader = new FileReader();
    reader.onload = ev => setFileData(ev.target?.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSubmit = async () => {
    if (!docName.trim()) { setError('Document name is required'); return; }
    if (mode === 'file' && !fileData) { setError('Please select a file to upload'); return; }
    if (mode === 'url' && !fileUrl.trim()) { setError('Please enter a file URL'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/logistics/trips/${bookingId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docType,
          docName: docName.trim(),
          fileUrl:    mode === 'url' ? fileUrl.trim() : undefined,
          fileData:   mode === 'file' ? fileData       : undefined,
          mimeType:   mimeType || undefined,
          fileSize:   fileSize ?? undefined,
          uploadedBy: uploadedBy.trim() || 'Operations',
          notes:      notes.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      onUploaded();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setSaving(false);
    }
  };

  const docInfo = DOC_TYPE_MAP[docType];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-white/20 rounded-2xl p-6 w-full max-w-lg shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">📎 Attach Document</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none">✕</button>
        </div>

        {/* Doc type */}
        <div>
          <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Document Type</label>
          <select value={docType} onChange={e => setDocType(e.target.value)}
            className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40">
            {DOC_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
            ))}
          </select>
        </div>

        {/* Name */}
        <div>
          <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">
            Document Name <span className="text-red-400">*</span>
          </label>
          <input value={docName} onChange={e => setDocName(e.target.value)}
            placeholder={`e.g. ${docInfo?.label ?? 'Document'} - June 2025`}
            className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40" />
        </div>

        {/* Upload mode toggle */}
        <div className="flex bg-slate-800 border border-white/10 rounded-xl overflow-hidden">
          {(['file', 'url'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                mode === m ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:text-white'
              }`}>
              {m === 'file' ? '📁 Upload File' : '🔗 Paste URL'}
            </button>
          ))}
        </div>

        {mode === 'file' ? (
          <div>
            <button onClick={() => fileRef.current?.click()}
              className={`w-full border-2 border-dashed rounded-xl py-6 text-sm transition-colors flex flex-col items-center gap-2 ${
                fileData ? 'border-emerald-500/40 text-emerald-400' : 'border-white/10 text-slate-400 hover:border-white/20 hover:text-white'
              }`}>
              {fileData ? (
                <><span className="text-2xl">{mimeIcon(mimeType)}</span>
                  <span className="font-medium">{fileName}</span>
                  <span className="text-xs opacity-60">{formatSize(fileSize)}</span></>
              ) : (
                <><span className="text-3xl">📁</span>
                  <span>Click to select file</span>
                  <span className="text-xs opacity-60">PDF, image, Word, Excel — max 5 MB</span></>
              )}
            </button>
            <input ref={fileRef} type="file" className="hidden"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt"
              onChange={handleFile} />
          </div>
        ) : (
          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">File URL</label>
            <input value={fileUrl} onChange={e => setFileUrl(e.target.value)}
              placeholder="https://storage.example.com/documents/bol-12345.pdf"
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Uploaded By</label>
            <input value={uploadedBy} onChange={e => setUploadedBy(e.target.value)}
              placeholder="Your name"
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40" />
          </div>
          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Optional note"
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40" />
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5 text-red-400 text-xs">⚠️ {error}</div>
        )}

        <div className="flex gap-3 pt-1">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-300 text-sm hover:bg-slate-800 transition-colors">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-semibold text-sm transition-colors disabled:opacity-40">
            {saving ? 'Saving…' : '📎 Attach Document'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Document Card ─────────────────────────────────────────────────────────────

function DocCard({ doc, onDelete, onView }: {
  doc: TripDoc;
  onDelete: (id: string) => void;
  onView: (id: string) => void;
}) {
  const typeInfo = DOC_TYPE_MAP[doc.doc_type] ?? { icon: '📎', label: doc.doc_type };
  return (
    <div className="bg-slate-900/60 border border-white/10 rounded-xl p-4 hover:border-white/20 transition-all group">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-slate-800 border border-white/10 flex items-center justify-center text-xl flex-shrink-0">
          {typeInfo.icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium truncate">{doc.doc_name}</p>
          <p className="text-slate-400 text-xs mt-0.5">{typeInfo.label}</p>
          <div className="flex items-center gap-3 mt-1 text-xs text-slate-600">
            {doc.mime_type && <span>{mimeIcon(doc.mime_type)} {doc.mime_type.split('/').pop()?.toUpperCase()}</span>}
            {doc.file_size && <span>{formatSize(doc.file_size)}</span>}
            {doc.uploaded_by && <span>by {doc.uploaded_by}</span>}
          </div>
          <p className="text-slate-700 text-xs mt-0.5">
            {new Date(doc.uploaded_at).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
          {doc.notes && <p className="text-slate-500 text-xs mt-1 italic">{doc.notes}</p>}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {(doc.file_url || true) && (
            <button onClick={() => onView(doc.id)}
              className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded-lg hover:bg-blue-500/10 transition-colors">
              View
            </button>
          )}
          <button onClick={() => onDelete(doc.id)}
            className="text-xs text-red-500 hover:text-red-400 px-2 py-1 rounded-lg hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Document Viewer Modal ─────────────────────────────────────────────────────

function DocViewer({ bookingId, docId, onClose }: { bookingId: string; docId: string; onClose: () => void }) {
  const [doc, setDoc] = useState<(TripDoc & { file_data?: string }) | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/logistics/trips/${bookingId}/documents/${docId}`)
      .then(r => r.ok ? r.json() : null)
      .then(setDoc)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [bookingId, docId]);

  const src = doc?.file_data ?? doc?.file_url;
  const isPdf   = doc?.mime_type === 'application/pdf' || src?.includes('.pdf');
  const isImage = doc?.mime_type?.startsWith('image/') || /\.(png|jpg|jpeg|webp|gif)$/i.test(src ?? '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-white/20 rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h3 className="text-sm font-bold text-white truncate">{doc?.doc_name ?? 'Document'}</h3>
          <div className="flex items-center gap-3">
            {src && (
              <a href={src} download={doc?.doc_name ?? 'document'}
                className="text-xs text-amber-400 hover:text-amber-300 transition-colors">
                ⬇ Download
              </a>
            )}
            <button onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none">✕</button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-48 text-slate-400 animate-pulse">Loading…</div>
          ) : !src ? (
            <div className="flex items-center justify-center h-48 text-slate-500">
              <div className="text-center">
                <div className="text-4xl mb-3">📄</div>
                <p>No file content available</p>
                {doc?.notes && <p className="text-sm mt-2">{doc.notes}</p>}
              </div>
            </div>
          ) : isPdf ? (
            <iframe src={src} className="w-full h-[70vh] rounded-xl border border-white/10" title={doc?.doc_name} />
          ) : isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={doc?.doc_name ?? 'Document'} className="max-w-full max-h-[70vh] mx-auto rounded-xl border border-white/10 object-contain" />
          ) : (
            <div className="flex items-center justify-center h-48 text-slate-400">
              <div className="text-center">
                <div className="text-4xl mb-3">{mimeIcon(doc?.mime_type ?? null)}</div>
                <p className="text-sm">Preview not available for this file type</p>
                <a href={src} download={doc?.doc_name} target="_blank" rel="noopener noreferrer"
                  className="mt-3 inline-block text-xs text-amber-400 hover:text-amber-300 underline">
                  Download file
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TripDocumentsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [docs,         setDocs]         = useState<TripDoc[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [showUpload,   setShowUpload]   = useState(false);
  const [viewingDoc,   setViewingDoc]   = useState<string | null>(null);
  const [filterType,   setFilterType]   = useState('ALL');
  const [bookingRef,   setBookingRef]   = useState('');
  const [deleting,     setDeleting]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [docsRes, bookingRes] = await Promise.all([
        fetch(`/api/logistics/trips/${id}/documents`).then(r => r.ok ? r.json() : []),
        fetch(`/api/bookings/${id}`).then(r => r.ok ? r.json() : null),
      ]);
      setDocs(Array.isArray(docsRes) ? docsRes : []);
      if (bookingRes?.bookingRef) setBookingRef(bookingRes.bookingRef);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (docId: string) => {
    if (!confirm('Delete this document?')) return;
    setDeleting(docId);
    try {
      await fetch(`/api/logistics/trips/${id}/documents/${docId}`, { method: 'DELETE' });
      await load();
    } catch { /* silent */ }
    finally { setDeleting(null); }
  };

  // Group by type
  const types = ['ALL', ...Array.from(new Set(docs.map(d => d.doc_type)))];
  const filtered = filterType === 'ALL' ? docs : docs.filter(d => d.doc_type === filterType);

  // Group filtered docs by type for display
  const grouped = DOC_TYPES.filter(t => filtered.some(d => d.doc_type === t.value));

  return (
    <>
      {showUpload && (
        <UploadModal bookingId={id} onClose={() => setShowUpload(false)} onUploaded={load} />
      )}
      {viewingDoc && (
        <DocViewer bookingId={id} docId={viewingDoc} onClose={() => setViewingDoc(null)} />
      )}

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <button onClick={() => router.back()} className="hover:text-white transition-colors">← Back</button>
              <span>/</span>
              <Link href="/logistics/trips" className="hover:text-white transition-colors">Trips</Link>
              <span>/</span>
              <span className="font-mono text-white">{bookingRef || id.slice(0, 8)}</span>
            </div>
            <h1 className="text-2xl font-bold text-white">📎 Trip Documents</h1>
            <p className="text-slate-400 text-sm mt-0.5">Shipping documents, certificates &amp; compliance files</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 bg-slate-800 border border-white/10 px-3 py-1.5 rounded-lg">
              {docs.length} document{docs.length !== 1 ? 's' : ''}
            </span>
            <button onClick={() => setShowUpload(true)}
              className="bg-amber-500 hover:bg-amber-400 text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors">
              + Attach Document
            </button>
          </div>
        </div>

        {/* Type filter */}
        {types.length > 1 && (
          <div className="flex gap-2 flex-wrap">
            {types.map(t => {
              const info = t === 'ALL' ? null : DOC_TYPE_MAP[t];
              return (
                <button key={t} onClick={() => setFilterType(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    filterType === t
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                      : 'text-slate-400 border-white/10 hover:border-white/20 hover:text-white'
                  }`}>
                  {info ? `${info.icon} ${info.label}` : 'All Types'}
                  <span className="ml-1 opacity-60">
                    ({t === 'ALL' ? docs.length : docs.filter(d => d.doc_type === t).length})
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Document list */}
        {loading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-slate-800/60 rounded-xl animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-16 text-center">
            <div className="text-5xl mb-3">📂</div>
            <p className="text-slate-400">No documents attached yet</p>
            <p className="text-slate-600 text-xs mt-1">Click &quot;Attach Document&quot; to add shipping docs, BOL, invoices, etc.</p>
            <button onClick={() => setShowUpload(true)}
              className="mt-4 bg-amber-500/20 text-amber-300 border border-amber-500/30 px-4 py-2 rounded-xl text-sm hover:bg-amber-500/30 transition-colors">
              + Attach Document
            </button>
          </div>
        ) : filterType === 'ALL' ? (
          /* Grouped view */
          <div className="space-y-6">
            {grouped.map(typeInfo => {
              const typeDocs = filtered.filter(d => d.doc_type === typeInfo.value);
              if (!typeDocs.length) return null;
              return (
                <div key={typeInfo.value}>
                  <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                    {typeInfo.icon} {typeInfo.label}
                    <span className="bg-slate-800 border border-white/10 rounded-full px-1.5 py-0.5 text-xs font-normal normal-case tracking-normal">
                      {typeDocs.length}
                    </span>
                  </h2>
                  <div className="space-y-3">
                    {typeDocs.map(doc => (
                      <DocCard key={doc.id} doc={doc}
                        onDelete={docId => handleDelete(docId)}
                        onView={docId => setViewingDoc(docId)} />
                    ))}
                  </div>
                </div>
              );
            })}
            {/* Ungrouped types not in DOC_TYPES */}
            {filtered.filter(d => !grouped.some(g => g.value === d.doc_type)).map(doc => (
              <DocCard key={doc.id} doc={doc}
                onDelete={docId => handleDelete(docId)}
                onView={docId => setViewingDoc(docId)} />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(doc => (
              <DocCard key={doc.id} doc={doc}
                onDelete={docId => handleDelete(docId)}
                onView={docId => setViewingDoc(docId)} />
            ))}
          </div>
        )}

        {/* Required doc checklist */}
        <div className="bg-slate-900/40 border border-white/5 rounded-2xl p-5">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Document Checklist</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {DOC_TYPES.slice(0, 6).map(t => {
              const present = docs.some(d => d.doc_type === t.value);
              return (
                <div key={t.value}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${
                    present
                      ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400'
                      : 'border-white/5 text-slate-600'
                  }`}>
                  <span>{present ? '✅' : '⬜'}</span>
                  <span>{t.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
