'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePermissions } from '@/contexts/PermissionContext';
import UserSwitcher from '@/components/UserSwitcher';
import BranchSelector from '@/components/BranchSelector';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import ThemeToggle from '@/components/ThemeToggle';

interface Props {
  moduleName: string;
  moduleIcon?: string;
  accentColor?: string;
}

/**
 * Same hydration-safety trick as PlatformSessionSlot: render a stable
 * placeholder on SSR + first client render, then swap to UserSwitcher /
 * "Not signed in" once PermissionProvider has read localStorage.
 */
function SessionSlotPlaceholder() {
  return <div className="w-32 h-9 rounded-full bg-slate-800/60 border border-white/10 animate-pulse" />;
}

function AuthSlot() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const { isAuthenticated } = usePermissions();

  if (!mounted) return <SessionSlotPlaceholder />;
  if (isAuthenticated) return <UserSwitcher />;
  return (
    <Link
      href="/platform"
      className="text-xs px-3 py-1.5 rounded-full bg-slate-800 border border-white/10 text-slate-400 hover:text-white transition-colors"
    >
      Not signed in
    </Link>
  );
}

import { Bot, ArrowLeft } from 'lucide-react';

export default function PlatformHomeBar({
  moduleName,
  moduleIcon = 'M',
  accentColor = 'from-blue-500 to-indigo-600',
}: Props) {
  const { tenant } = usePermissions();
  const pathname = usePathname();
  const isAgentsPage = pathname?.startsWith('/agents');

  return (
    <div className="flex items-center justify-between px-4 py-2.5 bg-slate-950/85 dark:bg-slate-950/85 bg-white/90 border-b border-white/10 dark:border-white/10 border-slate-200/80 z-50 backdrop-blur-xl flex-shrink-0 transition-colors">
      {/* Left: back to platform home + AI Agents quick link */}
      <div className="flex items-center gap-2">
        <Link
          href="/platform"
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 dark:bg-white/5 bg-slate-100 border border-white/10 dark:border-white/10 border-slate-200/90 text-slate-200 dark:text-slate-200 text-slate-700 hover:text-white dark:hover:text-white hover:text-slate-950 text-xs font-bold tracking-wider transition-all group min-w-0 shadow-sm"
        >
          <ArrowLeft className="w-3.5 h-3.5 flex-shrink-0 group-hover:-translate-x-0.5 transition-transform" />
          <span className="hidden lg:inline whitespace-nowrap">FLEET360 HOME</span>
          <span className="lg:hidden">HOME</span>
        </Link>
        {/* AI Agents quick-access — visible on every module page except /agents itself */}
        {!isAgentsPage && (
          <Link
            href="/agents"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 hover:border-violet-400/50 text-violet-400 dark:text-violet-400 text-violet-600 text-xs font-semibold transition-all shadow-sm"
          >
            <Bot className="w-3.5 h-3.5" />
            <span className="whitespace-nowrap">AI Agents</span>
          </Link>
        )}
      </div>

      {/* Centre: current module breadcrumb */}
      <div className="flex items-center gap-2 mx-4">
        <div
          className={`w-6 h-6 rounded-lg bg-gradient-to-br ${accentColor} flex items-center justify-center text-white text-xs font-extrabold flex-shrink-0 shadow-md`}
        >
          {moduleIcon}
        </div>
        <span className="text-slate-500 dark:text-slate-500 text-slate-400 text-xs">/</span>
        <span className="text-white dark:text-white text-slate-900 text-sm font-bold tracking-tight whitespace-nowrap">{moduleName}</span>
        {tenant && (
          <>
            <span className="text-slate-600 dark:text-slate-600 text-slate-400 text-xs hidden md:inline">/</span>
            <span className="text-slate-400 dark:text-slate-400 text-slate-500 text-xs font-medium hidden md:inline truncate max-w-32">{tenant.name}</span>
          </>
        )}
      </div>

      {/* Right: theme + language switcher + branch selector + user switcher */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <ThemeToggle />
        <LanguageSwitcher />
        <BranchSelector compact />
        <AuthSlot />
      </div>
    </div>
  );
}
