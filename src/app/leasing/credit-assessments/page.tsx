'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Plus, Edit2 } from 'lucide-react';

interface CreditAssessment {
  id: string;
  lessee: { name: string; id: string; type: string };
  assessmentDate: string;
  creditScore: number;
  riskRating: 'LOW' | 'MEDIUM' | 'HIGH';
  creditLimit: number;
  currentExposure: number;
  recommendedLimit: number;
  paymentHistory: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
  annualRevenue: number;
  yearsInBusiness: number;
  assessedBy: string;
  validUntil: string;
  status: string;
  notes: string;
}

interface Lessee {
  id: string;
  name: string;
  type: string;
}

const getRiskBadgeColor = (risk: string) => {
  switch (risk) {
    case 'LOW':
      return 'bg-emerald-900/30 text-emerald-200 border-emerald-700';
    case 'MEDIUM':
      return 'bg-amber-900/30 text-amber-200 border-amber-700';
    case 'HIGH':
      return 'bg-rose-900/30 text-rose-200 border-rose-700';
    default:
      return 'bg-slate-700/30 text-slate-300 border-slate-600';
  }
};

const getPaymentHistoryBadgeColor = (history: string) => {
  switch (history) {
    case 'EXCELLENT':
      return 'bg-emerald-900/30 text-emerald-200 border-emerald-700';
    case 'GOOD':
      return 'bg-blue-900/30 text-blue-200 border-blue-700';
    case 'FAIR':
      return 'bg-amber-900/30 text-amber-200 border-amber-700';
    case 'POOR':
      return 'bg-red-900/30 text-red-200 border-red-700';
    default:
      return 'bg-slate-700/30 text-slate-300 border-slate-600';
  }
};

export default function CreditAssessmentsPage() {
  const [assessments, setAssessments] = useState<CreditAssessment[]>([]);
  const [lessees, setLessees] = useState<Lessee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);

  const [formData, setFormData] = useState({
    lesseeId: '',
    assessmentDate: '',
    creditScore: '',
    riskRating: 'LOW',
    creditLimit: '',
    annualRevenue: '',
    yearsInBusiness: '',
    paymentHistory: 'GOOD',
    recommendedLimit: '',
    assessedBy: '',
    validUntil: '',
    notes: '',
  });

  const fetchAssessments = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/leasing/credit-assessments');
      if (!response.ok) throw new Error('Failed to fetch assessments');
      const data = await response.json();
      setAssessments(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error fetching assessments');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLessees = useCallback(async () => {
    try {
      const response = await fetch('/api/leasing/lessees');
      if (!response.ok) throw new Error('Failed to fetch lessees');
      const data = await response.json();
      setLessees(data);
    } catch (err) {
      console.error('Error fetching lessees:', err);
    }
  }, []);

  useEffect(() => {
    fetchAssessments();
    fetchLessees();
  }, [fetchAssessments, fetchLessees]);

  const handleCreateAssessment = async () => {
    try {
      const response = await fetch('/api/leasing/credit-assessments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          creditScore: parseInt(formData.creditScore),
          creditLimit: parseFloat(formData.creditLimit),
          annualRevenue: parseFloat(formData.annualRevenue),
          yearsInBusiness: parseInt(formData.yearsInBusiness),
          recommendedLimit: parseFloat(formData.recommendedLimit),
        }),
      });
      if (!response.ok) throw new Error('Failed to create assessment');
      setFormData({
        lesseeId: '',
        assessmentDate: '',
        creditScore: '',
        riskRating: 'LOW',
        creditLimit: '',
        annualRevenue: '',
        yearsInBusiness: '',
        paymentHistory: 'GOOD',
        recommendedLimit: '',
        assessedBy: '',
        validUntil: '',
        notes: '',
      });
      setShowNewModal(false);
      fetchAssessments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creating assessment');
    }
  };

  // Calculate summary stats
  const totalAssessed = assessments.length;
  const avgCreditScore = totalAssessed > 0
    ? Math.round(assessments.reduce((sum, a) => sum + a.creditScore, 0) / totalAssessed)
    : 0;
  const highRiskCount = assessments.filter(a => a.riskRating === 'HIGH').length;
  const totalExposure = assessments.reduce((sum, a) => sum + a.currentExposure, 0);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">Credit Assessments</h1>
          <button
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition"
          >
            <Plus size={20} /> New Assessment
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg">
            <p className="text-red-200">{error}</p>
          </div>
        )}

        {/* Summary Cards */}
        <div className="mb-8 grid grid-cols-4 gap-4">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
            <p className="text-slate-400 text-sm mb-1">Total Assessed</p>
            <p className="text-3xl font-bold text-blue-400">{totalAssessed}</p>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
            <p className="text-slate-400 text-sm mb-1">Avg Credit Score</p>
            <p className="text-3xl font-bold text-emerald-400">{avgCreditScore}</p>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
            <p className="text-slate-400 text-sm mb-1">High Risk Count</p>
            <p className="text-3xl font-bold text-rose-400">{highRiskCount}</p>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
            <p className="text-slate-400 text-sm mb-1">Total Exposure</p>
            <p className="text-3xl font-bold text-amber-400">{totalExposure.toFixed(2)} AED</p>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12">Loading assessments...</div>
        ) : (
          <div className="overflow-x-auto bg-slate-800 rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900">
                  <th className="px-4 py-3 text-left">Lessee</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Assessment Date</th>
                  <th className="px-4 py-3 text-right">Credit Score</th>
                  <th className="px-4 py-3 text-left">Risk Rating</th>
                  <th className="px-4 py-3 text-right">Credit Limit</th>
                  <th className="px-4 py-3 text-right">Current Exposure</th>
                  <th className="px-4 py-3 text-right">Recommended Limit</th>
                  <th className="px-4 py-3 text-left">Payment History</th>
                  <th className="px-4 py-3 text-left">Valid Until</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {assessments.map(assessment => (
                  <tr key={assessment.id} className="border-b border-slate-700 hover:bg-slate-750">
                    <td className="px-4 py-3 font-medium">{assessment.lessee.name}</td>
                    <td className="px-4 py-3 text-sm">{assessment.lessee.type}</td>
                    <td className="px-4 py-3 text-sm">{assessment.assessmentDate}</td>
                    <td className="px-4 py-3 text-right font-semibold">{assessment.creditScore}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs rounded border ${getRiskBadgeColor(assessment.riskRating)}`}>
                        {assessment.riskRating}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">{assessment.creditLimit.toFixed(2)} AED</td>
                    <td className="px-4 py-3 text-right">{assessment.currentExposure.toFixed(2)} AED</td>
                    <td className="px-4 py-3 text-right text-amber-400 font-medium">{assessment.recommendedLimit.toFixed(2)} AED</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs rounded border ${getPaymentHistoryBadgeColor(assessment.paymentHistory)}`}>
                        {assessment.paymentHistory}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">{assessment.validUntil}</td>
                    <td className="px-4 py-3 text-sm text-slate-200">{assessment.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* New Assessment Modal */}
        {showNewModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 border border-slate-700 rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-6 border-b border-slate-700">
                <h2 className="text-xl font-bold">New Credit Assessment</h2>
                <button
                  onClick={() => setShowNewModal(false)}
                  className="text-slate-400 hover:text-slate-200 transition"
                >
                  X
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Lessee</label>
                  <select
                    value={formData.lesseeId}
                    onChange={e => setFormData({...formData, lesseeId: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  >
                    <option value="">Select lessee</option>
                    {lessees.map(l => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Assessment Date</label>
                  <input
                    type="date"
                    value={formData.assessmentDate}
                    onChange={e => setFormData({...formData, assessmentDate: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Credit Score (0-1000)</label>
                  <input
                    type="number"
                    min="0"
                    max="1000"
                    value={formData.creditScore}
                    onChange={e => setFormData({...formData, creditScore: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Risk Rating</label>
                  <select
                    value={formData.riskRating}
                    onChange={e => setFormData({...formData, riskRating: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  >
                    <option>LOW</option>
                    <option>MEDIUM</option>
                    <option>HIGH</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Credit Limit (AED)</label>
                  <input
                    type="number"
                    value={formData.creditLimit}
                    onChange={e => setFormData({...formData, creditLimit: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Annual Revenue (AED)</label>
                  <input
                    type="number"
                    value={formData.annualRevenue}
                    onChange={e => setFormData({...formData, annualRevenue: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Years In Business</label>
                  <input
                    type="number"
                    value={formData.yearsInBusiness}
                    onChange={e => setFormData({...formData, yearsInBusiness: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Payment History</label>
                  <select
                    value={formData.paymentHistory}
                    onChange={e => setFormData({...formData, paymentHistory: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  >
                    <option>EXCELLENT</option>
                    <option>GOOD</option>
                    <option>FAIR</option>
                    <option>POOR</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Recommended Limit (AED)</label>
                  <input
                    type="number"
                    value={formData.recommendedLimit}
                    onChange={e => setFormData({...formData, recommendedLimit: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Assessed By</label>
                  <input
                    type="text"
                    value={formData.assessedBy}
                    onChange={e => setFormData({...formData, assessedBy: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Valid Until</label>
                  <input
                    type="date"
                    value={formData.validUntil}
                    onChange={e => setFormData({...formData, validUntil: e.target.value})}
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
                  onClick={() => setShowNewModal(false)}
                  className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateAssessment}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition"
                >
                  Create Assessment
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
