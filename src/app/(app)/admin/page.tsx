'use client';
import React from 'react';
import Link from 'next/link';
import { Settings } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import { useFetchedData } from '@/hooks/useFetchedData';

type Tenant = { id: string };
type User   = { id: string };
type Role   = { id: string };
type Perm   = { id: string };

export default function AdminOverview() {
  // Session-scoped fetch cache: 1st visit hits the server (fast — Data Cache
  // + CDN s-maxage), 2nd visit in the same tab is instant from the Map cache.
  const tenants     = useFetchedData<Tenant[]>('/api/admin/tenants');
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
    { label: 'Tenants',     value: stats.tenants,     color: 'from-blue-500 to-indigo-600',   href: '/admin/tenants' },
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
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { title: 'Corporate Clients & Rosters', desc: 'Manage B2B client accounts, authorized email domains, and coordinator rosters', href: '/admin/corporate-clients', color: 'border-orange-500/30 hover:border-orange-500/50' },
          { title: 'Manage Tenants', desc: 'Create organisations, enable/disable modules per tenant', href: '/admin/tenants', color: 'border-blue-500/30 hover:border-blue-500/50' },
          { title: 'Roles & Permission Matrix', desc: 'Configure roles and grant granular permissions per module and action', href: '/admin/roles', color: 'border-emerald-500/30 hover:border-emerald-500/50' },
          { title: 'User Management', desc: 'Assign users to tenants with specific roles', href: '/admin/users', color: 'border-violet-500/30 hover:border-violet-500/50' },
        ].map(item => (
          <Link key={item.href} href={item.href}
            className={`block p-6 rounded-2xl bg-slate-800/50 border ${item.color} transition-all`}>
            <h3 className="text-white font-semibold mb-2">{item.title}</h3>
            <p className="text-slate-400 text-sm">{item.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
