'use client';

import React, { useState, useEffect } from 'react';

interface ComplianceDoc {
  id: string;
  entityType: string;
  entityId: string;
  docType: string;
  authority: string;
  docNumber: string;
  issueDate: string;
  expiryDate: string;
  daysUntilExpiry: number;
  status: 'active' | 'expiring_soon' | 'expired';
  reminderDays: number;
  notes: string;
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<ComplianceDoc[]>([]);
  const [filteredDocs, setFilteredDocs] = useState<ComplianceDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [entityFilter, setEntityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    entityType: 'Vehicle',
    entityId: '',
    docType: 'RTA_PERMIT',
    authority: '',
    docNumber: '',
    issueDate: '',
    expiryDate: '',
    reminderDays: '30',
    notes: '',
  });

  useEffect(() => {
    fetchDocuments();
  }, []);

  useEffect(() => {
    let filtered = documents;
    if (entityFilter !== 'all') {
      filtered = filtered.filter((d) => d.entityType === entityFilter);
    }
    if (statusFilter !== 'all') {
      filtered = filtered.filter((d) => d.status === statusFilter);
    }
    setFilteredDocs(filtered);
  }, [documents, entityFilter, statusFilter]);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/compliance/documents');
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents || []);
      }
    } catch (error) {
      console.error('Error fetching documents:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/compliance/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setShowModal(false);
        setFormData({
          entityType: 'Vehicle',
          entityId: '',
          docType: 'RTA_PERMIT',
          authority: '',
          docNumber: '',
          issueDate: '',
          expiryDate: '',
          reminderDays: '30',
          notes: '',
        });
        fetchDocuments();
      }
    } catch (error) {
      console.error('Error creating document:', error);
    }
  };

  const getStatusColor = (status: string) => {
    if (status === 'expired') return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
    if (status === 'expiring_soon') return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
  };

  const getDaysColor = (days: number) => {
    if (days < 7) return 'text-rose-400';
    if (days < 30) return 'text-amber-400';
    return 'text-emerald-400';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Compliance Documents</h1>
          <p className="text-slate-400">Manage all regulatory documents and permits</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-all"
        >
          + New Document
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <div>
          <label className="block text-xs text-slate-400 mb-2 font-medium">Entity Type</label>
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Types</option>
            <option value="Vehicle">Vehicle</option>
            <option value="Driver">Driver</option>
            <option value="Company">Company</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-2 font-medium">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-800/50 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="expiring_soon">Expiring Soon</option>
            <option value="expired">Expired</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-800/50 border-b border-white/5">
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Entity Type</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Entity ID</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Doc Type</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Authority</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Doc Number</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Issue Date</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Expiry Date</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Days Remaining</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredDocs.length > 0 ? (
              filteredDocs.map((doc) => (
                <tr key={doc.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-6 py-4 text-sm text-white font-medium">{doc.entityType}</td>
                  <td className="px-6 py-4 text-sm text-white">{doc.entityId}</td>
                  <td className="px-6 py-4 text-sm text-white">{doc.docType}</td>
                  <td className="px-6 py-4 text-sm text-white">{doc.authority}</td>
                  <td className="px-6 py-4 text-sm text-white font-mono text-xs">{doc.docNumber}</td>
                  <td className="px-6 py-4 text-sm text-slate-200">
                    {new Date(doc.issueDate).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-200">
                    {new Date(doc.expiryDate).toLocaleDateString()}
                  </td>
                  <td className={`px-6 py-4 text-sm font-medium ${getDaysColor(doc.daysUntilExpiry)}`}>
                    {doc.daysUntilExpiry} days
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(doc.status)}`}>
                      {doc.status.replace('_', ' ')}
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9} className="px-6 py-8 text-center text-slate-200">
                  No documents found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-2xl border border-white/10 p-8 w-full max-w-lg max-h-screen overflow-y-auto">
            <h2 className="text-2xl font-bold text-white mb-6">New Document</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Entity Type</label>
                  <select
                    value={formData.entityType}
                    onChange={(e) => setFormData({ ...formData, entityType: e.target.value })}
                    className="w-full bg-slate-700/50 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="Vehicle">Vehicle</option>
                    <option value="Driver">Driver</option>
                    <option value="Company">Company</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Entity ID</label>
                  <input
                    type="text"
                    value={formData.entityId}
                    onChange={(e) => setFormData({ ...formData, entityId: e.target.value })}
                    className="w-full bg-slate-700/50 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    placeholder="V-001"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Doc Type</label>
                <select
                  value={formData.docType}
                  onChange={(e) => setFormData({ ...formData, docType: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="RTA_PERMIT">RTA Permit</option>
                  <option value="INSURANCE">Insurance</option>
                  <option value="ROAD_WORTHINESS">Road Worthiness</option>
                  <option value="DRIVER_PERMIT">Driver Permit</option>
                  <option value="SALIK">Salik Tag</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Authority</label>
                  <input
                    type="text"
                    value={formData.authority}
                    onChange={(e) => setFormData({ ...formData, authority: e.target.value })}
                    className="w-full bg-slate-700/50 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    placeholder="RTA Dubai"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Doc Number</label>
                  <input
                    type="text"
                    value={formData.docNumber}
                    onChange={(e) => setFormData({ ...formData, docNumber: e.target.value })}
                    className="w-full bg-slate-700/50 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    placeholder="DOC-123456"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Issue Date</label>
                  <input
                    type="date"
                    value={formData.issueDate}
                    onChange={(e) => setFormData({ ...formData, issueDate: e.target.value })}
                    className="w-full bg-slate-700/50 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Expiry Date</label>
                  <input
                    type="date"
                    value={formData.expiryDate}
                    onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
                    className="w-full bg-slate-700/50 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Reminder Days</label>
                <input
                  type="number"
                  value={formData.reminderDays}
                  onChange={(e) => setFormData({ ...formData, reminderDays: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  placeholder="30"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  placeholder="Additional notes..."
                  rows={2}
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2 rounded-lg bg-slate-700 text-white font-medium hover:bg-slate-600 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium hover:opacity-90 transition-all"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
