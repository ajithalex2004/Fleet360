'use client';

import PlatformHomeBar from '@/components/PlatformHomeBar';
import ModuleGuard from '@/components/ModuleGuard';

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleGuard moduleId="finance" moduleName="Finance & Billing" moduleIcon="💰">
      <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-white">
        <PlatformHomeBar moduleName="Finance & Billing" moduleIcon="FN" accentColor="from-green-500 to-emerald-600" />
        <div className="relative flex-1 min-h-0 overflow-y-auto p-6">{children}</div>
      </div>
    </ModuleGuard>
  );
}
