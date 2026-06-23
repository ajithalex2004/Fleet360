'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckSquare,
  Download,
  FileBadge,
  FileImage,
  FileSignature,
  FileText,
  Replace,
  Search,
  Shield,
  Square,
  Upload,
} from 'lucide-react';
import RowActionMenu from '@/components/ui/RowActionMenu';
import SmartDataGridHeader from '@/components/ui/SmartDataGridHeader';

type EntityType = 'CONTRACT' | 'LESSEE' | 'QUOTATION' | 'VEHICLE';

type DocumentRecord = {
  id: string;
  docName: string;
  type?: string;
  docType?: string;
  entityType: EntityType;
  entityId: string;
  entityLabel?: string;
  entitySecondaryLabel?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  status?: string | null;
  uploadedBy?: string | null;
  fileUrl: string;
  fileName?: string | null;
  mimeType?: string | null;
  notes?: string | null;
};

type EntityOption = {
  id: string;
  label: string;
  secondaryLabel?: string | null;
  status?: string | null;
};

type EntityOptionsResponse = Record<EntityType, EntityOption[]>;

type FormState = {
  entityType: EntityType;
  entityId: string;
  docType: string;
  docName: string;
  issueDate: string;
  expiryDate: string;
  notes: string;
};

const defaultFormState: FormState = {
  entityType: 'CONTRACT',
  entityId: '',
  docType: 'TRADE_LICENSE',
  docName: '',
  issueDate: '',
  expiryDate: '',
  notes: '',
};

const entityTypeOptions: EntityType[] = ['CONTRACT', 'LESSEE', 'QUOTATION', 'VEHICLE'];

const documentTypeOptions = [
  'TRADE_LICENSE',
  'EMIRATES_ID',
  'PASSPORT',
  'MOA',
  'SIGNED_AGREEMENT',
  'INSURANCE',
  'VEHICLE_PHOTO',
  'OTHER',
];

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB');
}

function getFilePresentation(doc: DocumentRecord) {
  const mime = doc.mimeType ?? '';
  const docType = doc.docType ?? doc.type ?? 'OTHER';
  if (mime.startsWith('image/') || docType === 'VEHICLE_PHOTO') {
    return { icon: FileImage, label: 'Image', color: 'text-sky-300' };
  }
  if (docType === 'SIGNED_AGREEMENT' || docType === 'MOA') {
    return { icon: FileSignature, label: 'Signed Doc', color: 'text-violet-300' };
  }
  if (docType === 'INSURANCE' || docType === 'TRADE_LICENSE') {
    return { icon: Shield, label: 'Compliance', color: 'text-emerald-300' };
  }
  if (docType === 'EMIRATES_ID' || docType === 'PASSPORT') {
    return { icon: FileBadge, label: 'Identity', color: 'text-amber-300' };
  }
  return { icon: FileText, label: 'Document', color: 'text-slate-200' };
}

function getStatusColor(expiryDate?: string | null) {
  if (!expiryDate) return 'bg-slate-700/50 text-slate-300 border-slate-600';
  const today = new Date();
  const expiry = new Date(expiryDate);
  const daysUntilExpiry = Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntilExpiry < 0) return 'bg-red-500/20 text-red-400 border-red-500/30';
  if (daysUntilExpiry < 30) return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
  return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
}

function getStatus(expiryDate?: string | null) {
  if (!expiryDate) return 'NO_EXPIRY';
  const today = new Date();
  const expiry = new Date(expiryDate);
  const daysUntilExpiry = Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntilExpiry < 0) return 'EXPIRED';
  if (daysUntilExpiry < 30) return 'EXPIRING_SOON';
  return 'ACTIVE';
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [entityOptions, setEntityOptions] = useState<EntityOptionsResponse>({
    CONTRACT: [],
    LESSEE: [],
    QUOTATION: [],
    VEHICLE: [],
  });
  const [entityTypeFilter, setEntityTypeFilter] = useState<EntityType>('CONTRACT');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<'docName' | 'docType' | 'entity' | 'issueDate' | 'expiryDate' | 'status'>('docName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [columnFilters, setColumnFilters] = useState({
    docName: '',
    docType: '',
    entity: '',
    issueDate: '',
    expiryDate: '',
    status: 'All',
  });
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sweepBusy, setSweepBusy] = useState(false);
  const [sweepResult, setSweepResult] = useState<string | null>(null);
  const [classifyBusy, setClassifyBusy] = useState(false);
  const [classifyHint, setClassifyHint] = useState<string | null>(null);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<DocumentRecord | null>(null);
  const [formData, setFormData] = useState<FormState>(defaultFormState);

  const fetchDocuments = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.append('entityType', entityTypeFilter);
      const response = await fetch(`/api/leasing/documents?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setDocuments(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Failed to fetch documents:', error);
    } finally {
      setLoading(false);
    }
  }, [entityTypeFilter]);

  const fetchEntityOptions = useCallback(async () => {
    try {
      const response = await fetch('/api/leasing/documents/options');
      if (!response.ok) return;
      const data = await response.json();
      setEntityOptions({
        CONTRACT: Array.isArray(data.CONTRACT) ? data.CONTRACT : [],
        LESSEE: Array.isArray(data.LESSEE) ? data.LESSEE : [],
        QUOTATION: Array.isArray(data.QUOTATION) ? data.QUOTATION : [],
        VEHICLE: Array.isArray(data.VEHICLE) ? data.VEHICLE : [],
      });
    } catch (error) {
      console.error('Failed to fetch document entity options:', error);
    }
  }, []);

  useEffect(() => {
    void fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => {
    void fetchEntityOptions();
  }, [fetchEntityOptions]);

  useEffect(() => {
    setSelectedDocIds([]);
  }, [entityTypeFilter, searchQuery, documents]);

  const filteredDocuments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return documents;
    return documents.filter((doc) => {
      const haystack = [
        doc.docName,
        doc.fileName,
        doc.docType,
        doc.type,
        doc.entityLabel,
        doc.entitySecondaryLabel,
        doc.entityType,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [documents, searchQuery]);

  const displayedDocuments = useMemo(() => {
    const filtered = filteredDocuments.filter((doc) => {
      const status = getStatus(doc.expiryDate);
      return (
        (!columnFilters.docName || doc.docName.toLowerCase().includes(columnFilters.docName.toLowerCase())) &&
        (!columnFilters.docType || String(doc.docType ?? doc.type ?? '').toLowerCase().includes(columnFilters.docType.toLowerCase())) &&
        (!columnFilters.entity || `${doc.entityLabel || doc.entityId} ${doc.entitySecondaryLabel || ''}`.toLowerCase().includes(columnFilters.entity.toLowerCase())) &&
        (!columnFilters.issueDate || String(doc.issueDate ?? '').includes(columnFilters.issueDate)) &&
        (!columnFilters.expiryDate || String(doc.expiryDate ?? '').includes(columnFilters.expiryDate)) &&
        (columnFilters.status === 'All' || status === columnFilters.status)
      );
    });

    filtered.sort((left, right) => {
      const leftValue = ({
        docName: left.docName,
        docType: left.docType ?? left.type ?? '',
        entity: left.entityLabel || left.entityId,
        issueDate: left.issueDate ?? '',
        expiryDate: left.expiryDate ?? '',
        status: getStatus(left.expiryDate),
      })[sortKey];
      const rightValue = ({
        docName: right.docName,
        docType: right.docType ?? right.type ?? '',
        entity: right.entityLabel || right.entityId,
        issueDate: right.issueDate ?? '',
        expiryDate: right.expiryDate ?? '',
        status: getStatus(right.expiryDate),
      })[sortKey];
      const comparison = String(leftValue).localeCompare(String(rightValue));
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [columnFilters, filteredDocuments, sortDirection, sortKey]);

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection('asc');
  };

  const currentEntityOptions = entityOptions[formData.entityType] ?? [];

  const openUploadModal = () => {
    setReplaceTarget(null);
    setSelectedFile(null);
    setClassifyHint(null);
    setFormData(defaultFormState);
    setShowModal(true);
  };

  const openReplaceModal = (doc: DocumentRecord) => {
    setReplaceTarget(doc);
    setSelectedFile(null);
    setClassifyHint(null);
    setFormData({
      entityType: doc.entityType,
      entityId: doc.entityId,
      docType: doc.docType ?? doc.type ?? 'OTHER',
      docName: doc.docName,
      issueDate: doc.issueDate ? new Date(doc.issueDate).toISOString().slice(0, 10) : '',
      expiryDate: doc.expiryDate ? new Date(doc.expiryDate).toISOString().slice(0, 10) : '',
      notes: doc.notes ?? '',
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setReplaceTarget(null);
    setSelectedFile(null);
    setClassifyHint(null);
    setFormData(defaultFormState);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => {
      if (name === 'entityType') {
        return { ...prev, entityType: value as EntityType, entityId: '' };
      }
      return { ...prev, [name]: value };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      alert(replaceTarget ? 'Pick a replacement file first.' : 'Pick a file to upload.');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', selectedFile);
      fd.append('entityType', formData.entityType);
      fd.append('entityId', formData.entityId);
      fd.append('docType', formData.docType);
      fd.append('docName', formData.docName || selectedFile.name);
      if (formData.issueDate) fd.append('issueDate', formData.issueDate);
      if (formData.expiryDate) fd.append('expiryDate', formData.expiryDate);
      if (formData.notes) fd.append('notes', formData.notes);
      if (replaceTarget) fd.append('replaceDocumentId', replaceTarget.id);

      const response = await fetch('/api/leasing/documents/upload', {
        method: 'POST',
        body: fd,
      });
      const json = await response.json();
      if (!response.ok) {
        alert(json.error ?? `Upload failed (${response.status})`);
        return;
      }

      closeModal();
      await Promise.all([fetchDocuments(), fetchEntityOptions()]);
    } catch (error) {
      console.error('Failed to upload document:', error);
      alert(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleClassify = async () => {
    if (!selectedFile) {
      setClassifyHint('Pick an image first.');
      return;
    }
    if (!selectedFile.type.startsWith('image/')) {
      setClassifyHint('AI classification currently works on images only.');
      return;
    }
    setClassifyBusy(true);
    setClassifyHint(null);
    try {
      const fd = new FormData();
      fd.append('file', selectedFile);
      if (formData.docType) fd.append('expectedDocType', formData.docType);
      const res = await fetch('/api/leasing/documents/classify', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) {
        setClassifyHint(json.error ?? `Classifier returned ${res.status}`);
        return;
      }
      const classification = json.classification as {
        docType: string;
        suggestedName: string;
        expiryDate: string | null;
        issueDate: string | null;
        confidence: string;
        warnings: string[];
      };

      const allowed = new Set(documentTypeOptions);
      const mappedType = allowed.has(classification.docType) ? classification.docType : 'OTHER';

      setFormData((prev) => ({
        ...prev,
        docType: mappedType,
        docName: classification.suggestedName || prev.docName,
        issueDate: classification.issueDate ?? prev.issueDate,
        expiryDate: classification.expiryDate ?? prev.expiryDate,
      }));
      setClassifyHint(
        `AI: ${classification.docType} (${classification.confidence})` +
          (classification.warnings.length ? ` • ${classification.warnings.length} warning(s)` : ''),
      );
    } catch (error) {
      setClassifyHint(error instanceof Error ? error.message : 'Classification failed');
    } finally {
      setClassifyBusy(false);
    }
  };

  const handleRunSweep = async () => {
    setSweepBusy(true);
    setSweepResult(null);
    try {
      const res = await fetch('/api/leasing/documents/sweep-expiry', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setSweepResult(`Error: ${json.error ?? res.status}`);
        return;
      }
      setSweepResult(
        `Scanned ${json.scanned} • ${json.hits.length} hits • ${json.alertsCreated} new alerts • ${json.statusUpdates} status updates.`,
      );
      await fetchDocuments();
    } catch (error) {
      setSweepResult(error instanceof Error ? error.message : 'Sweep failed');
    } finally {
      setSweepBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this document? This also removes the stored file.')) return;
    try {
      const response = await fetch(`/api/leasing/documents/${id}`, { method: 'DELETE' });
      if (response.ok) {
        setDocuments((prev) => prev.filter((doc) => doc.id !== id));
        setSelectedDocIds((prev) => prev.filter((docId) => docId !== id));
      }
    } catch (error) {
      console.error('Failed to delete document:', error);
    }
  };

  const handleDownload = (doc: DocumentRecord) => {
    const link = document.createElement('a');
    link.href = `/api/leasing/documents/${doc.id}/download`;
    link.download = doc.fileName || doc.docName || 'document';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleBulkDownload = async () => {
    const selectedDocs = displayedDocuments.filter((doc) => selectedDocIds.includes(doc.id));
    if (selectedDocs.length === 0) return;
    setBulkDownloading(true);
    try {
      for (const doc of selectedDocs) {
        handleDownload(doc);
        await new Promise((resolve) => setTimeout(resolve, 180));
      }
    } finally {
      setBulkDownloading(false);
    }
  };

  const allVisibleSelected =
    displayedDocuments.length > 0 && displayedDocuments.every((doc) => selectedDocIds.includes(doc.id));

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedDocIds([]);
      return;
    }
    setSelectedDocIds(displayedDocuments.map((doc) => doc.id));
  };

  const toggleSelectedDoc = (docId: string) => {
    setSelectedDocIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId],
    );
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-slate-400">Loading documents…</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="mb-2 text-4xl font-bold text-white">Documents</h1>
          <p className="text-slate-400">Manage lease files with better targeting, replacement, and download flows.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleRunSweep}
            disabled={sweepBusy}
            className="rounded-xl border border-amber-500/40 bg-amber-700/40 px-4 py-3 text-sm font-medium text-amber-100 transition-all hover:bg-amber-600/40 disabled:opacity-50"
          >
            {sweepBusy ? 'Sweeping…' : 'Run Expiry Sweep'}
          </button>
          <button
            onClick={openUploadModal}
            className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-sm font-medium text-white transition-all hover:opacity-90"
          >
            + Upload Document
          </button>
        </div>
      </div>

      {sweepResult && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-2 text-sm text-slate-200">
          {sweepResult}
        </div>
      )}

      <div className="flex flex-wrap gap-4 rounded-2xl border border-white/10 bg-slate-800/50 p-4">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search by document, entity, file name, or type…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-900/70 py-2 pl-10 pr-4 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <select
          value={entityTypeFilter}
          onChange={(e) => setEntityTypeFilter(e.target.value as EntityType)}
          className="rounded-lg border border-white/10 bg-slate-900/70 px-4 py-2 text-white focus:border-blue-500 focus:outline-none"
        >
          {entityTypeOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        <button
          onClick={toggleSelectAllVisible}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900/70 px-4 py-2 text-sm text-white hover:bg-slate-800"
        >
          {allVisibleSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
          {allVisibleSelected ? 'Clear selection' : 'Select visible'}
        </button>

        <button
          onClick={handleBulkDownload}
          disabled={selectedDocIds.length === 0 || bulkDownloading}
          className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-600/20 px-4 py-2 text-sm text-emerald-100 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          {bulkDownloading ? 'Downloading…' : `Download selected (${selectedDocIds.length})`}
        </button>
      </div>

      <div className="smart-data-grid-surface p-6 backdrop-blur-sm">
        <table className="w-full min-w-[1180px]">
          <SmartDataGridHeader
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={(key) => toggleSort(key as typeof sortKey)}
            columnResizeStorageKey="leasing-documents-column-widths"
            columns={[
              { key: 'select', label: 'Select', sortable: false, filter: <button type="button" onClick={toggleSelectAllVisible} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800">{allVisibleSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}{allVisibleSelected ? 'Clear' : 'Select'}</button>, headerClassName: 'w-[120px]' },
              { key: 'docName', label: 'Document', sortable: true, filter: <input value={columnFilters.docName} onChange={(e) => setColumnFilters((prev) => ({ ...prev, docName: e.target.value }))} placeholder="Search..." className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" /> },
              { key: 'docType', label: 'Type', sortable: true, filter: <input value={columnFilters.docType} onChange={(e) => setColumnFilters((prev) => ({ ...prev, docType: e.target.value }))} placeholder="Search..." className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" /> },
              { key: 'entity', label: 'Entity', sortable: true, filter: <input value={columnFilters.entity} onChange={(e) => setColumnFilters((prev) => ({ ...prev, entity: e.target.value }))} placeholder="Search..." className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" /> },
              { key: 'issueDate', label: 'Issue', sortable: true, filter: <input value={columnFilters.issueDate} onChange={(e) => setColumnFilters((prev) => ({ ...prev, issueDate: e.target.value }))} placeholder="YYYY-MM-DD" className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" /> },
              { key: 'expiryDate', label: 'Expiry', sortable: true, filter: <input value={columnFilters.expiryDate} onChange={(e) => setColumnFilters((prev) => ({ ...prev, expiryDate: e.target.value }))} placeholder="YYYY-MM-DD" className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none" /> },
              { key: 'status', label: 'Status', sortable: true, filter: <select value={columnFilters.status} onChange={(e) => setColumnFilters((prev) => ({ ...prev, status: e.target.value }))} className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white focus:border-blue-500 focus:outline-none"><option>All</option><option>ACTIVE</option><option>EXPIRING_SOON</option><option>EXPIRED</option><option>NO_EXPIRY</option></select> },
            ]}
            actionHeader="Actions"
          />
          <tbody>
            {displayedDocuments.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-10 text-center text-slate-400">
                  No documents found for this filter.
                </td>
              </tr>
            )}
            {displayedDocuments.map((doc) => {
              const file = getFilePresentation(doc);
              const FileIcon = file.icon;
              const selected = selectedDocIds.includes(doc.id);
              return (
                <tr key={doc.id} className="border-b border-white/5 transition-colors hover:bg-white/5">
                  <td className="px-4 py-4">
                    <button
                      type="button"
                      onClick={() => toggleSelectedDoc(doc.id)}
                      className="text-slate-300 hover:text-white"
                    >
                      {selected ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                    </button>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 rounded-lg border border-white/10 bg-slate-900/70 p-2 ${file.color}`}>
                        <FileIcon className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-white">{doc.docName}</div>
                        <div className="text-xs text-slate-400">{doc.fileName || 'Stored file'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-white">
                    <div>{doc.docType || doc.type}</div>
                    <div className="text-xs text-slate-500">{file.label}</div>
                  </td>
                  <td className="px-6 py-4 text-sm text-white">
                    <div>{doc.entityLabel || doc.entityId}</div>
                    <div className="text-xs text-slate-500">
                      {doc.entityType}
                      {doc.entitySecondaryLabel ? ` • ${doc.entitySecondaryLabel}` : ''}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-200">{formatDate(doc.issueDate)}</td>
                  <td className="px-6 py-4 text-sm text-slate-200">{formatDate(doc.expiryDate)}</td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`rounded-full border px-3 py-1 text-xs font-medium ${getStatusColor(doc.expiryDate)}`}>
                      {getStatus(doc.expiryDate)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <RowActionMenu
                      actions={[
                        {
                          label: 'View',
                          onSelect: () => window.open(doc.fileUrl, '_blank', 'noopener,noreferrer'),
                        },
                        {
                          label: 'Download',
                          onSelect: () => handleDownload(doc),
                        },
                        {
                          label: 'Replace',
                          onSelect: () => openReplaceModal(doc),
                        },
                        {
                          label: 'Delete',
                          onSelect: () => handleDelete(doc.id),
                          tone: 'danger',
                        },
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-800/95 p-8">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-white">
                  {replaceTarget ? 'Replace / Update Document' : 'Upload Document'}
                </h2>
                {replaceTarget && (
                  <p className="mt-1 text-sm text-slate-400">
                    Replacing {replaceTarget.docName} for {replaceTarget.entityLabel || replaceTarget.entityId}
                  </p>
                )}
              </div>
              <button onClick={closeModal} className="text-slate-400 transition-colors hover:text-white">
                X
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">Entity Type</label>
                  <select
                    name="entityType"
                    value={formData.entityType}
                    onChange={handleInputChange}
                    className="w-full rounded-lg border border-white/10 bg-slate-700 px-4 py-2 text-white focus:border-blue-500 focus:outline-none"
                  >
                    {entityTypeOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">Linked Record</label>
                  <select
                    name="entityId"
                    value={formData.entityId}
                    onChange={handleInputChange}
                    required
                    className="w-full rounded-lg border border-white/10 bg-slate-700 px-4 py-2 text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Select {formData.entityType.toLowerCase()}…</option>
                    {currentEntityOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                        {option.secondaryLabel ? ` — ${option.secondaryLabel}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">Document Type</label>
                  <select
                    name="docType"
                    value={formData.docType}
                    onChange={handleInputChange}
                    className="w-full rounded-lg border border-white/10 bg-slate-700 px-4 py-2 text-white focus:border-blue-500 focus:outline-none"
                  >
                    {documentTypeOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">Document Name</label>
                  <input
                    type="text"
                    name="docName"
                    value={formData.docName}
                    onChange={handleInputChange}
                    required
                    placeholder="Signed agreement - Safeway"
                    className="w-full rounded-lg border border-white/10 bg-slate-700 px-4 py-2 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div className="col-span-2">
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    File <span className="text-xs text-slate-500">(PDF, image, Office doc — max 25 MB)</span>
                  </label>
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt"
                    onChange={(e) => {
                      setSelectedFile(e.target.files?.[0] ?? null);
                      setClassifyHint(null);
                    }}
                    required
                    className="w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-600 file:px-4 file:py-2 file:text-white hover:file:bg-slate-500"
                  />
                  {selectedFile && (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-slate-400">
                        {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                      </p>
                      <button
                        type="button"
                        onClick={handleClassify}
                        disabled={classifyBusy || !selectedFile.type.startsWith('image/')}
                        className="rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
                      >
                        {classifyBusy ? 'Classifying…' : 'Auto-classify with AI'}
                      </button>
                    </div>
                  )}
                  {classifyHint && (
                    <p className="mt-2 rounded border border-violet-500/30 bg-violet-900/20 px-2 py-1 text-xs text-violet-300">
                      {classifyHint}
                    </p>
                  )}
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">Issue Date</label>
                  <input
                    type="date"
                    name="issueDate"
                    value={formData.issueDate}
                    onChange={handleInputChange}
                    className="w-full rounded-lg border border-white/10 bg-slate-700 px-4 py-2 text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">Expiry Date</label>
                  <input
                    type="date"
                    name="expiryDate"
                    value={formData.expiryDate}
                    onChange={handleInputChange}
                    className="w-full rounded-lg border border-white/10 bg-slate-700 px-4 py-2 text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">Notes</label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleInputChange}
                  rows={3}
                  placeholder="Optional context for this document…"
                  className="w-full rounded-lg border border-white/10 bg-slate-700 px-4 py-2 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  disabled={uploading || !selectedFile || !formData.entityId}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 py-2 font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {replaceTarget ? <Replace className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                  {uploading ? 'Saving…' : replaceTarget ? 'Replace & Save' : 'Upload Document'}
                </button>
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 rounded-lg bg-slate-700 py-2 font-medium text-white transition-colors hover:bg-slate-600"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
