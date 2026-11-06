'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import PlatformHomeBar from '@/components/PlatformHomeBar';
import ModuleGuard from '@/components/ModuleGuard';

const FINANCE_TABS = [
  { href: '/finance',                     label: 'Dashboard',           icon: '📊' },
  { href: '/finance/invoices',            label: 'Invoices',            icon: '🧾' },
  { href: '/finance/recurring-invoices',  label: 'Recurring',           icon: '🔁' },
  { href: '/finance/payments',            label: 'Payments',            icon: '💳' },
  { href: '/finance/credit-notes',        label: 'Credit Notes',        icon: '📄' },
  { href: '/finance/debit-notes',         label: 'Debit Notes',         icon: '📝' },
  { href: '/finance/ar-aging',            label: 'AR Aging',            icon: '⏳' },
  { href: '/finance/collections',         label: 'Collections',         icon: '📞' },
  { href: '/finance/payment-reminders',   label: 'Reminders',           icon: '🔔' },
  { href: '/finance/pdc',                 label: 'PDC Register',        icon: '🏦' },
  { href: '/finance/payables',            label: 'Payables (AP)',       icon: '📥' },
  { href: '/finance/expenses',            label: 'Expenses',            icon: '⛽' },
  { href: '/finance/deposits',            label: 'Deposits',            icon: '🔒' },
  { href: '/finance/bank-reconciliation', label: 'Bank Recon',          icon: '🔄' },
  { href: '/finance/coa',                 label: 'Chart of Accounts',   icon: '🗂️' },
  { href: '/finance/journal-entries',     label: 'Journals',            icon: '📒' },
  { href: '/finance/general-ledger',      label: 'General Ledger',      icon: '⚖️' },
  { href: '/finance/fixed-assets',        label: 'Fixed Assets',        icon: '🏗️' },
  { href: '/finance/management-accounts', label: 'Management Accounts', icon: '📈' },
  { href: '/finance/profit-centres',      label: 'Profit Centres',      icon: '🎯' },
  { href: '/finance/branch-pl',           label: 'Branch P&L',          icon: '🏢' },
  { href: '/finance/revenue-analysis',    label: 'Revenue Analysis',    icon: '🔍' },
  { href: '/finance/balance-sheet',       label: 'Balance Sheet',       icon: '📋' },
  { href: '/finance/budgets',             label: 'Budgets',             icon: '🎯' },
  { href: '/finance/budget-approvals',    label: 'Approvals',           icon: '✅' },
  { href: '/finance/tax',                 label: 'Tax Engine',          icon: '🏛️' },
  { href: '/finance/vat',                 label: 'VAT Returns',         icon: '📤' },
  { href: '/finance/vat-branch',          label: 'VAT by Branch',       icon: '🧾' },
  { href: '/finance/corporate-tax',       label: 'Corporate Tax',       icon: '🇦🇪' },
  { href: '/finance/period-locks',        label: 'Period Locks',        icon: '🔐' },
  { href: '/finance/audit-log',           label: 'Audit Log',           icon: '📜' },
  { href: '/finance/anomalies',           label: 'AI Anomalies',        icon: '🤖' },
];

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === '/finance' ? pathname === '/finance' : pathname?.startsWith(href);

  return (
    <ModuleGuard moduleId="finance" moduleName="Finance & Billing" moduleIcon="💰">
      <div className="flex h-full flex-col overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-main)]">
        <PlatformHomeBar moduleName="Finance & Billing" moduleIcon="FN" accentColor="from-green-500 to-emerald-600" />
        <nav className="flex items-center gap-1 overflow-x-auto border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/80 px-4 py-1.5 flex-shrink-0">
          {FINANCE_TABS.map(tab => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                isActive(tab.href)
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-main)]'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </Link>
          ))}
        </nav>
        <div className="relative flex-1 min-h-0 overflow-y-auto p-6">{children}</div>
      </div>
    </ModuleGuard>
  );
}
