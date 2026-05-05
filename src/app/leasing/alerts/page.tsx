'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface ExpiryAlert {
  id: string;
  type: string;
  name: string;
  document_type: string;
  expiry_date: string;
  days_remaining: number;
  module: string;
  action_url: string;
}

interface AlertSummary {
  critical: number;
  warning: number;
  notice: number;
  total: number;
}

type SeverityFilter = 'ALL' | 'CRITICAL' | 'WARNING' | 'NOTICE';
type TypeFilter = 'ALL' | 'EMIRATES_ID' | 'DRIVING_LICENSE' | 'PASSPORT' | 'INSURANCE' | 'VISIT_VISA' | 'LEASING_LICENSE' | 'CONTRACT_RENEWAL' | 'MILEAGE_LIMIT';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const TYPE_ICONS: Record<string, string> = {
  EMIRATES_ID:      '🪪',
  DRIVING_LICENSE:  '🚗',
  LEASING_LICENSE:  '🚗',
  PASSPORT:         '📘',
  INSURANCE:        '🛡️',
  VISIT_VISA:       '📄',
  CONTRACT_RENEWAL: '📜',
  MILEAGE_LIMIT:    '🛣️',
  DOCUMENT:         '📄',
};

const TYPE_LABELS: Record<string, string> = {
  EMIRATES_ID:      'Emirates ID',
  DRIVING_LICENSE:  'Driving License',
  LEASING_LICENSE:  'Leasing License',
  PASSPORT:         'Passport',
  INSURANCE:        'Insurance',
  VISIT_VISA:       'Visit Visa',
  CONTRACT_RENEWAL: 'Contract Renewal',
  MILEAGE_LIMIT:    'Mileage Limit',
  DOCUMENT:         'Document',
};

function getSeverity(days: number): 'CRITICAL' | 'WARNING' | 'NOTICE' {
  if (days < 0)  return 'CRITICAL';
  if (days < 30) return 'WARNING';
  return 'NOTICE';
}

function getDaysBadge(days: number): { label: string; cls: string } {
  if (days < 0)  return { label: 'EXPIRED',             cls: 'bg-red-500/20 text-red-400 border-red-500/40' };
  if (days < 7)  return { label: `${Math.ceil(days)}d`, cls: 'bg-red-500/20 text-red-400 border-red-500/40' };
  if (days < 30) return { label: `${Math.ceil(days)}d`, cls: 'bg-amber-500/20 text-amber-400 border-amber-500/40' };
  if (days < 60) return { label: `${Math.ceil(days)}d`, cls: 'bg-blue-500/20 text-blue-400 border-blue-500/40' };
  return { label: `${Math.ceil(days)}d`, cls: 'bg-slate-500/20 text-slate-400 border-slate-500/40' };
}

function formatDate(d: string) {
  try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

const TYPE_FILTER_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: 'ALL',              label: 'All Types' },
  { value: 'LEASING_LICENSE',  label: 'Driving License' },
  { value: 'INSURANCE',        label: 'Insurance' },
  { value: 'EMIRATES_ID',      label: 'Emirates ID' },
  { value: 'PASSPORT',         label: 'Passport' },
  { value: 'VISIT_VISA',       label: 'Visit Visa' },
  { value: 'CONTRACT_RENEWAL', label: 'Contract Renewal' },
  { value: 'MILEAGE_LIMIT',    label: 'Mileage Limit' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export default function LeasingExpiryAlertsPage() {
  const [alerts, setAlerts]       = useState<ExpiryAlert[]>([]);
  const [summary, setSummary]     = useState<AlertSummary>({ critical: 0, warning: 0, notice: 0, total: 0 });
  const [loading, setLoading]     = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [sevFilter, setSevFilter] = useState<SeverityFilter>('ALL');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/alerts/expiry?module=LEASING');
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setAlerts(data.alerts || []);
      setSummary(data.summary || { critical: 0, warning: 0, notice: 0, total: 0 });
      setLastRefresh(new Date());
    } catch {
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const iv = setInterval(fetchAlerts, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [fetchAlerts]);

  const visible = alerts.filter((a) => {
    const sev = getSeverity(a.days_remaining);
    if (sevFilter !== 'ALL' && sev !== sevFilter) return false;
    if (typeFilter !== 'ALL') {
      // Normalise LEASING_LICENSE -> DRIVING_LICENSE match
      const normalised = a.type === 'LEASING_LICENSE' ? 'LEASING_LICENSE' : a.type;
      if (normalised !== typeFilter) return false;
    }
    return true;
  });

  return (
    <div className="space-y-8">
      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">Expiry Alerts & Compliance Monitor</h1>
          <p className="text-slate-400 text-sm">
            Leasing documents, licenses, insurance and contract renewals requiring attention within 90 days
          </p>
          <p className="text-slate-600 text-xs mt-1">
            Last refreshed: {lastRefresh.toLocaleTimeString()} · Auto-refreshes every 5 min
          </p>
        </div>
        <button
          onClick={fetchAlerts}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600/20 border border-violet-500/30 text-violet-400 hover:bg-violet-600/30 transition-colors text-sm font-medium"
        >
          ↻ Refresh
        </button>
      </div>

      {/* ── Severity Summary Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">🔴</span>
            <div>
              <p className="text-xs font-semibold text-red-400 uppercase tracking-wider">CRITICAL</p>
              <p className="text-xs text-slate-500">Expired</p>
            </div>
          </div>
          <p className="text-4xl font-bold text-red-400">{summary.critical}</p>
          <p className="text-xs text-red-400/70 mt-1">Requires immediate action</p>
        </div>
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">🟡</span>
            <div>
              <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">WARNING</p>
              <p className="text-xs text-slate-500">Expires in 1–30 days</p>
            </div>
          </div>
          <p className="text-4xl font-bold text-amber-400">{summary.warning}</p>
          <p className="text-xs text-amber-400/70 mt-1">Action required soon</p>
        </div>
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-2xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">🔵</span>
            <div>
              <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider">NOTICE</p>
              <p className="text-xs text-slate-500">Expires in 31–90 days</p>
            </div>
          </div>
          <p className="text-4xl font-bold text-blue-400">{summary.notice}</p>
          <p className="text-xs text-blue-400/70 mt-1">Plan ahead</p>
        </div>
      </div>

      {/* ── Leasing-specific notice: contract renewals & mileage ── */}
      <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl px-5 py-4 flex items-start gap-3">
        <span className="text-violet-400 text-xl">📋</span>
        <div>
          <p className="text-violet-300 text-sm font-semibold">Leasing Compliance Scope</p>
          <p className="text-slate-400 text-xs mt-0.5">
            Tracks driving license expiry from credit assessments, insurance policies, lessee documents,
            contract renewal dates, and mileage limit thresholds. Use Contract Renewal and Mileage Limit filters
            to isolate leasing-specific alerts.
          </p>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-slate-800/60 border border-white/10 rounded-xl p-1">
          {(['ALL', 'CRITICAL', 'WARNING', 'NOTICE'] as SeverityFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setSevFilter(f)}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                sevFilter === f
                  ? 'bg-violet-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-slate-800/60 border border-white/10 rounded-xl p-1 flex-wrap">
          {TYPE_FILTER_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setTypeFilter(value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                typeFilter === value
                  ? 'bg-violet-600/80 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Table ── */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <div className="inline-block w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-slate-400 text-sm">Loading compliance data...</p>
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-16 text-center">
          <div className="text-5xl mb-4">✅</div>
          <p className="text-emerald-400 text-lg font-semibold">All documents are up to date</p>
          <p className="text-slate-500 text-sm mt-1">No expiry alerts match the selected filters</p>
        </div>
      ) : (
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-300">
              {visible.length} alert{visible.length !== 1 ? 's' : ''} found
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-3 w-8">Type</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3">Lessee / Asset</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3">Document</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3">Expiry Date</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3">Days Left</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3">Module</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {visible.map((alert) => {
                  const badge = getDaysBadge(alert.days_remaining);
                  return (
                    <tr key={alert.id} className="hover:bg-white/3 transition-colors">
                      <td className="px-6 py-3.5 text-lg">
                        {TYPE_ICONS[alert.type] || '📄'}
                      </td>
                      <td className="px-4 py-3.5 font-medium text-white max-w-[200px] truncate">
                        {alert.name}
                      </td>
                      <td className="px-4 py-3.5 text-slate-400">
                        {alert.document_type}
                      </td>
                      <td className="px-4 py-3.5 text-slate-300 font-mono text-xs">
                        {formatDate(alert.expiry_date)}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold border ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold border bg-violet-500/15 text-violet-400 border-violet-500/30">
                          LEASING
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <Link
                          href={alert.action_url}
                          className="px-3 py-1.5 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-400 hover:bg-violet-600/40 transition-colors text-xs font-medium"
                        >
                          {alert.days_remaining < 0 ? 'Renew' : 'Update'}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
