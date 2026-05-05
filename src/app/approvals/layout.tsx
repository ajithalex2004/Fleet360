'use client';
import PlatformHomeBar from '@/components/PlatformHomeBar';
import { useLanguage } from '@/contexts/LanguageContext';

export default function ApprovalsLayout({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-slate-950">
      <PlatformHomeBar moduleName={t('module.approvals')} moduleIcon="A" accentColor="from-violet-500 to-purple-600" />
      <main className="flex-1 overflow-y-auto bg-slate-950">
        <div className="p-8 min-h-full">{children}</div>
      </main>
    </div>
  );
}
