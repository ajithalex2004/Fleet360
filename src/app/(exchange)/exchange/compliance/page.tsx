/**
 * src/app/(exchange)/exchange/compliance/page.tsx
 *
 * Partner Compliance Vault & Expiry Monitor for Fleet360 Exchange.
 */

'use client';

import React, { useEffect, useState } from 'react';
import { ShieldCheck, Plus, CheckCircle2, AlertTriangle, FileText, X } from 'lucide-react';

const REQUIRED_DOCS = [
  { docType: 'TRADE_LICENSE',        label: 'Trade License' },
  { docType: 'TAX_CERTIFICATE',      label: 'Tax Certificate (TRN)' },
  { docType: 'COMMERCIAL_INSURANCE', label: 'Commercial Insurance' },
];

const EXPIRING_WITHIN_MS = 30 * 24 * 60 * 60 * 1000;

interface ComplianceDoc { docType: string; docNumber?: string | null; expiryDate?: string | null; status?: string | null }

/** The document's stored status, overridden by its expiry date when that has passed or is near. */
function effectiveStatus(doc: ComplianceDoc): string {
  const stored = doc.status || 'PENDING';
  if (stored === 'REJECTED' || stored === 'PENDING' || !doc.expiryDate) return stored;
  const left = new Date(doc.expiryDate).getTime() - Date.now();
  if (left < 0) return 'EXPIRED';
  if (left < EXPIRING_WITHIN_MS) return 'EXPIRING';
  return stored;
}

/** The document of a type that stays valid longest (no expiry counts as longest). */
function latestDoc(docs: ComplianceDoc[], docType: string): ComplianceDoc | undefined {
  const expiry = (d: ComplianceDoc) => (d.expiryDate ? new Date(d.expiryDate).getTime() : Number.POSITIVE_INFINITY);
  return docs.filter((d) => d.docType === docType).sort((a, b) => expiry(b) - expiry(a))[0];
}

function statusStyle(status: string): string {
  if (status === 'VALID') return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
  if (status === 'EXPIRING' || status === 'PENDING') return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
  return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
}

export default function ExchangeCompliancePage() {
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadDocs = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/exchange/partner/compliance');
      const res = await r.json().catch(() => ({}));
      if (!r.ok) {
        setLoadError(res.error ?? 'Could not load your compliance documents.');
        return;
      }
      setLoadError(null);
      setDocs(res.documents || []);
    } catch {
      setLoadError('Could not load your compliance documents.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDocs();
  }, []);

  const showToast = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 4000);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-white">Compliance Document Vault</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Keep your regulatory licenses, certificates, and commercial insurance up-to-date to maintain active quoting status.
          </p>
        </div>
        <button
          onClick={() => setShowUploadModal(true)}
          className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-lg shadow-cyan-600/30 flex items-center gap-1.5 transition active:scale-95"
        >
          <Plus className="w-4 h-4" />
          <span>Upload Document</span>
        </button>
      </div>

      {feedback && (
        <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{feedback}</span>
        </div>
      )}

      {loadError && (
        <div className="rounded-2xl border border-amber-700 bg-amber-950/40 px-4 py-3 text-xs text-amber-300">{loadError}</div>
      )}

      {/* Mandatory Requirements Status Cards — derived from the uploaded documents */}
      {!loadError && (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        {REQUIRED_DOCS.map((req) => {
          const doc = latestDoc(docs, req.docType);
          const status = doc ? effectiveStatus(doc) : 'MISSING';
          return (
            <div key={req.docType} className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white">{req.label}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${statusStyle(status)}`}>
                  {loading ? '…' : status}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                {loading
                  ? 'Checking your documents…'
                  : doc
                    ? `${doc.docNumber ? `No. ${doc.docNumber}` : 'Uploaded'}${doc.expiryDate ? ` · expires ${new Date(doc.expiryDate).toLocaleDateString()}` : ''}`
                    : 'Not uploaded yet.'}
              </p>
            </div>
          );
        })}
      </div>
      )}

      {/* Documents List */}
      <div className="rounded-3xl bg-slate-900/60 border border-slate-800 overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
            <tr>
              <th className="p-4">Document Type</th>
              <th className="p-4">Document Number</th>
              <th className="p-4">Expiry Date</th>
              <th className="p-4">Verification</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {docs.length > 0 ? (
              docs.map((d) => (
                <tr key={d.id} className="hover:bg-slate-800/30 transition">
                  <td className="p-4 font-bold text-white flex items-center gap-2">
                    <FileText className="w-4 h-4 text-cyan-400" />
                    <span>{d.docType}</span>
                  </td>
                  <td className="p-4 text-slate-300 font-mono">{d.docNumber || '—'}</td>
                  <td className="p-4 text-slate-400">
                    {d.expiryDate ? new Date(d.expiryDate).toLocaleDateString() : 'No expiry'}
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${statusStyle(effectiveStatus(d))}`}>
                      {effectiveStatus(d)}
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="p-8 text-center text-slate-500">
                  No documents uploaded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <UploadDocModal
          onClose={() => setShowUploadModal(false)}
          onUploaded={() => {
            setShowUploadModal(false);
            showToast('✓ Compliance document uploaded successfully!');
            void loadDocs();
          }}
        />
      )}
    </div>
  );
}

function UploadDocModal({
  onClose,
  onUploaded,
}: {
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [docType, setDocType] = useState('TRADE_LICENSE');
  const [docNumber, setDocNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/exchange/partner/compliance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnerId: 'dummy-partner-id',
          docType,
          docNumber,
          fileUrl: 'https://storage.fleet360.ae/compliance/doc-upload-sample.pdf',
          expiryDate: expiryDate || undefined,
        }),
      });

      if (!res.ok) throw new Error('Failed to upload document');
      onUploaded();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error uploading document');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl text-xs">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-sm font-bold text-white">Upload Compliance Document</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Document Type *</label>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="TRADE_LICENSE">UAE Commercial Trade License</option>
              <option value="TAX_CERTIFICATE">VAT / Tax Registration Certificate</option>
              <option value="COMMERCIAL_INSURANCE">Commercial Passenger Fleet Insurance</option>
              <option value="RTA_OPERATOR_PERMIT">RTA Transport Operator Permit</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Document / Certificate Number</label>
            <input
              type="text"
              value={docNumber}
              onChange={(e) => setDocNumber(e.target.value)}
              placeholder="e.g. TL-8849201"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Expiry Date</label>
            <input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold shadow-lg shadow-cyan-600/30 transition disabled:opacity-50"
            >
              {submitting ? 'Uploading...' : 'Save & Upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
