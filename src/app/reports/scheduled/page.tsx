'use client';

import React, { useState, useEffect } from 'react';

interface ScheduledReport {
  id: string;
  name: string;
  type: string;
  frequency: string;
  recipients: string;
  format: string;
  lastRun: string;
  nextRun: string;
  status: 'active' | 'paused' | 'failed';
}

export default function ScheduledReportsPage() {
  const [reports, setReports] = useState<ScheduledReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    type: 'Fleet Utilization',
    frequency: 'Weekly',
    recipients: '',
    format: 'PDF',
  });

  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/reports/schedules');
      if (res.ok) {
        const data = await res.json();
        setReports(data.reports || []);
      }
    } catch (error) {
      console.error('Error fetching scheduled reports:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/reports/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setShowModal(false);
        setFormData({ name: '', type: 'Fleet Utilization', frequency: 'Weekly', recipients: '', format: 'PDF' });
        fetchReports();
      }
    } catch (error) {
      console.error('Error creating scheduled report:', error);
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
    if (status === 'paused') return 'bg-slate-500/20 text-slate-300 border-slate-500/30';
    return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Scheduled Reports</h1>
          <p className="text-slate-400">Manage automated report generation and delivery</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-all"
        >
          + Schedule New Report
        </button>
      </div>

      {/* Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-800/50 border-b border-white/5">
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Report Name</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Type</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Frequency</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Recipients</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Format</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Last Run</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Next Run</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Status</th>
            </tr>
          </thead>
          <tbody>
            {reports.length > 0 ? (
              reports.map((report) => (
                <tr key={report.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-6 py-4 text-sm text-white font-medium">{report.name}</td>
                  <td className="px-6 py-4 text-sm text-white">{report.type}</td>
                  <td className="px-6 py-4 text-sm text-white">{report.frequency}</td>
                  <td className="px-6 py-4 text-sm text-slate-200 max-w-xs truncate">{report.recipients}</td>
                  <td className="px-6 py-4 text-sm text-white">
                    <span className="px-2 py-1 bg-slate-700/50 rounded text-xs font-medium">{report.format}</span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-200">
                    {new Date(report.lastRun).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-200">
                    {new Date(report.nextRun).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(report.status)}`}>
                      {report.status}
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-slate-200">
                  No scheduled reports found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-2xl border border-white/10 p-8 w-full max-w-md">
            <h2 className="text-2xl font-bold text-white mb-6">Schedule New Report</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Report Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  placeholder="e.g., Weekly Fleet Report"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Report Type</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="Fleet Utilization">Fleet Utilization</option>
                  <option value="Revenue Analysis">Revenue Analysis</option>
                  <option value="Driver Performance">Driver Performance</option>
                  <option value="Maintenance Cost">Maintenance Cost</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Frequency</label>
                <select
                  value={formData.frequency}
                  onChange={(e) => setFormData({ ...formData, frequency: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="Daily">Daily</option>
                  <option value="Weekly">Weekly</option>
                  <option value="Monthly">Monthly</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Recipients (comma-separated)</label>
                <input
                  type="text"
                  value={formData.recipients}
                  onChange={(e) => setFormData({ ...formData, recipients: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  placeholder="email1@example.com, email2@example.com"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Format</label>
                <select
                  value={formData.format}
                  onChange={(e) => setFormData({ ...formData, format: e.target.value })}
                  className="w-full bg-slate-700/50 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="PDF">PDF</option>
                  <option value="Excel">Excel</option>
                  <option value="CSV">CSV</option>
                </select>
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
                  Schedule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
