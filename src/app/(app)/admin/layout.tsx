'use client';

import PlatformHomeBar from '@/components/PlatformHomeBar';
import ModuleGuard from '@/components/ModuleGuard';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleGuard moduleId="admin" moduleName="Admin" moduleIcon="⚙️">
      <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-white">
        <PlatformHomeBar moduleName="Admin" moduleIcon="A" accentColor="from-red-500 to-rose-600" />
        <div className="p-6">{children}</div>
      </div>
    </ModuleGuard>
  );
}
