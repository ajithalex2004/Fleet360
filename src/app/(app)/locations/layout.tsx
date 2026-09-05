'use client';

import PlatformHomeBar from '@/components/PlatformHomeBar';
import ModuleGuard from '@/components/ModuleGuard';

export default function LocationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleGuard moduleId="fleet" moduleName="Locations" moduleIcon="??">
      <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-main)]">
        <PlatformHomeBar moduleName="Locations" moduleIcon="L" accentColor="from-blue-500 to-indigo-600" />
        <div className="relative flex-1 min-h-0 overflow-y-auto p-6">{children}</div>
      </div>
    </ModuleGuard>
  );
}
