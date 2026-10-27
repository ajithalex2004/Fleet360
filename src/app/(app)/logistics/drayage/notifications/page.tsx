'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Bell, AlertTriangle, AlertCircle, Clock, CheckCircle2, RefreshCw,
  Phone, Calendar, RotateCcw, Check, Filter, Layers, MapPin, ArrowRight,
  ExternalLink,
} from 'lucide-react';
import { PageHeader, KpiCard, Panel, StatusPill } from '@/components/ui/page-theme';
import {
  fetchDrayageWorkspaceCached,
  getCachedDrayageData,
  invalidateDrayageClientCache,
} from '@/lib/logistics/drayage-client-cache';

interface DrayageAlertItem {
  id: string;
  tenantId: string;
  type: 'DO_EXPIRY' | 'DEMURRAGE_CRITICAL' | 'DEMURRAGE_WARNING' | 'DETACHED_TRAILER' | 'PORT_TOKEN_PENDING';
  severity: 'URGENT' | 'CRITICAL' | 'WARNING';
  title: string;
  message: string;
  terminalName: string;
  containerId: string | null;
  containerNumber: string | null;
  jobId: string | null;
  jobCode: string | null;
  driverName: string | null;
  driverPhone: string | null;
  acknowledged: boolean;
  createdAt: string;
}

export default function DrayageNotificationsPage() {
  const cached = getCachedDrayageData();
  const [alerts, setAlerts] = useState<DrayageAlertItem[]>(cached?.alerts || []);
  const [loading, setLoading] = useState(!cached?.alerts);
  const [filterSeverity, setFilterSeverity] = useState<'ALL' | 'URGENT' | 'CRITICAL' | 'WARNING'>('ALL');
  const [selectedTerminal, setSelectedTerminal] = useState<string>('ALL');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const loadAlerts = useCallback(async (forceFresh = false) => {
    try {
      if (!getCachedDrayageData()?.alerts) {
        setLoading(true);
      }
      const data = await fetchDrayageWorkspaceCached({ forceFresh });
      setAlerts(data?.alerts || []);
    } catch (err) {
      if (!getCachedDrayageData()?.alerts) {
        showToast('error', err instanceof Error ? err.message : 'Failed to fetch alerts');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  const handleAcknowledge = async (alert: DrayageAlertItem) => {
    try {
      setActionLoadingId(alert.id);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'acknowledge_alert', alertKey: alert.id }),
      });
      if (!res.ok) throw new Error('Failed to acknowledge alert');
      showToast('success', 'Alert acknowledged and removed from active priority');
      invalidateDrayageClientCache();
      await loadAlerts(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error acknowledging alert');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleExtendDo = async (containerId: string) => {
    try {
      setActionLoadingId(containerId);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'extend_do', containerId, daysToAdd: 3 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to extend Delivery Order');
      showToast('success', 'Delivery Order extended by +3 days successfully!');
      invalidateDrayageClientCache();
      await loadAlerts(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error extending DO');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleTriggerL2 = async (jobId: string) => {
    try {
      setActionLoadingId(jobId);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'activate_l2', l1JobId: jobId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to activate L2 empty return');
      showToast('success', `L2 Empty Return job ${data.l2JobCode} activated!`);
      await loadAlerts();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error triggering L2');
    } finally {
      setActionLoadingId(null);
    }
  };

  const terminalsList = useMemo(() => {
    const set = new Set<string>();
    alerts.forEach((a) => {
      if (a.terminalName) set.add(a.terminalName);
    });
    return Array.from(set);
  }, [alerts]);

  const filteredAlerts = useMemo(() => {
    return alerts.filter((a) => {
      if (filterSeverity !== 'ALL' && a.severity !== filterSeverity) return false;
      if (selectedTerminal !== 'ALL' && a.terminalName !== selectedTerminal) return false;
      return true;
    });
  }, [alerts, filterSeverity, selectedTerminal]);

  const urgentCount = alerts.filter((a) => a.severity === 'URGENT' && !a.acknowledged).length;
  const criticalCount = alerts.filter((a) => a.severity === 'CRITICAL' && !a.acknowledged).length;
  const warningCount = alerts.filter((a) => a.severity === 'WARNING' && !a.acknowledged).length;

  return (
    <div className="space-y-6">
      {/* Toast Alert */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg text-xs font-semibold ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/90 border-rose-500/40 text-rose-200'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Page Header */}
      <PageHeader
        title="Drayage Notifications & Intelligent Command"
        subtitle="Automated alerts for Delivery Order (DO) expiries, ocean demurrage fines, and detached chassis awaiting return"
        icon={Bell}
        accent="rose"
        actions={
          <button
            onClick={() => loadAlerts(true)}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Alerts
          </button>
        }
      />

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Total Active Alerts"
          value={alerts.filter((a) => !a.acknowledged).length}
          icon={Bell}
          accent="blue"
          sub="Requires dispatcher action"
        />
        <KpiCard
          label="Urgent Action Required"
          value={urgentCount}
          icon={AlertTriangle}
          accent="rose"
          sub="DO expired or demurrage fine"
        />
        <KpiCard
          label="Critical Warnings"
          value={criticalCount}
          icon={AlertCircle}
          accent="amber"
          sub="Expiring within 24h"
        />
        <KpiCard
          label="Upcoming Free-Days"
          value={warningCount}
          icon={Clock}
          accent="cyan"
          sub="Free time expiring soon"
        />
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
        <div className="flex flex-wrap items-center gap-1.5">
          {(['ALL', 'URGENT', 'CRITICAL', 'WARNING'] as const).map((sev) => {
            const count =
              sev === 'ALL'
                ? alerts.length
                : sev === 'URGENT'
                ? urgentCount
                : sev === 'CRITICAL'
                ? criticalCount
                : warningCount;
            const active = filterSeverity === sev;
            return (
              <button
                key={sev}
                onClick={() => setFilterSeverity(sev)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                  active
                    ? 'bg-blue-600/15 border-blue-500/40 text-blue-400 font-bold'
                    : 'bg-[var(--bg-main)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                <span>{sev}</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {terminalsList.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-muted)] font-medium">Terminal:</span>
            <select
              value={selectedTerminal}
              onChange={(e) => setSelectedTerminal(e.target.value)}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
            >
              <option value="ALL">All Terminals</option>
              {terminalsList.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Alerts Feed */}
      <div className="space-y-3">
        {filteredAlerts.length === 0 ? (
          <Panel title="Command Alert Feed" icon={Bell} accent="blue">
            <div className="py-12 text-center text-xs text-[var(--text-muted)]">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2 opacity-80" />
              No active alerts matching your filter. All port free-days, delivery orders, and trailer returns are on schedule!
            </div>
          </Panel>
        ) : (
          filteredAlerts.map((alert) => {
            const isUrgent = alert.severity === 'URGENT';
            const isCritical = alert.severity === 'CRITICAL';
            return (
              <div
                key={alert.id}
                className={`p-4 rounded-xl border transition-all ${
                  alert.acknowledged
                    ? 'opacity-60 bg-[var(--bg-surface)] border-[var(--border-subtle)]'
                    : isUrgent
                    ? 'bg-rose-500/5 border-rose-500/30'
                    : isCritical
                    ? 'bg-amber-500/5 border-amber-500/30'
                    : 'bg-blue-500/5 border-blue-500/30'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                          isUrgent
                            ? 'bg-rose-500/15 border-rose-500/40 text-rose-400'
                            : isCritical
                            ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                            : 'bg-blue-500/15 border-blue-500/40 text-blue-400'
                        }`}
                      >
                        {alert.severity}
                      </span>
                      {alert.terminalName && (
                        <span className="text-[11px] text-[var(--text-muted)] flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> {alert.terminalName}
                        </span>
                      )}
                      {alert.containerNumber && (
                        <span className="font-mono text-xs font-bold text-[var(--text-main)]">
                          {alert.containerNumber}
                        </span>
                      )}
                      {alert.jobCode && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--bg-main)] text-[var(--text-muted)] border border-[var(--border-subtle)]">
                          {alert.jobCode}
                        </span>
                      )}
                    </div>

                    <h3 className="text-sm font-bold text-[var(--text-main)]">{alert.title}</h3>
                    <p className="text-xs text-[var(--text-muted)] leading-relaxed max-w-4xl">{alert.message}</p>

                    {alert.driverName && (
                      <div className="text-[11px] text-[var(--text-muted)] pt-1 flex items-center gap-3">
                        <span>
                          Driver: <strong className="text-[var(--text-main)]">{alert.driverName}</strong>
                        </span>
                        {alert.driverPhone && (
                          <a
                            href={`tel:${alert.driverPhone}`}
                            className="inline-flex items-center gap-1 text-blue-400 hover:underline font-mono"
                          >
                            <Phone className="w-3 h-3" /> {alert.driverPhone}
                          </a>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions Button Group */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {alert.type === 'DO_EXPIRY' && alert.containerId && (
                      <button
                        onClick={() => handleExtendDo(alert.containerId as string)}
                        disabled={actionLoadingId === alert.containerId}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-600/25 text-xs font-semibold transition-colors"
                      >
                        <Calendar className="w-3.5 h-3.5" />
                        Extend DO (+3 Days)
                      </button>
                    )}

                    {alert.type === 'DETACHED_TRAILER' && alert.jobId && (
                      <button
                        onClick={() => handleTriggerL2(alert.jobId as string)}
                        disabled={actionLoadingId === alert.jobId}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-600/15 border border-amber-500/30 text-amber-400 hover:bg-amber-600/25 text-xs font-semibold transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Trigger L2 Return
                      </button>
                    )}

                    <Link
                      href="/logistics/drayage/tracking"
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] text-xs font-medium transition-colors"
                    >
                      Track Job
                    </Link>

                    {!alert.acknowledged && (
                      <button
                        onClick={() => handleAcknowledge(alert)}
                        disabled={actionLoadingId === alert.id}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-emerald-400 hover:border-emerald-500/30 text-xs font-semibold transition-colors"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Acknowledge
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
