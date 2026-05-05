'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePermissions } from '@/contexts/PermissionContext';
import UserSwitcher from '@/components/UserSwitcher';
import BranchSelector from '@/components/BranchSelector';
import LanguageSwitcher from '@/components/LanguageSwitcher';

interface Props {
  moduleName: string;
  moduleIcon?: string;
  accentColor?: string;
}

export default function PlatformHomeBar({
  moduleName,
  moduleIcon = 'M',
  accentColor = 'from-blue-500 to-indigo-600',
}: Props) {
  const { user, tenant, isAuthenticated } = usePermissions();
  const pathname = usePathname();
  const isAgentsPage = pathname?.startsWith('/agents');

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-slate-950/90 border-b border-white/5 z-50 backdrop-blur-sm flex-shrink-0">
      {/* Left: back to platform home + AI Agents quick link */}
      <div className="flex items-center gap-2">
        <Link
          href="/platform"
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-slate-300 hover:text-white text-sm font-semibold transition-all group min-w-0"
        >
          <span className="flex-shrink-0 text-xs group-hover:-translate-x-0.5 transition-transform">&#8592;</span>
          <span className="hidden lg:inline whitespace-nowrap tracking-wide">XL AI HOME</span>
          <span className="lg:hidden text-xs">HOME</span>
        </Link>
        {/* AI Agents quick-access — visible on every module page except /agents itself */}
        {!isAgentsPage && (
          <Link
            href="/agents"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 hover:border-violet-400/50 text-violet-400 hover:text-violet-300 text-xs font-semibold transition-all"
          >
            <span>🤖</span>
            <span className="whitespace-nowrap">AI Agents</span>
          </Link>
        )}
      </div>

      {/* Centre: current module breadcrumb */}
      <div className="flex items-center gap-2 mx-4">
        <div
          className={`w-5 h-5 rounded bg-gradient-to-br ${accentColor} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}
        >
          {moduleIcon}
        </div>
        <span className="text-slate-500 text-xs">/</span>
        <span className="text-white text-sm font-medium whitespace-nowrap">{moduleName}</span>
        {tenant && (
          <>
            <span className="text-slate-600 text-xs hidden md:inline">/</span>
            <span className="text-slate-500 text-xs hidden md:inline truncate max-w-32">{tenant.name}</span>
          </>
        )}
      </div>

      {/* Right: language switcher + branch selector + user switcher */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <LanguageSwitcher />
        <BranchSelector compact />
        {isAuthenticated ? (
          <UserSwitcher />
        ) : (
          <Link
            href="/platform"
            className="text-xs px-3 py-1.5 rounded-full bg-slate-800 border border-white/10 text-slate-400 hover:text-white transition-colors"
          >
            Not signed in
          </Link>
        )}
      </div>
    </div>
  );
}
