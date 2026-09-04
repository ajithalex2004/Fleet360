'use client';

import PlatformHomeBar from '@/components/PlatformHomeBar';
import ModuleGuard from '@/components/ModuleGuard';

export default function DispatchLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleGuard moduleId="dispatch" moduleName="Dispatch Control" moduleIcon="🚦">
      <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-main)]">
        <PlatformHomeBar moduleName="Dispatch Control" moduleIcon="🚦" accentColor="from-blue-500 to-cyan-500" />
        <div className="relative flex-1 min-h-0 overflow-y-auto p-6">{children}</div>
      </div>
    </ModuleGuard>
  );
}
