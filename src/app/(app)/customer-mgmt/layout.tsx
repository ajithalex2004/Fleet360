'use client';

import PlatformHomeBar from '@/components/PlatformHomeBar';
import ModuleGuard from '@/components/ModuleGuard';

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleGuard moduleId="customer-mgmt" moduleName="Customer Management" moduleIcon="🏢">
      <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-white">
        <PlatformHomeBar moduleName="Customer Management" moduleIcon="C" accentColor="from-cyan-500 to-blue-600" />
        <div className="relative flex-1 min-h-0 overflow-y-auto p-6">{children}</div>
      </div>
    </ModuleGuard>
  );
}
