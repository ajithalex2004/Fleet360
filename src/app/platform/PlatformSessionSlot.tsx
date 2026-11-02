'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import UserSwitcher from '@/components/UserSwitcher';
import { usePermissions } from '@/contexts/PermissionContext';

function SessionFallback({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800 border border-white/10">
      <span className="w-2 h-2 rounded-full bg-slate-500" />
      <span className="text-slate-400 text-xs">{label}</span>
    </div>
  );
}

function SsrPlaceholder() {
  return <div className="w-32 h-9 rounded-xl bg-slate-800/60 border border-white/10 animate-pulse" />;
}

export default function PlatformSessionSlot() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const { isAuthenticated, isLoading } = usePermissions();

  if (!mounted) return <SsrPlaceholder />;
  if (isLoading) return <SessionFallback label="Session..." />;
  if (isAuthenticated) return <UserSwitcher />;

  const hasLocalSession =
    typeof window !== 'undefined' &&
    (!!localStorage.getItem('xl_mobility_session') || !!localStorage.getItem('xl_mobility_session_snapshot'));
  if (hasLocalSession) {
    return <SessionFallback label="Authenticating..." />;
  }

  return (
    <Link
      href="/login"
      className="rounded-xl bg-blue-600/20 border border-blue-500/40 px-4 py-1.5 text-xs font-semibold text-blue-300 hover:bg-blue-600/30 hover:text-white transition-all"
    >
      Sign In
    </Link>
  );
}
