'use client';

import PlatformHomeBar from '@/components/PlatformHomeBar';
import ModuleGuard from '@/components/ModuleGuard';

export default function SustainabilityLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleGuard moduleId="sustainability" moduleName="Sustainability & ESG" moduleIcon="🌱">
      <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-main)]">
        <PlatformHomeBar moduleName="Sustainability & ESG" moduleIcon="🌱" accentColor="from-emerald-500 to-green-600" />
        <div className="relative flex-1 min-h-0 overflow-y-auto p-6">{children}</div>
      </div>
    </ModuleGuard>
  );
}
