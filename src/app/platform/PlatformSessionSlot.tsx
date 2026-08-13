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

/**
 * Static placeholder rendered during SSR + the first client render, before
 * PermissionProvider has had a chance to read localStorage. Stable across
 * renders so React's hydration check passes — once mounted=true, we swap in
 * SessionFallback / UserSwitcher / Sign-in based on live auth state.
 */
function SsrPlaceholder() {
  return <div className="w-32 h-9 rounded-full bg-slate-800/60 border border-white/10 animate-pulse" />;
}

export default function PlatformSessionSlot() {
  // Track mount so we render an SSR-stable placeholder on server + first
  // client render. Without this the server renders <SessionFallback> (because
  // isLoading=true with no session at SSR time) while the client tries to
  // hydrate with <UserSwitcher> (because the localStorage snapshot has the
  // session), and React throws "Hydration failed" — re-rendering the whole
  // tree on the client and adding noticeable latency to /platform loads.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const { isAuthenticated, isLoading } = usePermissions();

  if (!mounted) return <SsrPlaceholder />;
  if (isLoading) return <SessionFallback label="Session..." />;
  if (isAuthenticated) return <UserSwitcher />;

  return (
    <Link
      href="/login"
      className="rounded-lg bg-blue-600/20 border border-blue-500/30 px-4 py-1.5 text-sm font-medium text-blue-300 hover:bg-blue-600/30 transition-all"
    >
      Sign in
    </Link>
  );
}
