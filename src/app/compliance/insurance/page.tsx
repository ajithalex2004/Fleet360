'use client';

import React, { useState, useEffect } from 'react';

interface InsurancePolicy {
  id: string;
  policyNumber: string;
  vehicle: string;
  provider: string;
  policyType: string;
  startDate: string;
  endDate: string;
  premium: number;
  sumInsured: number;
  status: 'active' | 'expired' | 'expiring_soon';
}

export default function InsurancePage() {
  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    policyNumber: '',
    vehicle: '',
    provider: '',
    policyType: 'Comprehensive',
    startDate: '',
    endDate: '',
    premium: '',
    sumInsured: '',
  });

  useEffect(() => {
    fetchPolicies();
  }, []);

  const fetchPolicies = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/compliance/insurance');
      if (res.ok) {
        const data = await res.json();
        setPolicies(data.policies || []);
      }
    } catch (error) {
      console.error('Error fetching policies:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/compliance/insurance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setShowModal(false);
        setFormData({
          policyNumber: '',
          vehicle: '',
          provider: '',
          policyType: 'Comprehensive',
          startDate: '',
          endDate: '',
          premium: '',
          sumInsured: '',
        });
        fetchPolicies();
      }
    } catch (error) {
      console.error('Error creating policy:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    if (status === 'active') return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    if (status === 'expiring_soon') return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)] mb-2">Insurance Policies</h1>
          <p className="text-xs text-[var(--text-muted)]">Manage vehicle insurance coverage</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-all"
        >
          + New Policy
        </button>
      </div>

      {/* Table */}
      <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-[var(--bg-surface)]/50 border-b border-[var(--border-subtle)]">
              <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Policy Number</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Vehicle</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Provider</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Type</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Start Date</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">End Date</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Premium</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Sum Insured</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Status</th>
            </tr>
          </thead>
          <tbody>
            {policies.length > 0 ? (
              policies.map((policy) => (
                <tr key={policy.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]">
                  <td className="px-6 py-4 text-sm text-[var(--text-main)] font-medium">{policy.policyNumber}</td>
                  <td className="px-6 py-4 text-sm text-[var(--text-main)]">{policy.vehicle}</td>
                  <td className="px-6 py-4 text-sm text-[var(--text-main)]">{policy.provider}</td>
                  <td className="px-6 py-4 text-sm text-[var(--text-main)]">{policy.policyType}</td>
                  <td className="px-6 py-4 text-sm text-[var(--text-main)]">
                    {new Date(policy.startDate).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-sm text-[var(--text-main)]">
                    {new Date(policy.endDate).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-sm text-[var(--text-main)]">AED {policy.premium.toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm text-[var(--text-main)]">AED {policy.sumInsured.toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(policy.status)}`}>
                      {policy.status.replace('_', ' ')}
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9} className="px-6 py-8 text-center text-[var(--text-main)]">
                  No insurance policies found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--bg-surface)] rounded-2xl border border-[var(--border-subtle)] p-8 w-full max-w-lg">
            <h2 className="text-2xl font-bold text-[var(--text-main)] mb-6">New Insurance Policy</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Policy Number</label>
                <input
                  type="text"
                  value={formData.policyNumber}
                  onChange={(e) => setFormData({ ...formData, policyNumber: e.target.value })}
                  className="w-full bg-[var(--bg-surface-hover)]/50 border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-blue-500"
                  placeholder="POL-001"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Vehicle</label>
                <input
                  type="text"
                  value={formData.vehicle}
                  onChange={(e) => setFormData({ ...formData, vehicle: e.target.value })}
                  className="w-full bg-[var(--bg-surface-hover)]/50 border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-blue-500"
                  placeholder="Vehicle ID"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Provider</label>
                  <input
                    type="text"
                    value={formData.provider}
                    onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
                    className="w-full bg-[var(--bg-surface-hover)]/50 border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-blue-500"
                    placeholder="Insurance Provider"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Type</label>
                  <select
                    value={formData.policyType}
                    onChange={(e) => setFormData({ ...formData, policyType: e.target.value })}
                    className="w-full bg-[var(--bg-surface-hover)]/50 border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-main)] focus:outline-none focus:border-blue-500"
                  >
                    <option value="Comprehensive">Comprehensive</option>
                    <option value="TPL">Third Party Liability</option>
                    <option value="Fleet">Fleet</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Start Date</label>
                  <input
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    className="w-full bg-[var(--bg-surface-hover)]/50 border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-main)] focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">End Date</label>
                  <input
                    type="date"
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                    className="w-full bg-[var(--bg-surface-hover)]/50 border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-main)] focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Premium (AED)</label>
                  <input
                    type="number"
                    value={formData.premium}
                    onChange={(e) => setFormData({ ...formData, premium: e.target.value })}
                    className="w-full bg-[var(--bg-surface-hover)]/50 border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-blue-500"
                    placeholder="5000"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Sum Insured (AED)</label>
                  <input
                    type="number"
                    value={formData.sumInsured}
                    onChange={(e) => setFormData({ ...formData, sumInsured: e.target.value })}
                    className="w-full bg-[var(--bg-surface-hover)]/50 border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-blue-500"
                    placeholder="500000"
                    required
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] text-[var(--text-main)] font-medium hover:bg-[var(--bg-surface-hover)] transition-all"
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
