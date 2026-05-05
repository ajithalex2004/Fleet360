'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface Doc {
  id: string;
  docRef: string;
  customerId: string | null;
  customerName: string;
  docType: string;
  docNumber: string | null;
  issuingAuthority: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  nationality: string | null;
  status: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
  fileUrl: string | null;
  notes: string | null;
  createdAt: string;
  daysToExpiry: number | null;
}

interface Stats {
  total: number;
  verified: number;
  pending: number;
  rejected: number;
  expiredOrExpiring: number;
}

const DOC_TYPE_TABS = [
  { key: 'ALL',              label: 'All' },
  { key: 'EMIRATES_ID',      label: 'Emirates ID' },
  { key: 'PASSPORT',         label: 'Passport' },
  { key: 'DRIVING_LICENSE',  label: 'Driving License' },
  { key: 'VISIT_VISA',       label: 'Visit Visa' },
  { key: 'RENTAL_CONTRACT',  label: 'Contract' },
];

const STATUS_TABS = [
  { key: 'ALL',                  label: 'All Statuses' },
  { key: 'PENDING_VERIFICATION', label: 'Pending' },
  { key: 'VERIFIED',             label: 'Verified' },
  { key: 'REJECTED',             label: 'Rejected' },
  { key: 'EXPIRED',              label: 'Expired' },
];

const DOC_TYPES_ALL = [
  'EMIRATES_ID', 'PASSPORT', 'DRIVING_LICENSE', 'VISIT_VISA',
  'INSURANCE_CERT', 'RENTAL_CONTRACT', 'OTHER',
];

const DOC_ICONS: Record<string, string> = {
  EMIRATES_ID:     '🪪',
  PASSPORT:        '📘',
  DRIVING_LICENSE: '🚗',
  VISIT_VISA:      '📄',
  INSURANCE_CERT:  '🛡️',
  RENTAL_CONTRACT: '📋',
  OTHER:           '📁',
};

const DOC_LABELS: Record<string, string> = {
  EMIRATES_ID:     'Emirates ID',
  PASSPORT:        'Passport',
  DRIVING_LICENSE: 'Driving License',
  VISIT_VISA:      'Visit Visa',
  INSURANCE_CERT:  'Insurance Cert',
  RENTAL_CONTRACT: 'Rental Contract',
  OTHER:           'Other',
};

const STATUS_COLORS: Record<string, string> = {
  PENDING_VERIFICATION: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  VERIFIED:             'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  REJECTED:             'bg-rose-500/20 text-rose-400 border-rose-500/30',
  EXPIRED:              'bg-rose-500/20 text-rose-400 border-rose-500/30',
};

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function expiryBadge(days: number | null): React.ReactNode {
  if (days == null) return <span className="text-slate-500 text-xs">N/A</span>;
  if (days < 0)
    return <span className="text-rose-400 font-semibold text-xs">Expired {Math.abs(days)}d ago</span>;
  if (days <= 30)
    return <span className="text-amber-400 font-semibold text-xs">{days}d ⚠</span>;
  return <span className="text-slate-300 text-xs">{days}d</span>;
}

const emptyForm = {
  customerName: '', docType: 'EMIRATES_ID', docNumber: '',
  issuingAuthority: '', issueDate: '', expiryDate: '',
  nationality: '', notes: '',
};

export default function DocumentsPage() {
  const [docs, setDocs]             = useState<Doc[]>([]);
  const [stats, setStats]           = useState<Stats | null>(null);
  const [docTypeTab, setDocTypeTab] = useState('ALL');
  const [statusTab, setStatusTab]   = useState('ALL');
  const [search, setSearch]         = useState('');
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [showModal, setShowModal]   = useState(false);
  const [saving, setSaving]         = useState(false);
  const [formData, setFormData]     = useState(emptyForm);

  // Verify / Reject modals
  const [verifyDoc, setVerifyDoc]     = useState<Doc | null>(null);
  const [rejectDoc, setRejectDoc]     = useState<Doc | null>(null);
  const [verifiedBy, setVerifiedBy]   = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [actionSaving, setActionSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (docTypeTab !== 'ALL') params.set('doc_type', docTypeTab);
      if (statusTab !== 'ALL')  params.set('status', statusTab);
      if (search)               params.set('search', search);
      const res  = await fetch(`/api/rental/documents?${params}`);
      const data = await res.json();
      setDocs(data.documents ?? []);
      setStats(data.stats ?? null);
    } catch {
      setError('Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [docTypeTab, statusTab, search]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/rental/documents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName:    formData.customerName,
          docType:         formData.docType,
          docNumber:       formData.docNumber || null,
          issuingAuthority: formData.issuingAuthority || null,
          issueDate:       formData.issueDate || null,
          expiryDate:      formData.expiryDate || null,
          nationality:     formData.nationality || null,
          notes:           formData.notes || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to save');
      }
      setShowModal(false);
      setFormData(emptyForm);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save document');
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    if (!verifyDoc) return;
    setActionSaving(true);
    try {
      await fetch('/api/rental/documents', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: verifyDoc.id, action: 'verify', verifiedBy: verifiedBy || 'Operations' }),
      });
      setVerifyDoc(null);
      setVerifiedBy('');
      load();
    } catch {
      setError('Failed to verify document');
    } finally {
      setActionSaving(false);
    }
  };

  const handleReject = async () => {
    if (!rejectDoc || !rejectReason.trim()) return;
    setActionSaving(true);
    try {
      await fetch('/api/rental/documents', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rejectDoc.id, action: 'reject', rejectionReason: rejectReason }),
      });
      setRejectDoc(null);
      setRejectReason('');
      load();
    } catch {
      setError('Failed to reject document');
    } finally {
      setActionSaving(false);
    }
  };

  const inputCls = 'w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none text-sm';
  const labelCls = 'block text-sm font-medium text-slate-300 mb-1.5';

  const needsExpiryWarning = (d: Doc): boolean => {
    if (!['EMIRATES_ID', 'DRIVING_LICENSE', 'VISIT_VISA', 'PASSPORT'].includes(d.docType)) return false;
    if (d.daysToExpiry == null) return false;
    return d.daysToExpiry <= 30;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Compliance Document Vault</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-lg">🇦🇪</span>
            <p className="text-amber-400 text-sm font-medium">
              UAE RTA Compliance — All customer documents must be verified before vehicle handover
            </p>
          </div>
        </div>
        <button
          onClick={() => { setShowModal(true); setFormData(emptyForm); }}
          className="rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90 transition-opacity flex-shrink-0"
        >
          + Add Document
        </button>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">
          {error}
        </div>
      )}

      {/* KPI Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Documents',      value: stats.total,             color: 'text-white',         icon: '📁' },
            { label: 'Verified',             value: stats.verified,          color: 'text-emerald-400',   icon: '✅' },
            { label: 'Pending Verification', value: stats.pending,           color: 'text-amber-400',     icon: '⏳' },
            { label: 'Expired / Expiring',   value: stats.expiredOrExpiring, color: 'text-rose-400',      icon: '⚠️' },
          ].map(({ label, value, color, icon }) => (
            <div key={label} className="bg-slate-800/60 border border-white/10 rounded-2xl p-5 backdrop-blur-sm">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{icon}</span>
                <p className="text-xs text-slate-400 uppercase tracking-wider">{label}</p>
              </div>
              <p className={`text-3xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-center">
        {/* Doc Type Tabs */}
        <div className="flex gap-1 bg-slate-800/60 border border-white/10 rounded-xl p-1">
          {DOC_TYPE_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setDocTypeTab(t.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                docTypeTab === t.key
                  ? 'bg-gradient-to-r from-teal-600 to-cyan-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {t.key !== 'ALL' && DOC_ICONS[t.key]} {t.label}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <select
          value={statusTab}
          onChange={e => setStatusTab(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-slate-800/60 border border-white/10 text-sm text-white focus:border-teal-500 focus:outline-none"
        >
          {STATUS_TABS.map(t => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>

        {/* Search */}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by customer or document number..."
          className="px-4 py-1.5 rounded-lg bg-slate-800/50 border border-white/10 text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none text-sm w-72"
        />
      </div>

      {/* Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 animate-pulse">Loading documents...</div>
        ) : docs.length === 0 ? (
          <div className="text-center text-slate-400 py-16">No documents found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  {['Ref No', 'Customer', 'Document Type', 'Doc Number', 'Expiry Date', 'Days Left', 'Status', 'Verified By', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {docs.map(d => {
                  const warn = needsExpiryWarning(d);
                  return (
                    <tr
                      key={d.id}
                      className={`border-b border-white/5 hover:bg-white/5 transition-colors ${warn ? 'bg-amber-500/5' : ''}`}
                    >
                      <td className="px-4 py-3 text-sm font-mono text-teal-400 whitespace-nowrap">{d.docRef}</td>
                      <td className="px-4 py-3 text-sm font-medium text-white whitespace-nowrap">
                        {d.customerName}
                        {d.nationality && <div className="text-xs text-slate-400">{d.nationality}</div>}
                      </td>
                      <td className="px-4 py-3 text-sm whitespace-nowrap">
                        <span className="flex items-center gap-1.5 text-white">
                          <span className="text-base">{DOC_ICONS[d.docType] ?? '📁'}</span>
                          <span>{DOC_LABELS[d.docType] ?? d.docType}</span>
                        </span>
                        {warn && (
                          <div className="text-xs text-amber-400 mt-0.5">⚠ Expiry Alert</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-300 whitespace-nowrap font-mono">
                        {d.docNumber ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-300 whitespace-nowrap">
                        {fmtDate(d.expiryDate)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {expiryBadge(d.daysToExpiry)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium border ${STATUS_COLORS[d.status] ?? 'bg-slate-500/20 text-slate-400 border-slate-500/30'}`}>
                          {d.status.replace(/_/g, ' ')}
                        </span>
                        {d.status === 'REJECTED' && d.rejectionReason && (
                          <div className="text-xs text-rose-400/70 mt-0.5 max-w-[120px] truncate" title={d.rejectionReason}>
                            {d.rejectionReason}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-300 whitespace-nowrap">
                        {d.verifiedBy ?? '—'}
                        {d.verifiedAt && (
                          <div className="text-xs text-slate-500">{fmtDate(d.verifiedAt)}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {d.status === 'PENDING_VERIFICATION' && (
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => { setVerifyDoc(d); setVerifiedBy(''); }}
                              className="text-xs px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30"
                            >
                              Verify
                            </button>
                            <button
                              onClick={() => { setRejectDoc(d); setRejectReason(''); }}
                              className="text-xs px-2.5 py-1 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                        {d.status !== 'PENDING_VERIFICATION' && (
                          <span className="text-xs text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Document Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-800/95 border border-white/10 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Add Document</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white text-xl">✕</button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className={labelCls}>Customer Name *</label>
                  <input
                    type="text" required placeholder="Full customer name"
                    value={formData.customerName}
                    onChange={e => setFormData(p => ({ ...p, customerName: e.target.value }))}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Document Type *</label>
                  <select
                    required value={formData.docType}
                    onChange={e => setFormData(p => ({ ...p, docType: e.target.value }))}
                    className={inputCls}
                  >
                    {DOC_TYPES_ALL.map(t => (
                      <option key={t} value={t}>{DOC_ICONS[t]} {DOC_LABELS[t]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Document Number</label>
                  <input
                    type="text" placeholder="e.g. 784-XXXX-XXXXXXX-X"
                    value={formData.docNumber}
                    onChange={e => setFormData(p => ({ ...p, docNumber: e.target.value }))}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Issuing Authority</label>
                  <input
                    type="text" placeholder="e.g. ICA, GDRFA"
                    value={formData.issuingAuthority}
                    onChange={e => setFormData(p => ({ ...p, issuingAuthority: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Nationality</label>
                  <input
                    type="text" placeholder="e.g. UAE, Indian"
                    value={formData.nationality}
                    onChange={e => setFormData(p => ({ ...p, nationality: e.target.value }))}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Issue Date</label>
                  <input
                    type="date"
                    value={formData.issueDate}
                    onChange={e => setFormData(p => ({ ...p, issueDate: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Expiry Date</label>
                  <input
                    type="date"
                    value={formData.expiryDate}
                    onChange={e => setFormData(p => ({ ...p, expiryDate: e.target.value }))}
                    className={inputCls}
                  />
                </div>

                <div className="col-span-2">
                  <label className={labelCls}>Notes</label>
                  <textarea
                    rows={3} placeholder="Additional notes or observations..."
                    value={formData.notes}
                    onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))}
                    className={`${inputCls} resize-none`}
                  />
                </div>
              </div>

              <div className="flex gap-4 justify-end pt-2">
                <button
                  type="button" onClick={() => setShowModal(false)}
                  className="px-6 py-2.5 rounded-lg border border-white/10 text-white hover:bg-white/5 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit" disabled={saving}
                  className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-600 text-white hover:opacity-90 disabled:opacity-50 text-sm font-medium"
                >
                  {saving ? 'Saving...' : 'Add Document'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Verify Modal */}
      {verifyDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-800/95 border border-white/10 rounded-2xl p-8">
            <h2 className="text-xl font-bold text-white mb-2">Verify Document</h2>
            <p className="text-slate-400 text-sm mb-4">
              Verifying <span className="text-teal-400">{verifyDoc.docRef}</span> for {verifyDoc.customerName}
            </p>
            <div className="mb-5">
              <label className={labelCls}>Verified By *</label>
              <input
                type="text" placeholder="Staff name or ID"
                value={verifiedBy}
                onChange={e => setVerifiedBy(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setVerifyDoc(null)}
                className="px-5 py-2 rounded-lg border border-white/10 text-white hover:bg-white/5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleVerify} disabled={actionSaving || !verifiedBy.trim()}
                className="px-5 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:opacity-90 disabled:opacity-50 text-sm font-medium"
              >
                {actionSaving ? 'Verifying...' : 'Mark Verified'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-800/95 border border-white/10 rounded-2xl p-8">
            <h2 className="text-xl font-bold text-white mb-2">Reject Document</h2>
            <p className="text-slate-400 text-sm mb-4">
              Rejecting <span className="text-teal-400">{rejectDoc.docRef}</span> for {rejectDoc.customerName}
            </p>
            <div className="mb-5">
              <label className={`${labelCls} text-rose-300`}>Rejection Reason *</label>
              <textarea
                rows={4} required placeholder="Provide a clear reason for rejection..."
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                className={`${inputCls} resize-none`}
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setRejectDoc(null)}
                className="px-5 py-2 rounded-lg border border-white/10 text-white hover:bg-white/5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleReject} disabled={actionSaving || !rejectReason.trim()}
                className="px-5 py-2 rounded-lg bg-gradient-to-r from-rose-600 to-rose-700 text-white hover:opacity-90 disabled:opacity-50 text-sm font-medium"
              >
                {actionSaving ? 'Rejecting...' : 'Confirm Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
