'use client';
import React, { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { KpiCard, StatGrid } from '@/components/ui/page-theme';

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

interface CustomerOption {
  id: string;
  fullName: string;
  companyName?: string | null;
  nationality?: string | null;
}

interface Stats {
  total: number;
  verified: number;
  pending: number;
  rejected: number;
  expiredOrExpiring: number;
}

const DOC_TYPE_TABS = [
  { key: 'ALL',             label: 'All' },
  { key: 'EMIRATES_ID',     label: 'Emirates ID' },
  { key: 'PASSPORT',        label: 'Passport' },
  { key: 'DRIVING_LICENSE', label: 'Driving License' },
  { key: 'VISIT_VISA',      label: 'Visit Visa' },
  { key: 'RENTAL_CONTRACT', label: 'Contract' },
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
  VISA:            '🛂',
  INSURANCE_CERT:  '🛡️',
  INSURANCE:       '🛡️',
  RENTAL_CONTRACT: '📋',
  CONTRACT:        '📋',
  REGISTRATION:    '🚘',
  MULKIYA:         '📋',
  TRADE_LICENSE:   '🏢',
  OTHER:           '📁',
};

const DOC_LABELS: Record<string, string> = {
  EMIRATES_ID:     'Emirates ID',
  PASSPORT:        'Passport',
  DRIVING_LICENSE: 'Driving License',
  VISIT_VISA:      'Visit Visa',
  VISA:            'Visa',
  INSURANCE_CERT:  'Insurance Cert',
  INSURANCE:       'Insurance',
  RENTAL_CONTRACT: 'Rental Contract',
  CONTRACT:        'Contract',
  REGISTRATION:    'Registration',
  MULKIYA:         'Mulkiya',
  TRADE_LICENSE:   'Trade License',
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
  if (days == null) return <span className="text-[var(--text-faint)] text-xs">N/A</span>;
  if (days < 0)
    return <span className="text-rose-400 font-semibold text-xs">Expired {Math.abs(days)}d ago</span>;
  if (days <= 30)
    return <span className="text-amber-400 font-semibold text-xs">{days}d ⚠</span>;
  return <span className="text-[var(--text-muted)] text-xs">{days}d</span>;
}

const emptyForm = {
  customerName: '', docType: 'EMIRATES_ID', docNumber: '',
  issuingAuthority: '', issueDate: '', expiryDate: '',
  nationality: '', notes: '',
};

function DocumentsVaultInner() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get('id') ?? '';
  const autoOpenedRef = useRef<string>('');

  const [docs, setDocs]               = useState<Doc[]>([]);
  const [customers, setCustomers]     = useState<CustomerOption[]>([]);
  const [stats, setStats]             = useState<Stats | null>(null);
  const [docTypeTab, setDocTypeTab]   = useState('ALL');
  const [statusTab, setStatusTab]     = useState('ALL');
  const [search, setSearch]           = useState('');
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [showModal, setShowModal]     = useState(false);
  const [saving, setSaving]           = useState(false);
  const [modalError, setModalError]   = useState('');
  const [formData, setFormData]       = useState(emptyForm);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Detail / Verify / Reject modals
  const [verifyDoc, setVerifyDoc]       = useState<Doc | null>(null);
  const [rejectDoc, setRejectDoc]       = useState<Doc | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionSaving, setActionSaving] = useState(false);
  const [actionError, setActionError]   = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (docTypeTab !== 'ALL') params.set('doc_type', docTypeTab);
      if (statusTab !== 'ALL')  params.set('status', statusTab);
      if (search)               params.set('search', search);
      const res  = await fetch(`/api/rental/documents?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Failed to load documents (HTTP ${res.status})`);
        return;
      }
      setDocs(data.documents ?? []);
      setStats(data.stats ?? null);
    } catch {
      setError('Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [docTypeTab, statusTab, search]);

  const loadCustomers = useCallback(async () => {
    try {
      const res = await fetch('/api/rental/customers');
      if (!res.ok) return;
      const d = await res.json().catch(() => []);
      const list = Array.isArray(d) ? d : (d?.data ?? d?.customers ?? []);
      setCustomers(Array.isArray(list) ? list : []);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  // Auto-open matching document modal when ?id= is passed from Expiry Alerts
  useEffect(() => {
    if (!highlightId || loading || docs.length === 0) return;
    if (autoOpenedRef.current === highlightId) return;
    const match = docs.find(d => d.id === highlightId || d.customerId === highlightId);
    if (match) {
      autoOpenedRef.current = highlightId;
      setActionError('');
      setVerifyDoc(match);
    }
  }, [highlightId, loading, docs]);

  const openAddModal = () => {
    setFormData(emptyForm);
    setSelectedCustomerId('');
    setSelectedFile(null);
    setModalError('');
    setShowModal(true);
  };

  const handleCustomerSelect = (custId: string) => {
    setSelectedCustomerId(custId);
    if (!custId) return;
    const cust = customers.find(c => c.id === custId);
    if (cust) {
      setFormData(prev => ({
        ...prev,
        customerName: cust.fullName,
        nationality: prev.nationality || cust.nationality || '',
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setModalError('');
    setError('');
    try {
      let uploadedUrl: string | null = null;
      if (selectedFile) {
        const fd = new FormData();
        fd.append('file', selectedFile);
        fd.append('entityType', 'DOCUMENT');
        fd.append('entityId', selectedCustomerId || '');
        fd.append('docType', formData.docType);
        fd.append('docName', formData.docNumber || selectedFile.name || formData.docType);

        const upRes = await fetch('/api/rental/documents/upload', {
          method: 'POST',
          body: fd,
        });
        const uploadJson = await upRes.json().catch(() => ({}));
        if (!upRes.ok) {
          throw new Error(uploadJson.error || `Document scan upload failed (HTTP ${upRes.status})`);
        }
        uploadedUrl = uploadJson.url ?? uploadJson.fileUrl ?? null;
      }

      const res = await fetch('/api/rental/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId:       selectedCustomerId || null,
          customerName:     formData.customerName,
          holderName:       formData.customerName,
          docType:          formData.docType,
          docNumber:        formData.docNumber || null,
          issuingAuthority: formData.issuingAuthority || null,
          issueDate:        formData.issueDate || null,
          expiryDate:       formData.expiryDate || null,
          nationality:      formData.nationality || null,
          fileUrl:          uploadedUrl,
          notes:            formData.notes || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Failed to save document (HTTP ${res.status})`);
      }
      setShowModal(false);
      setFormData(emptyForm);
      setSelectedCustomerId('');
      setSelectedFile(null);
      load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save document';
      setModalError(msg);
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    if (!verifyDoc) return;
    setActionSaving(true);
    setActionError('');
    try {
      const res = await fetch('/api/rental/documents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: verifyDoc.id, action: 'verify' }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setActionError(d.error || `Verification failed (HTTP ${res.status})`);
        return;
      }
      setVerifyDoc(null);
      load();
    } catch {
      setActionError('Network error while verifying document');
    } finally {
      setActionSaving(false);
    }
  };

  const handleReject = async () => {
    if (!rejectDoc || !rejectReason.trim()) return;
    setActionSaving(true);
    setActionError('');
    try {
      const res = await fetch('/api/rental/documents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rejectDoc.id, action: 'reject', rejectionReason: rejectReason }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setActionError(d.error || `Rejection failed (HTTP ${res.status})`);
        return;
      }
      setRejectDoc(null);
      setRejectReason('');
      load();
    } catch {
      setActionError('Network error while rejecting document');
    } finally {
      setActionSaving(false);
    }
  };

  const inputCls = 'w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-teal-500 focus:outline-none text-sm';
  const labelCls = 'block text-sm font-medium text-[var(--text-muted)] mb-1.5';

  const needsExpiryWarning = (d: Doc): boolean => {
    if (!['EMIRATES_ID', 'DRIVING_LICENSE', 'VISIT_VISA', 'PASSPORT', 'VISA'].includes(d.docType)) return false;
    if (d.daysToExpiry == null) return false;
    return d.daysToExpiry <= 30;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)] mb-2">Compliance Document Vault</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-lg">🇦🇪</span>
            <p className="text-amber-400 text-sm font-medium">
              UAE RTA Compliance — All customer documents must be verified before vehicle handover
            </p>
          </div>
        </div>
        <button
          onClick={openAddModal}
          className="rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90 transition-opacity flex-shrink-0"
        >
          + Add Document
        </button>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-rose-400 hover:text-rose-200 ml-3">✕</button>
        </div>
      )}

      {/* KPI Cards */}
      {stats && (
        <StatGrid cols={4}>
          <KpiCard label="Total Documents" value={stats.total} accent="slate" />
          <KpiCard label="Verified" value={stats.verified} accent="emerald" />
          <KpiCard label="Pending Verification" value={stats.pending} accent="amber" />
          <KpiCard label="Expired / Expiring" value={stats.expiredOrExpiring} accent="rose" />
        </StatGrid>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-center">
        {/* Doc Type Tabs */}
        <div className="flex gap-1 bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-xl p-1 flex-wrap">
          {DOC_TYPE_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setDocTypeTab(t.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                docTypeTab === t.key
                  ? 'bg-gradient-to-r from-teal-600 to-cyan-600 text-white'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
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
          className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] text-sm text-[var(--text-main)] focus:border-teal-500 focus:outline-none"
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
          className="px-4 py-1.5 rounded-lg bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-teal-500 focus:outline-none text-sm w-72"
        />
      </div>

      {/* Table */}
      <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl overflow-hidden backdrop-blur-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-[var(--text-muted)] animate-pulse">Loading documents...</div>
        ) : docs.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] py-16">No documents found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]">
                  {['Ref No', 'Customer', 'Document Type', 'Doc Number', 'Expiry Date', 'Days Left', 'Status', 'Verified By', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {docs.map(d => {
                  const warn = needsExpiryWarning(d);
                  const isHighlighted = Boolean(highlightId && (d.id === highlightId || d.customerId === highlightId));
                  return (
                    <tr
                      key={d.id}
                      className={`border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-colors ${
                        isHighlighted
                          ? 'bg-teal-500/15 ring-1 ring-inset ring-teal-500/50'
                          : warn
                            ? 'bg-amber-500/5'
                            : ''
                      }`}
                    >
                      <td className="px-4 py-3 text-sm font-mono text-teal-400 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => { setActionError(''); setVerifyDoc(d); }}
                          className="hover:underline"
                        >
                          {d.docRef}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-[var(--text-main)] whitespace-nowrap">
                        {d.customerName}
                        {d.nationality && <div className="text-xs text-[var(--text-muted)]">{d.nationality}</div>}
                      </td>
                      <td className="px-4 py-3 text-sm whitespace-nowrap">
                        <span className="flex items-center gap-1.5 text-[var(--text-main)]">
                          <span className="text-base">{DOC_ICONS[d.docType] ?? '📁'}</span>
                          <span>{DOC_LABELS[d.docType] ?? d.docType}</span>
                        </span>
                        {warn && (
                          <div className="text-xs text-amber-400 mt-0.5">⚠ Expiry Alert</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--text-muted)] whitespace-nowrap font-mono">
                        {d.docNumber ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--text-muted)] whitespace-nowrap">
                        {fmtDate(d.expiryDate)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {expiryBadge(d.daysToExpiry)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium border ${STATUS_COLORS[d.status] ?? 'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30'}`}>
                          {d.status.replace(/_/g, ' ')}
                        </span>
                        {d.status === 'REJECTED' && d.rejectionReason && (
                          <div className="text-xs text-rose-400/70 mt-0.5 max-w-[120px] truncate" title={d.rejectionReason}>
                            {d.rejectionReason}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--text-muted)] whitespace-nowrap">
                        {d.verifiedBy ?? '—'}
                        {d.verifiedAt && (
                          <div className="text-xs text-[var(--text-faint)]">{fmtDate(d.verifiedAt)}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {d.fileUrl && (
                            <a
                              href={d.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs px-2.5 py-1 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30"
                            >
                              View Scan ↗
                            </a>
                          )}
                          {d.status === 'PENDING_VERIFICATION' ? (
                            <>
                              <button
                                onClick={() => { setActionError(''); setVerifyDoc(d); }}
                                className="text-xs px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30"
                              >
                                Verify
                              </button>
                              <button
                                onClick={() => { setActionError(''); setRejectDoc(d); setRejectReason(''); }}
                                className="text-xs px-2.5 py-1 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30"
                              >
                                Reject
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => { setActionError(''); setVerifyDoc(d); }}
                              className="text-xs px-2.5 py-1 rounded bg-[var(--bg-surface-hover)] text-[var(--text-muted)] border border-[var(--border-subtle)] hover:text-[var(--text-main)]"
                            >
                              Details
                            </button>
                          )}
                        </div>
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
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[var(--bg-surface)]/95 border border-[var(--border-subtle)] rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-[var(--text-main)]">Add Document</h2>
              <button onClick={() => setShowModal(false)} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-xl">✕</button>
            </div>

            {modalError && (
              <div className="mb-4 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">
                {modalError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className={labelCls}>Link Registered Customer (Optional)</label>
                  <select
                    value={selectedCustomerId}
                    onChange={e => handleCustomerSelect(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">— Walk-in / Enter holder manually —</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.fullName}{c.companyName ? ` (${c.companyName})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-span-2">
                  <label className={labelCls}>Holder / Customer Name *</label>
                  <input
                    type="text" required placeholder="Full customer / document holder name"
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
                  <label className={labelCls}>Document Scan (Image or PDF)</label>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={e => setSelectedFile(e.target.files?.[0] ?? null)}
                    className="w-full text-sm text-[var(--text-muted)] file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-teal-600 file:text-white hover:file:bg-teal-500"
                  />
                  {selectedFile && (
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                    </p>
                  )}
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
                  className="px-6 py-2.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit" disabled={saving}
                  className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-600 text-white hover:opacity-90 disabled:opacity-50 text-sm font-medium"
                >
                  {saving ? 'Uploading & Saving...' : 'Add Document'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail / Verify Modal */}
      {verifyDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-[var(--bg-surface)]/95 border border-[var(--border-subtle)] rounded-2xl p-8 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold text-[var(--text-main)]">
                  {verifyDoc.status === 'PENDING_VERIFICATION' ? 'Verify Document' : 'Document Details'}
                </h2>
                <p className="text-[var(--text-muted)] text-sm mt-1">
                  <span className="text-teal-400 font-mono">{verifyDoc.docRef}</span> — {verifyDoc.customerName}
                </p>
              </div>
              <button
                onClick={() => { setVerifyDoc(null); setActionError(''); }}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-xl"
              >
                ✕
              </button>
            </div>

            {actionError && (
              <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">
                {actionError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-sm bg-[var(--bg-surface-hover)]/50 border border-[var(--border-subtle)] rounded-xl p-4">
              <div>
                <div className="text-xs text-[var(--text-faint)]">Document Type</div>
                <div className="text-[var(--text-main)] font-medium mt-0.5">
                  {DOC_ICONS[verifyDoc.docType] ?? '📁'} {DOC_LABELS[verifyDoc.docType] ?? verifyDoc.docType}
                </div>
              </div>
              <div>
                <div className="text-xs text-[var(--text-faint)]">Document Number</div>
                <div className="text-[var(--text-main)] font-mono mt-0.5">{verifyDoc.docNumber ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--text-faint)]">Expiry Date</div>
                <div className="text-[var(--text-main)] mt-0.5">{fmtDate(verifyDoc.expiryDate)}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--text-faint)]">Status</div>
                <div className="mt-0.5">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[verifyDoc.status] ?? 'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30'}`}>
                    {verifyDoc.status.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>
              {verifyDoc.issuingAuthority && (
                <div>
                  <div className="text-xs text-[var(--text-faint)]">Issuing Authority</div>
                  <div className="text-[var(--text-main)] mt-0.5">{verifyDoc.issuingAuthority}</div>
                </div>
              )}
              {verifyDoc.verifiedBy && (
                <div>
                  <div className="text-xs text-[var(--text-faint)]">Verified By</div>
                  <div className="text-[var(--text-main)] mt-0.5">{verifyDoc.verifiedBy}</div>
                </div>
              )}
              {verifyDoc.rejectionReason && (
                <div className="col-span-2">
                  <div className="text-xs text-rose-400">Rejection Reason</div>
                  <div className="text-rose-300 mt-0.5">{verifyDoc.rejectionReason}</div>
                </div>
              )}
            </div>

            {verifyDoc.fileUrl && (
              <div>
                <a
                  href={verifyDoc.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30 text-sm font-medium"
                >
                  View Scan ↗
                </a>
              </div>
            )}

            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={() => { setVerifyDoc(null); setActionError(''); }}
                className="px-5 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] text-sm"
              >
                Close
              </button>
              {verifyDoc.status === 'PENDING_VERIFICATION' && (
                <>
                  <button
                    onClick={() => {
                      const doc = verifyDoc;
                      setVerifyDoc(null);
                      setActionError('');
                      setRejectReason('');
                      setRejectDoc(doc);
                    }}
                    className="px-4 py-2 rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30 text-sm font-medium"
                  >
                    Reject…
                  </button>
                  <button
                    onClick={handleVerify}
                    disabled={actionSaving}
                    className="px-5 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:opacity-90 disabled:opacity-50 text-sm font-medium"
                  >
                    {actionSaving ? 'Verifying...' : 'Mark Verified'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-[var(--bg-surface)]/95 border border-[var(--border-subtle)] rounded-2xl p-8">
            <h2 className="text-xl font-bold text-[var(--text-main)] mb-2">Reject Document</h2>
            <p className="text-[var(--text-muted)] text-sm mb-4">
              Rejecting <span className="text-teal-400 font-mono">{rejectDoc.docRef}</span> for {rejectDoc.customerName}
            </p>

            {actionError && (
              <div className="mb-4 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">
                {actionError}
              </div>
            )}

            {rejectDoc.fileUrl && (
              <div className="mb-4">
                <a
                  href={rejectDoc.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30 font-medium"
                >
                  View Scan ↗
                </a>
              </div>
            )}

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
                onClick={() => { setRejectDoc(null); setActionError(''); }}
                className="px-5 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] text-sm"
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

export default function DocumentsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16 text-[var(--text-muted)] animate-pulse">
          Loading document vault...
        </div>
      }
    >
      <DocumentsVaultInner />
    </Suspense>
  );
}
