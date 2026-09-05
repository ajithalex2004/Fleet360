'use client';

import PlatformHomeBar from '@/components/PlatformHomeBar';
import ModuleGuard from '@/components/ModuleGuard';

export default function AssetsLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleGuard moduleId="assets" moduleName="Assets & Inventory" moduleIcon="🏗️">
      <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-main)]">
        <PlatformHomeBar moduleName="Assets & Inventory" moduleIcon="🏗️" accentColor="from-yellow-400 to-amber-600" />
        <div className="relative flex-1 min-h-0 overflow-y-auto p-6">{children}</div>
      </div>
    </ModuleGuard>
  );
}
