'use client';

import PlatformHomeBar from '@/components/PlatformHomeBar';
import ModuleGuard from '@/components/ModuleGuard';
import AppShell from '@/components/nav/AppShell';

export default function LeasingLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleGuard moduleId="leasing" moduleName="Vehicle Leasing" moduleIcon="📋">
      <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-white">
        <PlatformHomeBar moduleName="Vehicle Leasing" moduleIcon="VL" accentColor="from-violet-500 to-purple-600" />
        <AppShell>
          <div className="p-6">{children}</div>
        </AppShell>
      </div>
    </ModuleGuard>
  );
}
