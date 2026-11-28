'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import UserSwitcher from '@/components/UserSwitcher';
import { usePermissions } from '@/contexts/PermissionContext';

function SessionFallback({ label }: { label: string }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs"
      style={{
        backgroundColor: 'var(--pf-btn-sec-bg, var(--bg-surface))',
        borderColor: 'var(--pf-outline-variant, var(--border-subtle))',
        color: 'var(--pf-on-surface-variant, var(--text-muted))',
      }}
    >
      <span
        className="w-2 h-2 rounded-full"
        style={{ backgroundColor: 'var(--pf-outline, #6F7A6E)' }}
      />
      <span>{label}</span>
    </div>
  );
}

function SsrPlaceholder() {
  return (
    <div
      className="w-28 h-9 rounded-md border animate-pulse"
      style={{
        backgroundColor: 'var(--pf-btn-sec-bg, var(--bg-surface))',
        borderColor: 'var(--pf-outline-variant, var(--border-subtle))',
      }}
    />
  );
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

  return (
    <Link
      href="/login?logout=true"
      className="pf-btn-secondary inline-flex items-center px-3 py-2 rounded-md text-[13px] font-semibold"
    >
      Sign In
    </Link>
  );
}
