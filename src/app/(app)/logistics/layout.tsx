'use client';
/**
 * Logistics module layout.
 *
 * The persistent AppShell (sidebar + workspace tabs) is now provided by
 * the parent (app) route group layout, so it stays mounted as the user
 * navigates between /logistics/* sub-pages. This file is left with just
 * the module-specific chrome: ModuleGuard (subscription gate) and
 * PlatformHomeBar (module top bar).
 *
 * The `<div className="p-6">` wrapper that used to live around children
 * inside AppShell moved into this layout so the same spacing applies.
 */

import { useLanguage } from '@/contexts/LanguageContext';
import PlatformHomeBar from '@/components/PlatformHomeBar';
import ModuleGuard from '@/components/ModuleGuard';

export default function LogisticsLayout({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();

  return (
    <ModuleGuard moduleId="logistics" moduleName="Logistics Management" moduleIcon="🚛">
      <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-white">
        <PlatformHomeBar moduleName={t('module.logistics')} moduleIcon="🚛" accentColor="from-amber-500 to-orange-600" />
        <div className="relative flex-1 min-h-0 overflow-y-auto p-6">{children}</div>
      </div>
    </ModuleGuard>
  );
}
