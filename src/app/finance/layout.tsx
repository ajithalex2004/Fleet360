'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import PlatformHomeBar from '@/components/PlatformHomeBar';
import { useLanguage } from '@/contexts/LanguageContext';

import ModuleGuard from '@/components/ModuleGuard';
const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { href: '/finance',             label: 'Dashboard',           icon: '📊' },
    ],
  },
  {
    label: 'Receivables',
    items: [
      { href: '/finance/invoices',             label: 'Invoices',              icon: '🧾' },
      { href: '/finance/invoices?module=SCHOOL_BUS', label: 'School Bus Fees', icon: '🏫' },
      { href: '/finance/recurring-invoices',   label: 'Recurring Invoices',    icon: '🔁' },
      { href: '/finance/payments',             label: 'Payments',              icon: '💳' },
      { href: '/finance/credit-notes',         label: 'Credit Notes',          icon: '📝' },
      { href: '/finance/ar-aging',             label: 'AR Aging Report',        icon: '📊' },
      { href: '/finance/collections',          label: 'Collections & Dunning', icon: '📞' },
      { href: '/finance/payment-reminders',    label: 'Payment Reminders',     icon: '🔔' },
    ],
  },
  {
    label: 'UAE Compliance',
    items: [
      { href: '/finance/pdc',         label: 'PDC Register',        icon: '📋' },
      { href: '/finance/tax',         label: 'Tax Engine',          icon: '🏛️' },
      { href: '/finance/vat',         label: 'VAT Returns',         icon: '📤' },
      { href: '/finance/vat-branch',  label: 'VAT by Branch',       icon: '🏢' },
    ],
  },
  {
    label: 'Multi-Branch',
    items: [
      { href: '/finance/branch-pl',   label: 'Branch P&L',          icon: '📊' },
      { href: '/finance/vat-branch',  label: 'VAT Consolidation',   icon: '🇦🇪' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/finance/deposits',             label: 'Security Deposits',   icon: '🔒' },
      { href: '/finance/expenses',             label: 'Expense Management',  icon: '⛽' },
      { href: '/finance/bank-reconciliation',  label: 'Bank Reconciliation', icon: '🏦' },
      { href: '/finance/budgets',              label: 'Budget vs Actual',    icon: '📈' },
    ],
  },
  {
    label: 'Accounting',
    items: [
      { href: '/finance/coa',             label: 'Chart of Accounts', icon: '🗂️' },
      { href: '/finance/journal-entries', label: 'Journal Entries',   icon: '📒' },
      { href: '/finance/general-ledger',  label: 'General Ledger',    icon: '⚖️' },
      { href: '/finance/fixed-assets',    label: 'Fixed Assets',      icon: '🏗️' },
    ],
  },
  {
    label: 'Management Accounts',
    items: [
      { href: '/finance/management-accounts',          label: 'Income Statement (P&L)', icon: '📈' },
      { href: '/finance/management-accounts?tab=cf',   label: 'Cash Flow Statement',    icon: '💧' },
      { href: '/finance/revenue-analysis',             label: 'Revenue Analysis',       icon: '🔍' },
      { href: '/finance/branch-pl',                    label: 'Branch P&L',             icon: '🏢' },
    ],
  },
  {
    label: 'Compliance & Analytics',
    items: [
      { href: '/finance/balance-sheet',    label: 'Balance Sheet',       icon: '📋' },
      { href: '/finance/corporate-tax',    label: 'Corporate Tax (UAE)', icon: '🏛️' },
      { href: '/finance/budget-approvals', label: 'Budget Approvals',    icon: '✅' },
      { href: '/finance/period-locks',     label: 'Period Locking',      icon: '🔒' },
      { href: '/finance/audit-log',        label: 'Audit Log',           icon: '🔍' },
    ],
  },
  {
    label: 'AI Intelligence',
    items: [
      { href: '/finance/anomalies', label: 'Anomaly Detection', icon: '🔍' },
    ],
  },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { tLabel, t } = useLanguage();

  const isActive = (href: string) =>
    href === '/finance' ? pathname === '/finance' : pathname.startsWith(href);

  return (
    <ModuleGuard moduleId="finance" moduleName="Finance & Billing" moduleIcon="💰">
    <div className="flex flex-col h-screen bg-slate-900">
      <PlatformHomeBar moduleName={t('module.finance')} moduleIcon="FN" accentColor="from-green-500 to-emerald-600" />
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 bg-black border-r border-white/10 p-4 overflow-y-auto flex-shrink-0">
          <h2 className="text-base font-bold text-white mb-4 px-2">{t('module.finance')}</h2>
          <nav className="space-y-5">
            {NAV_GROUPS.map(group => (
              <div key={group.label}>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-2 mb-2">
                  {tLabel(group.label)}
                </p>
                <div className="space-y-0.5">
                  {group.items.map(item => (
                    <Link key={item.href} href={item.href}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all text-sm ${
                        isActive(item.href)
                          ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-medium shadow-sm'
                          : 'text-slate-300 hover:bg-white/5 hover:text-white'
                      }`}>
                      <span className="text-base leading-none">{item.icon}</span>
                      <span>{tLabel(item.label)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          {/* Phase badge */}
          <div className="mt-6 mx-2 bg-emerald-900/40 border border-emerald-500/20 rounded-xl p-3">
            <p className="text-xs font-bold text-emerald-400">Phase 2 — {tLabel('Management Accounts')}</p>
            <p className="text-xs text-slate-500 mt-0.5">{tLabel('P&L · Cash Flow · Revenue Analysis · Branches')}</p>
          </div>
        </div>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-8">
          {children}
        </main>
      </div>
    </div>
  
    </ModuleGuard>
  );
}
