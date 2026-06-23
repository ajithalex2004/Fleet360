'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import PlatformHomeBar from '@/components/PlatformHomeBar';
import { useLanguage } from '@/contexts/LanguageContext';
import ModuleGuard from '@/components/ModuleGuard';

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { href: '/leasing', label: 'Dashboard', icon: '📊' },
      { href: '/leasing/analytics', label: 'Analytics & BI', icon: '📈' },
    ],
  },
  {
    label: 'Sales Lifecycle',
    items: [
      { href: '/leasing/inquiries', label: 'Inquiries', icon: '📩' },
      { href: '/leasing/quotations/copilot', label: 'AI Co-pilot', icon: '✨' },
      { href: '/leasing/quotations', label: 'Quotations', icon: '💬' },
      { href: '/leasing/contracts-v2', label: 'Agreements', icon: '📜' },
      { href: '/leasing/contracts-v2/qa', label: 'Contract Q&A (AI)', icon: '💬' },
      { href: '/leasing/renewals', label: 'Renewals', icon: '🔄' },
      { href: '/leasing/early-terminations', label: 'Early Termination', icon: '🚫' },
    ],
  },
  {
    label: 'Fleet & Compliance',
    items: [
      { href: '/leasing/insurance', label: 'Insurance Status', icon: '🛡️' },
      { href: '/leasing/drivers', label: 'Driver Assignments', icon: '🤵' },
      { href: '/leasing/documents', label: 'Documents', icon: '📄' },
      { href: '/leasing/amendments', label: 'Amendments', icon: '📝' },
      { href: '/leasing/handover', label: 'Handover & Return', icon: '🚗' },
      { href: '/leasing/vehicle-exchange', label: 'Vehicle Exchange', icon: '🔁' },
      { href: '/leasing/transfers', label: 'Vehicle Transfers', icon: '🔀' },
      { href: '/leasing/returns', label: 'Vehicle Returns', icon: '↩️' },
    ],
  },
  {
    label: 'Customer',
    items: [
      { href: '/leasing/lessees', label: 'Lessees', icon: '👥' },
      { href: '/leasing/credit-assessments', label: 'Credit Assessment', icon: '🏅' },
    ],
  },
  {
    label: 'Management',
    items: [
      { href: '/leasing/workflow', label: 'Workflow & Approvals', icon: '✅' },
      { href: '/leasing/alerts', label: 'Expiry Alerts', icon: '🚨' },
      { href: '/leasing/branches', label: 'Branches', icon: '🏢' },
      { href: '/leasing/staff', label: 'Staff Management', icon: '👔' },
      { href: '/leasing/field', label: 'Field App (mobile)', icon: '📲' },
    ],
  },
];

type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED' | string;

interface LeasingApprovalSidebarStep {
  id: string;
  status?: ApprovalStatus | null;
  dueAt?: string | null;
  escalationAt?: string | null;
  runtimeActionId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  serviceTypeKey?: string | null;
}

function inferSidebarSlaTone(step: LeasingApprovalSidebarStep): 'on_track' | 'due_soon' | 'overdue' | 'escalated' {
  const now = Date.now();
  const escalationAt = step.escalationAt ? new Date(step.escalationAt).getTime() : null;
  const dueAt = step.dueAt ? new Date(step.dueAt).getTime() : null;
  if (escalationAt && now >= escalationAt) return 'escalated';
  if (dueAt && now >= dueAt) return 'overdue';
  if (dueAt && dueAt - now <= 4 * 3600000) return 'due_soon';
  return 'on_track';
}

function buildSidebarActionKey(step: LeasingApprovalSidebarStep) {
  return step.runtimeActionId ?? `${step.entityType ?? 'UNKNOWN'}:${step.entityId ?? step.id}:${step.serviceTypeKey ?? 'GENERAL'}`;
}

export default function LeasingLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { tLabel, t } = useLanguage();
  const [approvalSteps, setApprovalSteps] = useState<LeasingApprovalSidebarStep[]>([]);

  const isActive = (href: string) =>
    href === '/leasing' ? pathname === '/leasing' : pathname.startsWith(href);

  useEffect(() => {
    let mounted = true;

    const loadSidebarApprovalHealth = async () => {
      try {
        const response = await fetch('/api/leasing/approval-steps', { cache: 'no-store' });
        const data = await response.json().catch(() => []);
        if (!mounted) return;
        setApprovalSteps(Array.isArray(data) ? data : []);
      } catch {
        if (mounted) setApprovalSteps([]);
      }
    };

    void loadSidebarApprovalHealth();
    const interval = window.setInterval(() => { void loadSidebarApprovalHealth(); }, 60000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  const workflowApprovalBadge = useMemo(() => {
    const grouped = new Map<string, LeasingApprovalSidebarStep[]>();
    approvalSteps.forEach(step => {
      const list = grouped.get(buildSidebarActionKey(step)) ?? [];
      list.push(step);
      grouped.set(buildSidebarActionKey(step), list);
    });

    let overdue = 0;
    let escalated = 0;

    grouped.forEach(group => {
      const pending = group
        .filter(step => (step.status ?? 'PENDING') === 'PENDING')
        .sort((a, b) => {
          const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
          const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
          return aDue - bDue;
        })[0];
      if (!pending) return;
      const tone = inferSidebarSlaTone(pending);
      if (tone === 'escalated') escalated += 1;
      else if (tone === 'overdue') overdue += 1;
    });

    const total = escalated + overdue;
    if (total === 0) return null;
    return {
      total,
      tone: escalated > 0 ? 'escalated' : 'overdue',
      label: escalated > 0 ? `${escalated} escalated${overdue > 0 ? ` · ${overdue} overdue` : ''}` : `${overdue} overdue`,
    };
  }, [approvalSteps]);

  if (pathname?.startsWith('/leasing/field')) {
    return <>{children}</>;
  }

  return (
    <ModuleGuard moduleId="leasing" moduleName="Vehicle Leasing" moduleIcon="📋">
      <div className="flex h-screen flex-col bg-slate-900">
        <PlatformHomeBar moduleName={t('module.leasing')} moduleIcon="VL" accentColor="from-violet-500 to-purple-600" />
        <div className="flex flex-1 overflow-hidden">
          <div className="w-64 flex-shrink-0 overflow-y-auto border-r border-white/10 bg-black p-4">
            <h2 className="mb-4 px-2 text-base font-bold text-white">{t('module.leasing')}</h2>
            <nav className="space-y-5">
              {NAV_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {tLabel(group.label)}
                  </p>
                  <div className="space-y-0.5">
                    {group.items.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-all ${
                          isActive(item.href)
                            ? 'bg-gradient-to-r from-violet-600 to-purple-600 font-medium text-white shadow-sm'
                            : 'text-slate-300 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        <span className="text-base leading-none">{item.icon}</span>
                        <span className="min-w-0 flex-1">{tLabel(item.label)}</span>
                        {item.href === '/leasing/workflow' && workflowApprovalBadge && (
                          <span
                            title={workflowApprovalBadge.label}
                            className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                              workflowApprovalBadge.tone === 'escalated'
                                ? 'bg-orange-500 text-white'
                                : 'bg-rose-500 text-white'
                            }`}
                          >
                            {workflowApprovalBadge.total}
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </nav>

            <div className="mx-2 mt-6 rounded-xl border border-violet-500/20 bg-violet-900/40 p-3">
              <p className="text-xs font-bold text-violet-400">Smart Mobility - {t('module.leasing')}</p>
              <p className="mt-0.5 text-xs text-slate-500">{tLabel('Contracts · Fleet · Operations')}</p>
            </div>
          </div>

          <main className="flex-1 overflow-y-auto bg-slate-950 p-8 text-white">
            <div className="mx-auto max-w-7xl">{children}</div>
          </main>
        </div>
      </div>
    </ModuleGuard>
  );
}
