'use client';

import PlatformHomeBar from '@/components/PlatformHomeBar';
import ModuleGuard from '@/components/ModuleGuard';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleGuard moduleId="admin" moduleName="Admin" moduleIcon="⚙️">
      <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-white">
        <PlatformHomeBar moduleName="Admin" moduleIcon="A" accentColor="from-red-500 to-rose-600" />
        {/*
          Inner content area:
          - `relative`       — positioning context for child pages that use
                               `absolute inset-0` (e.g. /admin/roles) to fill
                               the viewport without depending on the broken
                               h-full chain (body is `display: block`, so
                               `h-full` doesn't propagate from html down).
          - `flex-1 min-h-0` — takes the remaining vertical space below
                               PlatformHomeBar. min-h-0 lets it shrink below
                               its content height when an absolute child
                               pins itself to all four edges.
          - `overflow-y-auto` — pages with natural content height scroll here
                               (PlatformHomeBar stays pinned to the top).
        */}
        <div className="relative flex-1 min-h-0 overflow-y-auto p-6">{children}</div>
      </div>
    </ModuleGuard>
  );
}
