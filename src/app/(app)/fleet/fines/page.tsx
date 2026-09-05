'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AlertTriangle,
  Zap,
  CheckCircle2,
  User,
  Building,
  RefreshCw,
  Plus,
  Search,
  HelpCircle,
  X,
} from 'lucide-react';

interface TrafficFineItem {
  id: string;
  vehicleId: string | null;
  vehicleCode?: string | null;
  licensePlate?: string | null;
  driverId: string | null;
  driverName?: string | null;
  fineDate: string;
  fineAmount: number;
  authority: string | null;
  fineRef: string | null;
  offenceType: string | null;
  assignedTo: string | null;
  status: string | null;
  paidDate: string | null;
  notes?: string | null;
}

interface FineSummary {
  outstanding: number;
  totalPaid: number;
  disputedCount: number;
  waivedCount: number;
  totalFines: number;
}

interface AutoMatchSummary {
  processedCount: number;
  matchedToDriverCount: number;
  assignedToCompanyCount: number;
  unmatchedCount: number;
  totalDriverRecoverableAed: number;
  totalCompanyLiabilityAed: number;
}

export default function TrafficFinesPage() {
  const [fines, setFines] = useState<TrafficFineItem[]>([]);
  const [summary, setSummary] = useState<FineSummary | null>(null);
  const [matchSummary, setMatchSummary] = useState<AutoMatchSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [matching, setMatching] = useState(false);
  const [error, setError] = useState('');
  const [matchMessage, setMatchMessage] = useState('');

  const [activeTab, setActiveTab] = useState<'ALL' | 'DRIVER' | 'COMPANY' | 'UNMATCHED'>('ALL');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);

  const [formData, setFormData] = useState({
    vehicleId: '',
    driverId: '',
    fineDate: new Date().toISOString().slice(0, 16),
    fineAmount: '',
    authority: 'RTA',
    fineRef: '',
    offenceType: 'SPEEDING',
    assignedTo: 'DRIVER',
  });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [finesRes, summaryRes, matchRes] = await Promise.all([
        fetch('/api/fleet/traffic-fines?limit=100'),
        fetch('/api/fleet/traffic-fines/summary'),
        fetch('/api/fleet/traffic-fines/auto-match'),
      ]);

      if (finesRes.ok) {
        const json = await finesRes.json();
        setFines(json.data || json || []);
      }
      if (summaryRes.ok) {
        setSummary(await summaryRes.json());
      }
      if (matchRes.ok) {
        setMatchSummary(await matchRes.json());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load traffic fines');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRunAutoMatch = async () => {
    try {
      setMatching(true);
      setMatchMessage('');
      const res = await fetch('/api/fleet/traffic-fines/auto-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confidenceThreshold: 75 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to auto-match');
      setMatchMessage(data.message);
      setMatchSummary(data.summary);
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Auto-match failed');
    } finally {
      setMatching(false);
    }
  };

  const handleAddFine = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/fleet/traffic-fines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          fineAmount: parseFloat(formData.fineAmount),
          driverId: formData.driverId || undefined,
        }),
      });
      if (!res.ok) throw new Error('Failed to record traffic fine');
      setShowModal(false);
      setFormData({
        vehicleId: '',
        driverId: '',
        fineDate: new Date().toISOString().slice(0, 16),
        fineAmount: '',
        authority: 'RTA',
        fineRef: '',
        offenceType: 'SPEEDING',
        assignedTo: 'DRIVER',
      });
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save fine');
    }
  };

  const filteredFines = useMemo(() => {
    return fines.filter((f) => {
      if (activeTab === 'DRIVER' && f.assignedTo !== 'DRIVER') return false;
      if (activeTab === 'COMPANY' && f.assignedTo !== 'COMPANY') return false;
      if (activeTab === 'UNMATCHED' && f.driverId) return false;

      if (search) {
        const q = search.toLowerCase();
        return (
          (f.fineRef && f.fineRef.toLowerCase().includes(q)) ||
          (f.offenceType && f.offenceType.toLowerCase().includes(q)) ||
          (f.authority && f.authority.toLowerCase().includes(q)) ||
          (f.vehicleCode && f.vehicleCode.toLowerCase().includes(q)) ||
          (f.licensePlate && f.licensePlate.toLowerCase().includes(q)) ||
          (f.driverName && f.driverName.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [fines, activeTab, search]);

  const driverLiabilityAed = fines
    .filter((f) => f.assignedTo === 'DRIVER' && f.status === 'UNPAID')
    .reduce((s, f) => s + Number(f.fineAmount ?? 0), 0);

  const companyLiabilityAed = fines
    .filter((f) => f.assignedTo === 'COMPANY' && f.status === 'UNPAID')
    .reduce((s, f) => s + Number(f.fineAmount ?? 0), 0);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-[var(--text-main)] flex items-center gap-2">
              <Zap className="w-6 h-6 text-amber-400" />
              Traffic Fine & Toll Auto-Matcher
            </h1>
            <span className="px-2 py-0.5 text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full">
              P0 Recovery
            </span>
          </div>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Correlates RTA, Police, and Salik/Darb violation timestamps with active DriverShifts for automated payroll recovery.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleRunAutoMatch}
            disabled={matching}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold shadow transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${matching ? 'animate-spin' : ''}`} />
            {matching ? 'Auto-Matching...' : 'Auto-Match to Shifts'}
          </button>

          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-main)] text-xs font-semibold border border-[var(--border-subtle)] transition"
          >
            <Plus className="w-4 h-4" />
            Record Fine / Toll
          </button>
        </div>
      </div>

      {matchMessage && (
        <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          {matchMessage}
        </div>
      )}

      {error && (
        <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs">
          {error}
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] space-y-1">
          <span className="text-xs text-[var(--text-muted)] font-medium">Total Outstanding</span>
          <p className="text-2xl font-bold text-[var(--text-main)]">
            AED {(summary?.outstanding || 0).toLocaleString()}
          </p>
          <p className="text-[11px] text-[var(--text-faint)]">Unpaid violations in system</p>
        </div>

        <div className="p-4 rounded-2xl bg-[var(--bg-surface)]/60 border border-cyan-500/30 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-cyan-400 font-medium">Driver Recoverable</span>
            <User className="w-4 h-4 text-cyan-400" />
          </div>
          <p className="text-2xl font-bold text-cyan-300">
            AED {driverLiabilityAed.toLocaleString()}
          </p>
          <p className="text-[11px] text-cyan-500/80">Matched & pending payroll deduction</p>
        </div>

        <div className="p-4 rounded-2xl bg-[var(--bg-surface)]/60 border border-amber-500/30 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-amber-400 font-medium">Company Liability</span>
            <Building className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-2xl font-bold text-amber-300">
            AED {companyLiabilityAed.toLocaleString()}
          </p>
          <p className="text-[11px] text-[var(--text-faint)]">Vehicle defects / company permits</p>
        </div>

        <div className="p-4 rounded-2xl bg-[var(--bg-surface)]/60 border border-emerald-500/30 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-emerald-400 font-medium">Auto-Matched Rate</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-emerald-300">
            {fines.length
              ? Math.round(
                  ((fines.filter((f) => f.driverId).length) / fines.length) * 100
                )
              : 100}
            %
          </p>
          <p className="text-[11px] text-[var(--text-faint)]">Shifts temporally correlated</p>
        </div>
      </div>

      {/* Tabs & Search */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto">
          {(['ALL', 'DRIVER', 'COMPANY', 'UNMATCHED'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === tab
                  ? 'bg-[var(--bg-surface-hover)] text-[var(--text-main)] border border-slate-500'
                  : 'bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-main)] border border-transparent'
              }`}
            >
              {tab === 'ALL' && 'All Violations'}
              {tab === 'DRIVER' && 'Driver Liability'}
              {tab === 'COMPANY' && 'Company Liability'}
              {tab === 'UNMATCHED' && 'Unmatched Queue'}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Search ref, plate, offence, driver..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-amber-500"
          />
        </div>
      </div>

      {/* Fines Table */}
      <div className="rounded-2xl border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-surface)]/60 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[var(--text-muted)]">
            <thead className="bg-[var(--bg-canvas)]/80 text-[var(--text-muted)] uppercase tracking-wider font-semibold border-b border-[var(--border-subtle)]">
              <tr>
                <th className="p-3.5">Violation Ref / Date</th>
                <th className="p-3.5">Vehicle</th>
                <th className="p-3.5">Offence & Authority</th>
                <th className="p-3.5">Amount (AED)</th>
                <th className="p-3.5">Assigned Liability</th>
                <th className="p-3.5">Matched Driver</th>
                <th className="p-3.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {!filteredFines.length ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-[var(--text-faint)]">
                    No traffic violations matching criteria.
                  </td>
                </tr>
              ) : (
                filteredFines.map((f) => (
                  <tr key={f.id} className="hover:bg-[var(--bg-surface-hover)] transition">
                    <td className="p-3.5">
                      <div className="font-bold text-[var(--text-main)] font-mono">{f.fineRef || f.id.slice(0, 8)}</div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {new Date(f.fineDate).toLocaleString('en-AE', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </div>
                    </td>

                    <td className="p-3.5">
                      <div className="font-bold text-[var(--text-main)]">{f.vehicleCode || 'VEH'}</div>
                      <div className="text-[10px] text-[var(--text-muted)] font-mono">{f.licensePlate || f.vehicleId?.slice(0, 8)}</div>
                    </td>

                    <td className="p-3.5">
                      <div className="font-semibold text-[var(--text-main)]">{f.offenceType || 'Driving Violation'}</div>
                      <div className="text-[10px] text-[var(--text-muted)]">{f.authority || 'RTA Dubai'}</div>
                    </td>

                    <td className="p-3.5 font-mono font-bold text-amber-300">
                      AED {f.fineAmount.toLocaleString()}
                    </td>

                    <td className="p-3.5">
                      {f.assignedTo === 'DRIVER' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                          <User className="w-3 h-3" />
                          DRIVER PAYROLL
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[var(--bg-surface-hover)] text-[var(--text-muted)]">
                          <Building className="w-3 h-3" />
                          COMPANY
                        </span>
                      )}
                    </td>

                    <td className="p-3.5">
                      {f.driverId ? (
                        <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>{f.driverName || `Driver #${f.driverId.slice(0, 6)}`}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-[var(--text-faint)]">
                          <HelpCircle className="w-3.5 h-3.5" />
                          <span>Unmatched</span>
                        </div>
                      )}
                    </td>

                    <td className="p-3.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          f.status === 'PAID'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : f.status === 'DISPUTED'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {f.status || 'UNPAID'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Record Fine Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-[var(--bg-canvas)]/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h3 className="text-base font-bold text-[var(--text-main)] flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
                Record Traffic Violation / Toll
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 rounded-lg hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddFine} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[var(--text-muted)] mb-1">Vehicle ID / UUID</label>
                  <input
                    type="text"
                    required
                    placeholder="Vehicle UUID..."
                    value={formData.vehicleId}
                    onChange={(e) => setFormData({ ...formData, vehicleId: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-[var(--text-muted)] mb-1">Fine Reference No.</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. DXB-FN-98214"
                    value={formData.fineRef}
                    onChange={(e) => setFormData({ ...formData, fineRef: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[var(--text-muted)] mb-1">Violation Timestamp</label>
                  <input
                    type="datetime-local"
                    required
                    value={formData.fineDate}
                    onChange={(e) => setFormData({ ...formData, fineDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-[var(--text-muted)] mb-1">Fine Amount (AED)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="e.g. 600"
                    value={formData.fineAmount}
                    onChange={(e) => setFormData({ ...formData, fineAmount: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[var(--text-muted)] mb-1">Offence Type</label>
                  <select
                    value={formData.offenceType}
                    onChange={(e) => setFormData({ ...formData, offenceType: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:outline-none focus:border-amber-500"
                  >
                    <option value="SPEEDING">Speeding (Radar)</option>
                    <option value="RED_LIGHT">Red Light Violation</option>
                    <option value="LANE_DISCIPLINE">Lane Discipline Misuse</option>
                    <option value="ILLEGAL_PARKING">Illegal Parking</option>
                    <option value="SALIK_TOLL">Salik Toll Crossing</option>
                    <option value="DARB_TOLL">Darb Toll Crossing</option>
                    <option value="EXPIRED_REGISTRATION">Expired Mulkiya / Testing (Company)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[var(--text-muted)] mb-1">Authority</label>
                  <select
                    value={formData.authority}
                    onChange={(e) => setFormData({ ...formData, authority: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:outline-none focus:border-amber-500"
                  >
                    <option value="RTA">Dubai RTA</option>
                    <option value="DUBAI_POLICE">Dubai Police</option>
                    <option value="ABU_DHABI_POLICE">Abu Dhabi Police / ITC</option>
                    <option value="SALIK">Salik Toll System</option>
                    <option value="DARB">Darb Abu Dhabi</option>
                    <option value="MUNICIPALITY">Municipality</option>
                  </select>
                </div>
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
                  className="px-4 py-2 rounded-xl bg-amber-500 text-white font-bold hover:bg-amber-400 transition"
                >
                  Save Fine
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
