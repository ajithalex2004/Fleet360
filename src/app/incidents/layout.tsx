'use client';

import { usePathname } from 'next/navigation';
import PlatformHomeBar from '@/components/PlatformHomeBar';
import ModuleGuard from '@/components/ModuleGuard';
import AppShell from '@/components/nav/AppShell';

export default function IncidentsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // The Ambulance Dispatch Board is a full-screen specialist surface — it
  // brings its own chrome, so we render only the ModuleGuard around children.
  if (pathname === '/incidents/ambulance/dispatch') {
    return (
      <ModuleGuard moduleId="incidents" moduleName="Incident & Ambulance" moduleIcon="🚨">
        <div className="flex h-screen w-full overflow-hidden bg-slate-950">{children}</div>
      </ModuleGuard>
    );
  }

  return (
    <ModuleGuard moduleId="incidents" moduleName="Incident & Ambulance" moduleIcon="🚨">
      <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-white">
        <PlatformHomeBar moduleName="Incident & Ambulance" moduleIcon="🚨" accentColor="from-red-500 to-rose-600" />
        <AppShell>
          <div className="p-6">{children}</div>
        </AppShell>
      </div>
    </ModuleGuard>
  );
}
