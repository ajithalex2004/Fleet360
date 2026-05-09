'use client';

/**
 * Portal — Documents (read-only with download).
 * Shows the lessee's documents (entityType=LESSEE, entityId=lesseeId)
 * with expiry status badges and a download link per file.
 */

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';

interface Doc {
  id: string;
  docType: string;
  docName: string;
  fileName: string | null;
  fileUrl: string | null;
  fileSize: number | null;
  mimeType: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  status: string | null;
  uploadedBy: string | null;
}

function expiryStatus(expiry: string | null): {
  bucket: 'expired' | 'urgent' | 'soon' | 'ok' | 'none';
  label: string;
  classes: string;
} {
  if (!expiry) return { bucket: 'none', label: 'No expiry', classes: 'bg-slate-500/20 text-slate-300 border-slate-500/30' };
  const days = Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400000);
  if (days < 0) return { bucket: 'expired', label: `Expired ${Math.abs(days)}d ago`, classes: 'bg-rose-500/20 text-rose-300 border-rose-500/30' };
  if (days <= 14) return { bucket: 'urgent', label: `Expires in ${days}d`, classes: 'bg-rose-500/20 text-rose-300 border-rose-500/30' };
  if (days <= 30) return { bucket: 'soon', label: `Expires in ${days}d`, classes: 'bg-amber-500/20 text-amber-300 border-amber-500/30' };
  return { bucket: 'ok', label: `Expires ${new Date(expiry).toLocaleDateString('en-GB')}`, classes: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' };
}

export default function PortalDocumentsPage() {
  const params = useParams();
  const search = useSearchParams();
  const tenantSlug = (params?.tenantSlug as string) ?? '';
  const lesseeId = search.get('lesseeId') ?? '';

  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!lesseeId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/leasing/documents?entityType=LESSEE&entityId=${lesseeId}`,
      );
      const data = res.ok ? await res.json() : [];
      setDocs(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [lesseeId]);

  useEffect(() => { load(); }, [load]);

  if (!lesseeId) {
    return (
      <div className="p-6">
        <p className="text-slate-400 text-sm">Pick a lessee first.</p>
        <Link href={`/portal/${tenantSlug}/leasing`} className="text-cyan-400 underline text-sm">
          ← Back to lessee picker
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link
          href={`/portal/${tenantSlug}/leasing?lesseeId=${lesseeId}`}
          className="text-xs text-slate-500 hover:text-cyan-400"
        >
          ← Back to dashboard
        </Link>
        <h1 className="text-2xl font-bold mt-1">My Documents</h1>
        <p className="text-sm text-slate-400 mt-1">
          {docs.length} document{docs.length === 1 ? '' : 's'} on file
        </p>
      </div>

      {loading ? (
        <div className="text-slate-500">Loading…</div>
      ) : docs.length === 0 ? (
        <div className="p-8 rounded-xl bg-slate-800/40 border border-slate-700 text-center text-slate-400">
          No documents on file. Contact your account manager to upload KYC documents.
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map(d => {
            const exp = expiryStatus(d.expiryDate);
            const sizeKb = d.fileSize ? `${(d.fileSize / 1024).toFixed(0)} KB` : '';
            return (
              <div
                key={d.id}
                className="p-4 rounded-xl bg-slate-800/40 border border-slate-700 flex items-center justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-white">{d.docName}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-300">
                      {d.docType}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full border ${exp.classes}`}
                    >
                      {exp.label}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1 truncate">
                    {d.fileName ?? '—'} {sizeKb && `· ${sizeKb}`} {d.mimeType && `· ${d.mimeType}`}
                  </div>
                </div>
                {d.fileUrl ? (
                  <a
                    href={d.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium"
                  >
                    View / Download
                  </a>
                ) : (
                  <span className="text-xs text-slate-500">No file</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-slate-500">
        Read-only view. Upload requests should go through your account manager.
      </p>
    </div>
  );
}
