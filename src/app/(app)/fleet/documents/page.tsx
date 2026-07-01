'use client';

import React, { useState, useEffect } from 'react';

interface Document {
  id: string;
  vehicle: string;
  licensePlate: string;
  docType: string;
  docNumber: string;
  issuedBy: string;
  issueDate: string;
  expiryDate: string;
  daysUntilExpiry: number;
  status: string;
}

export default function FleetDocuments() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterDocType, setFilterDocType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    vehicleId: '',
    docType: '',
    docNumber: '',
    issueDate: '',
    expiryDate: '',
    issuedBy: '',
    notes: '',
  });

  const docTypes = ['Registration', 'Insurance', 'Mulkiya', 'Testing', 'Permit', 'Other'];
  const statuses = ['Valid', 'Expired', 'Expiring Soon', 'Pending'];

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/fleet/documents');
      if (!res.ok) throw new Error('Failed to fetch documents');
      const data = await res.json();
      setDocuments(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  const filteredDocuments = documents.filter((doc) => {
    const matchesDocType = !filterDocType || doc.docType === filterDocType;
    const matchesStatus = !filterStatus || doc.status === filterStatus;
    return matchesDocType && matchesStatus;
  });

  const handleAddDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/fleet/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error('Failed to add document');
      setShowModal(false);
      setFormData({
        vehicleId: '',
        docType: '',
        docNumber: '',
        issueDate: '',
        expiryDate: '',
        issuedBy: '',
        notes: '',
      });
      fetchDocuments();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add document');
    }
  };

  const getStatusColor = (days: number) => {
    if (days < 7) return 'bg-red-500/20 text-red-400 border border-red-500/30';
    if (days < 30) return 'bg-amber-500/20 text-amber-400 border border-amber-500/30';
    return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin">
          <div className="w-12 h-12 border-4 border-slate-700 border-t-orange-500 rounded-full"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 text-red-400">
        <p className="font-medium">Error loading documents</p>
        <p className="text-sm mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Vehicle Documents</h1>
          <p className="text-slate-400 mt-1">Manage vehicle registration, insurance, and compliance documents</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 px-6 py-3 text-sm font-medium text-white hover:shadow-lg hover:shadow-orange-500/20 transition-all"
        >
          + Add Document
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <select
          value={filterDocType}
          onChange={(e) => setFilterDocType(e.target.value)}
          className="bg-slate-800/50 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
        >
          <option value="">All Document Types</option>
          {docTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-slate-800/50 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
        >
          <option value="">All Statuses</option>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </div>

      {/* Documents Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 overflow-hidden">
        {filteredDocuments.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">📄</div>
            <p className="text-slate-400">No documents found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-800/50">
                <tr className="border-b border-white/5">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Vehicle</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">License Plate</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Doc Type</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Doc Number</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Issued By</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Issue Date</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Expiry Date</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Days Until Expiry</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDocuments.map((doc) => (
                  <tr key={doc.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4 text-sm text-white font-medium">{doc.vehicle}</td>
                    <td className="px-6 py-4 text-sm text-slate-200">{doc.licensePlate}</td>
                    <td className="px-6 py-4 text-sm text-slate-200">{doc.docType}</td>
                    <td className="px-6 py-4 text-sm text-slate-200">{doc.docNumber}</td>
                    <td className="px-6 py-4 text-sm text-slate-200">{doc.issuedBy}</td>
                    <td className="px-6 py-4 text-sm text-slate-200">
                      {new Date(doc.issueDate).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-200">
                      {new Date(doc.expiryDate).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(doc.daysUntilExpiry)}`}>
                        {doc.daysUntilExpiry} days
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-medium ${
                          doc.status === 'Valid'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : doc.status === 'Expired'
                            ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                            : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        }`}
                      >
                        {doc.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <button className="text-blue-400 hover:text-blue-300 transition-colors">View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 border border-white/10 rounded-2xl p-8 max-w-md w-full">
            <h2 className="text-2xl font-bold text-white mb-6">Add New Document</h2>

            <form onSubmit={handleAddDocument} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Vehicle ID</label>
                <input
                  type="text"
                  value={formData.vehicleId}
                  onChange={(e) => setFormData({ ...formData, vehicleId: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Document Type</label>
                <select
                  value={formData.docType}
                  onChange={(e) => setFormData({ ...formData, docType: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                >
                  <option value="">Select Type</option>
                  {docTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Document Number</label>
                <input
                  type="text"
                  value={formData.docNumber}
                  onChange={(e) => setFormData({ ...formData, docNumber: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Issue Date</label>
                <input
                  type="date"
                  value={formData.issueDate}
                  onChange={(e) => setFormData({ ...formData, issueDate: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Expiry Date</label>
                <input
                  type="date"
                  value={formData.expiryDate}
                  onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Issued By</label>
                <input
                  type="text"
                  value={formData.issuedBy}
                  onChange={(e) => setFormData({ ...formData, issuedBy: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
                  rows={3}
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 px-4 py-2 text-sm font-medium text-white hover:shadow-lg hover:shadow-orange-500/20 transition-all"
                >
                  Add Document
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 rounded-xl bg-slate-700 px-4 py-2 text-sm font-medium text-slate-400 hover:bg-slate-600 transition-all"
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
