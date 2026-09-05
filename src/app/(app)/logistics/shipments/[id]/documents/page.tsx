'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FileText, Plus, RefreshCw, Trash2, X } from 'lucide-react';

interface ShipmentDocument {
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

interface ShipmentSummary { shipment_no: string; cargo_owner_name: string | null; status: string }

const DOC_TYPES = [
  ['BILL_OF_LADING', 'Bill of Lading'],
  ['COMMERCIAL_INVOICE', 'Commercial Invoice'],
  ['PACKING_LIST', 'Packing List'],
  ['DELIVERY_ORDER', 'Delivery Order'],
  ['WEIGHBRIDGE', 'Weighbridge Certificate'],
  ['CUSTOMS_DECLARATION', 'Customs Declaration'],
  ['OTHER', 'Other Document'],
] as const;

export default function ShipmentDocumentsPage() {
  const { id } = useParams<{ id: string }>() ?? {};
  const fileRef = useRef<HTMLInputElement>(null);
  const [shipment, setShipment] = useState<ShipmentSummary | null>(null);
  const [docs, setDocs] = useState<ShipmentDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [viewing, setViewing] = useState<(ShipmentDocument & { file_data?: string }) | null>(null);
  const [form, setForm] = useState({ docType: 'BILL_OF_LADING', docName: '', fileUrl: '', uploadedBy: '', notes: '' });
  const [fileData, setFileData] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/logistics/shipments/${id}/documents`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setShipment(body.shipment ?? null);
        setDocs(Array.isArray(body.data) ? body.data : []);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const selectFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setForm(prev => ({ ...prev, docName: prev.docName || file.name }));
    setMimeType(file.type || null);
    setFileSize(file.size);
    const reader = new FileReader();
    reader.onload = e => setFileData(String(e.target?.result ?? ''));
    reader.readAsDataURL(file);
  };

  const upload = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/logistics/shipments/${id}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docType: form.docType,
          docName: form.docName,
          fileUrl: form.fileUrl || null,
          fileData,
          mimeType,
          fileSize,
          uploadedBy: form.uploadedBy || null,
          notes: form.notes || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to attach document');
      setShowUpload(false);
      setForm({ docType: 'BILL_OF_LADING', docName: '', fileUrl: '', uploadedBy: '', notes: '' });
      setFileData(null); setMimeType(null); setFileSize(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to attach document');
    } finally {
      setSaving(false);
    }
  };

  const viewDoc = async (doc: ShipmentDocument) => {
    const res = await fetch(`/api/logistics/shipments/${id}/documents/${doc.id}`, { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (res.ok) setViewing(body);
  };

  const deleteDoc = async (docId: string) => {
    if (!confirm('Delete this shipment document?')) return;
    await fetch(`/api/logistics/shipments/${id}/documents/${docId}`, { method: 'DELETE' });
    await load();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
            <Link href="/logistics/trips" className="hover:text-white">Shipment orders</Link>
            <span>/</span>
            <span className="font-mono text-slate-300">{shipment?.shipment_no ?? id?.slice(0, 8) ?? '—'}</span>
          </div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white"><FileText className="h-6 w-6 text-sky-300" /> Shipment Documents</h1>
          <p className="mt-1 text-xs text-slate-400">{shipment?.cargo_owner_name ?? 'Customer'} - {docs.length} document{docs.length === 1 ? '' : 's'}</p>
        </div>
        <button type="button" onClick={() => setShowUpload(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400"><Plus className="h-4 w-4" /> Attach document</button>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-8 text-slate-400">Loading documents...</div>
      ) : docs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/40 p-12 text-center text-slate-400">No shipment documents attached yet.</div>
      ) : (
        <div className="grid gap-3">
          {docs.map(doc => (
            <article key={doc.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/70 p-4">
              <div>
                <p className="font-medium text-white">{doc.doc_name}</p>
                <p className="mt-1 text-xs text-slate-500">{doc.doc_type} - {doc.mime_type ?? 'link'} - {doc.uploaded_by ?? 'Operations'} - {new Date(doc.uploaded_at).toLocaleString('en-AE')}</p>
                {doc.notes && <p className="mt-1 text-xs text-slate-400">{doc.notes}</p>}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => void viewDoc(doc)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5">View</button>
                <button type="button" onClick={() => void deleteDoc(doc.id)} className="rounded-lg border border-rose-500/25 px-2 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </article>
          ))}
        </div>
      )}

      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-slate-950 p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Attach shipment document</h2>
              <button type="button" onClick={() => setShowUpload(false)} className="rounded-lg p-1 text-slate-400 hover:bg-white/5 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Document type</span><select value={form.docType} onChange={e => setForm(f => ({ ...f, docType: e.target.value }))} className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white">{DOC_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <Input label="Document name" value={form.docName} onChange={v => setForm(f => ({ ...f, docName: v }))} />
              <Input label="Uploaded by" value={form.uploadedBy} onChange={v => setForm(f => ({ ...f, uploadedBy: v }))} />
              <Input label="File URL" value={form.fileUrl} onChange={v => setForm(f => ({ ...f, fileUrl: v }))} />
            </div>
            <button type="button" onClick={() => fileRef.current?.click()} className="mt-3 w-full rounded-xl border border-dashed border-white/10 px-3 py-4 text-sm text-slate-300 hover:bg-white/5">{fileData ? 'Inline file selected' : 'Choose file for inline upload'}</button>
            <input ref={fileRef} type="file" className="hidden" onChange={selectFile} />
            <label className="mt-3 block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Notes</span><textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="min-h-20 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white" /></label>
            {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShowUpload(false)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5">Cancel</button>
              <button type="button" disabled={saving || !form.docName} onClick={() => void upload()} className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50">{saving && <RefreshCw className="h-4 w-4 animate-spin" />} Attach</button>
            </div>
          </div>
        </div>
      )}

      {viewing && <DocumentViewer doc={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">{label}</span><input value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-500/40" /></label>;
}

function DocumentViewer({ doc, onClose }: { doc: ShipmentDocument & { file_data?: string }; onClose: () => void }) {
  const src = doc.file_data ?? doc.file_url ?? '';
  const isImage = doc.mime_type?.startsWith('image/');
  const isPdf = doc.mime_type === 'application/pdf' || src.endsWith('.pdf');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-white/10 bg-slate-950">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <h3 className="truncate text-sm font-bold text-white">{doc.doc_name}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-white/5 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-80 overflow-auto p-4">
          {!src ? <p className="text-center text-slate-500">No file content available.</p> : isPdf ? <iframe src={src} title={doc.doc_name} className="h-[70vh] w-full rounded-xl border border-white/10" /> : isImage ? <img src={src} alt={doc.doc_name} className="mx-auto max-h-[70vh] rounded-xl" /> : <a href={src} target="_blank" rel="noreferrer" className="text-amber-300 underline">Open document</a>}
        </div>
      </div>
    </div>
  );
}
