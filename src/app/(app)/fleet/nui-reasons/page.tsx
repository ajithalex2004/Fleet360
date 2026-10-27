'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Settings } from 'lucide-react';

export default function FleetNuiReasonsRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/admin/nui-reasons');
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] text-center p-6 space-y-4">
      <div className="w-12 h-12 rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400">
        <Settings className="w-6 h-6 animate-spin" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-main)]">Redirecting to Admin...</h2>
        <p className="text-xs text-[var(--text-muted)] mt-1">
          NUI Reason Master has moved to the central <strong>Administration</strong> module.
        </p>
      </div>
      <Link
        href="/admin/nui-reasons"
        className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-xl text-xs font-semibold shadow-md transition-all"
      >
        <span>Open Admin NUI Reason Master</span>
        <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}
