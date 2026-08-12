'use client';

import PlatformHomeBar from '@/components/PlatformHomeBar';
import ModuleGuard from '@/components/ModuleGuard';

export default function RentalLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleGuard moduleId="rental" moduleName="Rent-a-Car" moduleIcon="🚗">
      <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-white">
        <PlatformHomeBar moduleName="Rent-a-Car" moduleIcon="RC" accentColor="from-teal-500 to-cyan-600" />
        <div className="relative flex-1 min-h-0 overflow-y-auto p-6">{children}</div>
      </div>
    </ModuleGuard>
  );
}
