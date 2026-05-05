'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { AlertCircle, Plus, Edit2, FileText } from 'lucide-react';

interface Claim {
  id: string;
  claimType: 'ACCIDENT' | 'THEFT' | 'FIRE' | 'NATURAL' | 'OTHER';
  claimDate: string;
  incidentDate: string;
  description: string;
  claimAmount: number;
  deductible: number;
}

interface InsurancePolicy {
  id: string;
  policyNo: string;
  contract: string;
  insurer: string;
  coverageType: 'COMPREHENSIVE' | 'THIRD_PARTY' | 'FLEET' | 'TPL';
  premium: number;
  startDate: string;
  expiryDate: string;
  daysToExpiry: number;
  status: 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'CANCELLED';
  renewalReminderDays: number;
  deductible: number;
  contractId: string;
  notes: string;
  claims: Claim[];
}

interface Contract {
  id: string;
  contractNo: string;
}

const getExpiryColor = (days: number) => {
  if (days > 60) return 'text-green-400';
  if (days > 30 && days <= 60) return 'text-amber-400';
  if (days > 15 && days <= 30) return 'text-orange-400';
  return 'text-red-400';
};

const getStatusBadgeColor = (status: string) => {
  switch (status) {
    case 'ACTIVE':
      return 'bg-emerald-900/30 text-emerald-200 border-emerald-700';
    case 'EXPIRING_SOON':
      return 'bg-orange-900/30 text-orange-200 border-orange-700';
    case 'EXPIRED':
      return 'bg-red-900/30 text-red-200 border-red-700';
    case 'CANCELLED':
      return 'bg-slate-700/30 text-slate-300 border-slate-600';
    default:
      return 'bg-slate-700/30 text-slate-300 border-slate-600';
  }
};

export default function InsurancePage() {
  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [showNewModal, setShowNewModal] = useState(false);
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedPolicy, setSelectedPolicy] = useState<InsurancePolicy | null>(null);
  const [expiringAlert, setExpiringAlert] = useState(false);

  const [formData, setFormData] = useState({
    insurer: '',
    coverageType: 'COMPREHENSIVE',
    premium: '',
    startDate: '',
    expiryDate: '',
    renewalReminderDays: 30,
    deductible: '',
    contractId: '',
    notes: '',
  });

  const [claimData, setClaimData] = useState({
    claimType: 'ACCIDENT',
    claimDate: '',
    incidentDate: '',
    description: '',
    claimAmount: '',
    deductible: '',
  });

  const fetchPolicies = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/leasing/insurance');
      if (!response.ok) throw new Error('Failed to fetch policies');
      const data = await response.json();
      setPolicies(data);

      const hasExpiring = data.some((p: InsurancePolicy) => p.daysToExpiry <= 30 && p.status !== 'EXPIRED');
      setExpiringAlert(hasExpiring);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error fetching policies');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchContracts = useCallback(async () => {
    try {
      const response = await fetch('/api/leasing/contracts-v2');
      if (!response.ok) throw new Error('Failed to fetch contracts');
      const data = await response.json();
      setContracts(data);
    } catch (err) {
      console.error('Error fetching contracts:', err);
    }
  }, []);

  useEffect(() => {
    fetchPolicies();
    fetchContracts();
  }, [fetchPolicies, fetchContracts]);

  const handleNewPolicy = async () => {
    try {
      const response = await fetch('/api/leasing/insurance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          premium: parseFloat(formData.premium),
          deductible: parseFloat(formData.deductible),
          renewalReminderDays: parseInt(formData.renewalReminderDays.toString()),
        }),
      });
      if (!response.ok) throw new Error('Failed to create policy');
      setFormData({
        insurer: '',
        coverageType: 'COMPREHENSIVE',
        premium: '',
        startDate: '',
        expiryDate: '',
        renewalReminderDays: 30,
        deductible: '',
        contractId: '',
        notes: '',
      });
      setShowNewModal(false);
      fetchPolicies();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creating policy');
    }
  };

  const handleAddClaim = async () => {
    if (!selectedPolicy) return;
    try {
      const response = await fetch(`/api/leasing/insurance/${selectedPolicy.id}/claims`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...claimData,
          claimAmount: parseFloat(claimData.claimAmount),
          deductible: parseFloat(claimData.deductible),
        }),
      });
      if (!response.ok) throw new Error('Failed to add claim');
      setClaimData({
        claimType: 'ACCIDENT',
        claimDate: '',
        incidentDate: '',
        description: '',
        claimAmount: '',
        deductible: '',
      });
      setShowClaimModal(false);
      fetchPolicies();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error adding claim');
    }
  };

  const handleEditPolicy = async () => {
    if (!selectedPolicy) return;
    try {
      const response = await fetch(`/api/leasing/insurance/${selectedPolicy.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          premium: parseFloat(formData.premium),
          deductible: parseFloat(formData.deductible),
          renewalReminderDays: parseInt(formData.renewalReminderDays.toString()),
        }),
      });
      if (!response.ok) throw new Error('Failed to update policy');
      setShowEditModal(false);
      setFormData({
        insurer: '',
        coverageType: 'COMPREHENSIVE',
        premium: '',
        startDate: '',
        expiryDate: '',
        renewalReminderDays: 30,
        deductible: '',
        contractId: '',
        notes: '',
      });
      fetchPolicies();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error updating policy');
    }
  };

  const filteredPolicies = statusFilter === 'All' 
    ? policies 
    : policies.filter(p => p.status === statusFilter);

  const openEditModal = (policy: InsurancePolicy) => {
    setSelectedPolicy(policy);
    setFormData({
      insurer: policy.insurer,
      coverageType: policy.coverageType,
      premium: policy.premium.toString(),
      startDate: policy.startDate,
      expiryDate: policy.expiryDate,
      renewalReminderDays: policy.renewalReminderDays,
      deductible: policy.deductible.toString(),
      contractId: policy.contractId,
      notes: policy.notes,
    });
    setShowEditModal(true);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">Insurance Management</h1>
          <button
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition"
          >
            <Plus size={20} /> New Policy
          </button>
        </div>

        {expiringAlert && (
          <div className="mb-6 p-4 bg-orange-900/30 border border-orange-700 rounded-lg flex items-start gap-3">
            <AlertCircle className="text-orange-400 mt-0.5" size={20} />
            <div>
              <p className="font-semibold text-orange-200">Expiring Policies Alert</p>
              <p className="text-orange-300 text-sm">One or more policies expire within 30 days. Review and renew as needed.</p>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg">
            <p className="text-red-200">{error}</p>
          </div>
        )}

        <div className="mb-6 flex gap-2">
          {['All', 'ACTIVE', 'EXPIRING_SOON', 'EXPIRED', 'CANCELLED'].map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-4 py-2 rounded-lg transition ${
                statusFilter === status
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {status}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-12">Loading policies...</div>
        ) : (
          <div className="overflow-x-auto bg-slate-800 rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900">
                  <th className="px-4 py-3 text-left">Policy No</th>
                  <th className="px-4 py-3 text-left">Contract</th>
                  <th className="px-4 py-3 text-left">Insurer</th>
                  <th className="px-4 py-3 text-left">Coverage</th>
                  <th className="px-4 py-3 text-right">Premium</th>
                  <th className="px-4 py-3 text-left">Start</th>
                  <th className="px-4 py-3 text-left">Expiry</th>
                  <th className="px-4 py-3 text-center">Days</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-center">Claims</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPolicies.map(policy => (
                  <tr key={policy.id} className="border-b border-slate-700 hover:bg-slate-750">
                    <td className="px-4 py-3">{policy.policyNo}</td>
                    <td className="px-4 py-3">{policy.contract}</td>
                    <td className="px-4 py-3">{policy.insurer}</td>
                    <td className="px-4 py-3">{policy.coverageType}</td>
                    <td className="px-4 py-3 text-right">{policy.premium.toFixed(2)} AED</td>
                    <td className="px-4 py-3 text-sm">{policy.startDate}</td>
                    <td className="px-4 py-3 text-sm">{policy.expiryDate}</td>
                    <td className={`px-4 py-3 text-center font-semibold ${getExpiryColor(policy.daysToExpiry)}`}>
                      {policy.daysToExpiry}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs rounded border ${getStatusBadgeColor(policy.status)}`}>
                        {policy.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">{policy.claims.length}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => openEditModal(policy)}
                          className="text-blue-400 hover:text-blue-300 transition"
                          title="Edit policy"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => {
                            setSelectedPolicy(policy);
                            setShowClaimModal(true);
                          }}
                          className="text-emerald-400 hover:text-emerald-300 transition"
                          title="Add claim"
                        >
                          <FileText size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* New Policy Modal */}
        {showNewModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 border border-slate-700 rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-6 border-b border-slate-700">
                <h2 className="text-xl font-bold">New Insurance Policy</h2>
                <button
                  onClick={() => setShowNewModal(false)}
                  className="text-slate-400 hover:text-slate-200 transition"
                >
                  X
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Insurer</label>
                  <input
                    type="text"
                    value={formData.insurer}
                    onChange={e => setFormData({...formData, insurer: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Coverage Type</label>
                  <select
                    value={formData.coverageType}
                    onChange={e => setFormData({...formData, coverageType: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  >
                    <option>COMPREHENSIVE</option>
                    <option>THIRD_PARTY</option>
                    <option>FLEET</option>
                    <option>TPL</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Premium (AED)</label>
                  <input
                    type="number"
                    value={formData.premium}
                    onChange={e => setFormData({...formData, premium: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Start Date</label>
                  <input
                    type="date"
                    value={formData.startDate}
                    onChange={e => setFormData({...formData, startDate: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Expiry Date</label>
                  <input
                    type="date"
                    value={formData.expiryDate}
                    onChange={e => setFormData({...formData, expiryDate: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Deductible (AED)</label>
                  <input
                    type="number"
                    value={formData.deductible}
                    onChange={e => setFormData({...formData, deductible: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Renewal Reminder (days)</label>
                  <input
                    type="number"
                    value={formData.renewalReminderDays}
                    onChange={e => setFormData({...formData, renewalReminderDays: parseInt(e.target.value)})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Contract</label>
                  <select
                    value={formData.contractId}
                    onChange={e => setFormData({...formData, contractId: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  >
                    <option value="">Select contract</option>
                    {contracts.map(c => (
                      <option key={c.id} value={c.id}>{c.contractNo}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Notes</label>
                  <textarea
                    value={formData.notes}
                    onChange={e => setFormData({...formData, notes: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100 h-20"
                  />
                </div>
              </div>
              <div className="flex gap-3 p-6 border-t border-slate-700">
                <button
                  onClick={() => setShowNewModal(false)}
                  className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleNewPolicy}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Policy Modal */}
        {showEditModal && selectedPolicy && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 border border-slate-700 rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-6 border-b border-slate-700">
                <h2 className="text-xl font-bold">Edit Policy: {selectedPolicy.policyNo}</h2>
                <button
                  onClick={() => setShowEditModal(false)}
                  className="text-slate-400 hover:text-slate-200 transition"
                >
                  X
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Insurer</label>
                  <input
                    type="text"
                    value={formData.insurer}
                    onChange={e => setFormData({...formData, insurer: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Coverage Type</label>
                  <select
                    value={formData.coverageType}
                    onChange={e => setFormData({...formData, coverageType: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  >
                    <option>COMPREHENSIVE</option>
                    <option>THIRD_PARTY</option>
                    <option>FLEET</option>
                    <option>TPL</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Premium (AED)</label>
                  <input
                    type="number"
                    value={formData.premium}
                    onChange={e => setFormData({...formData, premium: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Start Date</label>
                  <input
                    type="date"
                    value={formData.startDate}
                    onChange={e => setFormData({...formData, startDate: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Expiry Date</label>
                  <input
                    type="date"
                    value={formData.expiryDate}
                    onChange={e => setFormData({...formData, expiryDate: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Deductible (AED)</label>
                  <input
                    type="number"
                    value={formData.deductible}
                    onChange={e => setFormData({...formData, deductible: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Renewal Reminder (days)</label>
                  <input
                    type="number"
                    value={formData.renewalReminderDays}
                    onChange={e => setFormData({...formData, renewalReminderDays: parseInt(e.target.value)})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Notes</label>
                  <textarea
                    value={formData.notes}
                    onChange={e => setFormData({...formData, notes: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100 h-20"
                  />
                </div>
              </div>
              <div className="flex gap-3 p-6 border-t border-slate-700">
                <button
                  onClick={() => setShowEditModal(false)}
                  className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEditPolicy}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add Claim Modal */}
        {showClaimModal && selectedPolicy && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 border border-slate-700 rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-6 border-b border-slate-700">
                <h2 className="text-xl font-bold">Add Claim</h2>
                <button
                  onClick={() => setShowClaimModal(false)}
                  className="text-slate-400 hover:text-slate-200 transition"
                >
                  X
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Claim Type</label>
                  <select
                    value={claimData.claimType}
                    onChange={e => setClaimData({...claimData, claimType: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  >
                    <option>ACCIDENT</option>
                    <option>THEFT</option>
                    <option>FIRE</option>
                    <option>NATURAL</option>
                    <option>OTHER</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Claim Date</label>
                  <input
                    type="date"
                    value={claimData.claimDate}
                    onChange={e => setClaimData({...claimData, claimDate: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Incident Date</label>
                  <input
                    type="date"
                    value={claimData.incidentDate}
                    onChange={e => setClaimData({...claimData, incidentDate: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Description</label>
                  <textarea
                    value={claimData.description}
                    onChange={e => setClaimData({...claimData, description: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100 h-20"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Claim Amount (AED)</label>
                  <input
                    type="number"
                    value={claimData.claimAmount}
                    onChange={e => setClaimData({...claimData, claimAmount: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Deductible (AED)</label>
                  <input
                    type="number"
                    value={claimData.deductible}
                    onChange={e => setClaimData({...claimData, deductible: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
              </div>
              <div className="flex gap-3 p-6 border-t border-slate-700">
                <button
                  onClick={() => setShowClaimModal(false)}
                  className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddClaim}
                  className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg transition"
                >
                  Add Claim
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
