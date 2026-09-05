'use client';

import PlatformHomeBar from '@/components/PlatformHomeBar';
import ModuleGuard from '@/components/ModuleGuard';

export default function VendorsLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleGuard moduleId="vendors" moduleName="Vendors" moduleIcon="??">
      <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-main)]">
        <PlatformHomeBar moduleName="Vendors" moduleIcon="V" accentColor="from-emerald-500 to-teal-600" />
        <div className="relative flex-1 min-h-0 overflow-y-auto p-6">{children}</div>
      </div>
    </ModuleGuard>
  );
}
