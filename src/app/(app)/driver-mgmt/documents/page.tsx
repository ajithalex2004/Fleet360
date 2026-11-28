'use client';

import React, { useState, useEffect } from 'react';

import { FormField, FormFooter, FormSection, PrimaryButton, SecondaryButton, SelectInput, TextInput } from '@/components/ui/form-kit';
import { FormModal } from '@/components/ui/form-modal';
interface DriverDocument {
  id: string;
  driverName: string;
  docType: string;
  docNumber: string;
  expiryDate: string;
  daysUntilExpiry: number;
  status: string;
}

export default function DriverDocuments() {
  const [documents, setDocuments] = useState<DriverDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterDriver, setFilterDriver] = useState('');
  const [filterDocType, setFilterDocType] = useState('');
  const [drivers, setDrivers] = useState<string[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    driverId: '',
    docType: '',
    docNumber: '',
    expiryDate: '',
  });

  const docTypes = ['License', 'Passport', 'Visa', 'Emirates ID', 'Medical'];

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/drivers/documents');
      if (!res.ok) throw new Error('Failed to fetch documents');
      const data = await res.json();
      setDocuments(data);
      const uniqueDrivers: string[] = [...new Set<string>(data.map((d: DriverDocument) => d.driverName))];
      setDrivers(uniqueDrivers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  const filteredDocuments = documents.filter((doc) => {
    const matchesDriver = !filterDriver || doc.driverName === filterDriver;
    const matchesDocType = !filterDocType || doc.docType === filterDocType;
    return matchesDriver && matchesDocType;
  });

  const handleAddDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/drivers/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error('Failed to add document');
      setShowModal(false);
      setFormData({ driverId: '', docType: '', docNumber: '', expiryDate: '' });
      fetchData();
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
      <div className="flex items-center justify-center h-full min-h-[200px]">
        <div className="animate-spin">
          <div className="w-12 h-12 border-4 border-[var(--border-strong)] border-t-cyan-500 rounded-full"></div>
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
          <h1 className="text-2xl font-bold text-[var(--text-main)]">Driver Documents</h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">Manage driver licenses, visas, and permits</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 px-6 py-3 text-sm font-medium text-white hover:shadow-lg hover:shadow-cyan-500/20 transition-all"
        >
          + Add Document
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <select
          value={filterDriver}
          onChange={(e) => setFilterDriver(e.target.value)}
          className="bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-4 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-cyan-500"
        >
          <option value="">All Drivers</option>
          {drivers.map((driver) => (
            <option key={driver} value={driver}>
              {driver}
            </option>
          ))}
        </select>

        <select
          value={filterDocType}
          onChange={(e) => setFilterDocType(e.target.value)}
          className="bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-4 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-cyan-500"
        >
          <option value="">All Document Types</option>
          {docTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>

      {/* Documents Table */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6 overflow-hidden">
        {filteredDocuments.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">📄</div>
            <p className="text-[var(--text-muted)]">No documents found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[var(--bg-surface-hover)]">
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Driver Name</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Document Type</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Document Number</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Expiry Date</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Days Until Expiry</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDocuments.map((doc) => (
                  <tr key={doc.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-colors">
                    <td className="px-6 py-4 text-sm text-[var(--text-main)] font-medium">{doc.driverName}</td>
                    <td className="px-6 py-4 text-sm text-[var(--text-muted)]">{doc.docType}</td>
                    <td className="px-6 py-4 text-sm text-[var(--text-muted)] font-mono">{doc.docNumber}</td>
                    <td className="px-6 py-4 text-sm text-[var(--text-muted)]">{new Date(doc.expiryDate).toLocaleDateString()}</td>
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
                            : 'bg-red-500/20 text-red-400 border border-red-500/30'
                        }`}
                      >
                        {doc.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <button className="text-cyan-400 hover:text-cyan-300 transition-colors">View</button>
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
        <FormModal
          onClose={() => setShowModal(false)}
          title="Add Driver Document"
          size="sm"
        >
          <form onSubmit={handleAddDocument} className="space-y-5">
            <FormSection title="Document details" columns={1}>
              <FormField label="Driver" required>
                <SelectInput
                  value={formData.driverId}
                  onChange={(e) => setFormData({ ...formData, driverId: e.target.value })}
                  required
                >
                  <option value="">Select Driver</option>
                  {drivers.map((driver) => (
                    <option key={driver} value={driver}>
                      {driver}
                    </option>
                  ))}
                </SelectInput>
              </FormField>

              <FormField label="Document Type" required>
                <SelectInput
                  value={formData.docType}
                  onChange={(e) => setFormData({ ...formData, docType: e.target.value })}
                  required
                >
                  <option value="">Select Type</option>
                  {docTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </SelectInput>
              </FormField>

              <FormField label="Document Number" required>
                <TextInput
                  type="text"
                  value={formData.docNumber}
                  onChange={(e) => setFormData({ ...formData, docNumber: e.target.value })}
                  required
                />
              </FormField>

              <FormField label="Expiry Date" required>
                <TextInput
                  type="date"
                  value={formData.expiryDate}
                  onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
                  required
                />
              </FormField>
            </FormSection>
            <FormFooter secondary={<SecondaryButton type="button" onClick={() => setShowModal(false)}>Cancel</SecondaryButton>}>
              <PrimaryButton type="submit">Add Document</PrimaryButton>
            </FormFooter>
          </form>
        </FormModal>
      )}
    </div>
  );
}
