'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Clock3, Database, KeyRound, Settings, Shield, Users } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';

type StatKey = 'tenants' | 'users' | 'roles' | 'permissions';
type Stats = Record<StatKey, number>;

async function loadJson(path: string) {
  const res = await fetch(path, { cache: 'no-store' });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || data?.error || `Failed to load ${path}`);
  return data;
}

interface OverviewPayload {
  stats: Stats & {
    pendingApprovals: number;
    failedLogins24h: number;
  };
  scope: {
    roleCode: string;
    isSuperAdmin: boolean;
  };
  operational: {
    generatedAt: string;
    queryMs: number;
    cache: 'hit' | 'miss';
  };
}

export default function AdminOverview() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats>({ tenants: 0, users: 0, roles: 0, permissions: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [roleCode, setRoleCode] = useState('');
  const [ops, setOps] = useState<OverviewPayload['operational'] | null>(null);
  const [riskStats, setRiskStats] = useState({ pendingApprovals: 0, failedLogins24h: 0 });
  const [leasingSeeding, setLeasingSeeding] = useState(false);
  const [leasingMsg, setLeasingMsg] = useState('');

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError('');
    loadJson('/api/admin/overview').then((payload: OverviewPayload) => {
      if (!mounted) return;
      setRoleCode(payload.scope.roleCode);
      setStats({
        tenants: payload.stats.tenants,
        users: payload.stats.users,
        roles: payload.stats.roles,
        permissions: payload.stats.permissions,
      });
      setRiskStats({
        pendingApprovals: payload.stats.pendingApprovals,
        failedLogins24h: payload.stats.failedLogins24h,
      });
      setOps(payload.operational);
    }).catch(err => {
      if (!mounted) return;
      setError(err instanceof Error ? err.message : 'Failed to load admin overview');
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
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
    { key: 'tenants' as const, label: 'Tenants', value: stats.tenants, icon: Database, color: 'from-blue-600 to-indigo-700', href: '/admin/tenants' },
    { key: 'users' as const, label: 'Users', value: stats.users, icon: Users, color: 'from-violet-600 to-purple-700', href: '/admin/users' },
    { key: 'roles' as const, label: 'Roles', value: stats.roles, icon: Shield, color: 'from-emerald-600 to-teal-700', href: '/admin/roles' },
    { key: 'permissions' as const, label: 'Permissions', value: stats.permissions, icon: KeyRound, color: 'from-amber-600 to-orange-700', href: '/admin/roles' },
  ];
  const canSeedLeasing = roleCode === 'SUPER_ADMIN';
  const navigate = (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    event.preventDefault();
    router.push(href);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform Administration"
        subtitle="Multi-tenant access control for Fleet360"
        icon={Settings}
        accent="rose"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-300 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-emerald-100">Admin control plane online</div>
            <div className="text-xs text-emerald-200/70">
              {loading ? 'Checking live status...' : `Snapshot ${ops?.cache === 'hit' ? 'served from cache' : 'refreshed'} in ${ops?.queryMs ?? 0} ms`}
            </div>
          </div>
        </div>
        <Link href="/admin/approvals" onClick={(event) => navigate(event, '/admin/approvals')} className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 flex items-center gap-3 hover:bg-amber-500/15">
          <Clock3 className="w-5 h-5 text-amber-300 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-amber-100">{loading ? '...' : riskStats.pendingApprovals} pending approval(s)</div>
            <div className="text-xs text-amber-200/70">Dangerous admin changes waiting for review</div>
          </div>
        </Link>
        <Link href="/admin/security" onClick={(event) => navigate(event, '/admin/security')} className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 flex items-center gap-3 hover:bg-rose-500/15">
          <AlertTriangle className="w-5 h-5 text-rose-300 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-rose-100">{loading ? '...' : riskStats.failedLogins24h} failed login(s)</div>
            <div className="text-xs text-rose-200/70">Authentication failures in the last 24 hours</div>
          </div>
        </Link>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(c => {
          const Icon = c.icon;
          return (
          <Link key={c.key} href={c.href} onClick={(event) => navigate(event, c.href)} data-testid={`overview-card-${c.key}`} aria-label={`${c.label}: ${c.value}`}
            className={`rounded-2xl bg-gradient-to-br ${c.color} p-5 hover:opacity-90 transition-all min-h-[132px] flex flex-col justify-between`}>
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-white/80">{c.label}</div>
              <Icon className="w-5 h-5 text-white/75" />
            </div>
            <div className="text-4xl font-bold text-white" aria-busy={loading}>
              {loading ? <span className="inline-block h-10 w-16 rounded-lg bg-white/20 animate-pulse" /> : c.value}
            </div>
          </Link>
          );
        })}
      </div>

      {/* Leasing UAE Seed */}
      {canSeedLeasing && <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
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
      </div>}

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { title: 'Manage Tenants', desc: 'Create organisations, enable/disable modules per tenant', href: '/admin/tenants', color: 'border-blue-500/30 hover:border-blue-500/50' },
          { title: 'Roles & Permission Matrix', desc: 'Configure roles and grant granular permissions per module and action', href: '/admin/roles', color: 'border-emerald-500/30 hover:border-emerald-500/50' },
          { title: 'User Management', desc: 'Assign users to tenants with specific roles', href: '/admin/users', color: 'border-violet-500/30 hover:border-violet-500/50' },
        ].map(item => (
          <Link key={item.href} href={item.href} onClick={(event) => navigate(event, item.href)}
            className={`block p-6 rounded-2xl bg-slate-800/50 border ${item.color} transition-all`}>
            <h3 className="text-white font-semibold mb-2">{item.title}</h3>
            <p className="text-slate-400 text-sm">{item.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
