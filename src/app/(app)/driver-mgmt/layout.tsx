'use client';

import PlatformHomeBar from '@/components/PlatformHomeBar';
import ModuleGuard from '@/components/ModuleGuard';

export default function DriverMgmtLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleGuard moduleId="driver-mgmt" moduleName="Driver Management" moduleIcon="👤">
      <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-white">
        <PlatformHomeBar moduleName="Driver Management" moduleIcon="D" accentColor="from-blue-500 to-indigo-600" />
        <div className="relative flex-1 min-h-0 overflow-y-auto p-6">{children}</div>
      </div>
    </ModuleGuard>
  );
}
