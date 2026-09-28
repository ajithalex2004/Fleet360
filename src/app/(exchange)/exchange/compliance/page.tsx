/**
 * src/app/(exchange)/exchange/compliance/page.tsx
 *
 * Partner Compliance Vault: the mandatory documents for the partner's service
 * areas and emirate (src/lib/exchange/partner-activation.ts), uploads, and,
 * while the partner is Pending Activation, submitting them to the onboarding
 * company for review.
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Plus, CheckCircle2, FileText, X, Send, Lock, ExternalLink } from 'lucide-react';
import { COMPLIANCE_CATALOG, EMIRATE_LABELS, SUBMITTABLE_STATUSES, type Emirate } from '@/lib/exchange/partner-activation';

interface ChecklistItem {
  docType: string;
  label: string;
  hint: string;
  reason: string;
  expires: boolean;
  numbered: boolean;
  status: string;
  document: { id?: string; docNumber?: string | null; expiryDate?: string | null; reviewNote?: string | null } | null;
}

interface Onboarding {
  partner: {
    legalName: string;
    emirate: Emirate | null;
    domains: string[];
    onboardingStatus: string;
    onboardingLabel: string;
    reviewNote: string | null;
  };
  role: string;
  documents: Array<{
    id: string; docType: string; docNumber: string | null; expiryDate: string | null;
    status: string; reviewNote: string | null; hasFile: boolean; createdAt: string;
  }>;
  checklist: { items: ChecklistItem[]; complete: boolean; allApproved: boolean; missing: string[] };
}

const STATUS_LABELS: Record<string, string> = {
  MISSING: 'Not uploaded',
  PENDING: 'Awaiting review',
  VALID: 'Approved',
  EXPIRING: 'Expiring soon',
  EXPIRED: 'Expired',
  REJECTED: 'Rejected',
};

function statusStyle(status: string): string {
  if (status === 'VALID') return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
  if (status === 'EXPIRING' || status === 'PENDING') return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
  if (status === 'MISSING') return 'bg-slate-700/40 text-slate-300 border-slate-600';
  return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
}

const docLabel = (docType: string) => COMPLIANCE_CATALOG[docType]?.label ?? docType;

export default function ExchangeCompliancePage() {
  const [data, setData] = useState<Onboarding | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadFor, setUploadFor] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/exchange/partner/onboarding');
      const res = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(res.error ?? 'Could not load your compliance documents.');
        return;
      }
      setError(null);
      setData(res);
    } catch {
      setError('Could not load your compliance documents.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const showToast = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 5000);
  };

  const submitForReview = async () => {
    setSubmitting(true);
    try {
      const r = await fetch('/api/exchange/partner/onboarding/submit', { method: 'POST' });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(res.error ?? 'Could not submit your documents.');
        return;
      }
      showToast('✓ Submitted. Your onboarding company will review your documents and activate your account.');
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const status = data?.partner.onboardingStatus;
  const activated = status === 'APPROVED';
  const canSubmit = !!status && SUBMITTABLE_STATUSES.includes(status) && data?.role === 'PARTNER_ADMIN';
  const canUpload = data?.role === 'PARTNER_ADMIN' || data?.role === 'PARTNER_OPERATIONS';

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-white">Compliance Document Vault</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {data?.partner.emirate ? `${EMIRATE_LABELS[data.partner.emirate]} · ` : ''}
            Mandatory documents for your service areas. Keep them valid to stay active.
          </p>
        </div>
        {canUpload && (
          <button
            onClick={() => setUploadFor('')}
            className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-lg shadow-cyan-600/30 flex items-center gap-1.5 transition active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>Upload Document</span>
          </button>
        )}
      </div>

      {feedback && (
        <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{feedback}</span>
        </div>
      )}
      {error && (
        <div className="rounded-2xl border border-amber-700 bg-amber-950/40 px-4 py-3 text-xs text-amber-300 flex justify-between gap-2">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Activation status */}
      {data && !activated && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-amber-400" />
              <span className="font-bold text-white">Account status: {data.partner.onboardingLabel}</span>
            </div>
            {canSubmit && (
              <button
                onClick={submitForReview}
                disabled={submitting || !data.checklist.complete}
                title={data.checklist.complete ? undefined : `Upload first: ${data.checklist.missing.join(', ')}`}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send className="w-3.5 h-3.5" />
                {submitting ? 'Submitting…' : 'Submit for review'}
              </button>
            )}
          </div>
          <p className="text-slate-300">
            {status === 'UNDER_REVIEW' || status === 'APPLICATION_SUBMITTED'
              ? 'Your documents are with your onboarding company for review. You will be emailed when your account is activated.'
              : status === 'REJECTED'
                ? 'Your application was not approved.'
                : data.checklist.complete
                  ? canSubmit
                    ? 'All mandatory documents are uploaded. Submit them for review to get activated.'
                    : 'All mandatory documents are uploaded. Your partner administrator can now submit them for review.'
                  : `Upload every mandatory document below, then submit for review. Still needed: ${data.checklist.missing.join(', ')}.`}
          </p>
          {data.partner.reviewNote && (
            <p className="text-rose-300">Reviewer&rsquo;s note: {data.partner.reviewNote}</p>
          )}
          {data.partner.domains.length === 0 && (
            <p className="text-slate-400">
              Your service areas are not set yet; your onboarding company sets them. Permits for your services will be added here.
            </p>
          )}
        </div>
      )}

      {/* Mandatory documents */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 text-xs">
          {data.checklist.items.map((req) => (
            <div key={req.docType} className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-1.5 flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <span className="font-bold text-white">{req.label}</span>
                <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-bold border ${statusStyle(req.status)}`}>
                  {STATUS_LABELS[req.status] ?? req.status}
                </span>
              </div>
              <p className="text-[11px] text-slate-500">{req.hint}</p>
              <p className="text-[10px] text-slate-500">Required for: {req.reason}</p>
              {req.document && (
                <p className="text-[11px] text-slate-400">
                  {req.document.docNumber ? `No. ${req.document.docNumber}` : 'Uploaded'}
                  {req.document.expiryDate ? ` · expires ${new Date(req.document.expiryDate).toLocaleDateString()}` : ''}
                </p>
              )}
              {req.status === 'REJECTED' && req.document?.reviewNote && (
                <p className="text-[11px] text-rose-300">Rejected: {req.document.reviewNote}</p>
              )}
              {canUpload && req.status !== 'VALID' && req.status !== 'PENDING' && (
                <div className="pt-1 mt-auto">
                  <button
                    onClick={() => setUploadFor(req.docType)}
                    className="text-[11px] font-bold text-cyan-400 hover:text-cyan-300"
                  >
                    {req.status === 'MISSING' ? 'Upload' : 'Upload a new one'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Documents list */}
      <div className="rounded-3xl bg-slate-900/60 border border-slate-800 overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
            <tr>
              <th className="p-4">Document Type</th>
              <th className="p-4">Document Number</th>
              <th className="p-4">Expiry Date</th>
              <th className="p-4">Review</th>
              <th className="p-4">File</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {loading && !data ? (
              <tr><td colSpan={5} className="p-8 text-center text-slate-500">Loading…</td></tr>
            ) : data && data.documents.length > 0 ? (
              data.documents.map((d) => (
                <tr key={d.id} className="hover:bg-slate-800/30 transition">
                  <td className="p-4 font-bold text-white">
                    <span className="flex items-center gap-2"><FileText className="w-4 h-4 text-cyan-400" />{docLabel(d.docType)}</span>
                  </td>
                  <td className="p-4 text-slate-300 font-mono">{d.docNumber || '—'}</td>
                  <td className="p-4 text-slate-400">{d.expiryDate ? new Date(d.expiryDate).toLocaleDateString() : 'No expiry'}</td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${statusStyle(d.status)}`}>
                      {STATUS_LABELS[d.status] ?? d.status}
                    </span>
                    {d.status === 'REJECTED' && d.reviewNote && <div className="mt-1 text-[10px] text-rose-300">{d.reviewNote}</div>}
                  </td>
                  <td className="p-4">
                    {d.hasFile ? (
                      <a
                        href={`/api/exchange/partner/compliance/${d.id}/file`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:underline inline-flex items-center gap-1"
                      >
                        View <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : '—'}
                  </td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={5} className="p-8 text-center text-slate-500">No documents uploaded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {uploadFor !== null && data && (
        <UploadDocModal
          initialDocType={uploadFor || data.checklist.items.find((i) => i.status === 'MISSING')?.docType || 'TRADE_LICENSE'}
          required={data.checklist.items.map((i) => i.docType)}
          onClose={() => setUploadFor(null)}
          onUploaded={() => {
            setUploadFor(null);
            showToast('✓ Document uploaded. It shows as Awaiting review until your onboarding company checks it.');
            void load();
          }}
        />
      )}
    </div>
  );
}

function UploadDocModal({
  initialDocType,
  required,
  onClose,
  onUploaded,
}: {
  initialDocType: string;
  required: string[];
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [docType, setDocType] = useState(initialDocType);
  const [docNumber, setDocNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const type = COMPLIANCE_CATALOG[docType];
  // The partner's mandatory documents first, then the rest of the catalogue.
  const options = [...required, ...Object.keys(COMPLIANCE_CATALOG).filter((t) => !required.includes(t))];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Choose the document file.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('docType', docType);
      if (docNumber.trim()) form.set('docNumber', docNumber.trim());
      if (expiryDate) form.set('expiryDate', expiryDate);
      const res = await fetch('/api/exchange/partner/compliance', { method: 'POST', body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Could not upload the document.');
        return;
      }
      onUploaded();
    } catch {
      setError('Could not upload the document.');
    } finally {
      setSubmitting(false);
    }
  };

  const input = 'w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl text-xs">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-sm font-bold text-white">Upload Compliance Document</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Document Type *</label>
            <select value={docType} onChange={(e) => setDocType(e.target.value)} className={input}>
              {options.map((t) => (
                <option key={t} value={t}>{docLabel(t)}{required.includes(t) ? '' : ' (optional)'}</option>
              ))}
            </select>
            {type && <p className="mt-1 text-[11px] text-slate-500">{type.hint}</p>}
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Document / Certificate Number{type?.numbered ? ' *' : ''}</label>
            <input
              type="text"
              value={docNumber}
              onChange={(e) => setDocNumber(e.target.value)}
              required={type?.numbered}
              placeholder="e.g. TL-8849201"
              className={input}
            />
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Expiry Date{type?.expires ? ' *' : ''}</label>
            <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} required={type?.expires} className={input} />
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">File * (PDF or image, up to 10 MB)</label>
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-white"
            />
          </div>

          {error && <p className="text-rose-300">{error}</p>}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white">Cancel</button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold shadow-lg shadow-cyan-600/30 transition disabled:opacity-50"
            >
              {submitting ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
