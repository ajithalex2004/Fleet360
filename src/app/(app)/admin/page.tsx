'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Settings, Activity, Zap, CheckCircle2, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import { useFetchedData } from '@/hooks/useFetchedData';
import { usePermissions } from '@/contexts/PermissionContext';
import { DrayageSuperAdminConfigModal } from '@/components/logistics/drayage/DrayageSuperAdminConfigModal';
import {
  DEFAULT_DRAYAGE_AUTOMATION_CONFIG,
  type DrayageAutomationConfig,
} from '@/lib/logistics/drayage-domain';
import { invalidateDrayageClientCache } from '@/lib/logistics/drayage-client-cache';

type Tenant = { id: string };
type User   = { id: string };
type Role   = { id: string };
type Perm   = { id: string };

export default function AdminOverview() {
  const { user, tenant } = usePermissions();
  const isSuperAdmin = user?.roleCode === 'SUPER_ADMIN';
  const navPerms = tenant?.navPermissions ?? {};
  // Session-scoped fetch cache: 1st visit hits the server (fast — Data Cache
  // + CDN s-maxage), 2nd visit in the same tab is instant from the Map cache.
  const tenants     = useFetchedData<Tenant[]>(isSuperAdmin ? '/api/admin/tenants' : null);
  const users       = useFetchedData<User[]>(  '/api/admin/users');
  const roles       = useFetchedData<Role[]>(  '/api/admin/roles');
  const permissions = useFetchedData<Perm[]>(  '/api/admin/permissions');

  // Super Admin Drayage Engine Config State
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [automationConfig, setAutomationConfig] = useState<DrayageAutomationConfig>(DEFAULT_DRAYAGE_AUTOMATION_CONFIG);
  const [autoL2DispatchEnabled, setAutoL2DispatchEnabled] = useState<boolean>(true);
  const [togglingAutoL2, setTogglingAutoL2] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    if (!isSuperAdmin) return;
    fetch('/api/logistics/drayage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_automation_config' }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.automationConfig) {
          setAutomationConfig({
            ...DEFAULT_DRAYAGE_AUTOMATION_CONFIG,
            ...data.automationConfig,
          });
          if (typeof data.automationConfig.autoL2DispatchEnabled === 'boolean') {
            setAutoL2DispatchEnabled(data.automationConfig.autoL2DispatchEnabled);
          }
        }
      })
      .catch(() => {});
  }, [isSuperAdmin]);

  const handleToggleAutoL2Mode = async (enabled: boolean) => {
    try {
      setTogglingAutoL2(true);
      setAutoL2DispatchEnabled(enabled);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'toggle_auto_l2_mode',
          enabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update L2 dispatch mode');
      invalidateDrayageClientCache();
      showToast(
        'success',
        enabled
          ? `⚡ Switched to Auto-L2 Dispatch & 4-Factor Pre-Assignment (Triggers @ T-${automationConfig.thresholdMinutes || 30}m before Offload ETC)`
          : '🛠️ Switched to Manual L2 Dispatch Mode (Dispatcher triggers L2 manually)',
      );
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error toggling L2 dispatch mode');
    } finally {
      setTogglingAutoL2(false);
    }
  };

  const stats = {
    tenants:     tenants.data?.length     ?? 0,
    users:       users.data?.length       ?? 0,
    roles:       roles.data?.length       ?? 0,
    permissions: permissions.data?.length  ?? 0,
  };

  const cards = [
    ...(isSuperAdmin ? [{ label: 'Tenants', value: stats.tenants, color: 'from-blue-500 to-indigo-600', href: '/admin/tenants' }] : []),
    { label: 'Users',       value: stats.users,       color: 'from-violet-500 to-purple-600', href: '/admin/users' },
    { label: 'Roles',       value: stats.roles,       color: 'from-emerald-500 to-teal-600',  href: '/admin/roles' },
    { label: 'Permissions', value: stats.permissions, color: 'from-amber-500 to-orange-600',  href: '/admin/roles' },
  ];

  return (
    <div className="space-y-6">
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

      <PageHeader
        title="Platform Administration"
        subtitle="Multi-tenant access control for Fleet360"
        icon={Settings}
        accent="rose"
        actions={
          isSuperAdmin ? (
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="flex items-center rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-0.5 text-xs shadow-sm"
                title="Super Admin Dispatch Automation Mode: Switch between Manual L2 Dispatch and Automatic L2 Dispatch + 4-Factor Pre-Assignment at T-30 mins before Offloading ETC"
              >
                <button
                  type="button"
                  disabled={togglingAutoL2}
                  onClick={() => handleToggleAutoL2Mode(false)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-semibold transition-all ${
                    !autoL2DispatchEnabled
                      ? 'bg-slate-700 text-white shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                  }`}
                >
                  Manual L2
                </button>
                <button
                  type="button"
                  disabled={togglingAutoL2}
                  onClick={() => handleToggleAutoL2Mode(true)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-bold transition-all ${
                    autoL2DispatchEnabled
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                  }`}
                >
                  <Zap className="w-3.5 h-3.5 fill-current" />
                  Auto-L2 @ T-{automationConfig.thresholdMinutes || 30}m
                </button>
              </div>

              <button
                type="button"
                onClick={() => setConfigModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-slate-800 border border-slate-700 text-xs font-bold text-white hover:bg-slate-800 transition-colors shadow-sm"
                title="Open Super Admin Drayage Engine Configuration (4-Factor Weights, T-30m Timer, Street-Turn Radius, Demurrage Thresholds)"
              >
                <Settings className="w-3.5 h-3.5 text-sky-400" />
                Engine Config
              </button>
            </div>
          ) : undefined
        }
      />

      {/* Stats — instant on re-visit, fast first paint via Data Cache + CDN */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(c => (
          <Link key={c.label} href={c.href}
            className={`rounded-2xl bg-gradient-to-br ${c.color} p-6 hover:opacity-90 transition-all`}>
            <div className="text-4xl font-bold text-white">{c.value}</div>
            <div className="text-sm text-white/80 mt-1">{c.label}</div>
          </Link>
        ))}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { title: 'Customers & Consignors', desc: 'Customer directory, consignors, and 3-tier organizational hierarchy mappings', href: '/customer-mgmt', color: 'border-emerald-500/30 hover:border-emerald-500/50', show: true },
          { title: 'Vendors, Partners & Garages', desc: 'Exchange partners, outsource transporters, scorecards, and maintenance garages', href: '/vendors', color: 'border-cyan-500/30 hover:border-cyan-500/50', show: true },
          { title: 'Region, Dept & Section', desc: 'Manage 3-tier organizational hierarchy (Region ➔ Department ➔ Section / Unit)', href: '/admin/hierarchy', color: 'border-blue-500/30 hover:border-blue-500/50', show: isSuperAdmin || navPerms['hierarchy'] !== false },
          { title: 'NUI Reason Master', desc: 'Non-utilization and operational reasons for transfers, maintenance, and allocations', href: '/admin/nui-reasons', color: 'border-amber-500/30 hover:border-amber-500/50', show: isSuperAdmin || navPerms['nui-reasons'] !== false },
          { title: 'Corporate Clients & Rosters', desc: 'Manage B2B client accounts, authorized email domains, and coordinator rosters', href: '/admin/corporate-clients', color: 'border-orange-500/30 hover:border-orange-500/50', show: isSuperAdmin },
          { title: 'Manage Tenants', desc: 'Create organisations, enable/disable modules per tenant', href: '/admin/tenants', color: 'border-blue-500/30 hover:border-blue-500/50', show: isSuperAdmin },
          { title: 'Roles & Permission Matrix', desc: 'Configure roles and grant granular permissions per module and action', href: '/admin/roles', color: 'border-emerald-500/30 hover:border-emerald-500/50', show: true },
          { title: 'User Management', desc: 'Assign users to tenants with specific roles', href: '/admin/users', color: 'border-violet-500/30 hover:border-violet-500/50', show: true },
        ].filter(item => item.show).map(item => (
          <Link key={item.href} href={item.href}
            className={`block p-6 rounded-2xl bg-[var(--bg-surface)]/50 border ${item.color} transition-all`}>
            <h3 className="text-[var(--text-main)] font-semibold mb-2">{item.title}</h3>
            <p className="text-[var(--text-muted)] text-sm">{item.desc}</p>
          </Link>
        ))}
      </div>

      {/* System Diagnostics & Operations (Super Admin Only) */}
      {isSuperAdmin && (
      <div className="rounded-2xl bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-400" />
            <h2 className="text-base font-semibold text-[var(--text-main)]">System Health & Diagnostic Monitors</h2>
          </div>
          <Link href="/admin/health" className="text-xs font-semibold text-blue-400 hover:text-blue-300">
            Open Health Monitor &rarr;
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Link href="/admin/health" className="p-4 rounded-xl bg-[var(--bg-surface-hover)]/40 border border-[var(--border-subtle)] hover:border-blue-500/40 transition-all">
            <div className="text-sm font-semibold text-[var(--text-main)]">System Health Check</div>
            <div className="text-xs text-[var(--text-muted)] mt-1">Live DB ping, storage durability, integrations & microservices</div>
          </Link>
          <Link href="/admin/health?tab=platform-info" className="p-4 rounded-xl bg-[var(--bg-surface-hover)]/40 border border-[var(--border-subtle)] hover:border-blue-500/40 transition-all">
            <div className="text-sm font-semibold text-[var(--text-main)]">Platform Info</div>
            <div className="text-xs text-[var(--text-muted)] mt-1">Upstash Redis, module catalog, DB models & route counts</div>
          </Link>
          <Link href="/admin/health?tab=schema-status" className="p-4 rounded-xl bg-[var(--bg-surface-hover)]/40 border border-[var(--border-subtle)] hover:border-blue-500/40 transition-all">
            <div className="text-sm font-semibold text-[var(--text-main)]">Schema Status</div>
            <div className="text-xs text-[var(--text-muted)] mt-1">Runtime table and column completeness across modules</div>
          </Link>
          <Link href="/admin/health?tab=job-runs" className="p-4 rounded-xl bg-[var(--bg-surface-hover)]/40 border border-[var(--border-subtle)] hover:border-blue-500/40 transition-all">
            <div className="text-sm font-semibold text-[var(--text-main)]">Background Job Runs</div>
            <div className="text-xs text-[var(--text-muted)] mt-1">Cron worker execution logs, durations and failure traces</div>
          </Link>
        </div>
      </div>
      )}

      {isSuperAdmin && (
        <DrayageSuperAdminConfigModal
          open={configModalOpen}
          onClose={() => setConfigModalOpen(false)}
          config={automationConfig}
          onSaved={(updated) => {
            setAutomationConfig(updated);
            setAutoL2DispatchEnabled(updated.autoL2DispatchEnabled);
            invalidateDrayageClientCache();
            showToast(
              'success',
              `⚙️ Drayage Policy Updated: Auto-L2 @ T-${updated.thresholdMinutes}m · Street-Turn ≤${updated.streetTurnRadiusKm}km · Weights ${updated.weightProximityPct}/${updated.weightIdlenessPct}/${updated.weightWorkloadPct}/${updated.weightAvailabilityPct}%`,
            );
          }}
        />
      )}
    </div>
  );
}
