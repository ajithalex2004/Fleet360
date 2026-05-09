'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';

export default function AdminOverview() {
  const [stats, setStats] = useState({ tenants: 0, users: 0, roles: 0, permissions: 0 });
  const [leasingSeeding, setLeasingSeeding] = useState(false);
  const [leasingMsg, setLeasingMsg] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/tenants').then(r => r.json()).catch(() => []),
      fetch('/api/admin/users').then(r => r.json()).catch(() => []),
      fetch('/api/admin/roles').then(r => r.json()).catch(() => []),
      fetch('/api/admin/permissions').then(r => r.json()).catch(() => []),
    ]).then(([t, u, r, p]) => {
      setStats({
        tenants:     Array.isArray(t) ? t.length : 0,
        users:       Array.isArray(u) ? u.length : 0,
        roles:       Array.isArray(r) ? r.length : 0,
        permissions: Array.isArray(p) ? p.length : 0,
      });
    });
  }, []);

  const handleLeasingSeed = async () => {
    setLeasingSeeding(true); setLeasingMsg('');
    try {
      const res = await fetch('/api/admin/seed/leasing', { method: 'POST' });
      const data = await res.json();
      setLeasingMsg(res.ok
        ? data.message
        : `Error: ${data.error}`);
    } catch { setLeasingMsg('Seed failed'); }
    finally { setLeasingSeeding(false); }
  };

  const cards = [
    { label: 'Tenants',     value: stats.tenants,     color: 'from-blue-500 to-indigo-600',   href: '/admin/tenants' },
    { label: 'Users',       value: stats.users,       color: 'from-violet-500 to-purple-600', href: '/admin/users' },
    { label: 'Roles',       value: stats.roles,       color: 'from-emerald-500 to-teal-600',  href: '/admin/roles' },
    { label: 'Permissions', value: stats.permissions, color: 'from-amber-500 to-orange-600',  href: '/admin/roles' },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Platform Administration</h1>
        <p className="text-slate-400">Multi-tenant access control for Fleet360</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(c => (
          <Link key={c.label} href={c.href}
            className={`rounded-2xl bg-gradient-to-br ${c.color} p-6 hover:opacity-90 transition-all`}>
            <div className="text-4xl font-bold text-white">{c.value}</div>
            <div className="text-sm text-white/80 mt-1">{c.label}</div>
          </Link>
        ))}
      </div>

      {/* Leasing UAE Seed */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-white mb-2">UAE Vehicle Leasing Demo Data</h2>
        <p className="text-slate-400 text-sm mb-4">
          Seeds realistic UAE demo data across all Vehicle Leasing modules:
          7 corporate customers (Emaar, ADNOC, SLB, DP World, Etisalat, GFH, EXL Solutions),
          linked lessees, 5 lease contracts, payment schedules, traffic fines, fuel logs,
          insurance policies, mileage readings, receipts, renewals and credit assessments.
          Also creates the Region/Department/Unit hierarchy for UAE.
        </p>
        <button onClick={handleLeasingSeed} disabled={leasingSeeding}
          className="px-6 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white font-medium hover:opacity-90 disabled:opacity-50">
          {leasingSeeding ? 'Seeding UAE Data...' : 'Seed UAE Leasing Demo Data'}
        </button>
        {leasingMsg && (
          <p className={`mt-3 text-sm ${leasingMsg.includes('Error') || leasingMsg.includes('failed') ? 'text-rose-400' : 'text-emerald-400'}`}>
            {leasingMsg}
          </p>
        )}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
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
