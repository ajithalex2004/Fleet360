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
    <div className="flex items-center justify-between px-4 py-2 bg-white/80 dark:bg-zinc-950/80 border-b border-black/10 dark:border-white/10 z-50 backdrop-blur-md flex-shrink-0 transition-colors">
      {/* Left: back to platform home + AI Agents quick link */}
      <div className="flex items-center gap-2">
        <Link
          href="/platform"
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-zinc-900 dark:text-zinc-100 hover:bg-black/10 dark:hover:bg-white/10 text-xs font-medium tracking-wide transition-all group min-w-0"
        >
          <ArrowLeft className="w-3.5 h-3.5 flex-shrink-0 group-hover:-translate-x-0.5 transition-transform" />
          <span className="hidden lg:inline whitespace-nowrap">FLEET360</span>
          <span className="lg:hidden">HOME</span>
        </Link>
        {/* AI Agents quick-access — visible on every module page except /agents itself */}
        {!isAgentsPage && (
          <Link
            href="/agents"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/10 hover:bg-violet-500/15 border border-violet-500/20 text-violet-700 dark:text-violet-300 text-xs font-medium transition-all"
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
