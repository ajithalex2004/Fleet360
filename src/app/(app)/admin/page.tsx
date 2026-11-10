'use client';
import React from 'react';
import Link from 'next/link';
import { Settings, Activity } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import { useFetchedData } from '@/hooks/useFetchedData';
import { usePermissions } from '@/contexts/PermissionContext';

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
      <PageHeader
        title="Platform Administration"
        subtitle="Multi-tenant access control for Fleet360"
        icon={Settings}
        accent="rose"
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
          { title: 'Departments', desc: 'Manage company departments used for user memberships and module access', href: '/admin/departments', color: 'border-indigo-500/30 hover:border-indigo-500/50', show: isSuperAdmin || navPerms['departments'] !== false },
          { title: 'Branches & Regions', desc: 'Manage operational hubs, branch depots, and regional offices', href: '/admin/branches', color: 'border-blue-500/30 hover:border-blue-500/50', show: isSuperAdmin || navPerms['branches'] !== false },
          { title: 'Manage Tenants', desc: 'Create organisations, enable/disable modules per tenant', href: '/admin/tenants', color: 'border-blue-500/30 hover:border-blue-500/50', show: isSuperAdmin },
          { title: 'Roles & Permission Matrix', desc: 'Configure roles and grant granular permissions per module and action', href: '/admin/roles', color: 'border-emerald-500/30 hover:border-emerald-500/50', show: true },
          { title: 'User Management', desc: 'Assign users to tenants with specific roles', href: '/admin/users', color: 'border-violet-500/30 hover:border-violet-500/50', show: true },
          { title: 'Audit Log', desc: 'Inspect security events, administrative actions, and change history', href: '/admin/audit-logs', color: 'border-amber-500/30 hover:border-amber-500/50', show: isSuperAdmin || navPerms['audit-logs'] !== false },
          { title: 'Subscription & Plan', desc: 'View plan quotas, active user/vehicle usage, and billing status', href: '/admin/subscription', color: 'border-indigo-500/30 hover:border-indigo-500/50', show: !isSuperAdmin && navPerms['billing'] !== false },
          ...(tenant?.id ? [
            { title: 'User Invitations', desc: 'Invite new team members by email and manage pending onboarding links', href: `/admin/tenants/${tenant.id}/invitations`, color: 'border-emerald-500/30 hover:border-emerald-500/50', show: true },
            { title: 'Single Sign-On (OIDC)', desc: 'Configure Okta, Entra ID, or Google Workspace SSO for your company', href: `/admin/tenants/${tenant.id}/sso`, color: 'border-violet-500/30 hover:border-violet-500/50', show: true },
            { title: 'API Keys & Integrations', desc: 'Manage tenant API keys, scopes, and programmatic access limits', href: `/admin/tenants/${tenant.id}/api-keys`, color: 'border-amber-500/30 hover:border-amber-500/50', show: true },
            { title: 'White-Label Branding', desc: 'Upload company logo and configure primary/accent portal colours', href: `/admin/tenants/${tenant.id}/branding`, color: 'border-pink-500/30 hover:border-pink-500/50', show: true },
            { title: 'Ticket Types & SLAs', desc: 'Customise service-ticket categories, priority levels, and SLA targets', href: `/admin/tenants/${tenant.id}/ticket-types`, color: 'border-cyan-500/30 hover:border-cyan-500/50', show: true },
            { title: 'Security & Dispatch Policy', desc: 'Enforce MFA, session idle timeouts, IP allowlists, and dispatch rules', href: `/admin/tenants/${tenant.id}/settings`, color: 'border-blue-500/30 hover:border-blue-500/50', show: true },
          ] : []),
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
    </div>
  );
}
