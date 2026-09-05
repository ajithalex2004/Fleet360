'use client';

import PlatformHomeBar from '@/components/PlatformHomeBar';
import ModuleGuard from '@/components/ModuleGuard';

export default function AIPlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleGuard moduleId="ai-platform" moduleName="AI Platform" moduleIcon="??">
      <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-main)]">
        <PlatformHomeBar moduleName="AI Platform" moduleIcon="AI" accentColor="from-purple-500 to-indigo-600" />
        <div className="relative flex-1 min-h-0 overflow-y-auto p-6">{children}</div>
      </div>
    </ModuleGuard>
  );
}
