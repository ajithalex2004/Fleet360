'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface Alert {
  id: string;
  tag_mac: string;
  asset_name?: string;
  asset_id?: string;
  from_zone?: string;
  to_zone?: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_POSITIVE';
  detected_at: string;
  acknowledged_at?: string;
  acknowledged_by?: string;
  resolved_at?: string;
  resolution_notes?: string;
  gateway_name?: string;
  gateway_code?: string;
}

interface BLEStats {
  open_alerts?: number;
  critical_alerts?: number;
}

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: 'bg-red-500/20 text-red-400 border-red-500/40',
  HIGH: 'bg-orange-500/20 text-orange-400 border-orange-500/40',
  MEDIUM: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
  LOW: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
};

const STATUS_STYLES: Record<string, string> = {
  OPEN: 'bg-red-500/20 text-red-400 border-red-500/40',
  ACKNOWLEDGED: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
  RESOLVED: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
  FALSE_POSITIVE: 'bg-slate-700 text-slate-400 border-slate-600',
};

function RelativeTime({ dt }: { dt: string }) {
  const diff = Math.floor((Date.now() - new Date(dt).getTime()) / 1000);
  let label = '';
  if (diff < 60) label = `${diff}s ago`;
  else if (diff < 3600) label = `${Math.floor(diff / 60)}m ago`;
  else if (diff < 86400) label = `${Math.floor(diff / 3600)}h ago`;
  else label = `${Math.floor(diff / 86400)}d ago`;
  return <span title={new Date(dt).toLocaleString()} className="text-slate-400 text-xs cursor-default">{label}</span>;
}

export default function BLEAlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');

  // Stats derived from alerts
  const openCount = alerts.filter(a => a.status === 'OPEN').length;
  const ackCount = alerts.filter(a => a.status === 'ACKNOWLEDGED').length;
  const resolvedCount = alerts.filter(a => a.status === 'RESOLVED').length;

  // Selected alert for modal
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [acknowledgedBy, setAcknowledgedBy] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg);
    setToastType(type);
    setTimeout(() => setToast(''), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (severityFilter) params.set('severity', severityFilter);
      const r = await fetch(`/api/assets/ble/alerts?${params}`);
      if (!r.ok) throw new Error();
      const data = await r.json();
      setAlerts(Array.isArray(data) ? data : []);
    } catch { setError('Failed to load alerts'); }
    setLoading(false);
  }, [statusFilter, severityFilter]);

  useEffect(() => { load(); }, [load]);

  const patchAlert = async (id: string, body: Record<string, unknown>) => {
    setActionLoading(true);
    try {
      const r = await fetch('/api/assets/ble/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      });
      if (!r.ok) throw new Error();
      showToast('Alert updated successfully');
      setSelectedAlert(null);
      load();
    } catch { showToast('Failed to update alert', 'error'); }
    setActionLoading(false);
  };

  const acknowledge = (alert: Alert) => {
    patchAlert(alert.id, { status: 'ACKNOWLEDGED', acknowledged_by: acknowledgedBy || 'System User' });
  };

  const resolve = (alert: Alert) => {
    patchAlert(alert.id, { status: 'RESOLVED', resolution_notes: resolutionNotes });
  };

  const markFalsePositive = (alert: Alert) => {
    patchAlert(alert.id, { status: 'FALSE_POSITIVE', resolution_notes: 'Marked as false positive' });
  };

  const openModal = (alert: Alert) => {
    setSelectedAlert(alert);
    setResolutionNotes(alert.resolution_notes ?? '');
    setAcknowledgedBy(alert.acknowledged_by ?? '');
  };

  const filteredAlerts = alerts.filter(a => {
    if (fromFilter && new Date(a.detected_at) < new Date(fromFilter)) return false;
    if (toFilter && new Date(a.detected_at) > new Date(toFilter)) return false;
    return true;
  });

  const timelineStep = (label: string, timestamp?: string, active = false) => (
    <div className={`flex items-start gap-3 ${active ? 'opacity-100' : 'opacity-40'}`}>
      <div className={`w-3 h-3 rounded-full mt-0.5 flex-shrink-0 ${active ? 'bg-yellow-400' : 'bg-slate-600'}`} />
      <div>
        <p className={`text-xs font-medium ${active ? 'text-white' : 'text-slate-500'}`}>{label}</p>
        {timestamp && <p className="text-xs text-slate-500">{new Date(timestamp).toLocaleString()}</p>}
      </div>
    </div>
  );

  return (
    <div className="p-8 space-y-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm text-white ${toastType === 'error' ? 'bg-red-600' : 'bg-emerald-600'}`}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">🚨 BLE Movement Alerts</h1>
          <p className="text-slate-400 text-sm mt-1">Zone violation alerts from BLE tracking</p>
        </div>
        <button onClick={load} className="text-xs bg-slate-800 border border-white/8 text-slate-300 hover:text-white px-3 py-1.5 rounded-lg">
          Refresh
        </button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">{error}</div>}

      {/* KPI Strip */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Open Alerts', value: openCount, color: 'text-red-400', bg: 'border-red-500/20' },
          { label: 'Acknowledged', value: ackCount, color: 'text-amber-400', bg: 'border-amber-500/20' },
          { label: 'Resolved', value: resolvedCount, color: 'text-emerald-400', bg: 'border-emerald-500/20' },
        ].map(k => (
          <div key={k.label} className={`bg-slate-900 border ${k.bg} rounded-xl p-5`}>
            {loading ? (
              <div className="space-y-2">
                <div className="h-8 bg-slate-800 rounded animate-pulse w-12" />
                <div className="h-3 bg-slate-800 rounded animate-pulse w-24" />
              </div>
            ) : (
              <>
                <p className={`text-3xl font-bold ${k.color}`}>{k.value}</p>
                <p className="text-slate-400 text-sm mt-1">{k.label}</p>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-slate-900 border border-white/8 rounded-xl p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="w-full bg-slate-800 border border-white/8 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="">All Statuses</option>
              {['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE'].map(s => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Severity</label>
            <select
              value={severityFilter}
              onChange={e => setSeverityFilter(e.target.value)}
              className="w-full bg-slate-800 border border-white/8 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="">All Severities</option>
              {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(s => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">From</label>
            <input
              type="datetime-local"
              value={fromFilter}
              onChange={e => setFromFilter(e.target.value)}
              className="w-full bg-slate-800 border border-white/8 rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">To</label>
            <input
              type="datetime-local"
              value={toFilter}
              onChange={e => setToFilter(e.target.value)}
              className="w-full bg-slate-800 border border-white/8 rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
        </div>
        <div className="flex justify-end mt-2">
          <button
            onClick={() => { setStatusFilter(''); setSeverityFilter(''); setFromFilter(''); setToFilter(''); }}
            className="text-xs text-slate-400 hover:text-white"
          >
            Clear filters
          </button>
        </div>
      </div>

      {/* Alerts Table */}
      <div className="bg-slate-900 border border-white/8 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-white/8 flex items-center justify-between">
          <span className="text-sm text-slate-400">{filteredAlerts.length} alerts</span>
          {openCount > 0 && (
            <span className="text-xs bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full animate-pulse">
              {openCount} require attention
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/50 border-b border-white/8">
              <tr className="text-slate-400 text-xs uppercase">
                {['Time', 'Asset', 'Tag MAC', 'Zone Transition', 'Severity', 'Status', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-slate-800 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredAlerts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center text-slate-500">
                    <div className="text-4xl mb-3">✅</div>
                    <p className="font-medium">No alerts found.</p>
                    <p className="text-sm mt-1">All clear — no zone violations detected.</p>
                  </td>
                </tr>
              ) : filteredAlerts.map(a => (
                <tr
                  key={a.id}
                  className={`transition-colors cursor-pointer ${a.status === 'OPEN' ? 'hover:bg-red-500/5' : 'hover:bg-white/3'}`}
                  onClick={() => openModal(a)}
                >
                  <td className="px-4 py-3 whitespace-nowrap">
                    <RelativeTime dt={a.detected_at} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-white text-xs font-medium">{a.asset_name ?? '—'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-yellow-300 font-mono text-xs bg-yellow-300/5 px-1.5 py-0.5 rounded">{a.tag_mac}</code>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-slate-300 max-w-[120px] truncate" title={a.from_zone}>{a.from_zone ?? '—'}</span>
                      <span className="text-yellow-500 font-bold flex-shrink-0">→</span>
                      <span className="text-white font-medium max-w-[120px] truncate" title={a.to_zone}>{a.to_zone ?? '—'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs border font-medium ${SEVERITY_STYLES[a.severity] ?? SEVERITY_STYLES.LOW}`}>
                      {a.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${STATUS_STYLES[a.status] ?? STATUS_STYLES.OPEN}`}>
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5">
                      {a.status === 'OPEN' && (
                        <button
                          onClick={() => acknowledge(a)}
                          className="text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30 px-2 py-1 rounded"
                        >
                          ✓ Acknowledge
                        </button>
                      )}
                      {a.status === 'ACKNOWLEDGED' && (
                        <>
                          <button
                            onClick={() => openModal(a)}
                            className="text-xs bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 px-2 py-1 rounded"
                          >
                            ✓ Resolve
                          </button>
                          <button
                            onClick={() => markFalsePositive(a)}
                            className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-400 px-2 py-1 rounded"
                          >
                            FP
                          </button>
                        </>
                      )}
                      {(a.status === 'RESOLVED' || a.status === 'FALSE_POSITIVE') && (
                        <span className="text-xs text-slate-600 italic">
                          {a.status === 'RESOLVED' ? 'Resolved' : 'False Positive'}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Alert Detail Modal */}
      {selectedAlert && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setSelectedAlert(null)}>
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-white/8">
              <div className="flex items-center gap-3">
                <h2 className="text-white font-semibold">Alert Detail</h2>
                <span className={`px-2 py-0.5 rounded-full text-xs border ${SEVERITY_STYLES[selectedAlert.severity]}`}>{selectedAlert.severity}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs border ${STATUS_STYLES[selectedAlert.status]}`}>{selectedAlert.status}</span>
              </div>
              <button onClick={() => setSelectedAlert(null)} className="text-slate-400 hover:text-white text-xl">✕</button>
            </div>

            <div className="p-5 space-y-5">
              {/* Asset & Tag info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-950 rounded-xl p-4 border border-white/8">
                  <p className="text-xs text-slate-400 mb-2 uppercase tracking-wider font-medium">Asset</p>
                  <p className="text-white font-semibold">{selectedAlert.asset_name ?? 'Unassigned'}</p>
                  <code className="text-yellow-300 font-mono text-xs mt-1 block">{selectedAlert.tag_mac}</code>
                </div>
                <div className="bg-slate-950 rounded-xl p-4 border border-white/8">
                  <p className="text-xs text-slate-400 mb-2 uppercase tracking-wider font-medium">Gateway</p>
                  <p className="text-white font-semibold">{selectedAlert.gateway_name ?? '—'}</p>
                  <code className="text-slate-400 font-mono text-xs mt-1 block">{selectedAlert.gateway_code ?? '—'}</code>
                </div>
              </div>

              {/* Zone transition diagram */}
              <div className="bg-slate-950 rounded-xl p-4 border border-white/8">
                <p className="text-xs text-slate-400 mb-3 uppercase tracking-wider font-medium">Zone Transition</p>
                <div className="flex items-center gap-4">
                  <div className="flex-1 bg-slate-800 rounded-lg p-3 text-center">
                    <p className="text-xs text-slate-500 mb-1">From Zone</p>
                    <p className="text-white font-semibold">{selectedAlert.from_zone ?? 'Unknown'}</p>
                  </div>
                  <div className="text-3xl text-yellow-400 font-bold flex-shrink-0">→</div>
                  <div className="flex-1 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center">
                    <p className="text-xs text-red-400 mb-1">To Zone (Violation)</p>
                    <p className="text-red-300 font-semibold">{selectedAlert.to_zone ?? 'Unknown'}</p>
                  </div>
                </div>
              </div>

              {/* Timeline */}
              <div className="bg-slate-950 rounded-xl p-4 border border-white/8">
                <p className="text-xs text-slate-400 mb-3 uppercase tracking-wider font-medium">Timeline</p>
                <div className="space-y-3 relative pl-1">
                  <div className="absolute left-1.5 top-2 bottom-2 w-px bg-slate-700" />
                  {timelineStep('Detected', selectedAlert.detected_at, true)}
                  {timelineStep('Acknowledged', selectedAlert.acknowledged_at, !!selectedAlert.acknowledged_at)}
                  {timelineStep('Resolved', selectedAlert.resolved_at, !!selectedAlert.resolved_at)}
                </div>
                {selectedAlert.acknowledged_by && (
                  <p className="text-xs text-slate-500 mt-3">Acknowledged by: <span className="text-slate-300">{selectedAlert.acknowledged_by}</span></p>
                )}
              </div>

              {/* Action area */}
              {selectedAlert.status === 'OPEN' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Acknowledged By</label>
                    <input
                      value={acknowledgedBy}
                      onChange={e => setAcknowledgedBy(e.target.value)}
                      placeholder="Your name or ID"
                      className="w-full bg-slate-800 border border-white/8 rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <button
                    onClick={() => acknowledge(selectedAlert)}
                    disabled={actionLoading}
                    className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold py-2 rounded-lg text-sm disabled:opacity-50"
                  >
                    {actionLoading ? 'Processing...' : '✓ Acknowledge Alert'}
                  </button>
                </div>
              )}

              {selectedAlert.status === 'ACKNOWLEDGED' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Resolution Notes</label>
                    <textarea
                      value={resolutionNotes}
                      onChange={e => setResolutionNotes(e.target.value)}
                      rows={3}
                      placeholder="Describe how this was resolved..."
                      className="w-full bg-slate-800 border border-white/8 rounded-lg px-3 py-2 text-sm text-white resize-none"
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => resolve(selectedAlert)}
                      disabled={actionLoading}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2 rounded-lg text-sm disabled:opacity-50"
                    >
                      {actionLoading ? 'Processing...' : '✓ Mark Resolved'}
                    </button>
                    <button
                      onClick={() => markFalsePositive(selectedAlert)}
                      disabled={actionLoading}
                      className="px-4 bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium py-2 rounded-lg text-sm"
                    >
                      False Positive
                    </button>
                  </div>
                </div>
              )}

              {selectedAlert.resolution_notes && (
                <div className="bg-slate-950 rounded-xl p-4 border border-white/8">
                  <p className="text-xs text-slate-400 mb-1 uppercase tracking-wider font-medium">Resolution Notes</p>
                  <p className="text-slate-300 text-sm">{selectedAlert.resolution_notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
