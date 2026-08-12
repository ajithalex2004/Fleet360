'use client';

import PlatformHomeBar from '@/components/PlatformHomeBar';
import ModuleGuard from '@/components/ModuleGuard';
import AppShell from '@/components/nav/AppShell';

export default function ComplianceLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleGuard moduleId="compliance" moduleName="Compliance & Regulatory" moduleIcon="⚖️">
      <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-white">
        <PlatformHomeBar moduleName="Compliance & Regulatory" moduleIcon="C" accentColor="from-cyan-500 to-blue-600" />
        <AppShell>
          <div className="p-6">{children}</div>
        </AppShell>
      </div>
    </ModuleGuard>
  );
}
