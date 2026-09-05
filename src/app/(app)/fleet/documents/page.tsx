'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  FileCheck2,
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  Plus,
  Search,
  Clock,
  CheckCircle2,
  XCircle,
  FileText,
  X,
} from 'lucide-react';

interface VehicleDocumentItem {
  id: string;
  vehicleId: string;
  vehicleCode?: string;
  licensePlate?: string;
  makeModel?: string;
  docType: string;
  docNumber?: string | null;
  issuedBy?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  daysRemaining?: number;
  status: string;
  notes?: string | null;
}

interface GroundedVehicleItem {
  vehicleId: string;
  vehicleCode: string;
  licensePlate: string;
  makeModel: string;
  actionTaken: string;
  actionReason?: string;
  complianceHealth: string;
  documents: Array<{
    id: string;
    docType: string;
    status: string;
    daysRemaining: number;
    groundingRequired: boolean;
    reason?: string;
  }>;
}

interface SweepSummary {
  sweepTimestamp: string;
  totalVehiclesEvaluated: number;
  totalDocumentsEvaluated: number;
  compliantVehiclesCount: number;
  warningVehiclesCount: number;
  criticalVehiclesCount: number;
  groundedVehiclesCount: number;
  newlyGroundedCount: number;
  newlyRestoredCount: number;
  vehicleRecords: GroundedVehicleItem[];
}

export default function FleetDocumentsPage() {
  const [documents, setDocuments] = useState<VehicleDocumentItem[]>([]);
  const [sweepSummary, setSweepSummary] = useState<SweepSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [sweeping, setSweeping] = useState(false);
  const [error, setError] = useState('');
  const [sweepMessage, setSweepMessage] = useState('');

  const [activeTab, setActiveTab] = useState<'ALL' | 'GROUNDED' | 'EXPIRING' | 'VALID'>('ALL');
  const [filterDocType, setFilterDocType] = useState('ALL');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);

  const [formData, setFormData] = useState({
    vehicleId: '',
    docType: 'MULKIYA',
    docNumber: '',
    issueDate: '',
    expiryDate: '',
    issuedBy: '',
    notes: '',
  });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [docsRes, sweepRes] = await Promise.all([
        fetch('/api/fleet/documents?limit=100'),
        fetch('/api/fleet/documents/sweep'),
      ]);

      if (docsRes.ok) {
        const json = await docsRes.json();
        setDocuments(json.data || json || []);
      }
      if (sweepRes.ok) {
        const summary = await sweepRes.json();
        setSweepSummary(summary);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load fleet document intelligence');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRunSweep = async () => {
    try {
      setSweeping(true);
      setSweepMessage('');
      const res = await fetch('/api/fleet/documents/sweep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mulkiyaGracePeriodDays: 30 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to run sweep');
      setSweepMessage(data.message);
      setSweepSummary(data.summary);
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Sweep failed');
    } finally {
      setSweeping(false);
    }
  };

  const handleAddDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/fleet/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error('Failed to register document');
      setShowModal(false);
      setFormData({
        vehicleId: '',
        docType: 'MULKIYA',
        docNumber: '',
        issueDate: '',
        expiryDate: '',
        issuedBy: '',
        notes: '',
      });
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add document');
    }
  };

  const groundedVehicles = sweepSummary?.vehicleRecords.filter(
    (v) => v.complianceHealth === 'NON_COMPLIANT' || v.actionTaken === 'GROUNDED'
  ) || [];

  const filteredDocs = documents.filter((doc) => {
    if (filterDocType !== 'ALL' && doc.docType !== filterDocType) return false;

    const days = doc.expiryDate
      ? Math.floor((new Date(doc.expiryDate).getTime() - Date.now()) / (1000 * 86400))
      : -999;

    if (activeTab === 'EXPIRING' && days > 30) return false;
    if (activeTab === 'VALID' && days <= 30) return false;

    if (search) {
      const q = search.toLowerCase();
      return (
        (doc.docNumber && doc.docNumber.toLowerCase().includes(q)) ||
        (doc.docType && doc.docType.toLowerCase().includes(q)) ||
        (doc.vehicleCode && doc.vehicleCode.toLowerCase().includes(q)) ||
        (doc.licensePlate && doc.licensePlate.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-[var(--text-main)] flex items-center gap-2">
              <FileCheck2 className="w-6 h-6 text-cyan-400" />
              Document Expiry & Vehicle Auto-Grounding
            </h1>
            <span className="px-2 py-0.5 text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded-full">
              P0 Compliance
            </span>
          </div>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Automated UAE regulatory sweep: Mulkiya 30d grace evaluation, 0-day insurance enforcement, and automatic asset grounding.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleRunSweep}
            disabled={sweeping}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-white text-xs font-bold shadow transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${sweeping ? 'animate-spin' : ''}`} />
            {sweeping ? 'Running Sweep...' : 'Run Expiry Sweep'}
          </button>

          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-main)] text-xs font-semibold border border-[var(--border-subtle)] transition"
          >
            <Plus className="w-4 h-4" />
            Upload Document
          </button>
        </div>
      </div>

      {sweepMessage && (
        <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          {sweepMessage}
        </div>
      )}

      {error && (
        <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs">
          {error}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-[var(--bg-surface)]/60 border border-emerald-500/30 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-emerald-400 font-medium">Fully Compliant</span>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-[var(--text-main)]">
            {sweepSummary?.compliantVehiclesCount || 0}
          </p>
          <p className="text-[11px] text-[var(--text-faint)]">All mandatory documents valid</p>
        </div>

        <div className="p-4 rounded-2xl bg-[var(--bg-surface)]/60 border border-amber-500/30 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-amber-400 font-medium">Expiring in 30 Days</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-2xl font-bold text-amber-300">
            {sweepSummary?.warningVehiclesCount || 0}
          </p>
          <p className="text-[11px] text-[var(--text-faint)]">Upcoming renewals needed</p>
        </div>

        <div className="p-4 rounded-2xl bg-[var(--bg-surface)]/60 border border-orange-500/30 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-orange-400 font-medium">Critical (&le; 7 Days)</span>
            <AlertTriangle className="w-4 h-4 text-orange-400" />
          </div>
          <p className="text-2xl font-bold text-orange-300">
            {sweepSummary?.criticalVehiclesCount || 0}
          </p>
          <p className="text-[11px] text-[var(--text-faint)]">Immediate action required</p>
        </div>

        <div className="p-4 rounded-2xl bg-[var(--bg-surface)]/60 border border-rose-500/40 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-rose-400 font-medium">Grounded / Expired</span>
            <ShieldAlert className="w-4 h-4 text-rose-400" />
          </div>
          <p className="text-2xl font-bold text-rose-300">
            {sweepSummary?.groundedVehiclesCount || groundedVehicles.length}
          </p>
          <p className="text-[11px] text-rose-400/80">Blocked from trip dispatch</p>
        </div>
      </div>

      {/* Grounded Quarantine Banner */}
      {groundedVehicles.length > 0 && (
        <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-500/40 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-rose-300 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              Grounded Vehicles Quarantine ({groundedVehicles.length} vehicles)
            </h3>
            <span className="text-xs text-rose-400 font-mono">STATUS: GROUNDED</span>
          </div>
          <p className="text-xs text-rose-200/80">
            The following vehicles have been automatically grounded due to expired insurance or Mulkiya past grace period. They cannot be assigned to any driver, route, or ad-hoc booking.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 pt-1">
            {groundedVehicles.map((v) => (
              <div
                key={v.vehicleId}
                className="p-3 rounded-xl bg-rose-900/40 border border-rose-500/30 text-xs space-y-1"
              >
                <div className="flex items-center justify-between font-bold text-[var(--text-main)]">
                  <span>{v.vehicleCode}</span>
                  <span className="font-mono text-rose-300">{v.licensePlate}</span>
                </div>
                <p className="text-[11px] text-rose-200/70">{v.actionReason || 'Non-compliant documents'}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters & Tabs */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto">
          {(['ALL', 'EXPIRING', 'VALID'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === tab
                  ? 'bg-[var(--bg-surface-hover)] text-[var(--text-main)] border border-slate-500'
                  : 'bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-main)] border border-transparent'
              }`}
            >
              {tab === 'ALL' && 'All Documents'}
              {tab === 'EXPIRING' && 'Expiring Soon (&le; 30d)'}
              {tab === 'VALID' && 'Valid Documents'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={filterDocType}
            onChange={(e) => setFilterDocType(e.target.value)}
            className="px-3 py-1.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] focus:outline-none focus:border-cyan-500"
          >
            <option value="ALL">All Document Types</option>
            <option value="MULKIYA">Mulkiya (Registration)</option>
            <option value="INSURANCE">Insurance</option>
            <option value="TESTING">Testing / Inspection</option>
            <option value="PERMIT">Permit</option>
            <option value="CIVIL_DEFENSE">Civil Defense</option>
          </select>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              placeholder="Search plate, doc #..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>
      </div>

      {/* Document Grid */}
      <div className="rounded-2xl border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-surface)]/60 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[var(--text-muted)]">
            <thead className="bg-[var(--bg-canvas)]/80 text-[var(--text-muted)] uppercase tracking-wider font-semibold border-b border-[var(--border-subtle)]">
              <tr>
                <th className="p-3.5">Vehicle</th>
                <th className="p-3.5">Document Type</th>
                <th className="p-3.5">Document No.</th>
                <th className="p-3.5">Issued By</th>
                <th className="p-3.5">Expiry Date</th>
                <th className="p-3.5">Status & Countdown</th>
                <th className="p-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {!filteredDocs.length ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-[var(--text-faint)]">
                    No documents matching the criteria.
                  </td>
                </tr>
              ) : (
                filteredDocs.map((doc) => {
                  const days = doc.expiryDate
                    ? Math.floor((new Date(doc.expiryDate).getTime() - Date.now()) / (1000 * 86400))
                    : -999;

                  return (
                    <tr key={doc.id} className="hover:bg-[var(--bg-surface-hover)] transition">
                      <td className="p-3.5">
                        <div className="font-bold text-[var(--text-main)]">{doc.vehicleCode || doc.vehicleId.slice(0, 8)}</div>
                        <div className="text-[10px] text-[var(--text-muted)] font-mono">{doc.licensePlate || '—'}</div>
                      </td>

                      <td className="p-3.5">
                        <span className="font-semibold text-[var(--text-main)]">{doc.docType}</span>
                      </td>

                      <td className="p-3.5 font-mono text-cyan-300">
                        {doc.docNumber || '—'}
                      </td>

                      <td className="p-3.5 text-[var(--text-muted)]">
                        {doc.issuedBy || '—'}
                      </td>

                      <td className="p-3.5 font-mono">
                        {doc.expiryDate ? new Date(doc.expiryDate).toLocaleDateString('en-AE') : '—'}
                      </td>

                      <td className="p-3.5">
                        {days < 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                            <XCircle className="w-3 h-3" />
                            Expired {Math.abs(days)}d ago
                          </span>
                        ) : days <= 7 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-500/20 text-orange-300 border border-orange-500/40">
                            <AlertTriangle className="w-3 h-3" />
                            Expires in {days}d (Critical)
                          </span>
                        ) : days <= 30 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                            <Clock className="w-3 h-3" />
                            Expires in {days}d
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            <CheckCircle2 className="w-3 h-3" />
                            Valid ({days}d)
                          </span>
                        )}
                      </td>

                      <td className="p-3.5 text-right">
                        <button
                          onClick={() => {
                            setFormData({
                              vehicleId: doc.vehicleId,
                              docType: doc.docType,
                              docNumber: doc.docNumber || '',
                              issueDate: '',
                              expiryDate: '',
                              issuedBy: doc.issuedBy || '',
                              notes: '',
                            });
                            setShowModal(true);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] text-cyan-300 text-xs font-semibold border border-[var(--border-subtle)] transition"
                        >
                          Renew
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Upload/Renew Document Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-[var(--bg-canvas)]/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h3 className="text-base font-bold text-[var(--text-main)] flex items-center gap-2">
                <FileText className="w-5 h-5 text-cyan-400" />
                Register / Renew Fleet Document
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 rounded-lg hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddDocument} className="space-y-3 text-xs">
              <div>
                <label className="block text-[var(--text-muted)] mb-1">Vehicle ID / UUID</label>
                <input
                  type="text"
                  required
                  placeholder="Vehicle UUID..."
                  value={formData.vehicleId}
                  onChange={(e) => setFormData({ ...formData, vehicleId: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[var(--text-muted)] mb-1">Document Type</label>
                  <select
                    value={formData.docType}
                    onChange={(e) => setFormData({ ...formData, docType: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:outline-none focus:border-cyan-500"
                  >
                    <option value="MULKIYA">Mulkiya (Registration)</option>
                    <option value="INSURANCE">Insurance Policy</option>
                    <option value="TESTING">Testing / Inspection</option>
                    <option value="PERMIT">Commercial Permit</option>
                    <option value="CIVIL_DEFENSE">Civil Defense</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[var(--text-muted)] mb-1">Document Number</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. POL-984214"
                    value={formData.docNumber}
                    onChange={(e) => setFormData({ ...formData, docNumber: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[var(--text-muted)] mb-1">Issue Date</label>
                  <input
                    type="date"
                    value={formData.issueDate}
                    onChange={(e) => setFormData({ ...formData, issueDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-[var(--text-muted)] mb-1">Expiry Date</label>
                  <input
                    type="date"
                    required
                    value={formData.expiryDate}
                    onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[var(--text-muted)] mb-1">Issued By Authority</label>
                <input
                  type="text"
                  placeholder="e.g. Dubai RTA, Abu Dhabi Police, Sukoon Insurance"
                  value={formData.issuedBy}
                  onChange={(e) => setFormData({ ...formData, issuedBy: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-xl bg-[var(--bg-surface)] text-[var(--text-muted)] font-semibold hover:bg-[var(--bg-surface-hover)] transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-cyan-500 text-white font-bold hover:bg-cyan-400 transition"
                >
                  Save & Validate Compliance
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
