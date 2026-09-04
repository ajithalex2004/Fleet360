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
  return <div className="w-32 h-9 rounded-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] animate-pulse" />;
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
      className="text-xs px-3 py-1.5 rounded-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
    >
      Not signed in
    </Link>
  );
}

import { Bot, ArrowLeft, Search } from 'lucide-react';

export default function PlatformHomeBar({
  moduleName,
  moduleIcon = 'M',
  accentColor = 'from-blue-500 to-indigo-600',
}: Props) {
  const { tenant } = usePermissions();
  const pathname = usePathname();
  const isAgentsPage = pathname?.startsWith('/agents');

  const openPalette = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('fleet360:open-command-palette'));
    }
  };

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] z-50 backdrop-blur-md flex-shrink-0 transition-colors">
      {/* Left: back to platform home + AI Agents quick link + Command Palette */}
      <div className="flex items-center gap-2">
        <Link
          href="/platform"
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] hover:border-[var(--border-strong)] text-xs font-medium tracking-wide transition-all group min-w-0"
        >
          <ArrowLeft className="w-3.5 h-3.5 flex-shrink-0 group-hover:-translate-x-0.5 transition-transform" />
          <span className="hidden lg:inline whitespace-nowrap">FLEET360</span>
          <span className="lg:hidden">HOME</span>
        </Link>
        {/* AI Agents quick-access — visible on every module page except /agents itself */}
        {!isAgentsPage && (
          <Link
            href="/agents"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/10 hover:bg-violet-500/15 border border-violet-500/20 text-violet-400 text-xs font-medium transition-all"
          >
            <Bot className="w-3.5 h-3.5" />
            <span className="whitespace-nowrap">AI Agents</span>
          </Link>
        )}

        {/* Global ⌘K Omni-Search Button */}
        <button
          onClick={openPalette}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-[var(--text-muted)] hover:text-[var(--text-main)] text-xs transition-all cursor-pointer group"
          title="Search anything (⌘K or Ctrl+K)"
        >
          <Search className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-emerald-500 transition-colors" />
          <span className="hidden sm:inline">Search...</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] font-mono text-[10px] text-[var(--text-muted)] group-hover:border-emerald-500/40">
            <span>⌘</span>K
          </kbd>
        </button>
      </div>

      {/* Centre: current module breadcrumb */}
      <div className="flex items-center gap-2 mx-4">
        <div
          className={`w-6 h-6 rounded-lg bg-gradient-to-br ${accentColor} flex items-center justify-center text-white text-xs font-extrabold flex-shrink-0 shadow-md`}
        >
          {moduleIcon}
        </div>
        <span className="text-[var(--text-faint)] text-xs">/</span>
        <span className="text-[var(--text-main)] text-sm font-bold tracking-tight whitespace-nowrap">{moduleName}</span>
        {tenant && (
          <>
            <span className="text-[var(--text-faint)] text-xs hidden md:inline">/</span>
            <span className="text-[var(--text-faint)] text-xs font-medium hidden md:inline truncate max-w-32">{tenant.name}</span>
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
