'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { FolderOpen, Upload, CheckCircle2, AlertCircle } from 'lucide-react';

interface Document {
  id: string; docType: string; docName: string; fileName: string | null;
  fileUrl: string | null; createdAt: string; status: string | null;
}
interface Contract { id: string; contractNumber: string | null }

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [entityId, setEntityId] = useState('');
  const [docName, setDocName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, cRes] = await Promise.all([
        fetch('/api/leasing-portal/documents'),
        fetch('/api/leasing-portal/contracts'),
      ]);
      setDocuments(dRes.ok ? await dRes.json() : []);
      setContracts(cRes.ok ? await cRes.json() : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file || !entityId || !docName.trim()) {
      setToast({ type: 'err', msg: 'Pick a contract, name the document, and choose a file.' });
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('entityType', 'CONTRACT');
      form.set('entityId', entityId);
      form.set('docType', 'OTHER');
      form.set('docName', docName);
      const res = await fetch('/api/leasing-portal/documents', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) { setToast({ type: 'err', msg: data.error ?? 'Upload failed' }); return; }
      setToast({ type: 'ok', msg: 'Document uploaded.' });
      setDocName('');
      if (fileRef.current) fileRef.current.value = '';
      void load();
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <div className="text-slate-400">Loading…</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Documents</h1>

      {toast && (
        <div className={`rounded-lg px-3 py-2 text-sm flex items-center gap-2 ${toast.type === 'ok' ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'}`}>
          {toast.type === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2"><Upload className="w-4 h-4" /> Upload a document</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select value={entityId} onChange={e => setEntityId(e.target.value)}
            className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
            <option value="">Select contract…</option>
            {contracts.map(c => <option key={c.id} value={c.id}>{c.contractNumber ?? c.id.slice(0, 8)}</option>)}
          </select>
          <input value={docName} onChange={e => setDocName(e.target.value)} placeholder="Document name"
            className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
          <input ref={fileRef} type="file" accept="image/*,application/pdf,text/plain"
            className="text-xs text-slate-300 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-cyan-600 file:text-white file:text-xs" />
        </div>
        <button onClick={upload} disabled={uploading}
          className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm font-medium">
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </div>

      <div className="space-y-2">
        {documents.length === 0 && <div className="text-slate-500">No documents yet.</div>}
        {documents.map(d => (
          <a key={d.id} href={d.fileUrl ?? '#'} target="_blank" rel="noreferrer"
            className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/40 border border-slate-700 hover:bg-slate-700/40">
            <FolderOpen className="w-4 h-4 text-cyan-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{d.docName}</div>
              <div className="text-xs text-slate-400">{d.docType} · {d.createdAt?.slice(0, 10)}</div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
