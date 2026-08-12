'use client';

import PlatformHomeBar from '@/components/PlatformHomeBar';
import ModuleGuard from '@/components/ModuleGuard';

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleGuard moduleId="reports" moduleName="Reports & Analytics" moduleIcon="📊">
      <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-white">
        <PlatformHomeBar moduleName="Reports & Analytics" moduleIcon="RP" accentColor="from-slate-500 to-slate-600" />
        <div className="relative flex-1 min-h-0 overflow-y-auto p-6">{children}</div>
      </div>
    </ModuleGuard>
  );
}
