'use client';

import PlatformHomeBar from '@/components/PlatformHomeBar';
import ModuleGuard from '@/components/ModuleGuard';

export default function FleetLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleGuard moduleId="fleet" moduleName="Fleet Management" moduleIcon="🚘">
      <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-white">
        <PlatformHomeBar moduleName="Fleet Management" moduleIcon="F" accentColor="from-orange-500 to-amber-600" />
        <div className="p-6">{children}</div>
      </div>
    </ModuleGuard>
  );
}
