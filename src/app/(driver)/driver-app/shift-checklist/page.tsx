'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Redirects any legacy /driver-app/shift-checklist link directly to the simplest
 * LogiXL-Connect Driver App (/driver-app/today) without showing a Pre-Trip Checklist.
 */
export default function ShiftChecklistPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/driver-app/today');
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 text-slate-600 text-sm font-semibold">
      Opening LogiXL-Connect My Jobs…
    </div>
  );
}
