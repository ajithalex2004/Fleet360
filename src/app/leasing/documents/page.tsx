'use client';
import React, { useState, useCallback, useEffect } from 'react';

interface Document {
  id: string;
  docName: string;
  type: string;
  entityType: string;
  entityId: string;
  issueDate: string;
  expiryDate: string;
  status: string;
  uploadedBy: string;
  fileUrl: string;
}

interface FormData {
  entityType: string;
  entityId: string;
  docType: string;
  docName: string;
  fileName: string;
  fileUrl: string;
  issueDate: string;
  expiryDate: string;
  uploadedBy: string;
  notes: string;
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [filteredDocuments, setFilteredDocuments] = useState<Document[]>([]);
  const [entityTypeFilter, setEntityTypeFilter] = useState('CONTRACT');
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sweepBusy, setSweepBusy] = useState(false);
  const [sweepResult, setSweepResult] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>({
    entityType: 'CONTRACT',
    entityId: '',
    docType: 'TRADE_LICENSE',
    docName: '',
    fileName: '',
    fileUrl: '',
    issueDate: '',
    expiryDate: '',
    uploadedBy: '',
    notes: '',
  });

  const fetchDocuments = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.append('entityType', entityTypeFilter);
      const response = await fetch(`/api/leasing/documents?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setDocuments(data);
      }
    } catch (error) {
      console.error('Failed to fetch documents:', error);
    } finally {
      setLoading(false);
    }
  }, [entityTypeFilter]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => {
    let filtered = documents;

    if (searchQuery) {
      filtered = filtered.filter((doc) =>
        doc.docName.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    setFilteredDocuments(filtered);
  }, [searchQuery, documents]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      alert('Pick a file to upload.');
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

      const response = await fetch('/api/leasing/documents/upload', {
        method: 'POST',
        body: fd,
      });
      const json = await response.json();
      if (!response.ok) {
        alert(json.error ?? `Upload failed (${response.status})`);
        return;
      }
      setFormData({
        entityType: 'CONTRACT',
        entityId: '',
        docType: 'TRADE_LICENSE',
        docName: '',
        fileName: '',
        fileUrl: '',
        issueDate: '',
        expiryDate: '',
        uploadedBy: '',
        notes: '',
      });
      setSelectedFile(null);
      setShowModal(false);
      fetchDocuments();
    } catch (error) {
      console.error('Failed to upload document:', error);
      alert(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploading(false);
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
        `Scanned ${json.scanned} · ${json.hits.length} hits · ${json.alertsCreated} new alerts · ${json.statusUpdates} status updates.`,
      );
      fetchDocuments();
    } catch (error) {
      setSweepResult(error instanceof Error ? error.message : 'Sweep failed');
    } finally {
      setSweepBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this document?')) {
      try {
        const response = await fetch(`/api/leasing/documents/${id}`, {
          method: 'DELETE',
        });
        if (response.ok) {
          setDocuments(documents.filter((doc) => doc.id !== id));
        }
      } catch (error) {
        console.error('Failed to delete document:', error);
      }
    }
  };

  const getStatusColor = (expiryDate: string) => {
    const today = new Date();
    const expiry = new Date(expiryDate);
    const daysUntilExpiry = Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry < 0) {
      return 'bg-red-500/20 text-red-400 border-red-500/30';
    } else if (daysUntilExpiry < 30) {
      return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    } else {
      return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    }
  };

  const getStatus = (expiryDate: string) => {
    const today = new Date();
    const expiry = new Date(expiryDate);
    const daysUntilExpiry = Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry < 0) {
      return 'EXPIRED';
    } else if (daysUntilExpiry < 30) {
      return 'EXPIRING_SOON';
    } else {
      return 'ACTIVE';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Documents</h1>
          <p className="text-slate-400">Manage contracts, licenses, and related documents</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleRunSweep}
            disabled={sweepBusy}
            className="rounded-xl bg-amber-700/40 border border-amber-500/40 px-4 py-3 text-sm font-medium text-amber-100 hover:bg-amber-600/40 disabled:opacity-50 transition-all"
            title="Scan all documents for expiring/expired status, create alerts"
          >
            {sweepBusy ? 'Sweeping…' : 'Run Expiry Sweep'}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90 transition-all"
          >
            + Upload Document
          </button>
        </div>
      </div>

      {sweepResult && (
        <div className="rounded-lg bg-slate-800/60 border border-slate-700 px-4 py-2 text-sm text-slate-200">
          {sweepResult}
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex gap-4 flex-wrap">
        <div className="flex-1 min-w-64">
          <input
            type="text"
            placeholder="Search documents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2 rounded-lg bg-slate-800/50 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none transition-all"
          />
        </div>
        <select
          value={entityTypeFilter}
          onChange={(e) => setEntityTypeFilter(e.target.value)}
          className="px-4 py-2 rounded-lg bg-slate-800/50 border border-white/10 text-white focus:border-blue-500 focus:outline-none transition-all"
        >
          <option>CONTRACT</option>
          <option>LESSEE</option>
          <option>QUOTATION</option>
          <option>VEHICLE</option>
        </select>
      </div>

      {/* Documents Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-800/50">
            <tr className="border-b border-white/5">
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Doc Name</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Type</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Entity</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Issue Date</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Expiry Date</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Status</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Uploaded By</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredDocuments.map((doc) => (
              <tr key={doc.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td className="px-6 py-4 text-sm font-medium text-white">{doc.docName}</td>
                <td className="px-6 py-4 text-sm text-white">{doc.type}</td>
                <td className="px-6 py-4 text-sm text-white">
                  {doc.entityType} - {doc.entityId}
                </td>
                <td className="px-6 py-4 text-sm text-slate-200">{doc.issueDate}</td>
                <td className="px-6 py-4 text-sm text-slate-200">{doc.expiryDate}</td>
                <td className="px-6 py-4 text-sm">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(doc.expiryDate)}`}>
                    {getStatus(doc.expiryDate)}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-white">{doc.uploadedBy}</td>
                <td className="px-6 py-4 text-sm space-x-2">
                  <a
                    href={doc.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    View
                  </a>
                  <button
                    onClick={() => handleDelete(doc.id)}
                    className="text-red-400 hover:text-red-300 transition-colors"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Upload Document Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-800/95 border border-white/10 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Upload Document</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                X
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Entity Type</label>
                  <select
                    name="entityType"
                    value={formData.entityType}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option>CONTRACT</option>
                    <option>LESSEE</option>
                    <option>QUOTATION</option>
                    <option>VEHICLE</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Entity ID</label>
                  <input
                    type="text"
                    name="entityId"
                    value={formData.entityId}
                    onChange={handleInputChange}
                    required
                    placeholder="LC-001"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Document Type</label>
                  <select
                    name="docType"
                    value={formData.docType}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option>TRADE_LICENSE</option>
                    <option>EMIRATES_ID</option>
                    <option>PASSPORT</option>
                    <option>MOA</option>
                    <option>SIGNED_AGREEMENT</option>
                    <option>INSURANCE</option>
                    <option>VEHICLE_PHOTO</option>
                    <option>OTHER</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Document Name</label>
                  <input
                    type="text"
                    name="docName"
                    value={formData.docName}
                    onChange={handleInputChange}
                    required
                    placeholder="Trade License - ABC Corp"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    File <span className="text-slate-500 text-xs">(PDF, image, Office doc — max 25 MB)</span>
                  </label>
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                    required
                    className="w-full text-sm text-slate-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-slate-600 file:text-white hover:file:bg-slate-500"
                  />
                  {selectedFile && (
                    <p className="mt-1 text-xs text-slate-400">
                      {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Issue Date</label>
                  <input
                    type="date"
                    name="issueDate"
                    value={formData.issueDate}
                    onChange={handleInputChange}
                    required
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Expiry Date</label>
                  <input
                    type="date"
                    name="expiryDate"
                    value={formData.expiryDate}
                    onChange={handleInputChange}
                    required
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Uploaded By</label>
                  <input
                    type="text"
                    name="uploadedBy"
                    value={formData.uploadedBy}
                    onChange={handleInputChange}
                    required
                    placeholder="John Doe"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Notes</label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleInputChange}
                  placeholder="Additional notes..."
                  rows={3}
                  className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  disabled={uploading || !selectedFile}
                  className="flex-1 rounded-lg bg-blue-600 text-white font-medium py-2 hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {uploading ? 'Uploading…' : 'Upload'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setSelectedFile(null); }}
                  className="flex-1 rounded-lg bg-slate-700 text-white font-medium py-2 hover:bg-slate-600 transition-colors"
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
