'use client';

import React, { useState, useEffect } from 'react';

import { FormField, FormFooter, FormSection, PrimaryButton, SecondaryButton, TextInput } from '@/components/ui/form-kit';
import { FormModal } from '@/components/ui/form-modal';
interface TrainingRecord {
  id: string;
  driver: string;
  courseName: string;
  provider: string;
  completedDate: string;
  expiryDate: string;
  certificate: string;
  status: string;
}

export default function TrainingTracker() {
  const [trainings, setTrainings] = useState<TrainingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    driver: '',
    courseName: '',
    provider: '',
    completedDate: '',
    expiryDate: '',
    certificate: '',
  });

  const statuses = ['Pending', 'Enrolled', 'Completed', 'Expired'];

  useEffect(() => {
    fetchTrainings();
  }, []);

  const fetchTrainings = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/drivers/training');
      if (!res.ok) throw new Error('Failed to fetch training records');
      const data = await res.json();
      setTrainings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load training records');
    } finally {
      setLoading(false);
    }
  };

  const filteredTrainings = trainings.filter((training) => {
    const matchesStatus = !filterStatus || training.status === filterStatus;
    return matchesStatus;
  });

  const handleAddTraining = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/drivers/training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error('Failed to add training record');
      setShowModal(false);
      setFormData({ driver: '', courseName: '', provider: '', completedDate: '', expiryDate: '', certificate: '' });
      fetchTrainings();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add training record');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Pending':
        return 'bg-amber-500/20 text-amber-400 border border-amber-500/30';
      case 'Enrolled':
        return 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30';
      case 'Completed':
        return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
      case 'Expired':
        return 'bg-red-500/20 text-red-400 border border-red-500/30';
      default:
        return 'bg-slate-500/20 text-[var(--text-muted)] border border-slate-500/30';
    }
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
        <p className="font-medium">Error loading training records</p>
        <p className="text-sm mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">Training Tracker</h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">Manage driver training and certifications</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 px-6 py-3 text-sm font-medium text-white hover:shadow-lg hover:shadow-cyan-500/20 transition-all"
        >
          + New Training Record
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-4">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-4 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-cyan-500"
        >
          <option value="">All Statuses</option>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </div>

      {/* Training Table */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6 overflow-hidden">
        {filteredTrainings.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">🎓</div>
            <p className="text-[var(--text-muted)]">No training records found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[var(--bg-surface-hover)]">
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Driver</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Course Name</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Provider</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Completed Date</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Expiry Date</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Certificate</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrainings.map((training) => (
                  <tr key={training.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-colors">
                    <td className="px-6 py-4 text-sm text-[var(--text-main)] font-medium">{training.driver}</td>
                    <td className="px-6 py-4 text-sm text-[var(--text-muted)]">{training.courseName}</td>
                    <td className="px-6 py-4 text-sm text-[var(--text-muted)]">{training.provider}</td>
                    <td className="px-6 py-4 text-sm text-[var(--text-muted)]">
                      {training.completedDate ? new Date(training.completedDate).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-[var(--text-muted)]">
                      {training.expiryDate ? new Date(training.expiryDate).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {training.certificate ? (
                        <button className="text-cyan-400 hover:text-cyan-300 transition-colors">Download</button>
                      ) : (
                        <span className="text-[var(--text-muted)]">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(training.status)}`}>
                        {training.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <button className="text-cyan-400 hover:text-cyan-300 transition-colors">Edit</button>
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
          title="New Training Record"
          size="sm"
        >
          <form onSubmit={handleAddTraining} className="space-y-5">
            <FormSection title="Training details" columns={1}>
              <FormField label="Driver" required>
                <TextInput
                  type="text"
                  value={formData.driver}
                  onChange={(e) => setFormData({ ...formData, driver: e.target.value })}
                  required
                />
              </FormField>

              <FormField label="Course Name" required>
                <TextInput
                  type="text"
                  value={formData.courseName}
                  onChange={(e) => setFormData({ ...formData, courseName: e.target.value })}
                  required
                />
              </FormField>

              <FormField label="Provider" required>
                <TextInput
                  type="text"
                  value={formData.provider}
                  onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
                  required
                />
              </FormField>

              <FormField label="Completed Date">
                <TextInput
                  type="date"
                  value={formData.completedDate}
                  onChange={(e) => setFormData({ ...formData, completedDate: e.target.value })}
                />
              </FormField>

              <FormField label="Expiry Date">
                <TextInput
                  type="date"
                  value={formData.expiryDate}
                  onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
                />
              </FormField>

              <FormField label="Certificate">
                <TextInput
                  type="text"
                  value={formData.certificate}
                  onChange={(e) => setFormData({ ...formData, certificate: e.target.value })}
                  placeholder="Certificate URL or ID"
                />
              </FormField>
            </FormSection>
            <FormFooter secondary={<SecondaryButton type="button" onClick={() => setShowModal(false)}>Cancel</SecondaryButton>}>
              <PrimaryButton type="submit">Add Training</PrimaryButton>
            </FormFooter>
          </form>
        </FormModal>
      )}
    </div>
  );
}
