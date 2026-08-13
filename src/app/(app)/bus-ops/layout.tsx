'use client';

import PlatformHomeBar from '@/components/PlatformHomeBar';
import ModuleGuard from '@/components/ModuleGuard';

export default function BusOpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleGuard moduleId="bus-ops" moduleName="Staff Transportation" moduleIcon="🚌">
      <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-white">
        <PlatformHomeBar moduleName="Staff Transportation" moduleIcon="B" accentColor="from-purple-500 to-pink-600" />
        <div className="relative flex-1 min-h-0 overflow-y-auto p-6">{children}</div>
      </div>
    </ModuleGuard>
  );
}
